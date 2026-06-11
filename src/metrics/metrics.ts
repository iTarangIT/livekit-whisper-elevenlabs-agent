import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('metrics');
const FILE = join(process.cwd(), 'metrics', 'metrics.jsonl');

type Fields = Record<string, unknown>;

function append(record: Fields): void {
  try {
    mkdirSync(dirname(FILE), { recursive: true });
    appendFileSync(FILE, `${JSON.stringify(record)}\n`);
  } catch (error) {
    logger.error('failed to write metric', {
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}

export function recordCallSetup(room: string, fields: Fields): void {
  append({ room, event: 'call_setup', ts: new Date().toISOString(), ...fields });
}

function collectNumbers(value: unknown, key: string, out: number[]): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectNumbers(item, key, out);
    }
    return;
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (k === key && (typeof v === 'number' || typeof v === 'string')) {
        const num = Number(v);
        if (Number.isFinite(num)) {
          out.push(num);
        }
      } else {
        collectNumbers(v, key, out);
      }
    }
  }
}

export class CallMetrics {
  private readonly start = performance.now();
  private turnCount = 0;
  private answeredAt?: number;
  private userDoneAt?: number;
  private interruptions = 0;
  private awaitingResponse = false;

  constructor(private readonly room: string) {}

  private record(event: string, fields: Fields = {}): void {
    append({
      room: this.room,
      event,
      ts: new Date().toISOString(),
      offsetMs: Math.round(performance.now() - this.start),
      ...fields,
    });
  }

  markAnswered(): void {
    if (this.answeredAt !== undefined) {
      return;
    }
    this.answeredAt = performance.now();
    this.record('answered');
  }

  greetingStart(): void {
    this.record('greeting_start');
  }

  userTranscript(text: string): void {
    this.turnCount += 1;
    this.userDoneAt = performance.now();
    this.awaitingResponse = true;
    this.record('user_transcript', { turn: this.turnCount, textLength: text.length, text });
  }

  agentThinking(): void {
    this.record('agent_thinking', { turn: this.turnCount });
  }

  agentSpeaking(): void {
    const now = performance.now();
    const responseMs =
      this.awaitingResponse && this.userDoneAt !== undefined
        ? Math.round(now - this.userDoneAt)
        : undefined;
    this.awaitingResponse = false;
    this.record('response_latency', { turn: this.turnCount, responseMs });
  }

  agentTranscript(text: string, interrupted: boolean): void {
    if (interrupted) {
      this.interruptions += 1;
    }
    this.record('agent_transcript', {
      turn: this.turnCount,
      textLength: text.length,
      interrupted,
      text,
    });
  }

  realtimeMetrics(metrics: unknown): void {
    this.record('realtime_metrics', { metrics });
  }

  quality(level: string): void {
    this.record('connection_quality', { quality: level });
  }

  rtcStats(stats: unknown): void {
    const plain = stats && typeof (stats as { toJson?: unknown }).toJson === 'function'
      ? (stats as { toJson: () => unknown }).toJson()
      : stats;
    const rttValues: number[] = [];
    const jitterValues: number[] = [];
    const lossValues: number[] = [];
    collectNumbers(plain, 'roundTripTime', rttValues);
    collectNumbers(plain, 'jitter', jitterValues);
    collectNumbers(plain, 'packetsLost', lossValues);
    this.record('rtc_stats', {
      rttMs: rttValues.length > 0 ? Math.round(Math.max(...rttValues) * 1000) : undefined,
      jitterMs: jitterValues.length > 0 ? Math.round(Math.max(...jitterValues) * 1000) : undefined,
      packetsLost: lossValues.length > 0 ? Math.max(...lossValues) : undefined,
    });
  }

  finalize(): void {
    const now = performance.now();
    const durationMs = this.answeredAt !== undefined ? Math.round(now - this.answeredAt) : undefined;
    this.record('call_end', {
      durationMs,
      turns: this.turnCount,
      interruptions: this.interruptions,
    });
  }
}
