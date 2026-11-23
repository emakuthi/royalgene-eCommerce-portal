'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Download, ExternalLink, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { formatMoney } from '@/lib/currency';
import { deleteReceipt, fetchReceiptObjectUrl, type Receipt } from '@/lib/receipts';

/**
 * Shows one or more receipts (an expense can have several pages): the photo or PDF
 * fetched from Google Drive through RoyalTrack, with download and remove.
 */
export default function ReceiptViewer({
  token,
  receipts,
  onClose,
  onDeleted,
}: {
  token: string | null;
  receipts: Receipt[];
  onClose: () => void;
  onDeleted: (id: string) => void;
}) {
  const [index, setIndex] = useState(0);
  const receipt = receipts[Math.min(index, receipts.length - 1)];
  const [file, setFile] = useState<{ url?: string; error?: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!receipt) return;
    let url: string | undefined;
    let cancelled = false;
    setFile(null);
    fetchReceiptObjectUrl(token, receipt.id).then((r) => {
      if ('url' in r) url = r.url;
      if (cancelled) { if (url) URL.revokeObjectURL(url); return; }
      setFile('url' in r ? { url: r.url } : { error: r.error });
    });
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [token, receipt]);

  if (!receipt) return null;

  const download = () => {
    if (!file?.url) return;
    const a = document.createElement('a');
    a.href = file.url;
    a.download = receipt.fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const remove = async () => {
    if (!window.confirm('Remove this receipt? It moves to the bin in Google Drive, where you can still restore it for 30 days.')) return;
    setDeleting(true);
    const res = await deleteReceipt(token, receipt.id);
    setDeleting(false);
    if (res.success) {
      toast.success('Receipt removed');
      onDeleted(receipt.id);
      setIndex(0);
    } else {
      toast.error(res.error || 'Could not remove the receipt');
    }
  };

  const facts = [
    receipt.supplier,
    receipt.amount != null ? formatMoney(receipt.amount, receipt.currency ?? undefined) : null,
    receipt.receiptDate,
  ].filter(Boolean).join(' · ');

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()} fullWidth maxWidth="md">
      <DialogContent>
        <DialogHeader>
          <DialogTitle sx={{ px: 0 }}>Receipt{receipts.length > 1 ? ` ${index + 1} of ${receipts.length}` : ''}</DialogTitle>
          {facts && <p className="text-sm text-gray-600 dark:text-gray-300">{facts}</p>}
          {receipt.notes && <p className="text-sm text-gray-500">{receipt.notes}</p>}
        </DialogHeader>

        <div className="mt-4 flex min-h-[16rem] items-center justify-center rounded-lg bg-gray-50 dark:bg-gray-800/60 overflow-hidden">
          {!file ? (
            <p className="text-sm text-gray-500">Opening from Google Drive…</p>
          ) : file.error ? (
            <p className="px-4 text-center text-sm text-red-600">{file.error}</p>
          ) : receipt.mimeType === 'application/pdf' ? (
            <iframe src={file.url} title={receipt.fileName} className="h-[70vh] w-full" />
          ) : (
            // A local object URL, so next/image has nothing to optimise.
            <img src={file.url} alt={`Receipt ${receipt.fileName}`} className="max-h-[70vh] w-auto object-contain" />
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <div className="flex gap-2">
            {receipts.length > 1 && (
              <>
                <Button variant="outline" size="sm" disabled={index === 0} onClick={() => setIndex(index - 1)}>Previous</Button>
                <Button variant="outline" size="sm" disabled={index >= receipts.length - 1} onClick={() => setIndex(index + 1)}>Next</Button>
              </>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" disabled={!file?.url} onClick={download}><Download className="h-3.5 w-3.5 mr-1" />Download</Button>
            {file?.url && (
              <Button variant="outline" size="sm" onClick={() => window.open(file.url, '_blank', 'noopener')}><ExternalLink className="h-3.5 w-3.5 mr-1" />Open</Button>
            )}
            <Button variant="outline" size="sm" disabled={deleting} onClick={remove} className="text-red-600 hover:text-red-700">
              <Trash2 className="h-3.5 w-3.5 mr-1" />{deleting ? 'Removing…' : 'Remove'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
