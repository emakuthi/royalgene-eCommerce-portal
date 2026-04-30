// Minimal typed logger without any `any` usage.
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
  mask(value: string, visible?: number): string;
  logWithTime<T>(label: string, fn: () => Promise<T> | T): Promise<T> | T;
}

const formatMeta = (meta?: Record<string, unknown>): string =>
  meta ? JSON.stringify(meta) : '';

const createLogger = (): Logger => {
  const log = (level: LogLevel, message: string, meta?: Record<string, unknown>) => {
    const out = `[${level.toUpperCase()}] ${message}${meta ? ` - ${formatMeta(meta)}` : ''}`;
    switch (level) {
      case 'debug':
        console.debug(out);
        break;
      case 'info':
        console.info(out);
        break;
      case 'warn':
        console.warn(out);
        break;
      case 'error':
        console.error(out);
        break;
    }
  };

  return {
    debug: (message: string, meta?: Record<string, unknown>) => log('debug', message, meta),
    info: (message: string, meta?: Record<string, unknown>) => log('info', message, meta),
    warn: (message: string, meta?: Record<string, unknown>) => log('warn', message, meta),
    error: (message: string, meta?: Record<string, unknown>) => log('error', message, meta),

    mask: (value: string, visible = 4) => {
      if (!value) return value;
      const keep = Math.max(0, Math.min(visible, value.length));
      const masked = '*'.repeat(Math.max(0, value.length - keep));
      return value.slice(0, keep) + masked;
    },

    logWithTime: (label: string, fn) => {
      const start = Date.now();
      try {
        const result = fn();
        if (result instanceof Promise) {
          return result.finally(() => {
            const ms = Date.now() - start;
            log('info', `${label} completed in ${ms}ms`);
          });
        } else {
          const ms = Date.now() - start;
          log('info', `${label} completed in ${ms}ms`);
          return result;
        }
      } catch (err) {
        const ms = Date.now() - start;
        log('error', `${label} failed after ${ms}ms`, { error: String(err) });
        throw err;
      }
    },
  };
};

const logger = createLogger();

export default logger;
export { logger as namedLogger, createLogger };

