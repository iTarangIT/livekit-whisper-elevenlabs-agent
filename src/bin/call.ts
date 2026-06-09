import { placeOutboundCall } from '../telephony/dialer.js';

async function main(): Promise<void> {
  const number = process.argv[2];
  if (!number) {
    process.stderr.write('Usage: npm run call -- +91XXXXXXXXXX\n');
    process.exit(1);
  }

  const call = await placeOutboundCall(number);
  process.stdout.write(`Calling ${call.phoneNumber} in room ${call.room}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
