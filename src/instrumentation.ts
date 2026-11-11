import { registerOTel } from '@vercel/otel';

/**
 * Traces for Grafana Cloud. Next.js records a span per request and per fetch (so every
 * Supabase call shows with its time); @vercel/otel exports them over OTLP/HTTP to the
 * Alloy collector on the VPS, set by OTEL_EXPORTER_OTLP_ENDPOINT. Without that variable
 * (local dev, tests) nothing is exported.
 */
export function register() {
  // Refuse to start in production without the secrets that have dev fallbacks, so a
  // missing one stops the container instead of quietly breaking every phone's login.
  // (Not during `next build`, which runs without runtime secrets.)
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.NODE_ENV === 'production' && process.env.NEXT_PHASE !== 'phase-production-build') {
    const missing = ['JWT_SECRET', 'SUPABASE_SERVICE_ROLE_KEY'].filter((name) => !process.env[name]);
    if (missing.length) throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
  if (!process.env.OTEL_EXPORTER_OTLP_ENDPOINT) return;
  registerOTel({ serviceName: process.env.OTEL_SERVICE_NAME || 'royaltrack-portal' });
}
