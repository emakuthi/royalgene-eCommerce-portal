import { createClient } from '@supabase/supabase-js';
import { startRealtimeStockSync } from './supabase-realtime';

const getSupabaseUrl = () => process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
const getSupabasePublishableKey = () => process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY || 'placeholder-key';
const getSupabaseServiceKey = () => process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder-key';

// Resolve env values once at module initialization so we can log them safely
const SUPABASE_URL = getSupabaseUrl();
const SUPABASE_PUBLISHABLE_KEY = getSupabasePublishableKey();
const SUPABASE_SERVICE_KEY = getSupabaseServiceKey();

// Client-side Supabase instance (public access)
export const supabaseClient = createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY
);

// Server-side Supabase instance (with service role for admin operations)
export const supabaseAdmin = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_KEY
);

// Diagnostic flag to allow endpoints to detect clearly misconfigured Supabase settings
export const isSupabaseAdminConfigured = Boolean(
  SUPABASE_URL && SUPABASE_URL !== 'https://placeholder.supabase.co' &&
  SUPABASE_SERVICE_KEY && SUPABASE_SERVICE_KEY !== 'placeholder-key'
);

// Startup-time logging to confirm environment variables are present.
// Use a lightweight masking strategy to avoid leaking secrets in logs.
const maskKey = (k: string | undefined) => {
  if (!k) return '***MISSING***';
  if (k === 'placeholder-key') return '***PLACEHOLDER***';
  try {
    if (k.length <= 8) return '***REDACTED***';
    return `${k.slice(0, 4)}...${k.slice(-4)}`;
  } catch (e) {
    return '***REDACTED***';
  }
};

const maskUrl = (u: string | undefined) => {
  if (!u) return '***MISSING***';
  try {
    const parsed = new URL(u);
    return parsed.hostname;
  } catch (e) {
    return u;
  }
};

// (startup logging moved below so we can include realtime startup status)

// Attempt to start realtime sync if configured — guard across module reloads (HMR/dev)
let realtimeStarted: boolean;
try {
  const g = globalThis as unknown as { __supabaseRealtimeStarted?: boolean };
  if (!g.__supabaseRealtimeStarted) {
    try {
      // In this codebase startRealtimeStockSync returns void; call it and treat lack of an
      // exception as a successful start.
      startRealtimeStockSync();
      realtimeStarted = true;
    } catch (e) {
      realtimeStarted = false;
    }

    g.__supabaseRealtimeStarted = true;
  } else {
    realtimeStarted = true;
  }
} catch (err) {
  // ignore — realtime is optional
  realtimeStarted = false;
}

// Build the envSummary now that we know realtime status
const envSummary = {
  NEXT_PUBLIC_SUPABASE_URL: maskUrl(SUPABASE_URL),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY: maskKey(SUPABASE_PUBLISHABLE_KEY),
  SUPABASE_SERVICE_ROLE_KEY: SUPABASE_SERVICE_KEY === 'placeholder-key' ? '***PLACEHOLDER***' : (SUPABASE_SERVICE_KEY ? '***SET***' : '***MISSING***'),
  NODE_ENV: process.env.NODE_ENV || 'unknown',
  realtimeStarted
};

// Log initialization info without importing server-only logger here so
// this module remains safe to import from client code. Server-side
// structured logging can be performed by server entrypoints that import
// the server logger directly when needed.
console.info('[Supabase] initialized', envSummary);

// If running on the server and Supabase admin appears unconfigured, surface a clear error
if (typeof window === 'undefined' && !isSupabaseAdminConfigured) {
  // Use console.error here because logger may not be fully initialized in some serverless setups.
  // This makes misconfiguration obvious in Vercel/function logs.
  console.error('[Supabase] WARNING: Supabase admin client appears unconfigured.\n' +
    `Detected URL: ${maskUrl(SUPABASE_URL)}; Service key present: ${SUPABASE_SERVICE_KEY === 'placeholder-key' ? 'no' : (SUPABASE_SERVICE_KEY ? 'yes' : 'no')}.\n` +
    'Ensure SUPABASE_SERVICE_ROLE_KEY and NEXT_PUBLIC_SUPABASE_URL are set in your deployment environment.'
  );
}


// Image bucket name
export const IMAGE_BUCKET = 'products';
