import type { ReadableStream } from 'node:stream/web';
import type { AudioFrame } from '@livekit/rtc-node';
import { VADEventType, type VAD, type VADStream } from '@livekit/agents';
import type { VadCallbacks } from '../types/index.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('vad');

export class VadService {
  private readonly stream: VADStream;
  private consuming?: Promise<void>;

  constructor(vad: VAD, private readonly callbacks: VadCallbacks) {
    this.stream = vad.stream();
  }

  start(input: ReadableStream<AudioFrame>): void {
    this.stream.updateInputStream(input);
    this.consuming = this.consume();
  }

  private async consume(): Promise<void> {
    try {
      for await (const event of this.stream) {
        if (event.type === VADEventType.START_OF_SPEECH) {
          this.callbacks.onSpeechStart();
        } else if (event.type === VADEventType.END_OF_SPEECH) {
          this.callbacks.onSpeechEnd(event.frames);
        }
      }
    } catch (error) {
      logger.error('vad stream ended unexpectedly', {
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async close(): Promise<void> {
    this.stream.close();
    if (this.consuming) {
      await this.consuming;
    }
  }
}
