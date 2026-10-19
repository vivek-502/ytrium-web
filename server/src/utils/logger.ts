/* Minimal structured logger. No secrets, no user content beyond short queries. */

type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const minLevel: number = LEVELS[(process.env.LOG_LEVEL as Level) || 'info'] ?? 20;

export interface Logger {
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

export function createLogger(scope: string): Logger {
  const emit = (level: Level, msg: string, meta?: Record<string, unknown>) => {
    if (LEVELS[level] < minLevel) return;
    const line = {
      time: new Date().toISOString(),
      level,
      scope,
      msg,
      ...(meta || {}),
    };
    const out = level === 'error' || level === 'warn' ? console.error : console.log;
    out(JSON.stringify(line));
  };
  return {
    debug: (m, meta) => emit('debug', m, meta),
    info: (m, meta) => emit('info', m, meta),
    warn: (m, meta) => emit('warn', m, meta),
    error: (m, meta) => emit('error', m, meta),
  };
}
