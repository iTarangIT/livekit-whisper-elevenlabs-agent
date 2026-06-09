type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function activeLevel(): LogLevel {
  const raw = (process.env.LOG_LEVEL ?? 'info').toLowerCase();
  return raw === 'debug' || raw === 'warn' || raw === 'error' ? raw : 'info';
}

export class Logger {
  constructor(private readonly scope: string) {}

  debug(message: string, meta?: Record<string, unknown>): void {
    this.write('debug', message, meta);
  }

  info(message: string, meta?: Record<string, unknown>): void {
    this.write('info', message, meta);
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    this.write('warn', message, meta);
  }

  error(message: string, meta?: Record<string, unknown>): void {
    this.write('error', message, meta);
  }

  latency(label: string, ms: number, meta?: Record<string, unknown>): void {
    this.write('info', `${label} latency: ${Math.round(ms)}ms`, meta);
  }

  private write(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
    if (WEIGHT[level] < WEIGHT[activeLevel()]) {
      return;
    }
    const time = new Date().toISOString();
    const base = `${time} [${level.toUpperCase()}] [${this.scope}] ${message}`;
    const line = meta && Object.keys(meta).length > 0 ? `${base} ${JSON.stringify(meta)}` : base;
    const sink = level === 'error' ? process.stderr : process.stdout;
    sink.write(`${line}\n`);
  }
}

export function createLogger(scope: string): Logger {
  return new Logger(scope);
}
