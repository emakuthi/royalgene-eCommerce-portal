import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, IMAGE_BUCKET } from '@/lib/supabase-client';
import { verifyMobileAuth } from '@/lib/mobile-shop-auth';
import { v4 as uuidv4 } from 'uuid';

/**
 * POST /api/mobile/upload
 * Upload a product image from a mobile client to Supabase Storage.
 *
 * Requires a valid JWT (portal_user, admin, or super_admin) in the
 * Authorization header.
 *
 * Form body:
 *   file  – the image file (JPEG, PNG, WebP, or GIF, max 10 MB)
 *   name? – optional custom filename prefix
 *
 * Returns:
 *   { success: true, url: "<public-storage-url>" }
 */
export async function POST(request: NextRequest) {
  try {
    // Auth – reuse the lightweight mobile auth helper (no shop scope needed here)
    const authResult = verifyMobileAuth(request);
    if (authResult instanceof Response) return authResult;

    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const customName = (formData.get('name') as string | null) ?? undefined;

    if (!file) {
      return NextResponse.json(
        { success: false, error: 'No file provided', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    // Validate MIME type
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json(
        { success: false, error: 'Invalid file type. Allowed: JPEG, PNG, WebP, GIF', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    // Validate file size (max 10 MB)
    const MAX_SIZE = 10 * 1024 * 1024;
    if (file.size > MAX_SIZE) {
      return NextResponse.json(
        { success: false, error: 'File size exceeds 10 MB limit', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    // Build a unique filename
    const extension = file.name.split('.').pop() || 'jpg';
    const filename = customName
      ? `mobile/${customName}-${uuidv4()}.${extension}`
      : `mobile/${uuidv4()}.${extension}`;

    // Upload to Supabase Storage
    const buffer = await file.arrayBuffer();
    const { data, error } = await supabaseAdmin.storage
      .from(IMAGE_BUCKET)
      .upload(filename, buffer, {
        contentType: file.type,
        upsert: false,
      });

    if (error) {
      console.error('[Mobile Upload] Supabase upload error:', error.message);
      return NextResponse.json(
        { success: false, error: `Upload failed: ${error.message}`, code: 'INTERNAL_ERROR' },
        { status: 500 },
      );
    }

    // Get and return the public URL
    const { data: publicUrlData } = supabaseAdmin.storage
      .from(IMAGE_BUCKET)
      .getPublicUrl(data.path);

    return NextResponse.json(
      {
        success: true,
        url: publicUrlData.publicUrl,
        message: 'Image uploaded successfully',
      },
      { status: 200 },
    );
  } catch (err) {
    console.error('[Mobile Upload] Unexpected error:', err instanceof Error ? err.message : String(err));
    return NextResponse.json(
      { success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' },
      { status: 500 },
    );
  }
}

export function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    },
  });
}

