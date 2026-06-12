import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { type JobContext, defineAgent, voice } from '@livekit/agents';
import * as openai from '@livekit/agents-plugin-openai';
import {
  ConnectionQuality,
  type RemoteParticipant,
  type RemoteTrack,
  RoomEvent,
  TrackKind,
} from '@livekit/rtc-node';
import { config } from '../config/env.js';
import { CallMetrics } from '../metrics/metrics.js';
import { createLogger } from '../utils/logger.js';

const STATS_INTERVAL_MS = 5000;

function qualityName(quality: ConnectionQuality): string {
  return ConnectionQuality[quality] ?? String(quality);
}

const logger = createLogger('agent');

function readDealerNumber(metadata: string): string {
  if (!metadata) {
    return '';
  }
  try {
    const parsed = JSON.parse(metadata) as { phoneNumber?: unknown };
    return typeof parsed.phoneNumber === 'string' ? parsed.phoneNumber : '';
  } catch {
    return '';
  }
}

function buildTurnDetection() {
  if (config.realtime.turnDetection === 'server_vad') {
    return {
      type: 'server_vad' as const,
      silence_duration_ms: config.realtime.silenceMs,
      create_response: true,
      interrupt_response: true,
    };
  }
  return {
    type: 'semantic_vad' as const,
    eagerness: 'medium' as const,
    create_response: true,
    interrupt_response: true,
  };
}

export default defineAgent({
  entry: async (ctx: JobContext) => {
    const metrics = new CallMetrics(
      ctx.job.room?.name ?? ctx.room.name ?? readDealerNumber(ctx.job.metadata) ?? 'call',
    );

    const instructions = readFileSync(resolve(config.realtime.instructionsPath), 'utf8');

    const agent = new voice.Agent({ instructions });
    const session = new voice.AgentSession({
      llm: new openai.realtime.RealtimeModel({
        apiKey: config.realtime.apiKey,
        model: config.realtime.model,
        voice: config.realtime.voice,
        turnDetection: buildTurnDetection(),
        inputAudioTranscription: { model: 'gpt-4o-mini-transcribe' },
      }),
    });

    session.on(voice.AgentSessionEventTypes.UserInputTranscribed, (ev) => {
      if (!ev.isFinal) {
        return;
      }
      logger.info('user transcript', { text: ev.transcript });
      metrics.userTranscript(ev.transcript);
    });

    session.on(voice.AgentSessionEventTypes.AgentStateChanged, (ev) => {
      if (ev.newState === 'thinking') {
        metrics.agentThinking();
      } else if (ev.newState === 'speaking') {
        metrics.agentSpeaking();
      }
    });

    session.on(voice.AgentSessionEventTypes.ConversationItemAdded, (ev) => {
      const item = ev.item;
      if (item.type !== 'message' || item.role !== 'assistant') {
        return;
      }
      metrics.agentTranscript(item.textContent ?? '', item.interrupted);
    });

    session.on(voice.AgentSessionEventTypes.MetricsCollected, (ev) => {
      metrics.realtimeMetrics(ev.metrics);
    });

    session.on(voice.AgentSessionEventTypes.Error, (ev) => {
      logger.error('agent session error', {
        reason: ev.error instanceof Error ? ev.error.message : String(ev.error),
      });
    });

    const seen = new Set<string>();
    const markAnswered = (track: RemoteTrack, participant: RemoteParticipant): void => {
      if (track.kind !== TrackKind.KIND_AUDIO) {
        return;
      }
      const key = track.sid ?? participant.identity;
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      logger.info('audio track subscribed', { participant: participant.identity });
      metrics.markAnswered();
    };

    let statsTimer: ReturnType<typeof setInterval> | undefined;
    let stopped = false;
    const stop = (): void => {
      if (stopped) {
        return;
      }
      stopped = true;
      if (statsTimer) {
        clearInterval(statsTimer);
        statsTimer = undefined;
      }
      metrics.finalize();
      void session.close();
    };

    ctx.room.on(RoomEvent.TrackSubscribed, (track, _publication, participant) => {
      markAnswered(track, participant);
    });

    ctx.room.on(RoomEvent.ConnectionQualityChanged, (quality, participant) => {
      metrics.quality(qualityName(quality));
      logger.debug('connection quality', {
        participant: participant.identity,
        quality: qualityName(quality),
      });
    });

    ctx.room.on(RoomEvent.ParticipantDisconnected, (participant) => {
      logger.info('participant left', { participant: participant.identity });
      stop();
    });

    ctx.room.on(RoomEvent.Disconnected, () => {
      logger.info('room disconnected');
      stop();
    });

    await ctx.connect();
    logger.info('connected to room', {
      room: ctx.room.name,
      dealer: readDealerNumber(ctx.job.metadata),
    });

    for (const participant of ctx.room.remoteParticipants.values()) {
      for (const publication of participant.trackPublications.values()) {
        if (publication.subscribed && publication.track) {
          markAnswered(publication.track, participant);
        }
      }
    }

    await session.start({ agent, room: ctx.room });
    metrics.greetingStart();
    session.generateReply({
      instructions: `Open the call by greeting the dealer. Say exactly this, word for word, then stop: "${config.call.openingLine}"`,
    });
    logger.info('realtime session started', {
      model: config.realtime.model,
      voice: config.realtime.voice,
    });

    statsTimer = setInterval(() => {
      ctx.room
        .getRtcStats()
        .then((stats) => metrics.rtcStats(stats))
        .catch((error: unknown) => {
          logger.debug('failed to read rtc stats', {
            reason: error instanceof Error ? error.message : String(error),
          });
        });
    }, STATS_INTERVAL_MS);
  },
});
