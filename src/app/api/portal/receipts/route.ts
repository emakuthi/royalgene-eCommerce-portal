import { NextRequest, NextResponse } from 'next/server';
import { requireTenantUser } from '@/lib/authorize';
import { optionsResponse } from '@/lib/apiResponse';
import { handleCreateReceipt, handleListReceipts } from '@/lib/receipts/receipt-routes.server';

// GET /api/portal/receipts[?from=&to=&shopId=&expenseId=&stockTransactionId=&q=] — purchase receipts.
export async function GET(request: NextRequest) {
  const auth = requireTenantUser(request);
  if (auth instanceof NextResponse) return auth;
  return handleListReceipts(request, auth);
}

// POST /api/portal/receipts — multipart: file + supplier/amount/receiptDate/notes/links; saved to Google Drive.
export async function POST(request: NextRequest) {
  const auth = requireTenantUser(request);
  if (auth instanceof NextResponse) return auth;
  return handleCreateReceipt(request, auth);
}

export function OPTIONS() {
  return optionsResponse('GET,POST,OPTIONS');
}
