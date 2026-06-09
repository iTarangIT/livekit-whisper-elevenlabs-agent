import OpenAI, { toFile } from 'openai';
import { BYTES_PER_SAMPLE, CHANNELS, SAMPLE_RATE, type SttService } from '../types/index.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('whisper');

interface WhisperOptions {
  language?: string;
  prompt?: string;
}

function toWav(pcm: Buffer, sampleRate: number, channels: number): Buffer {
  const blockAlign = channels * BYTES_PER_SAMPLE;
  const byteRate = sampleRate * blockAlign;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(BYTES_PER_SAMPLE * 8, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

export class WhisperService implements SttService {
  private readonly client: OpenAI;

  constructor(
    apiKey: string,
    private readonly model: string,
    private readonly options: WhisperOptions = {},
  ) {
    this.client = new OpenAI({ apiKey });
  }

  async transcribe(audio: Buffer): Promise<string> {
    if (audio.length < BYTES_PER_SAMPLE * 2) {
      logger.warn('skipping empty audio buffer');
      return '';
    }

    const wav = toWav(audio, SAMPLE_RATE, CHANNELS);

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const startedAt = performance.now();
      try {
        const file = await toFile(wav, 'speech.wav', { type: 'audio/wav' });
        const result = await this.client.audio.transcriptions.create({
          file,
          model: this.model,
          language: this.options.language,
          prompt: this.options.prompt,
        });
        logger.latency('whisper', performance.now() - startedAt);
        return result.text.trim();
      } catch (error) {
        logger.error('transcription failed', {
          attempt,
          reason: error instanceof Error ? error.message : String(error),
        });
        if (attempt === 2) {
          return '';
        }
      }
    }

    return '';
  }
}
