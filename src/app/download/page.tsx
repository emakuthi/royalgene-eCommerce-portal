import Image from 'next/image';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { supabaseAdmin } from '@/lib/supabase-client';

async function getLatestRelease() {
  const { data } = await supabaseAdmin
    .from('AppRelease')
    .select('versionCode, versionName, apkUrl, changelog, fileSizeBytes, createdAt')
    .eq('platform', 'android')
    .order('versionCode', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

function formatSize(bytes: number | null | undefined): string | null {
  if (!bytes) return null;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default async function DownloadPage() {
  const release = await getLatestRelease();

  return (
    <div className="min-h-screen bg-white dark:bg-gray-950">
      <header className="sticky top-0 z-40 border-b border-gray-100 dark:border-gray-800 bg-white/80 dark:bg-gray-950/80 backdrop-blur">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 h-16 flex items-center justify-between">
          <Link href="/">
            <Image src="/logo.png" alt="Royal Gene Portal" width={163} height={50} className="object-contain h-10 w-auto" priority />
          </Link>
          <div className="flex items-center gap-2">
            <Button variant="ghost" asChild>
              <Link href="/login">Sign in</Link>
            </Button>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-2xl px-4 sm:px-6 py-16 sm:py-24 text-center">
        <h1 className="text-3xl sm:text-4xl font-bold text-gray-900 dark:text-white">RoyalTrack for Android</h1>
        <p className="mt-3 text-gray-500 dark:text-gray-400">
          The RoyalTrack mobile app for shop staff and admins — stock, sales and receipts on the go.
        </p>

        {release ? (
          <div className="mt-10 rounded-2xl border border-gray-100 dark:border-gray-800 p-8">
            <p className="text-sm text-gray-500 dark:text-gray-400">Version {release.versionName}</p>
            <Button asChild size="lg" className="mt-4 bg-[hsl(var(--primary))] hover:brightness-90 text-white">
              <a href={release.apkUrl} download>Download APK</a>
            </Button>
            {formatSize(release.fileSizeBytes) && (
              <p className="mt-2 text-xs text-gray-400">{formatSize(release.fileSizeBytes)}</p>
            )}
            {release.changelog && (
              <div className="mt-6 text-left">
                <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">What&apos;s new</p>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400 whitespace-pre-line">{release.changelog}</p>
              </div>
            )}
            <p className="mt-6 text-xs text-gray-400">
              Not on the Play Store — after downloading, open the file and allow installs from this
              browser when prompted. Already have the app? It checks for updates automatically.
            </p>
          </div>
        ) : (
          <p className="mt-10 text-gray-500 dark:text-gray-400">No build published yet — check back soon.</p>
        )}
      </section>

      <footer className="mx-auto max-w-6xl px-4 sm:px-6 py-10 text-center text-sm text-gray-500 dark:text-gray-400">
        © {new Date().getFullYear()} Royal Gene Portal. All rights reserved.
      </footer>
    </div>
  );
}
