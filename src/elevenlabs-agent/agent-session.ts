import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js/Client.js';
import { Conversation } from '@elevenlabs/elevenlabs-js/api/resources/conversationalAi/conversation/index.js';
import type { AudioSource } from '@livekit/rtc-node';
import { createLogger } from '../utils/logger.js';
import { LiveKitAudioBridge } from './audio-bridge.js';

const logger = createLogger('agent-session');

export interface AgentSession {
  bridge: LiveKitAudioBridge;
  start(): Promise<void>;
  end(): void;
  sendUserMessage(text: string): void;
}

export function createAgentSession(apiKey: string, agentId: string, source: AudioSource): AgentSession {
  const client = new ElevenLabsClient({ apiKey });
  const bridge = new LiveKitAudioBridge(source);

  const conversation = new Conversation({
    client,
    agentId,
    requiresAuth: true,
    audioInterface: bridge,
    callbackAgentResponse: (response) => logger.info('agent response', { response }),
  });

  return {
    bridge,
    start: () => conversation.startSession(),
    end: () => conversation.endSession(),
    sendUserMessage: (text: string) => conversation.sendUserMessage(text),
  };
}
