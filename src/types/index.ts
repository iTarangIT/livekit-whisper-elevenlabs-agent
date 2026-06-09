import type { AudioFrame } from '@livekit/rtc-node';

export type Role = 'user' | 'assistant';

export interface Message {
  readonly role: Role;
  readonly text: string;
  readonly timestamp: number;
}

export interface SttService {
  transcribe(audio: Buffer): Promise<string>;
}

export interface TtsService {
  generateSpeech(text: string): Promise<Buffer>;
}

export interface ConversationEngine {
  respond(text: string, history: readonly Message[]): Promise<string>;
}

export interface TranscriptStore {
  addMessage(role: Role, text: string): Message;
  getHistory(): readonly Message[];
  clear(): void;
}

export interface VadCallbacks {
  onSpeechStart(): void;
  onSpeechEnd(frames: AudioFrame[]): void;
}

export const SAMPLE_RATE = 16000;
export const CHANNELS = 1;
export const BYTES_PER_SAMPLE = 2;
