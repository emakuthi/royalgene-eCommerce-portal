import 'server-only';
import { supabaseAdmin } from './supabase-client';
import { createZip } from './zip';

type Row = Record<string, unknown>;

// Supabase returns at most this many rows per request, so anything longer has
// to be read page by page or the export would quietly stop short.
const PAGE_SIZE = 1000;

/** Vercel refuses a response over 4.5 MB, so stop just under that with a clear message. */
export const MAX_EXPORT_BYTES = 4 * 1024 * 1024;

// Tables that are simply absent on a database a migration hasn't reached.
const MISSING_TABLE_CODES = new Set(['42P01', 'PGRST205']);

const SENSITIVE_COLUMN = /password|secret|token|credential|hash|api_?key|otp|salt/i;

/**
 * What goes in an export. Listed one by one rather than discovered, so a new
 * table holding credentials or platform data can't end up in a customer's file
 * by default. byShop also catches rows that predate organizationId.
 */
const EXPORT_TABLES: Array<{ table: string; file: string; byShop?: boolean }> = [
  { table: 'Product', file: 'products.csv' },
  { table: 'ProductCategory', file: 'product-categories.csv' },
  { table: 'ProductBarcode', file: 'product-barcodes.csv' },
  { table: 'RecipeItem', file: 'recipe-items.csv' },
  { table: 'ShopStock', file: 'stock.csv', byShop: true },
  { table: 'ShopStockVariant', file: 'stock-sizes-colours.csv' },
  { table: 'StockTransaction', file: 'stock-movements.csv', byShop: true },
  { table: 'StockTransfer', file: 'stock-transfers.csv' },
  { table: 'SalesEntry', file: 'sales.csv', byShop: true },
  { table: 'Customer', file: 'customers.csv' },
  { table: 'CustomerPayment', file: 'customer-payments.csv' },
  { table: 'Expense', file: 'expenses.csv' },
  { table: 'ExpenseCategory', file: 'expense-categories.csv' },
  { table: 'RecurringExpense', file: 'recurring-expenses.csv' },
  { table: 'PortalUser', file: 'staff.csv' },
];

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  // A typed product name starting with = would otherwise run as a formula when
  // the file is opened in a spreadsheet.
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

/** One CSV document, without any column that could hold a credential. */
export function rowsToCsv(rows: Row[]): string {
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))].filter((c) => !SENSITIVE_COLUMN.test(c));
  return [columns.map(csvCell).join(','), ...rows.map((row) => columns.map((c) => csvCell(row[c])).join(','))].join('\r\n');
}

async function readAllRows(table: string, scope: string | { column: string; value: string }): Promise<Row[] | null> {
  const rows: Row[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const query = supabaseAdmin.from(table).select('*');
    const scoped = typeof scope === 'string' ? query.or(scope) : query.eq(scope.column, scope.value);
    const { data, error } = await scoped.order('id', { ascending: true }).range(from, from + PAGE_SIZE - 1);
    if (error) {
      if (error.code && MISSING_TABLE_CODES.has(error.code)) return null;
      // An export with a table missing looks complete but isn't, so fail the whole thing.
      throw new Error(`${table}: ${error.message}`);
    }
    rows.push(...((data ?? []) as Row[]));
    if ((data ?? []).length < PAGE_SIZE) return rows;
  }
}

function readme(name: string, now: Date, counts: Array<{ file: string; rows: number }>, missing: string[]): string {
  return [
    `RoyalTrack data export for ${name}`,
    `Created ${now.toISOString()}`,
    '',
    'Keep this file private. It holds your sales, stock, costs and staff details.',
    '',
    'Files (rows):',
    ...counts.map((c) => `  ${c.file} (${c.rows})`),
    ...(missing.length ? ['', `Not available yet on this workspace: ${missing.join(', ')}`] : []),
    '',
    'Good to know:',
    '  - Product photos are not included.',
    '  - Sales still waiting to sync on a phone are not included.',
    '  - A date in a deletedAt column means that row was deleted.',
    '  - The files open in Excel or Google Sheets. RoyalTrack cannot load them back in yet.',
    '',
  ].join('\r\n');
}

export interface OrgExport {
  zip: Buffer;
  fileName: string;
  counts: Array<{ file: string; rows: number }>;
}

/** Everything a workspace owns, as a zip of CSV files. */
export async function buildOrgExport(organizationId: string, now: Date = new Date()): Promise<OrgExport> {
  const { data: org, error: orgError } = await supabaseAdmin
    .from('Organization')
    .select('name, slug')
    .eq('id', organizationId)
    .maybeSingle();
  if (orgError || !org) throw new Error(orgError?.message ?? 'Organization not found');

  const orgScope = { column: 'organizationId', value: organizationId };
  const shops = await readAllRows('Shop', orgScope);
  if (!shops) throw new Error('Shop table not found');
  const shopIds = shops.map((s) => String(s.id));
  const shopScope = shopIds.length > 0
    ? `organizationId.eq.${organizationId},shopId.in.(${shopIds.join(',')})`
    : `organizationId.eq.${organizationId}`;

  const entries = [{ name: 'shops.csv', content: rowsToCsv(shops) }];
  const counts = [{ file: 'shops.csv', rows: shops.length }];
  const missing: string[] = [];
  for (const { table, file, byShop } of EXPORT_TABLES) {
    const rows = await readAllRows(table, byShop ? shopScope : orgScope);
    if (!rows) {
      missing.push(file);
      continue;
    }
    entries.push({ name: file, content: rowsToCsv(rows) });
    counts.push({ file, rows: rows.length });
  }

  const name = String((org as Row).name ?? 'your workspace');
  const slug = String((org as Row).slug ?? 'workspace').replace(/[^a-z0-9-]/gi, '');
  return {
    zip: createZip([{ name: 'README.txt', content: readme(name, now, counts, missing) }, ...entries], now),
    fileName: `royaltrack-${slug}-${now.toISOString().slice(0, 10)}.zip`,
    counts,
  };
}
