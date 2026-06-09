import type { Message, Role, TranscriptStore } from '../types/index.js';

export class TranscriptService implements TranscriptStore {
  private readonly messages: Message[] = [];

  addMessage(role: Role, text: string): Message {
    const message: Message = { role, text, timestamp: Date.now() };
    this.messages.push(message);
    return message;
  }

  getHistory(): readonly Message[] {
    return this.messages.slice();
  }

  clear(): void {
    this.messages.length = 0;
  }
}
