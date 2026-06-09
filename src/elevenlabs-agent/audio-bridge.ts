import { AudioInterface } from '@elevenlabs/elevenlabs-js/api/resources/conversationalAi/conversation/index.js';
import { AudioFrame, type AudioSource } from '@livekit/rtc-node';
import { CHANNELS, SAMPLE_RATE } from '../types/index.js';

const FRAME_MS = 20;
const SAMPLES_PER_FRAME = (SAMPLE_RATE * FRAME_MS) / 1000;

export class LiveKitAudioBridge extends AudioInterface {
  private inputCallback?: (audio: Buffer) => void;
  private stopped = false;
  private generation = 0;
  private playChain: Promise<void> = Promise.resolve();

  constructor(private readonly source: AudioSource) {
    super();
  }

  start(inputCallback: (audio: Buffer) => void): void {
    this.inputCallback = inputCallback;
  }

  stop(): void {
    this.stopped = true;
    this.inputCallback = undefined;
    this.source.clearQueue();
  }

  output(audio: Buffer): void {
    if (this.stopped) {
      return;
    }
    const generation = this.generation;
    this.playChain = this.playChain.then(() => this.render(audio, generation)).catch(() => undefined);
  }

  interrupt(): void {
    this.generation += 1;
    this.source.clearQueue();
  }

  pushUserAudio(audio: Buffer): void {
    if (this.stopped || !this.inputCallback) {
      return;
    }
    this.inputCallback(audio);
  }

  private async render(audio: Buffer, generation: number): Promise<void> {
    const buffer = Buffer.from(audio);
    const samples = new Int16Array(buffer.buffer, buffer.byteOffset, buffer.length >> 1);
    for (let offset = 0; offset < samples.length; offset += SAMPLES_PER_FRAME) {
      if (this.stopped || generation !== this.generation) {
        return;
      }
      const end = Math.min(offset + SAMPLES_PER_FRAME, samples.length);
      const chunk = samples.slice(offset, end);
      await this.source.captureFrame(new AudioFrame(chunk, SAMPLE_RATE, CHANNELS, chunk.length));
    }
  }
}
