import { defineConfig } from 'vitest/config';
import path from 'node:path';

// No vitest config existed before this — the existing test files under
// src/**/*.test.ts all import via the `@/` alias (matching tsconfig.json's
// paths) but nothing resolved it for Vitest, so the whole suite failed to
// even load. This fixes that for both the pre-existing tests and the new
// entitlement tests added alongside this change.
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // The real `server-only` package intentionally throws unless the
      // importing bundle sets Next.js's "react-server" resolve condition —
      // Vitest doesn't, so every *.server.ts file (a real, load-bearing
      // convention across this codebase) would crash on import. Next's own
      // build is unaffected; this alias only applies to test runs.
      'server-only': path.resolve(__dirname, './src/lib/__tests__/__mocks__/noop-module.ts'),
      'client-only': path.resolve(__dirname, './src/lib/__tests__/__mocks__/noop-module.ts'),
    },
  },
  test: {
    environment: 'node',
  },
});
