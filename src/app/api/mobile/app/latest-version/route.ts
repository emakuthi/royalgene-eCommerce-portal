import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-client';
import { getMinAppVersionCode } from '@/lib/platform-settings.server';

const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.royalgenegroup.royaltrack';

interface LatestVersionResponse {
  success: boolean;
  error?: string;
  data?: {
    versionCode: number;
    versionName: string;
    apkUrl: string;
    changelog: string | null;
    releasedAt: string;
  } | null;
  /**
   * Force-update policy, separate from `data` so it's served even before any
   * release exists. Builds with versionCode < minVersionCode must update
   * before they can be used (0 = no minimum). Older app builds ignore it.
   */
  policy?: { minVersionCode: number; playStoreUrl: string };
}

/**
 * GET /api/mobile/app/latest-version?platform=android — public, unauthenticated.
 * The app calls this on the shared root host (same as login/signup) since
 * one APK build serves every tenant. No release published yet is not an
 * error — data is just null and the app has nothing to prompt about.
 */
export async function GET(request: NextRequest) {
  try {
    const platform = request.nextUrl.searchParams.get('platform') || 'android';

    const [{ data, error }, minVersionCode] = await Promise.all([supabaseAdmin
      .from('AppRelease')
      .select('versionCode, versionName, apkUrl, changelog, createdAt')
      .eq('platform', platform)
      .order('versionCode', { ascending: false })
      .limit(1)
      .maybeSingle(), getMinAppVersionCode()]);

    if (error) {
      return NextResponse.json<LatestVersionResponse>(
        { success: false, error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json<LatestVersionResponse>({
      success: true,
      data: data
        ? {
            versionCode: data.versionCode,
            versionName: data.versionName,
            apkUrl: data.apkUrl,
            changelog: data.changelog ?? null,
            releasedAt: data.createdAt,
          }
        : null,
      policy: { minVersionCode, playStoreUrl: PLAY_STORE_URL },
    });
  } catch (err) {
    console.error('[latest-version] Unexpected error:', err instanceof Error ? err.message : String(err));
    return NextResponse.json<LatestVersionResponse>(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
