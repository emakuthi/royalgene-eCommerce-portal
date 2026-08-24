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

// Deletion is no longer client-triggered: removing an image from the
// product form just changes local state (see components/image-upload.tsx),
// and the backend (portal/mobile product PUT and full-product DELETE
// routes) diffs the submitted images array against what's actually stored
// and deletes whatever disappeared — see src/lib/storage-usage.server.ts's
// deleteUploadedFile(s). The previous deleteProductImage() here imported
// supabaseAdmin (the service-role client) directly into a module reachable
// from 'use client' components — a real key-exposure risk — and had zero
// callers, so it was removed rather than fixed in place.

