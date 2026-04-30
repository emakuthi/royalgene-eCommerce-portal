// Helper to compute pre-filled form data for quick record
import type { Product } from '@/lib/types';

export type PrefillSaleInput = {
  productId: string;
  product?: { name?: string } | null;
  unitPrice?: number;
  paymentMethod?: string;
};

export type PrefillStockRow = {
  id: string;
  productId: string;
  quantity: number;
  lowStockThreshold?: number;
  // some API shapes use `Product` (uppercase) when returning joined relations
  Product?: Product | null;
  product?: Product | null;
};

export function computePrefillForm(sale: PrefillSaleInput, stocks: PrefillStockRow[]) {
  const matchingStock = stocks.find((s) => s.productId === sale.productId);
  const shopStockId = matchingStock?.id || '';

  // Prefer explicit sale.unitPrice when provided.
  // Otherwise, prefer an authoritative admin product price from either `Product` (uppercase) or `product` relation.
  const adminPrice = matchingStock?.Product?.price ?? matchingStock?.product?.price ?? 0;
  const unitPrice = typeof sale.unitPrice === 'number' ? sale.unitPrice : adminPrice;

  const paymentMethod = sale.paymentMethod === 'mobile_money' ? 'mpesa' : (sale.paymentMethod ?? 'cash');

  return {
    shopStockId,
    productId: sale.productId,
    quantity: 1,
    unitPrice,
    discount: 0,
    paymentMethod,
    customerName: '',
    customerPhone: '',
    notes: '',
  };
}
