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
  AGENT_NAME: z.string().min(1).default('dealer-outbound'),

  OPENAI_API_KEY: z.string().min(1, 'OPENAI_API_KEY is required'),
  WHISPER_MODEL: z.string().min(1).default('gpt-4o-transcribe'),
  STT_LANGUAGE: z.string().min(1).optional(),
  STT_PROMPT: z.string().min(1).optional(),

  ELEVENLABS_API_KEY: z.string().min(1, 'ELEVENLABS_API_KEY is required'),
  ELEVENLABS_AGENT_ID: z.string().min(1, 'ELEVENLABS_AGENT_ID is required'),
  ELEVENLABS_VOICE_ID: z.string().min(1).optional(),
  ELEVENLABS_MODEL_ID: z.string().min(1).default('eleven_flash_v2_5'),

  SIP_TRUNK_ADDRESS: z.string().min(1).optional(),
  SIP_TRUNK_USERNAME: z.string().min(1).optional(),
  SIP_TRUNK_PASSWORD: z.string().min(1).optional(),
  SIP_CALLER_NUMBER: z.string().min(1).optional(),
  SIP_OUTBOUND_TRUNK_ID: z.string().min(1).optional(),
  SIP_TRANSPORT: z.enum(['auto', 'udp', 'tcp', 'tls']).default('auto'),

  CALL_RINGING_TIMEOUT: z.coerce.number().int().positive().default(30),
  CALL_MAX_DURATION: z.coerce.number().int().positive().default(600),
  AGENT_OPENING_LINE: z
    .string()
    .min(1)
    .default('Hello, this is a call from the dealership. Is now a good time to talk?'),

  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export interface AppConfig {
  livekit: {
    url: string;
    apiKey: string;
    apiSecret: string;
  };
  agentName: string;
  openai: {
    apiKey: string;
    whisperModel: string;
  };
  stt: {
    language?: string;
    prompt?: string;
  };
  elevenLabs: {
    apiKey: string;
    agentId: string;
    voiceId?: string;
    modelId: string;
  };
  sip: {
    trunkAddress?: string;
    trunkUsername?: string;
    trunkPassword?: string;
    callerNumber?: string;
    outboundTrunkId?: string;
    transport: 'auto' | 'udp' | 'tcp' | 'tls';
  };
  call: {
    ringingTimeout: number;
    maxDuration: number;
    openingLine: string;
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
    agentName: env.AGENT_NAME,
    openai: {
      apiKey: env.OPENAI_API_KEY,
      whisperModel: env.WHISPER_MODEL,
    },
    stt: {
      language: env.STT_LANGUAGE,
      prompt: env.STT_PROMPT,
    },
    elevenLabs: {
      apiKey: env.ELEVENLABS_API_KEY,
      agentId: env.ELEVENLABS_AGENT_ID,
      voiceId: env.ELEVENLABS_VOICE_ID,
      modelId: env.ELEVENLABS_MODEL_ID,
    },
    sip: {
      trunkAddress: env.SIP_TRUNK_ADDRESS,
      trunkUsername: env.SIP_TRUNK_USERNAME,
      trunkPassword: env.SIP_TRUNK_PASSWORD,
      callerNumber: env.SIP_CALLER_NUMBER,
      outboundTrunkId: env.SIP_OUTBOUND_TRUNK_ID,
      transport: env.SIP_TRANSPORT,
    },
    call: {
      ringingTimeout: env.CALL_RINGING_TIMEOUT,
      maxDuration: env.CALL_MAX_DURATION,
      openingLine: env.AGENT_OPENING_LINE,
    },
    logLevel: env.LOG_LEVEL,
  });
}

export const config: AppConfig = load();
