'use client';
import { useEffect } from 'react';
import { faro, getWebInstrumentations, initializeFaro, LogLevel } from '@grafana/faro-web-sdk';
import { TracingInstrumentation } from '@grafana/faro-web-tracing';
import { scrubDeep } from '@/lib/faro-scrub';

/**
 * Grafana Faro real-user monitoring: page loads, Web Vitals, JS errors and fetch timings, sent
 * to Grafana Cloud Frontend Observability. Same-origin /api calls carry a W3C traceparent header,
 * so the portal's server traces (@vercel/otel, see instrumentation.ts) join the browser trace.
 * Off unless NEXT_PUBLIC_FARO_URL is set at build time.
 */
export default function FrontendObservability() {
  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_FARO_URL;
    // faro.api is a no-op placeholder before init in Faro 2.x; config only exists once initialised.
    if (!url || faro.config) return;
    try {
      initializeFaro({
        url,
        app: { name: process.env.NEXT_PUBLIC_FARO_APP_NAME || 'royaltrack-portal', environment: process.env.NODE_ENV },
        instrumentations: [...getWebInstrumentations(), new TracingInstrumentation()],
        // Console: warn/error only.
        consoleInstrumentation: { disabledLevels: [LogLevel.TRACE, LogLevel.DEBUG, LogLevel.LOG, LogLevel.INFO] },
        // Verify, reset and session-bridge links carry tokens in URLs — never ship them.
        beforeSend: (item) => scrubDeep(item),
      });
    } catch (error) {
      console.error('Error initializing Faro:', error);
    }
  }, []);
  return null;
}
