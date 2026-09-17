import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-client';

const APK_BUCKET = 'app-releases';

interface PublishResponse {
  success: boolean;
  error?: string;
  message?: string;
  release?: {
    platform: string;
    versionCode: number;
    versionName: string;
    apkUrl: string;
  };
}

/**
 * POST /api/internal/app-releases — called by CI (GitHub Actions), not by
 * the portal frontend or the mobile app. Authenticated with a static bearer
 * token (APP_RELEASE_PUBLISH_TOKEN) rather than a portal JWT, the same way
 * the Paystack webhook uses an HMAC secret instead of one — there's no user
 * session at build time.
 *
 * multipart/form-data body:
 *   apk           – the signed release APK
 *   versionCode   – integer, must be strictly greater than any published one
 *   versionName   – e.g. "1.0.42"
 *   changelog?    – shown in the in-app update prompt and the download page
 */
export async function POST(request: NextRequest) {
  try {
    const token = request.headers.get('Authorization')?.replace('Bearer ', '');
    const expected = process.env.APP_RELEASE_PUBLISH_TOKEN;
    if (!expected) {
      return NextResponse.json<PublishResponse>(
        { success: false, error: 'Publishing is not configured' },
        { status: 503 }
      );
    }
    if (!token || token !== expected) {
      return NextResponse.json<PublishResponse>(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const formData = await request.formData();
    const apk = formData.get('apk') as File | null;
    const versionCodeRaw = formData.get('versionCode') as string | null;
    const versionName = (formData.get('versionName') as string | null)?.trim();
    const changelog = (formData.get('changelog') as string | null)?.trim() || null;
    const platform = (formData.get('platform') as string | null)?.trim() || 'android';

    const versionCode = versionCodeRaw ? parseInt(versionCodeRaw, 10) : NaN;

    if (!apk || !Number.isFinite(versionCode) || versionCode <= 0 || !versionName) {
      return NextResponse.json<PublishResponse>(
        { success: false, error: 'apk, versionCode and versionName are required' },
        { status: 400 }
      );
    }
    if (apk.type && apk.type !== 'application/vnd.android.package-archive' && apk.type !== 'application/octet-stream') {
      return NextResponse.json<PublishResponse>(
        { success: false, error: 'apk must be an APK file' },
        { status: 400 }
      );
    }

    const { data: latest } = await supabaseAdmin
      .from('AppRelease')
      .select('versionCode')
      .eq('platform', platform)
      .order('versionCode', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latest && versionCode <= (latest as { versionCode: number }).versionCode) {
      return NextResponse.json<PublishResponse>(
        { success: false, error: `versionCode ${versionCode} is not newer than the published ${latest.versionCode}` },
        { status: 409 }
      );
    }

    const buffer = await apk.arrayBuffer();
    const path = `${platform}/${versionCode}.apk`;
    const { error: uploadError } = await supabaseAdmin.storage
      .from(APK_BUCKET)
      .upload(path, buffer, {
        contentType: 'application/vnd.android.package-archive',
        upsert: true,
      });
    if (uploadError) {
      return NextResponse.json<PublishResponse>(
        { success: false, error: `Upload failed: ${uploadError.message}` },
        { status: 500 }
      );
    }

    const { data: publicUrlData } = supabaseAdmin.storage.from(APK_BUCKET).getPublicUrl(path);

    const { error: insertError } = await supabaseAdmin.from('AppRelease').insert({
      platform,
      versionCode,
      versionName,
      apkPath: path,
      apkUrl: publicUrlData.publicUrl,
      fileSizeBytes: buffer.byteLength,
      changelog,
    });
    if (insertError) {
      return NextResponse.json<PublishResponse>(
        { success: false, error: `Failed to record release: ${insertError.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json<PublishResponse>({
      success: true,
      message: 'Release published',
      release: { platform, versionCode, versionName, apkUrl: publicUrlData.publicUrl },
    });
  } catch (err) {
    console.error('[app-releases publish] Unexpected error:', err instanceof Error ? err.message : String(err));
    return NextResponse.json<PublishResponse>(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
