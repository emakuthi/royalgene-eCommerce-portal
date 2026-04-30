'use client';

import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuthStore } from '@/lib/store';
import { Upload, Download, AlertCircle, CheckCircle2, X, Loader } from 'lucide-react';
import { toast } from 'sonner';
import type { Product } from '@/lib/types';

interface BulkUploadError {
  row: number;
  field: string;
  error: string;
  value?: string | number;
}

interface BulkUploadResult {
  successful: number;
  failed: number;
  total: number;
  errors: BulkUploadError[];
  createdProducts: Partial<Product>[];
}

export function BulkProductUpload() {
  const { token } = useAuthStore();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<BulkUploadResult | null>(null);
  const [showResult, setShowResult] = useState(false);

  const handleDownloadTemplate = async () => {
    try {
      const response = await fetch('/api/admin/products/bulk-upload');
      const csv = await response.text();

      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);

      link.setAttribute('href', url);
      link.setAttribute('download', 'products-template.csv');
      link.style.visibility = 'hidden';

      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      URL.revokeObjectURL(url);

      toast.success('Template downloaded successfully');
    } catch (error) {
      console.error('Error downloading template:', error);
      toast.error('Failed to download template');
    }
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.includes('csv') && !file.name.endsWith('.csv')) {
      toast.error('Please select a CSV file');
      return;
    }

    handleUpload(file);
  };

  const handleUpload = async (file: File) => {
    if (!token) {
      toast.error('Authentication required. Please login.');
      return;
    }

    setUploading(true);
    setUploadResult(null);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch('/api/admin/products/bulk-upload', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
        },
        body: formData,
      });

      const data = await response.json();

      if (data.results) {
        setUploadResult(data.results);
        setShowResult(true);

        if (data.results.successful > 0) {
          toast.success(
            `Successfully uploaded ${data.results.successful} product${data.results.successful !== 1 ? 's' : ''}`
          );
        }

        if (data.results.failed > 0) {
          toast.error(
            `Failed to upload ${data.results.failed} product${data.results.failed !== 1 ? 's' : ''}`
          );
        }
      } else if (!data.success) {
        toast.error(data.error || 'Upload failed');
      }

      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    } catch (error) {
      console.error('Upload error:', error);
      toast.error('Upload failed. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const files = e.dataTransfer.files;
    const file = files[0];

    if (file && (file.type.includes('csv') || file.name.endsWith('.csv'))) {
      handleUpload(file);
    } else {
      toast.error('Please drop a CSV file');
    }
  };

  return (
    <div className="space-y-4">
      {/* Upload Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            Bulk Product Upload
          </CardTitle>
          <CardDescription>Upload multiple products from a CSV file</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Drop Zone */}
          <div
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center cursor-pointer hover:border-gray-400 hover:bg-gray-50 transition"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="h-8 w-8 mx-auto mb-2 text-gray-400" />
            <p className="font-medium text-gray-700 mb-1">Drop your CSV file here</p>
            <p className="text-sm text-gray-500">or click to select a file</p>

            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              onChange={handleFileSelect}
              className="hidden"
              disabled={uploading}
            />
          </div>

          {/* Action Buttons */}
          <div className="flex gap-2 pt-2">
            <Button
              variant="outline"
              onClick={handleDownloadTemplate}
              disabled={uploading}
              className="gap-2"
            >
              <Download className="h-4 w-4" />
              Download Template
            </Button>
          </div>

          {/* Upload Status */}
          {uploading && (
            <div className="flex items-center justify-center gap-2 text-sm text-gray-600 py-2">
              <Loader className="h-4 w-4 animate-spin" />
              Uploading products...
            </div>
          )}
        </CardContent>
      </Card>

      {/* Results Card */}
      {showResult && uploadResult && (
        <Card className={uploadResult.successful > 0 ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}>
          <CardHeader>
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2">
                {uploadResult.successful > 0 ? (
                  <CheckCircle2 className="h-5 w-5 text-green-600" />
                ) : (
                  <AlertCircle className="h-5 w-5 text-red-600" />
                )}
                <div>
                  <CardTitle className={uploadResult.successful > 0 ? 'text-green-900' : 'text-red-900'}>
                    Upload Result
                  </CardTitle>
                  <CardDescription className={uploadResult.successful > 0 ? 'text-green-700' : 'text-red-700'}>
                    {uploadResult.successful === uploadResult.total
                      ? 'All products uploaded successfully!'
                      : `Uploaded ${uploadResult.successful} of ${uploadResult.total} products`}
                  </CardDescription>
                </div>
              </div>
              <button
                onClick={() => setShowResult(false)}
                className="text-gray-500 hover:text-gray-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Summary Stats */}
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-white rounded-lg p-3">
                <p className="text-sm text-gray-600 mb-1">Successful</p>
                <p className="text-2xl font-bold text-green-600">{uploadResult.successful}</p>
              </div>
              <div className="bg-white rounded-lg p-3">
                <p className="text-sm text-gray-600 mb-1">Failed</p>
                <p className="text-2xl font-bold text-red-600">{uploadResult.failed}</p>
              </div>
            </div>

            {/* Error Details */}
            {uploadResult.errors.length > 0 && (
              <div className="space-y-2">
                <h4 className="font-medium text-sm text-gray-900">Errors:</h4>
                <div className="bg-white rounded-lg p-3 max-h-64 overflow-y-auto space-y-2">
                  {uploadResult.errors.map((error, idx) => (
                    <div key={idx} className="text-sm border-l-2 border-red-300 pl-3 py-1">
                      <p className="font-medium text-red-900">
                        Row {error.row}, Field: {error.field}
                      </p>
                      <p className="text-red-700">{error.error}</p>
                      {error.value && <p className="text-red-600 text-xs">Value: {error.value}</p>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Created Products List */}
            {uploadResult.createdProducts.length > 0 && (
              <div className="space-y-2">
                <h4 className="font-medium text-sm text-gray-900">Created Products:</h4>
                <div className="bg-white rounded-lg p-3 max-h-64 overflow-y-auto space-y-2">
                  {uploadResult.createdProducts.map((product) => (
                    <div key={product.id} className="text-sm border-l-2 border-green-300 pl-3 py-1">
                      <p className="font-medium text-green-900">{product.name}</p>
                      <p className="text-green-700 text-xs">SKU: {product.sku}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

