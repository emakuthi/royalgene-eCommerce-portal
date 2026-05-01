import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, IMAGE_BUCKET } from '@/lib/supabase-client';
import { verifyToken } from '@/lib/auth.server';
import { v4 as uuidv4 } from 'uuid';

interface UploadResponse {
  success: boolean;
  url?: string;
  error?: string;
  message?: string;
}

/**
 * POST /api/portal/upload
 * Uploads an image to Supabase Storage.
 * Requires a valid portal/admin JWT in the Authorization header.
 *
 * Form body:
 *   file  – the image file
 *   name? – optional custom filename prefix
 *
 * Returns:
 *   { success: true, url: "<public-storage-url>" }
 */
export async function POST(request: NextRequest) {
  try {
    // Auth check – portal users and admins may upload images
    const token = request.headers.get('Authorization')?.replace('Bearer ', '');
    if (!token) {
      return NextResponse.json<UploadResponse>(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }
    const payload = verifyToken(token);
    if (!payload) {
      return NextResponse.json<UploadResponse>(
        { success: false, error: 'Invalid token' },
        { status: 401 }
      );
    }

    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const customName = (formData.get('name') as string | null) ?? undefined;

    if (!file) {
      return NextResponse.json<UploadResponse>(
        { success: false, error: 'No file provided' },
        { status: 400 }
      );
    }

    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json<UploadResponse>(
        { success: false, error: 'Invalid file type. Allowed: JPEG, PNG, WebP, GIF' },
        { status: 400 }
      );
    }

    // Validate file size (max 10 MB)
    const MAX_SIZE = 10 * 1024 * 1024;
    if (file.size > MAX_SIZE) {
      return NextResponse.json<UploadResponse>(
        { success: false, error: 'File size exceeds 10 MB limit' },
        { status: 400 }
      );
    }

    // Build a unique filename
    const extension = file.name.split('.').pop() || 'jpg';
    const filename = customName
      ? `${customName}-${uuidv4()}.${extension}`
      : `${uuidv4()}.${extension}`;

    // Upload to Supabase Storage
    const buffer = await file.arrayBuffer();
    const { data, error } = await supabaseAdmin.storage
      .from(IMAGE_BUCKET)
      .upload(filename, buffer, {
        contentType: file.type,
        upsert: false,
      });

    if (error) {
      console.error('[Portal Upload] Supabase upload error:', error.message);
      return NextResponse.json<UploadResponse>(
        { success: false, error: `Upload failed: ${error.message}` },
        { status: 500 }
      );
    }

    // Return the public URL
    const { data: publicUrlData } = supabaseAdmin.storage
      .from(IMAGE_BUCKET)
      .getPublicUrl(data.path);

    return NextResponse.json<UploadResponse>(
      {
        success: true,
        url: publicUrlData.publicUrl,
        message: 'Image uploaded successfully',
      },
      { status: 200 }
    );
  } catch (err) {
    console.error('[Portal Upload] Unexpected error:', err instanceof Error ? err.message : String(err));
    return NextResponse.json<UploadResponse>(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      Allow: 'POST, OPTIONS',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    },
  });
}

