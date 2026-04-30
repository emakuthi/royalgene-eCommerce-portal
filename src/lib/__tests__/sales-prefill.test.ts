import { describe, it, expect } from 'vitest';
import { computePrefillForm, PrefillSaleInput, PrefillStockRow } from '@/lib/sales-prefill';

describe('computePrefillForm', () => {
  it('prefills from matching stock', () => {
    const sale: PrefillSaleInput = { productId: 'p1', unitPrice: 5000, paymentMethod: 'cash' };
    const stocks: PrefillStockRow[] = [{ id: 's1', productId: 'p1', quantity: 10, product: { id: 'p1', price: 4500 } } as PrefillStockRow];
    const res = computePrefillForm(sale, stocks);
    expect(res.shopStockId).toBe('s1');
    expect(res.productId).toBe('p1');
    expect(res.unitPrice).toBe(5000); // explicit sale.unitPrice takes precedence
    expect(res.paymentMethod).toBe('cash');
    expect(res.quantity).toBe(1);
  });

  it('falls back to stock price when sale unitPrice not provided', () => {
    const sale: PrefillSaleInput = { productId: 'p2' };
    const stocks: PrefillStockRow[] = [{ id: 's2', productId: 'p2', quantity: 5, product: { id: 'p2', price: 2500 } } as PrefillStockRow];
    const res = computePrefillForm(sale, stocks);
    expect(res.shopStockId).toBe('s2');
    expect(res.unitPrice).toBe(2500);
  });

  it('maps mobile_money to mpesa', () => {
    const sale: PrefillSaleInput = { productId: 'p3', paymentMethod: 'mobile_money' };
    const stocks: PrefillStockRow[] = [];
    const res = computePrefillForm(sale, stocks);
    expect(res.paymentMethod).toBe('mpesa');
  });

  it('prefers admin product price from products table', () => {
    const sale: PrefillSaleInput = { productId: 'p4' };
    const stocks: PrefillStockRow[] = [
      {
        id: 's4',
        productId: 'p4',
        quantity: 20,
        product: { id: 'p4', price: 3500 } // admin product price from products table
      } as PrefillStockRow
    ];
    const res = computePrefillForm(sale, stocks);
    expect(res.shopStockId).toBe('s4');
    expect(res.unitPrice).toBe(3500); // should use admin product price
  });

  it('handles Product (uppercase) relation for admin price', () => {
    const sale: PrefillSaleInput = { productId: 'p5' };
    const stocks: PrefillStockRow[] = [
      {
        id: 's5',
        productId: 'p5',
        quantity: 15,
        Product: { id: 'p5', price: 6000 } // uppercase Product relation
      } as PrefillStockRow
    ];
    const res = computePrefillForm(sale, stocks);
    expect(res.unitPrice).toBe(6000); // should use Product.price
  });

  it('explicit sale unitPrice takes precedence over admin product price', () => {
    const sale: PrefillSaleInput = { productId: 'p6', unitPrice: 7000 };
    const stocks: PrefillStockRow[] = [
      {
        id: 's6',
        productId: 'p6',
        quantity: 8,
        product: { id: 'p6', price: 5500 } // admin has different price
      } as PrefillStockRow
    ];
    const res = computePrefillForm(sale, stocks);
    expect(res.unitPrice).toBe(7000); // explicit sale.unitPrice takes precedence
  });
});
