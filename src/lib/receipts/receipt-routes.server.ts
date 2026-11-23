import 'server-only';
import type { NextRequest } from 'next/server';
import type { VerifiedPayload } from '../auth.server';
import { jsonResponse } from '../apiResponse';
import { denyUnlessShopAllowed } from '../shop-access.server';
import {
  MAX_RECEIPT_BYTES,
  canManageReceipts,
  cleanReceiptInput,
  createReceipt,
  deleteReceipt,
  findReceipt,
  listReceipts,
  openReceiptFile,
  updateReceipt,
} from './receipts.server';

/**
 * Request handling for receipts, shared by /api/portal/receipts and
 * /api/mobile/receipts — each route only authenticates and hands over the
 * verified payload.
 */

const FORBIDDEN = () => jsonResponse(
  { success: false, error: 'You do not have permission to manage receipts. Ask an admin to grant it.', code: 'FORBIDDEN' },
  403,
);
const NOT_FOUND = () => jsonResponse({ success: false, error: 'Receipt not found', code: 'NOT_FOUND' }, 404);
const fail = (r: { status: number; error: string; code?: string }) => jsonResponse({ success: false, error: r.error, code: r.code }, r.status);

/** GET ?from=&to=&shopId=&expenseId=&stockTransactionId=&q= */
export async function handleListReceipts(request: NextRequest, p: VerifiedPayload): Promise<Response> {
  if (!(await canManageReceipts(p))) return FORBIDDEN();
  const q = request.nextUrl.searchParams;
  const data = await listReceipts(p, {
    from: q.get('from') || undefined,
    to: q.get('to') || undefined,
    shopId: q.get('shopId') || undefined,
    expenseId: q.get('expenseId') || undefined,
    stockTransactionId: q.get('stockTransactionId') || undefined,
    search: q.get('q') || undefined,
  });
  return jsonResponse({ success: true, data });
}

/** POST multipart/form-data: `file` plus optional supplier, amount, currency, receiptDate, notes, shopId, expenseId, stockTransactionId. */
export async function handleCreateReceipt(request: NextRequest, p: VerifiedPayload): Promise<Response> {
  if (!(await canManageReceipts(p))) return FORBIDDEN();
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > MAX_RECEIPT_BYTES + 64 * 1024) return jsonResponse({ success: false, error: 'A receipt can be at most 10 MB' }, 413);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonResponse({ success: false, error: 'Send the receipt as multipart/form-data with a "file" field' }, 400);
  }
  const file = form.get('file');
  if (!(file instanceof Blob)) return jsonResponse({ success: false, error: 'A "file" is required' }, 400);

  const fields: Record<string, unknown> = {};
  for (const [k, v] of form.entries()) if (k !== 'file' && typeof v === 'string') fields[k] = v;
  const input = await cleanReceiptInput(p.organizationId as string, fields);
  if (!input.ok) return fail(input);
  if (input.value.shopId) {
    const denied = await denyUnlessShopAllowed(p, input.value.shopId);
    if (denied) return denied;
  }

  const result = await createReceipt(
    p.organizationId as string,
    p.userId ?? null,
    { bytes: new Uint8Array(await file.arrayBuffer()), mimeType: file.type },
    input.value,
  );
  if (!result.ok) return fail(result);
  return jsonResponse({ success: true, data: result.receipt }, 201);
}

export async function handleGetReceipt(p: VerifiedPayload, id: string): Promise<Response> {
  if (!(await canManageReceipts(p))) return FORBIDDEN();
  const receipt = await findReceipt(p, id);
  if (!receipt) return NOT_FOUND();
  const { driveFileId: _driveFileId, ...dto } = receipt;
  return jsonResponse({ success: true, data: dto });
}

/** PATCH JSON with any of the editable fields (supplier, amount, receiptDate, notes, links). */
export async function handleUpdateReceipt(request: NextRequest, p: VerifiedPayload, id: string): Promise<Response> {
  if (!(await canManageReceipts(p))) return FORBIDDEN();
  const existing = await findReceipt(p, id);
  if (!existing) return NOT_FOUND();
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const input = await cleanReceiptInput(p.organizationId as string, body);
  if (!input.ok) return fail(input);
  // Only the fields actually sent change.
  const patch = Object.fromEntries(Object.entries(input.value).filter(([k]) => k in body));
  if (typeof patch.shopId === 'string') {
    const denied = await denyUnlessShopAllowed(p, patch.shopId);
    if (denied) return denied;
  }
  const updated = await updateReceipt(p.organizationId as string, id, patch);
  return updated ? jsonResponse({ success: true, data: updated }) : NOT_FOUND();
}

export async function handleDeleteReceipt(p: VerifiedPayload, id: string): Promise<Response> {
  if (!(await canManageReceipts(p))) return FORBIDDEN();
  const receipt = await findReceipt(p, id);
  if (!receipt) return NOT_FOUND();
  await deleteReceipt(p.organizationId as string, receipt);
  return jsonResponse({ success: true });
}

/** The image/PDF itself, streamed from Drive (private, never cached by shared caches). */
export async function handleReceiptFile(p: VerifiedPayload, id: string, download: boolean): Promise<Response> {
  if (!(await canManageReceipts(p))) return FORBIDDEN();
  const receipt = await findReceipt(p, id);
  if (!receipt) return NOT_FOUND();
  const opened = await openReceiptFile(p.organizationId as string, receipt.driveFileId);
  if (!opened.ok) return fail(opened);
  const safeName = receipt.fileName.replace(/[^\w.\- ]+/g, '_');
  return new Response(opened.response.body, {
    status: 200,
    headers: {
      'Content-Type': receipt.mimeType,
      'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${safeName}"`,
      'Cache-Control': 'private, max-age=300',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
