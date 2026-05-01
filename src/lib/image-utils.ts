import { supabaseAdmin, IMAGE_BUCKET } from './supabase-client';

/**
 * Upload image to Supabase Storage via the portal upload API.
 * @param file - Image file to upload
 * @param customName - Optional custom filename prefix (without extension)
 * @param token - Optional JWT sent in Authorization header
 * @returns Public URL of uploaded image
 */
export async function uploadProductImage(
  file: File,
  customName?: string,
  token?: string
): Promise<string> {
  console.log('[Image Upload] Stage 1: Starting image upload', {
    fileName: file.name,
    fileSize: file.size,
    fileType: file.type,
    customName,
    timestamp: new Date().toISOString(),
  });

  // Validate file type
  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  if (!allowedTypes.includes(file.type)) {
    console.error('[Image Upload] Stage 1 FAILED: Invalid file type', { fileType: file.type });
    throw new Error('Invalid file type. Allowed: JPEG, PNG, WebP, GIF');
  }
  console.log('[Image Upload] Stage 2: File type validated', { fileType: file.type });

  // Validate file size (max 10MB)
  const maxSize = 10 * 1024 * 1024;
  if (file.size > maxSize) {
    console.error('[Image Upload] Stage 2 FAILED: File size exceeds limit', {
      fileSize: file.size,
      maxSize
    });
    throw new Error('File size exceeds 10MB limit');
  }
  console.log('[Image Upload] Stage 3: File size validated', { fileSize: file.size });

  // Send to upload API
  const formData = new FormData();
  formData.append('file', file);
  if (customName) {
    formData.append('name', customName);
  }
  console.log('[Image Upload] Stage 4: FormData created, sending to server', {
    timestamp: new Date().toISOString(),
  });

  // Use the portal-specific upload endpoint (the eCommerce app's /api/admin/upload
  // is not accessible from the portal app).
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const response = await fetch('/api/portal/upload', {
    method: 'POST',
    headers,
    body: formData,
  });
  console.log('[Image Upload] Stage 5: Server response received', {
    status: response.status,
    statusText: response.statusText,
    timestamp: new Date().toISOString(),
  });

  if (!response.ok) {
    const error = await response.json();
    console.error('[Image Upload] Stage 5 FAILED: Server error', {
      status: response.status,
      error
    });
    throw new Error(error.error || 'Upload failed');
  }

  const data = await response.json();
  console.log('[Image Upload] Stage 6: Response parsed successfully', {
    url: data.url,
    message: data.message,
    timestamp: new Date().toISOString(),
  });
  console.log('[Image Upload] COMPLETED: Image uploaded successfully', { url: data.url });

  return data.url;
}

/**
 * Delete image from Supabase Storage
 * @param imageUrl - Public URL of the image
 */
export async function deleteProductImage(imageUrl: string): Promise<void> {
  console.log('[Image Delete] Stage 1: Starting image deletion', {
    imageUrl,
    timestamp: new Date().toISOString(),
  });

  // Extract filename from URL
  const match = imageUrl.match(/\/storage\/v1\/object\/public\/products\/(.+?)(?:\?|$)/);
  if (!match || !match[1]) {
    console.error('[Image Delete] Stage 1 FAILED: Invalid image URL format', { imageUrl });
    throw new Error('Invalid image URL');
  }
  console.log('[Image Delete] Stage 2: URL parsed successfully', { filename: match[1] });

  const filename = decodeURIComponent(match[1]);
  console.log('[Image Delete] Stage 3: Filename decoded', { filename });

  const { error } = await supabaseAdmin.storage
    .from(IMAGE_BUCKET)
    .remove([filename]);
  console.log('[Image Delete] Stage 4: Deletion request sent to storage', {
    timestamp: new Date().toISOString(),
  });

  if (error) {
    console.error('[Image Delete] Stage 4 FAILED: Storage deletion failed', {
      error: error.message
    });
    throw new Error(`Failed to delete image: ${error.message}`);
  }

  console.log('[Image Delete] COMPLETED: Image deleted successfully', { filename });
}

