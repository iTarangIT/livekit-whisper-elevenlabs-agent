import { SIPTransport } from '@livekit/protocol';
import { config } from '../config/env.js';
import { createLogger } from '../utils/logger.js';
import { sipClient } from './livekit-clients.js';

const logger = createLogger('trunk');

const TRANSPORTS: Record<'auto' | 'udp' | 'tcp' | 'tls', SIPTransport> = {
  auto: SIPTransport.SIP_TRANSPORT_AUTO,
  udp: SIPTransport.SIP_TRANSPORT_UDP,
  tcp: SIPTransport.SIP_TRANSPORT_TCP,
  tls: SIPTransport.SIP_TRANSPORT_TLS,
};

export async function ensureOutboundTrunk(): Promise<string> {
  const { trunkAddress, trunkUsername, trunkPassword, callerNumber, transport } = config.sip;
  if (!trunkAddress || !callerNumber) {
    throw new Error('SIP_TRUNK_ADDRESS and SIP_CALLER_NUMBER are required to create a trunk');
  }

  const trunk = await sipClient.createSipOutboundTrunk('vobiz-outbound', trunkAddress, [callerNumber], {
    transport: TRANSPORTS[transport],
    authUsername: trunkUsername,
    authPassword: trunkPassword,
  });

  logger.info('outbound trunk ready', { sipTrunkId: trunk.sipTrunkId, address: trunkAddress });
  return trunk.sipTrunkId;
}
