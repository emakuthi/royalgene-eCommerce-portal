// Where the server reaches Supabase. SUPABASE_URL and SUPABASE_ANON_KEY are read
// at run time, unlike NEXT_PUBLIC_* values, which Next.js bakes into the build, so
// one image can point at hosted or self-hosted Supabase. The NEXT_PUBLIC_* names
// stay as the fallback for deployments that haven't set the new ones.
export const supabaseUrl = (): string | undefined =>
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;

export const supabaseAnonKey = (): string | undefined =>
  process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY;

/**
 * Browser-facing link to a file in a public bucket. The server may reach Supabase
 * on a private address, so links use SUPABASE_PUBLIC_URL when it is set. Built
 * the same way as supabase-js getPublicUrl.
 */
export function publicObjectUrl(bucket: string, path: string): string {
  const base = (process.env.SUPABASE_PUBLIC_URL || supabaseUrl() || '').replace(/\/+$/, '');
  return encodeURI(`${base}/storage/v1/object/public/${bucket}/${path}`);
}
