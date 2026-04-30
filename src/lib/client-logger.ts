// Client-safe logger: uses console and provides the same small API as server logger
export type LogLevel = 'info' | 'warn' | 'error';

function formatLocalTimeForNairobi(date = new Date()): string {
  try {
    return date.toLocaleString('en-KE', { timeZone: 'Africa/Nairobi' });
  } catch (_err) {
    return date.toISOString();
  }
}

function normalizeMeta(meta?: Record<string, unknown>) {
  if (!meta) return {} as Record<string, unknown>;
  return meta;
}

export function logWithTime(level: LogLevel, message: string, meta?: Record<string, unknown>) {
  const now = new Date();
  const base = {
    timestamp: now.toISOString(),
    level: (level || 'info').toUpperCase(),
    service: process.env.SERVICE_NAME || process.env.npm_package_name || 'service',
    message,
    local: formatLocalTimeForNairobi(now),
  } as Record<string, unknown>;

  const entry = { ...base, ...normalizeMeta(meta) };
  const out = JSON.stringify(entry);
  if (level === 'error') console.error(out); else console.log(out);
}

export const mask = (obj: Record<string, unknown> = {}): Record<string, unknown> => {
  try {
    const clone = JSON.parse(JSON.stringify(obj || {}));
    const keysToMask = ['password', 'pwd', 'token', 'accessToken', 'refreshToken', 'secret', 'authorization', 'otp'];
    keysToMask.forEach((k) => {
      if (Object.prototype.hasOwnProperty.call(clone, k)) {
        try { clone[k] = '***REDACTED***'; } catch (e) { clone[k] = '***REDACTED***'; }
      }
    });
    return clone;
  } catch (e) {
    return obj;
  }
};

const logger = {
  info: (message: string, meta?: Record<string, unknown>) => { try { logWithTime('info', message, meta); } catch (_) {} if (typeof console !== 'undefined') console.info(message, meta); },
  warn: (message: string, meta?: Record<string, unknown>) => { try { logWithTime('warn', message, meta); } catch (_) {} if (typeof console !== 'undefined') console.warn(message, meta); },
  error: (message: string, meta?: Record<string, unknown>) => { try { logWithTime('error', message, meta); } catch (_) {} if (typeof console !== 'undefined') console.error(message, meta); },
  log: (level: string, message: string, meta?: Record<string, unknown>) => { try { logWithTime(level as LogLevel, message, meta); } catch (_) {} if (typeof console !== 'undefined') console.log(level.toUpperCase(), message, meta); },
  mask,
  logWithTime,
};

export default logger;

