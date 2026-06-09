import { fileURLToPath } from 'node:url';
import { WorkerOptions, cli } from '@livekit/agents';
import { config } from './config/env.js';
import { createLogger } from './utils/logger.js';

const logger = createLogger('worker');

const extension = import.meta.url.endsWith('.ts') ? '.ts' : '.js';
const agent = fileURLToPath(new URL(`./worker/voice-agent${extension}`, import.meta.url));

logger.info('starting voice agent worker', { livekit: config.livekit.url });

cli.runApp(new WorkerOptions({ agent, agentName: config.agentName }));
