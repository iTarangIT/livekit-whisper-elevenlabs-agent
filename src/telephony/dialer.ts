import { config } from '../config/env.js';
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

  await roomClient.createRoom({ name: room });
  logger.info('room created', { room });

  await dispatchClient.createDispatch(room, config.agentName, {
    metadata: JSON.stringify({ phoneNumber }),
  });
  logger.info('agent dispatched', { room, agent: config.agentName });

  const participant = await sipClient.createSipParticipant(trunkId, phoneNumber, room, {
    participantIdentity: 'dealer',
    participantName: 'Dealer',
    waitUntilAnswered: true,
    playDialtone: false,
    krispEnabled: true,
    ringingTimeout: config.call.ringingTimeout,
    maxCallDuration: config.call.maxDuration,
  });
  logger.info('dealer answered', { room, participant: participant.participantId });

  return { room, phoneNumber, participantId: participant.participantId };
}
