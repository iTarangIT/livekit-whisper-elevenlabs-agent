import { config } from '../config/env.js';
import { recordCallSetup } from '../metrics/metrics.js';
import { createLogger } from '../utils/logger.js';
import { dispatchClient, roomClient, sipClient } from './livekit-clients.js';

const logger = createLogger('dialer');

export interface OutboundCall {
  room: string;
  phoneNumber: string;
  participantId: string;
}

export async function placeOutboundCall(phoneNumber: string): Promise<OutboundCall> {
  const trunkId = config.sip.outboundTrunkId;
  if (!trunkId) {
    throw new Error('SIP_OUTBOUND_TRUNK_ID is required; run `npm run trunk:setup` first');
  }

  const digits = phoneNumber.replace(/[^0-9]/g, '');
  const room = `dealer-call-${digits}-${Date.now()}`;

  const roomStart = performance.now();
  await roomClient.createRoom({ name: room });
  const roomMs = performance.now() - roomStart;
  logger.info('room created', { room });

  await dispatchClient.createDispatch(room, config.agentName, {
    metadata: JSON.stringify({ phoneNumber }),
  });
  logger.info('agent dispatched', { room, agent: config.agentName });

  const dialStart = performance.now();
  const participant = await sipClient.createSipParticipant(trunkId, phoneNumber, room, {
    participantIdentity: 'dealer',
    participantName: 'Dealer',
    waitUntilAnswered: true,
    playDialtone: false,
    krispEnabled: true,
    ringingTimeout: config.call.ringingTimeout,
    maxCallDuration: config.call.maxDuration,
  });
  const dialToAnswerMs = performance.now() - dialStart;
  logger.info('dealer answered', { room, participant: participant.participantId });

  recordCallSetup(room, {
    roomCreateMs: Math.round(roomMs),
    dialToAnswerMs: Math.round(dialToAnswerMs),
  });

  return { room, phoneNumber, participantId: participant.participantId };
}
