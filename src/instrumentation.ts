import { registerOTel } from '@vercel/otel';

/**
 * Traces for Grafana Cloud. Next.js records a span per request and per fetch (so every
 * Supabase call shows with its time); @vercel/otel exports them over OTLP/HTTP to the
 * Alloy collector on the VPS, set by OTEL_EXPORTER_OTLP_ENDPOINT. Without that variable
 * (local dev, tests) nothing is exported.
 */
export function register() {
  if (!process.env.OTEL_EXPORTER_OTLP_ENDPOINT) return;
  registerOTel({ serviceName: process.env.OTEL_SERVICE_NAME || 'royaltrack-portal' });
}
