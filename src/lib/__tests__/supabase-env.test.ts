import { describe, it, expect, afterEach, vi } from 'vitest';
import { supabaseUrl, supabaseAnonKey, publicObjectUrl } from '../supabase-env';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('supabase-env', () => {
  it('prefers the run-time SUPABASE_URL and SUPABASE_ANON_KEY over the build-time NEXT_PUBLIC_* values', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://abc.supabase.co');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY', 'build-key');
    expect(supabaseUrl()).toBe('https://abc.supabase.co');
    expect(supabaseAnonKey()).toBe('build-key');

    vi.stubEnv('SUPABASE_URL', 'http://supabase-envoy:8000');
    vi.stubEnv('SUPABASE_ANON_KEY', 'run-key');
    expect(supabaseUrl()).toBe('http://supabase-envoy:8000');
    expect(supabaseAnonKey()).toBe('run-key');
  });

  it('builds public file links from SUPABASE_PUBLIC_URL, not the private server address', () => {
    vi.stubEnv('SUPABASE_URL', 'http://supabase-envoy:8000');
    vi.stubEnv('SUPABASE_PUBLIC_URL', 'https://files.royalgenegroup.co.ke/');
    expect(publicObjectUrl('products', 'org-1/shoe 1.jpg')).toBe(
      'https://files.royalgenegroup.co.ke/storage/v1/object/public/products/org-1/shoe%201.jpg',
    );
  });

  it('falls back to the server address when no public base is set, as getPublicUrl did', () => {
    vi.stubEnv('SUPABASE_URL', '');
    vi.stubEnv('SUPABASE_PUBLIC_URL', '');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://abc.supabase.co');
    expect(publicObjectUrl('app-releases', 'android/app-12.apk')).toBe(
      'https://abc.supabase.co/storage/v1/object/public/app-releases/android/app-12.apk',
    );
  });
});
