import { ensureOutboundTrunk } from '../telephony/trunk.js';

async function main(): Promise<void> {
  const trunkId = await ensureOutboundTrunk();
  process.stdout.write(`\nAdd this to your .env:\nSIP_OUTBOUND_TRUNK_ID=${trunkId}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
