import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FILE = join(process.cwd(), 'metrics', 'metrics.jsonl');

interface Record {
  room: string;
  event: string;
  ts: string;
  offsetMs: number;
  [key: string]: unknown;
}

function load(): Record[] {
  let raw = '';
  try {
    raw = readFileSync(FILE, 'utf8');
  } catch {
    return [];
  }
  const records: Record[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }
    try {
      records.push(JSON.parse(trimmed) as Record);
    } catch {
      continue;
    }
  }
  return records;
}

function numbers(records: Record[], event: string, field: string): number[] {
  const values: number[] = [];
  for (const record of records) {
    if (record.event !== event) {
      continue;
    }
    const value = record[field];
    if (typeof value === 'number' && Number.isFinite(value)) {
      values.push(value);
    }
  }
  return values;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) {
    return 0;
  }
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)] ?? 0;
}

function stats(values: number[]): string {
  if (values.length === 0) {
    return 'n/a';
  }
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  const avg = Math.round(sum / sorted.length);
  return [
    String(sorted.length).padStart(5),
    String(Math.round(sorted[0] ?? 0)).padStart(7),
    String(avg).padStart(7),
    String(Math.round(percentile(sorted, 50))).padStart(7),
    String(Math.round(percentile(sorted, 95))).padStart(7),
    String(Math.round(sorted[sorted.length - 1] ?? 0)).padStart(7),
  ].join('');
}

function sum(records: Record[], event: string, field: string): number {
  return numbers(records, event, field).reduce((acc, v) => acc + v, 0);
}

function row(label: string, values: number[]): string {
  return `${label.padEnd(24)}${stats(values)}`;
}

function main(): void {
  const records = load();
  if (records.length === 0) {
    process.stdout.write(`No metrics found at ${FILE}\n`);
    return;
  }

  const rooms = new Set(records.map((r) => r.room));
  const turns = records.filter((r) => r.event === 'user_transcript').length;
  const interruptions = sum(records, 'call_end', 'interruptions');

  const lines: string[] = [];
  lines.push('');
  lines.push(`Calls: ${rooms.size}   Turns: ${turns}   Interruptions: ${interruptions}`);
  lines.push('');
  lines.push(`${'Metric (ms)'.padEnd(24)}${'count'.padStart(5)}${'min'.padStart(7)}${'avg'.padStart(7)}${'p50'.padStart(7)}${'p95'.padStart(7)}${'max'.padStart(7)}`);
  lines.push('-'.repeat(64));
  lines.push(row('Response latency', numbers(records, 'response_latency', 'responseMs')));
  lines.push(row('Dial -> answer', numbers(records, 'call_setup', 'dialToAnswerMs')));
  lines.push(row('Call duration', numbers(records, 'call_end', 'durationMs')));
  lines.push(row('RTT', numbers(records, 'rtc_stats', 'rttMs')));
  lines.push(row('Jitter', numbers(records, 'rtc_stats', 'jitterMs')));
  lines.push('');
  lines.push('Response latency = dealer stops speaking -> agent starts speaking (voice-to-voice).');
  lines.push('');

  let timelineRoom = '';
  let bestTurns = -1;
  for (const room of rooms) {
    const roomTurns = records.filter((r) => r.room === room && r.event === 'user_transcript').length;
    if (roomTurns > bestTurns) {
      bestTurns = roomTurns;
      timelineRoom = room;
    }
  }
  if (timelineRoom) {
    lines.push(`Sample turn timeline (room ${timelineRoom}):`);
    const timeline = records
      .filter((r) => r.room === timelineRoom && typeof r.offsetMs === 'number')
      .sort((a, b) => a.offsetMs - b.offsetMs);
    for (const record of timeline) {
      lines.push(`  +${String(record.offsetMs).padStart(7)}ms  ${record.event}`);
    }
    lines.push('');
  }

  process.stdout.write(`${lines.join('\n')}\n`);
}

main();
