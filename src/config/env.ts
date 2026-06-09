import { z } from 'zod';

try {
  process.loadEnvFile();
} catch {
  void 0;
}

const schema = z.object({
  LIVEKIT_URL: z.string().min(1, 'LIVEKIT_URL is required'),
  LIVEKIT_API_KEY: z.string().min(1, 'LIVEKIT_API_KEY is required'),
  LIVEKIT_API_SECRET: z.string().min(1, 'LIVEKIT_API_SECRET is required'),
  OPENAI_API_KEY: z.string().min(1, 'OPENAI_API_KEY is required'),
  WHISPER_MODEL: z.string().min(1).default('gpt-4o-mini-transcribe'),
  ELEVENLABS_API_KEY: z.string().min(1, 'ELEVENLABS_API_KEY is required'),
  ELEVENLABS_VOICE_ID: z.string().min(1, 'ELEVENLABS_VOICE_ID is required'),
  ELEVENLABS_MODEL_ID: z.string().min(1).default('eleven_flash_v2_5'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export interface AppConfig {
  livekit: {
    url: string;
    apiKey: string;
    apiSecret: string;
  };
  openai: {
    apiKey: string;
    whisperModel: string;
  };
  elevenLabs: {
    apiKey: string;
    voiceId: string;
    modelId: string;
  };
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

function load(): AppConfig {
  const cleaned = Object.fromEntries(
    Object.entries(process.env).map(([key, value]) => [key, value === '' ? undefined : value]),
  );

  const parsed = schema.safeParse(cleaned);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    process.stderr.write(`\nInvalid environment configuration:\n${issues}\n\n`);
    process.exit(1);
  }

  const env = parsed.data;
  return Object.freeze({
    livekit: {
      url: env.LIVEKIT_URL,
      apiKey: env.LIVEKIT_API_KEY,
      apiSecret: env.LIVEKIT_API_SECRET,
    },
    openai: {
      apiKey: env.OPENAI_API_KEY,
      whisperModel: env.WHISPER_MODEL,
    },
    elevenLabs: {
      apiKey: env.ELEVENLABS_API_KEY,
      voiceId: env.ELEVENLABS_VOICE_ID,
      modelId: env.ELEVENLABS_MODEL_ID,
    },
    logLevel: env.LOG_LEVEL,
  });
}

export const config: AppConfig = load();
