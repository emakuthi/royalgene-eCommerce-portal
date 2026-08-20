import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/authorize';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { supabaseAdmin } from '@/lib/supabase-client';
import { getTaxInvoiceForSale } from '@/lib/etims/tax-invoice.server';

// GET /api/portal/sales/[id]/tax-invoice — the generated (not KRA-submitted) invoice for one sale.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;

  // Verify the sale belongs to the caller's own organization before returning its invoice.
  const { data: sale } = await supabaseAdmin.from('SalesEntry').select('organizationId').eq('id', id).maybeSingle();
  if (!sale) return jsonResponse({ success: false, error: 'Sale not found' }, 404);
  if (auth.organizationId && sale.organizationId !== auth.organizationId) {
    return jsonResponse({ success: false, error: 'Forbidden' }, 403);
  }

  const invoice = await getTaxInvoiceForSale(id);
  if (!invoice) return jsonResponse({ success: false, error: 'No tax invoice generated for this sale yet' }, 404);

  return jsonResponse({ success: true, data: invoice });
}

export function OPTIONS() {
  return optionsResponse('GET,OPTIONS');
}
