import { defineAgent, type JobContext, type JobProcess } from '@livekit/agents';
import { VAD } from '@livekit/agents-plugin-silero';
import {
  AudioFrame,
  AudioSource,
  AudioStream,
  LocalAudioTrack,
  RoomEvent,
  TrackKind,
  TrackPublishOptions,
  TrackSource,
  combineAudioFrames,
} from '@livekit/rtc-node';
import { config } from '../config/env.js';
import { RuleBasedConversationService } from '../conversation/conversation.service.js';
import { ElevenLabsService } from '../services/elevenlabs.service.js';
import { TranscriptService } from '../services/transcript.service.js';
import { WhisperService } from '../services/whisper.service.js';
import { CHANNELS, SAMPLE_RATE } from '../types/index.js';
import { createLogger } from '../utils/logger.js';
import { VadService } from '../vad/vad.service.js';

const logger = createLogger('agent');

const FRAME_MS = 20;
const SAMPLES_PER_FRAME = (SAMPLE_RATE * FRAME_MS) / 1000;

interface AgentUserData {
  vad?: VAD;
}

function framesToPcm(frames: AudioFrame[]): Buffer {
  const merged = combineAudioFrames(frames);
  return Buffer.from(merged.data.buffer, merged.data.byteOffset, merged.data.byteLength);
}

async function playback(source: AudioSource, pcm: Buffer): Promise<void> {
  const total = Math.floor(pcm.byteLength / 2);
  const samples = new Int16Array(pcm.buffer, pcm.byteOffset, total);
  for (let offset = 0; offset < samples.length; offset += SAMPLES_PER_FRAME) {
    const end = Math.min(offset + SAMPLES_PER_FRAME, samples.length);
    const chunk = samples.slice(offset, end);
    await source.captureFrame(new AudioFrame(chunk, SAMPLE_RATE, CHANNELS, chunk.length));
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
    const vad = ctx.proc.userData.vad;
    if (!vad) {
      throw new Error('vad model was not initialized during prewarm');
    }

    const stt = new WhisperService(config.openai.apiKey, config.openai.whisperModel);
    const tts = new ElevenLabsService(
      config.elevenLabs.apiKey,
      config.elevenLabs.voiceId,
      config.elevenLabs.modelId,
    );
    const transcript = new TranscriptService();
    const conversation = new RuleBasedConversationService();

    const source = new AudioSource(SAMPLE_RATE, CHANNELS);
    const track = LocalAudioTrack.createAudioTrack('agent-voice', source);

    await ctx.connect();
    logger.info('connected to room', { room: ctx.room.name });

    const localParticipant = ctx.room.localParticipant;
    if (!localParticipant) {
      throw new Error('local participant unavailable after connecting');
    }
    await localParticipant.publishTrack(
      track,
      new TrackPublishOptions({ source: TrackSource.SOURCE_MICROPHONE }),
    );

    let queue: Promise<void> = Promise.resolve();

    const handleSpeech = async (frames: AudioFrame[]): Promise<void> => {
      if (frames.length === 0) {
        return;
      }
      const text = await stt.transcribe(framesToPcm(frames));
      if (text.length === 0) {
        return;
      }
      logger.info('transcript received', { text });
      transcript.addMessage('user', text);

      const reply = await conversation.respond(text, transcript.getHistory());
      transcript.addMessage('assistant', reply);
      logger.info('response generated', { reply });

      const audio = await tts.generateSpeech(reply);
      if (audio.length === 0) {
        return;
      }
      await playback(source, audio);
    };

    const callbacks = {
      onSpeechStart: () => logger.info('speech started'),
      onSpeechEnd: (frames: AudioFrame[]) => {
        logger.info('speech ended');
        queue = queue
          .then(() => handleSpeech(frames))
          .catch((error: unknown) => {
            logger.error('failed to handle speech segment', {
              reason: error instanceof Error ? error.message : String(error),
            });
          });
      },
    };

    const sessions = new Map<string, VadService>();

    ctx.room.on(RoomEvent.ParticipantConnected, (participant) => {
      logger.info('participant joined', { participant: participant.identity });
    });

    ctx.room.on(RoomEvent.TrackSubscribed, (subscribed, _publication, participant) => {
      if (subscribed.kind !== TrackKind.KIND_AUDIO) {
        return;
      }
      logger.info('audio track subscribed', { participant: participant.identity });
      const input = new AudioStream(subscribed, {
        sampleRate: SAMPLE_RATE,
        numChannels: CHANNELS,
        frameSizeMs: FRAME_MS,
      });
      const session = new VadService(vad, callbacks);
      session.start(input);
      sessions.set(participant.identity, session);
    });

    ctx.room.on(RoomEvent.ParticipantDisconnected, (participant) => {
      logger.info('participant left', { participant: participant.identity });
      const session = sessions.get(participant.identity);
      if (session) {
        void session.close();
        sessions.delete(participant.identity);
      }
    });

    ctx.room.on(RoomEvent.Disconnected, () => {
      logger.info('room disconnected');
      for (const session of sessions.values()) {
        void session.close();
      }
      sessions.clear();
    });
  },
});
