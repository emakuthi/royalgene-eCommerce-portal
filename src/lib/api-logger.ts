/**
 * API Logger Utility
 * Provides consistent, formatted logging across all API endpoints
 */

interface LogContext {
  endpoint: string;
  method: string;
  timestamp?: string;
}

interface LogData {
  [key: string]: unknown;
}

class APILogger {
  private static readonly COLORS = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m',
  };

  private static formatTimestamp(): string {
    return new Date().toISOString();
  }

  private static formatEndpoint(endpoint: string, method: string): string {
    const methodColor = {
      GET: this.COLORS.cyan,
      POST: this.COLORS.green,
      PUT: this.COLORS.yellow,
      DELETE: this.COLORS.red,
      PATCH: this.COLORS.blue,
    }[method] || this.COLORS.reset;

    return `${methodColor}${method}${this.COLORS.reset} ${this.COLORS.bright}${endpoint}${this.COLORS.reset}`;
  }

  private static formatHeader(context: LogContext, status: 'REQUEST' | 'RESPONSE' | 'ERROR'): string {
    const statusColor = {
      REQUEST: this.COLORS.blue,
      RESPONSE: this.COLORS.green,
      ERROR: this.COLORS.red,
    }[status];

    return `${statusColor}[${status}]${this.COLORS.reset} ${this.formatEndpoint(
      context.endpoint,
      context.method
    )} @ ${this.formatTimestamp()}`;
  }

  private static formatJSON(data: LogData): string {
    try {
      // Mask sensitive data
      const sanitized = this.sanitizeData(data);
      return JSON.stringify(sanitized, null, 2);
    } catch (_err) {
      return String(data);
    }
  }

  private static sanitizeData(data: unknown): unknown {
    if (typeof data !== 'object' || data === null) {
      return data;
    }

    if (Array.isArray(data)) {
      return data.map(item => this.sanitizeData(item));
    }

    const sensitiveKeys = ['password', 'token', 'secret', 'key', 'authorization', 'apiKey'];
    const sanitized: Record<string, unknown> = {};

    for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
      const key = k.toLowerCase();
      if (sensitiveKeys.some(sensitive => key.includes(sensitive))) {
        sanitized[k] = '***REDACTED***';
      } else if (typeof v === 'object') {
        sanitized[k] = this.sanitizeData(v);
      } else {
        sanitized[k] = v;
      }
    }

    return sanitized;
  }

  static request(endpoint: string, method: string, data?: LogData): void {
    const context: LogContext = { endpoint, method };
    console.log('\n' + '='.repeat(80));
    console.log(this.formatHeader(context, 'REQUEST'));
    if (data) {
      console.log('Payload:');
      console.log(this.formatJSON(data));
    }
    console.log('='.repeat(80));
  }

  static response(endpoint: string, method: string, statusCode: number, data?: LogData, duration?: number): void {
    const context: LogContext = { endpoint, method };
    const statusColor =
      statusCode >= 200 && statusCode < 300 ? this.COLORS.green : statusCode >= 400 ? this.COLORS.red : this.COLORS.yellow;

    console.log('\n' + '='.repeat(80));
    console.log(`${this.formatHeader(context, 'RESPONSE')} ${statusColor}[${statusCode}]${this.COLORS.reset}${duration ? ` - ${duration}ms` : ''}`);
    if (data) {
      console.log('Response:');
      console.log(this.formatJSON(data));
    }
    console.log('='.repeat(80) + '\n');
  }

  static error(endpoint: string, method: string, error: unknown, statusCode: number = 500, duration?: number): void {
    const context: LogContext = { endpoint, method };
    console.log('\n' + '='.repeat(80));
    console.log(`${this.formatHeader(context, 'ERROR')} ${this.COLORS.red}[${statusCode}]${this.COLORS.reset}${duration ? ` - ${duration}ms` : ''}`);
    console.log('Error Details:');

    if (error instanceof Error) {
      console.log(`Message: ${error.message}`);
      if (error.stack) {
        console.log(`Stack: ${error.stack}`);
      }
    } else {
      console.log(this.formatJSON({ error: String(error) }));
    }
    console.log('='.repeat(80) + '\n');
  }

  static info(endpoint: string, method: string, message: string, data?: LogData): void {
    const context: LogContext = { endpoint, method };
    console.log(`\n${this.COLORS.blue}[INFO]${this.COLORS.reset} ${this.formatEndpoint(context.endpoint, context.method)}`);
    console.log(`Message: ${message}`);
    if (data) {
      console.log('Data:');
      console.log(this.formatJSON(data));
    }
  }

  static debug(endpoint: string, method: string, message: string, data?: LogData): void {
    if (process.env.DEBUG_LOGGING === 'true') {
      const context: LogContext = { endpoint, method };
      console.log(`\n${this.COLORS.cyan}[DEBUG]${this.COLORS.reset} ${this.formatEndpoint(context.endpoint, context.method)}`);
      console.log(`Message: ${message}`);
      if (data) {
        console.log(this.formatJSON(data));
      }
    }
  }

  static timing(label: string, duration: number): void {
    const durationColor = duration > 1000 ? this.COLORS.red : duration > 500 ? this.COLORS.yellow : this.COLORS.green;
    console.log(`${this.COLORS.bright}Timing${this.COLORS.reset}: ${label} took ${durationColor}${duration}ms${this.COLORS.reset}`);
  }
}

export default APILogger;

