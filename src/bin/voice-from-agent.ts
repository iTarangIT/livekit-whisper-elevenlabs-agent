import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';

try {
  process.loadEnvFile();
} catch {
  void 0;
}

async function main(): Promise<void> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const agentId = process.env.ELEVENLABS_AGENT_ID;
  if (!apiKey || !agentId) {
    process.stderr.write('Set ELEVENLABS_API_KEY and ELEVENLABS_AGENT_ID in .env first.\n');
    process.exit(1);
  }

  const client = new ElevenLabsClient({ apiKey });
  const agent = await client.conversationalAi.agents.get(agentId);
  const voiceId = agent.conversationConfig.tts?.voiceId;
  if (!voiceId) {
    process.stderr.write('That agent has no TTS voice id configured.\n');
    process.exit(1);
  }

  process.stdout.write(`ELEVENLABS_VOICE_ID=${voiceId}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
