import { describe, it, expect } from 'vitest';
import { summariseDay, reportTemplateParams, normaliseWhatsappNumber } from '../daily-report';

const shops = { a: 'Town', b: 'Mall' };

describe('summariseDay', () => {
  it('counts checkouts, not lines, and splits revenue by payment method', () => {
    const r = summariseDay(
      [
        { id: '1', shopId: 'a', saleGroupId: 'g1', totalAmount: 600, paymentMethod: 'M-Pesa' },
        { id: '2', shopId: 'a', saleGroupId: 'g1', totalAmount: 400, paymentMethod: 'M-Pesa' },
        { id: '3', shopId: 'b', saleGroupId: 'g2', totalAmount: '250', paymentMethod: 'cash' },
      ],
      shops,
      [],
    );
    expect(r.total).toBe(1250);
    expect(r.orders).toBe(2);
    expect(r.byPayment).toEqual({ cash: 250, mpesa: 1000, card: 0, credit: 0 });
    expect(r.shops).toEqual([{ name: 'Town', total: 1000, orders: 1 }, { name: 'Mall', total: 250, orders: 1 }]);
  });

  it('splits each line of a split-payment checkout by the methods\' shares', () => {
    const breakdown = [{ method: 'Cash', amount: 300 }, { method: 'M-Pesa', amount: 700 }];
    const r = summariseDay(
      [
        { id: '1', shopId: 'a', saleGroupId: 'g', totalAmount: 500, paymentMethod: 'Cash + M-Pesa', paymentBreakdown: breakdown },
        { id: '2', shopId: 'a', saleGroupId: 'g', totalAmount: 500, paymentMethod: 'Cash + M-Pesa', paymentBreakdown: breakdown },
      ],
      shops,
      [],
    );
    expect(r.byPayment.cash).toBeCloseTo(300);
    expect(r.byPayment.mpesa).toBeCloseTo(700);
  });

  it('leaves deleted sales out of the totals but counts them', () => {
    const r = summariseDay(
      [
        { id: '1', shopId: 'a', saleGroupId: 'g1', totalAmount: 100, paymentMethod: 'cash' },
        { id: '2', shopId: 'a', saleGroupId: 'g2', totalAmount: 900, paymentMethod: 'cash', deletedAt: '2026-11-11T10:00:00Z' },
      ],
      shops,
      [],
    );
    expect(r.total).toBe(100);
    expect(r.deletedSales).toBe(1);
  });

  it('counts out-of-stock and low stock using each shop\'s own limit', () => {
    const r = summariseDay([], shops, [
      { quantity: 0, lowStockThreshold: 5 },
      { quantity: 3, lowStockThreshold: 5 },
      { quantity: 3, lowStockThreshold: 0 },
      { quantity: 20, lowStockThreshold: 5 },
    ]);
    expect(r.outOfStock).toBe(1);
    expect(r.lowStock).toBe(1);
  });
});

describe('reportTemplateParams', () => {
  it('gives seven single-line parameters', () => {
    const r = summariseDay([{ id: '1', shopId: 'a', saleGroupId: 'g', totalAmount: 1500, paymentMethod: 'M-Pesa' }], shops, [{ quantity: 0, lowStockThreshold: 2 }]);
    const p = reportTemplateParams(r, 'Royal\nCollection', 'Wed, 11 Nov', 'KES');
    expect(p).toHaveLength(7);
    expect(p.every((x) => !/[\n\t]/.test(x))).toBe(true);
    expect(p[0]).toBe('Royal Collection');
    expect(p[3]).toBe('1');
    expect(p[4]).toContain('M-Pesa');
    expect(p[6]).toBe('1 out of stock');
  });

  it('says so when there were no sales', () => {
    const p = reportTemplateParams(summariseDay([], shops, []), 'Shop', 'Wed, 11 Nov', 'KES');
    expect(p[4]).toBe('none');
    expect(p[5]).toBe('no sales');
    expect(p[6]).toBe('all good');
  });
});

describe('normaliseWhatsappNumber', () => {
  it('turns Kenyan local numbers into international form', () => {
    expect(normaliseWhatsappNumber('0712 345 678')).toBe('254712345678');
    expect(normaliseWhatsappNumber('0112345678')).toBe('254112345678');
    expect(normaliseWhatsappNumber('+254 712-345-678')).toBe('254712345678');
    expect(normaliseWhatsappNumber('712345678')).toBe('254712345678');
  });

  it('keeps other countries and rejects junk', () => {
    expect(normaliseWhatsappNumber('+255 754 123 456')).toBe('255754123456');
    expect(normaliseWhatsappNumber('call me')).toBeNull();
    expect(normaliseWhatsappNumber('12345')).toBeNull();
  });
});
