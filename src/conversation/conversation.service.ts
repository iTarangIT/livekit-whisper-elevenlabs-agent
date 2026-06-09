import type { ConversationEngine, Message } from '../types/index.js';

interface Rule {
  matches(text: string): boolean;
  reply: string;
}

const rules: Rule[] = [
  {
    matches: (text) => text.includes('price') || text.includes('cost'),
    reply: 'Sure sir, which vehicle model are you interested in?',
  },
  {
    matches: (text) => text.includes('hello') || text.includes('hi') || text.includes('hey'),
    reply: 'Hello sir, how can I help you today?',
  },
];

const FALLBACK = 'Could you please tell me more?';

export class RuleBasedConversationService implements ConversationEngine {
  async respond(text: string, history: readonly Message[]): Promise<string> {
    void history;
    const normalized = text.toLowerCase().trim();
    if (normalized.length === 0) {
      return FALLBACK;
    }
    for (const rule of rules) {
      if (rule.matches(normalized)) {
        return rule.reply;
      }
    }
    return FALLBACK;
  }
}
