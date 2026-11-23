import { NextRequest } from 'next/server';
import { optionsResponse } from '@/lib/apiResponse';
import { handleCreateReceipt, handleListReceipts } from '@/lib/receipts/receipt-routes.server';
import { mobileReceiptsAuth } from '@/lib/receipts/mobile-auth.server';

// GET /api/mobile/receipts[?from=&to=&shopId=&expenseId=&stockTransactionId=&q=] — purchase receipts.
export async function GET(request: NextRequest) {
  const auth = await mobileReceiptsAuth(request);
  if (auth instanceof Response) return auth;
  return handleListReceipts(request, auth);
}

// POST /api/mobile/receipts — multipart: file + supplier/amount/receiptDate/notes/links; saved to Google Drive.
export async function POST(request: NextRequest) {
  const auth = await mobileReceiptsAuth(request);
  if (auth instanceof Response) return auth;
  return handleCreateReceipt(request, auth);
}

export function OPTIONS() {
  return optionsResponse('GET,POST,OPTIONS');
}
