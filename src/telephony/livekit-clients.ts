import { AgentDispatchClient, RoomServiceClient, SipClient } from 'livekit-server-sdk';
import { config } from '../config/env.js';

function toHttpHost(url: string): string {
  return url.replace(/^wss:\/\//i, 'https://').replace(/^ws:\/\//i, 'http://');
}

const host = toHttpHost(config.livekit.url);

export const sipClient = new SipClient(host, config.livekit.apiKey, config.livekit.apiSecret);
export const dispatchClient = new AgentDispatchClient(
  host,
  config.livekit.apiKey,
  config.livekit.apiSecret,
);
export const roomClient = new RoomServiceClient(
  host,
  config.livekit.apiKey,
  config.livekit.apiSecret,
);
