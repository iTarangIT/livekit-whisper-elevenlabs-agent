import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import { SAMPLE_RATE, type TtsService } from '../types/index.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('elevenlabs');

const OUTPUT_FORMAT = `pcm_${SAMPLE_RATE}` as const;

async function collect(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const reader = stream.getReader();
  const chunks: Buffer[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (value) {
        chunks.push(Buffer.from(value));
      }
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}

export class ElevenLabsService implements TtsService {
  private readonly client: ElevenLabsClient;

  constructor(
    apiKey: string,
    private readonly voiceId: string,
    private readonly model: string,
  ) {
    this.client = new ElevenLabsClient({ apiKey });
  }

  async generateSpeech(text: string): Promise<Buffer> {
    const trimmed = text.trim();
    if (trimmed.length === 0) {
      return Buffer.alloc(0);
    }

    const startedAt = performance.now();
    try {
      const stream = await this.client.textToSpeech.convert(this.voiceId, {
        text: trimmed,
        modelId: this.model,
        outputFormat: OUTPUT_FORMAT,
      });
      const audio = await collect(stream);
      logger.latency('elevenlabs', performance.now() - startedAt);
      return audio;
    } catch (error) {
      logger.error('speech generation failed', {
        reason: error instanceof Error ? error.message : String(error),
      });
      return Buffer.alloc(0);
    }
  }
}
