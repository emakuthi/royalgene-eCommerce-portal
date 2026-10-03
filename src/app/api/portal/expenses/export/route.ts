import { NextRequest, NextResponse } from 'next/server';
import { requireTenantUser } from '@/lib/authorize';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { listExpenses } from '@/lib/expenses.server';
import { getOrgCurrency } from '@/lib/currency.server';
import { supabaseAdmin } from '@/lib/supabase-client';

/** CSV-escape: wrap in quotes and double any embedded quotes. */
function csv(value: unknown): string {
  const s = value == null ? '' : String(value);
  return `"${s.replace(/"/g, '""')}"`;
}

// GET /api/portal/expenses/export[?from=&to=&shopId=&categoryId=]
// Streams the filtered expenses as a CSV download (base currency in a dedicated
// column so totals are comparable regardless of the entry currency).
export async function GET(request: NextRequest) {
  const auth = requireTenantUser(request);
  if (auth instanceof NextResponse) return auth;
  if (!auth.organizationId) return jsonResponse({ success: false, error: 'No organization' }, 400);
  const p = request.nextUrl.searchParams;

  const [expenses, { currency: baseCurrency }, { data: shopRows }] = await Promise.all([
    listExpenses(auth.organizationId, {
      shopId: p.get('shopId') || undefined,
      from: p.get('from') || undefined,
      to: p.get('to') || undefined,
      categoryId: p.get('categoryId') || undefined,
    }),
    getOrgCurrency(auth.organizationId),
    supabaseAdmin.from('Shop').select('id, name').eq('organizationId', auth.organizationId),
  ]);

  const shopNames = new Map<string, string>(((shopRows as { id: string; name: string }[]) ?? []).map((s) => [s.id, s.name]));

  const header = ['Date', 'Category', 'Shop', 'Description', 'Amount', 'Currency', `Base Amount (${baseCurrency})`];
  const lines = [header.map(csv).join(',')];
  for (const e of expenses) {
    lines.push([
      csv(e.expenseDate),
      csv(e.categoryName ?? ''),
      csv(e.shopId ? (shopNames.get(e.shopId) ?? '') : 'Org-wide'),
      csv(e.description ?? ''),
      csv(e.amount.toFixed(2)),
      csv(e.currency),
      csv(e.baseAmount.toFixed(2)),
    ].join(','));
  }
  const totalBase = expenses.reduce((s, e) => s + e.baseAmount, 0);
  lines.push(['', '', '', '', '', csv('TOTAL'), csv(totalBase.toFixed(2))].join(','));

  const csvBody = '﻿' + lines.join('\r\n'); // BOM so Excel reads UTF-8
  const filename = `expenses-${p.get('from') || 'all'}_${p.get('to') || 'all'}.csv`;
  return new NextResponse(csvBody, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}

export function OPTIONS() {
  return optionsResponse('GET,OPTIONS');
}
