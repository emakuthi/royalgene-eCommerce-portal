import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-client';

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

    const { data, error } = await supabaseAdmin
      .from('AppRelease')
      .select('versionCode, versionName, apkUrl, changelog, createdAt')
      .eq('platform', platform)
      .order('versionCode', { ascending: false })
      .limit(1)
      .maybeSingle();

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
    });
  } catch (err) {
    console.error('[latest-version] Unexpected error:', err instanceof Error ? err.message : String(err));
    return NextResponse.json<LatestVersionResponse>(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
