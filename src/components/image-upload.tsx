'use client';

import { useState, useRef, useCallback } from 'react';
import { uploadProductImage } from '@/lib/image-utils';
import { useAuthStore } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { X, Upload, Loader2 } from 'lucide-react';

interface ImageUploadProps {
  onImageUpload: (url: string) => void;
  onRemove?: (url: string) => void;
  images?: string[];
  maxFiles?: number;
}

export function ImageUpload({
  onImageUpload,
  onRemove,
  images = [],
  maxFiles = 5,
}: ImageUploadProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Grab the JWT so it can be forwarded to the portal upload API
  const { token } = useAuthStore();

  const handleFileSelect = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = event.target.files;
      if (!files) return;

      console.log('[Component] Stage 1: File selection started', {
        filesCount: files.length,
        timestamp: new Date().toISOString(),
      });

      if (images.length + files.length > maxFiles) {
        const errorMsg = `Maximum ${maxFiles} images allowed`;
        console.warn('[Component] Stage 1 FAILED: Max files exceeded', {
          currentCount: images.length,
          newCount: files.length,
          maxFiles,
        });
        setError(errorMsg);
        return;
      }

      console.log('[Component] Stage 2: File count validation passed', {
        currentCount: images.length,
        newCount: files.length,
        totalCount: images.length + files.length,
      });

      setError(null);
      setIsLoading(true);
      console.log('[Component] Stage 3: Processing started, loading state set');

      try {
        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          console.log(`[Component] Stage 4.${i + 1}: Processing file ${i + 1}/${files.length}`, {
            fileName: file.name,
            fileSize: file.size,
            fileType: file.type,
          });

          // Pass the auth token so the portal upload route can verify the request
          const url = await uploadProductImage(file, undefined, token ?? undefined);

          console.log(`[Component] Stage 4.${i + 1}: File ${i + 1}/${files.length} uploaded successfully`, {
            url,
          });

          onImageUpload(url);
        }

        console.log('[Component] COMPLETED: All files uploaded successfully', {
          totalFiles: files.length,
          timestamp: new Date().toISOString(),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Upload failed';
        console.error('[Component] FAILED: Upload failed', {
          error: message,
          timestamp: new Date().toISOString(),
        });
        setError(message);
      } finally {
        setIsLoading(false);
        console.log('[Component] Stage 5: Loading state reset');
        // Reset input
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
          console.log('[Component] Stage 6: File input reset');
        }
      }
    },
    [images.length, maxFiles, onImageUpload, token]
  );

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <label className="text-sm font-medium">Product Images</label>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={isLoading || images.length >= maxFiles}
            onClick={() => fileInputRef.current?.click()}
            className="gap-2"
          >
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Uploading...
              </>
            ) : (
              <>
                <Upload className="h-4 w-4" />
                Upload Image
              </>
            )}
          </Button>
          <span className="text-sm text-gray-500 self-center">
            {images.length}/{maxFiles}
          </span>
        </div>
        <Input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          multiple
          onChange={handleFileSelect}
          disabled={isLoading}
          className="hidden"
        />
        <p className="text-xs text-gray-500">
          Supported formats: JPEG, PNG, WebP, GIF (Max 10MB each)
        </p>
      </div>

      {error && (
        <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive-foreground">
          {error}
        </div>
      )}

      {images.length > 0 && (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
          {images.map((url) => (
            <div key={url} className="relative group">
              <img
                src={url}
                alt="Product"
                className="h-24 w-24 rounded-lg object-cover border border-gray-200"
              />
              {onRemove && (
                <button
                  onClick={() => onRemove(url)}
                  className="absolute -top-2 -right-2 bg-destructive text-destructive-foreground rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                  title="Remove image"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
