/**
 * Validates a line item's discount against its gross (quantity * unitPrice).
 * Absent = 0. See supabase/migrations/20261009_01_sale_discount.sql.
 */
export function parseSaleDiscount(raw: unknown, gross: number): number | { error: string } {
  if (raw == null || raw === '') return 0;
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n) || n < 0) return { error: 'Discount must be a positive amount' };
  const discount = Math.round(n * 100) / 100;
  if (discount > gross) return { error: 'Discount cannot be more than the item total' };
  return discount;
}
