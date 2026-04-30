/*
  Make this module safe to import in client bundles. Avoid top-level imports of
  Node-only modules (fs, path, os) so bundlers like Next/Turbopack don't try to
  include them in the browser build.

  All filesystem operations are performed at runtime inside guarded blocks
  (checking for `require`) and the resolved state is cached.
*/

const cached = {
  initialized: false,
  fileLoggingAvailable: false as boolean,
  resolvedLogsDir: '' as string,
};

function initOnce() {
  if (cached.initialized) return;
  cached.initialized = true;

  // If `require` is not available (client or Edge runtime), disable file logging.
  if (typeof require !== 'function') {
    cached.fileLoggingAvailable = false;
    cached.resolvedLogsDir = '';
    return;
  }

  try {
    // Guarded require casted to a typed function to avoid `any` eslint errors
    const req = (require as unknown) as (id: string) => unknown;
    const fs: typeof import('fs') = req('fs') as typeof import('fs');
    const path: typeof import('path') = req('path') as typeof import('path');
    const os: typeof import('os') = req('os') as typeof import('os');

    const configuredLogDir = process.env.LOG_DIR || 'logs';
    const resolvedLogsDir = path.resolve(process.cwd(), configuredLogDir);

    try {
      fs.mkdirSync(resolvedLogsDir, { recursive: true });
      cached.fileLoggingAvailable = true;
      cached.resolvedLogsDir = resolvedLogsDir;
      return;
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      // Avoid importing logger here (circular). Use console as a safe fallback.
      console.warn(`Could not create logs directory at ${resolvedLogsDir}: ${errorMessage}`);

      const fallbackDir = path.join(os.tmpdir(), 'royalgene-logs');
      try {
        fs.mkdirSync(fallbackDir, { recursive: true });
        cached.fileLoggingAvailable = true;
        cached.resolvedLogsDir = fallbackDir;
        console.warn(`Falling back to temporary logs directory: ${cached.resolvedLogsDir}`);
        return;
      } catch (ee) {
        const err2Msg = ee instanceof Error ? ee.message : String(ee);
        console.warn(`Could not create fallback logs directory at ${fallbackDir}: ${err2Msg}`);
        console.warn('Disabling file transports; only Console logging will be used.');
        cached.fileLoggingAvailable = false;
        cached.resolvedLogsDir = '';
        return;
      }
    }
  } catch (e) {
    // If any runtime require/import fails, disable file logging.
    cached.fileLoggingAvailable = false;
    cached.resolvedLogsDir = '';
    return;
  }
}

export function isFileLoggingAvailable(): boolean {
  initOnce();
  return cached.fileLoggingAvailable;
}

export function getLogsDir(): string | null {
  initOnce();
  return cached.fileLoggingAvailable ? cached.resolvedLogsDir : null;
}

export async function ensureLogDir(): Promise<boolean> {
  initOnce();
  if (!cached.fileLoggingAvailable) return false;

  if (typeof require !== 'function') return false;
  try {
    const req = (require as unknown) as (id: string) => unknown;
    const fsp: typeof import('fs/promises') = req('fs/promises') as typeof import('fs/promises');
    await fsp.mkdir(cached.resolvedLogsDir, { recursive: true });
    return true;
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    console.warn(`Failed to ensure logs directory ${cached.resolvedLogsDir}: ${errMsg}`);
    return false;
  }
}

