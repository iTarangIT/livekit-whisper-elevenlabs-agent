import { defineAgent, type JobContext, type JobProcess } from '@livekit/agents';
import { VAD } from '@livekit/agents-plugin-silero';
import {
  type AudioFrame,
  AudioSource,
  AudioStream,
  LocalAudioTrack,
  type RemoteParticipant,
  type RemoteTrack,
  RoomEvent,
  TrackKind,
  TrackPublishOptions,
  TrackSource,
  combineAudioFrames,
} from '@livekit/rtc-node';
import { config } from '../config/env.js';
import { createAgentSession } from '../elevenlabs-agent/agent-session.js';
import { WhisperService } from '../services/whisper.service.js';
import { CHANNELS, SAMPLE_RATE } from '../types/index.js';
import { createLogger } from '../utils/logger.js';
import { VadService } from '../vad/vad.service.js';

const logger = createLogger('agent');

interface AgentUserData {
  vad?: VAD;
}

function framesToPcm(frames: AudioFrame[]): Buffer {
  const merged = combineAudioFrames(frames);
  return Buffer.from(merged.data.buffer, merged.data.byteOffset, merged.data.byteLength);
}

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

export default defineAgent<AgentUserData>({
  prewarm: async (proc: JobProcess<AgentUserData>) => {
    proc.userData.vad = await VAD.load({
      minSpeechDuration: 0.1,
      minSilenceDuration: 0.5,
      sampleRate: SAMPLE_RATE,
    });
    logger.info('vad model loaded');
  },

  entry: async (ctx: JobContext<AgentUserData>) => {
    const agentId = config.elevenLabs.agentId;
    if (!agentId) {
      throw new Error('ELEVENLABS_AGENT_ID is required to run the agent bridge');
    }

    const vad = ctx.proc.userData.vad;
    if (!vad) {
      throw new Error('vad model was not initialized during prewarm');
    }

    const stt = new WhisperService(config.openai.apiKey, config.openai.whisperModel, config.stt);
    const source = new AudioSource(SAMPLE_RATE, CHANNELS);
    const track = LocalAudioTrack.createAudioTrack('agent-voice', source);
    const session = createAgentSession(config.elevenLabs.apiKey, agentId, source);

    let queue: Promise<void> = Promise.resolve();
    const handleUtterance = async (frames: AudioFrame[]): Promise<void> => {
      if (frames.length === 0) {
        return;
      }
      const text = await stt.transcribe(framesToPcm(frames));
      if (text.length === 0) {
        return;
      }
      logger.info('transcript received', { text });
      session.bridge.interrupt();
      session.sendUserMessage(text);
    };

    const callbacks = {
      onSpeechStart: () => logger.info('speech started'),
      onSpeechEnd: (frames: AudioFrame[]) => {
        logger.info('speech ended');
        queue = queue.then(() => handleUtterance(frames)).catch((error: unknown) => {
          logger.error('failed to handle utterance', {
            reason: error instanceof Error ? error.message : String(error),
          });
        });
      },
    };

    let sessionStarted = false;
    const ensureSessionStarted = (): void => {
      if (sessionStarted) {
        return;
      }
      sessionStarted = true;
      session
        .start()
        .then(() => logger.info('elevenlabs agent session started', { agentId }))
        .catch((error: unknown) => {
          logger.error('failed to start agent session', {
            reason: error instanceof Error ? error.message : String(error),
          });
        });
    };

    const vadSessions = new Map<string, VadService>();
    const startListening = (audioTrack: RemoteTrack, participant: RemoteParticipant): void => {
      const key = audioTrack.sid ?? participant.identity;
      if (vadSessions.has(key)) {
        return;
      }
      logger.info('audio track subscribed', { participant: participant.identity });
      const input = new AudioStream(audioTrack, {
        sampleRate: SAMPLE_RATE,
        numChannels: CHANNELS,
        frameSizeMs: 20,
      });
      const vadSession = new VadService(vad, callbacks);
      vadSession.start(input);
      vadSessions.set(key, vadSession);
      ensureSessionStarted();
    };

    const stop = (): void => {
      for (const vadSession of vadSessions.values()) {
        void vadSession.close();
      }
      vadSessions.clear();
      session.end();
    };

    ctx.room.on(RoomEvent.ParticipantConnected, (participant) => {
      logger.info('participant joined', { participant: participant.identity });
    });

    ctx.room.on(RoomEvent.TrackSubscribed, (subscribed, _publication, participant) => {
      if (subscribed.kind !== TrackKind.KIND_AUDIO) {
        return;
      }
      startListening(subscribed, participant);
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
    logger.info('connected to room', { room: ctx.room.name, dealer: readDealerNumber(ctx.job.metadata) });

    const localParticipant = ctx.room.localParticipant;
    if (!localParticipant) {
      throw new Error('local participant unavailable after connecting');
    }
    await localParticipant.publishTrack(
      track,
      new TrackPublishOptions({ source: TrackSource.SOURCE_MICROPHONE }),
    );

    for (const participant of ctx.room.remoteParticipants.values()) {
      for (const publication of participant.trackPublications.values()) {
        if (publication.subscribed && publication.track && publication.track.kind === TrackKind.KIND_AUDIO) {
          startListening(publication.track, participant);
        }
      }
    }
  },
});
