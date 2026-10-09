import { describe, it, expect } from 'vitest';
import { parsePaymentBreakdown, paymentMethodsOf, paymentKind } from '../payment-breakdown';

describe('parsePaymentBreakdown', () => {
  it('returns null when nothing was sent (single-method sale)', () => {
    expect(parsePaymentBreakdown(undefined)).toBeNull();
    expect(parsePaymentBreakdown(null)).toBeNull();
  });

  it('accepts a valid split, rounding amounts to cents', () => {
    expect(parsePaymentBreakdown([
      { method: 'Cash', amount: 500 },
      { method: 'M-Pesa', amount: '1000.004' },
    ])).toEqual([
      { method: 'Cash', amount: 500 },
      { method: 'M-Pesa', amount: 1000 },
    ]);
  });

  it('rejects malformed input instead of treating it as single-method', () => {
    expect(parsePaymentBreakdown('Cash')).toHaveProperty('error');
    expect(parsePaymentBreakdown([{ method: 'Cash', amount: 500 }])).toHaveProperty('error');
    expect(parsePaymentBreakdown([{ method: 'Cash', amount: 0 }, { method: 'Card', amount: 5 }])).toHaveProperty('error');
    expect(parsePaymentBreakdown([{ method: '', amount: 5 }, { method: 'Card', amount: 5 }])).toHaveProperty('error');
    expect(parsePaymentBreakdown([{ method: 'Cash', amount: 5 }, { method: 'cash', amount: 5 }])).toHaveProperty('error');
  });
});

describe('paymentMethodsOf', () => {
  it('lists every method of a split sale', () => {
    expect(paymentMethodsOf({
      paymentMethod: 'Cash + M-Pesa',
      paymentBreakdown: [{ method: 'Cash', amount: 1 }, { method: 'M-Pesa', amount: 2 }],
    })).toEqual(['Cash', 'M-Pesa']);
  });

  it('falls back to paymentMethod, then cash', () => {
    expect(paymentMethodsOf({ paymentMethod: 'Card' })).toEqual(['Card']);
    expect(paymentMethodsOf({})).toEqual(['cash']);
  });
});

describe('paymentKind', () => {
  it('treats the app and portal spellings the same', () => {
    expect(paymentKind('M-Pesa')).toBe('mpesa');
    expect(paymentKind('mobile_money')).toBe('mpesa');
    expect(paymentKind('Card')).toBe('card');
    expect(paymentKind('cash')).toBe('cash');
    expect(paymentKind(undefined)).toBe('cash');
  });
});
