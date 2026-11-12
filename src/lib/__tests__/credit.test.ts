import { describe, it, expect } from 'vitest';
import { creditPart, customerBalances, isCreditSale, cleanCustomerName, cleanCustomerPhone } from '../credit';
import { paymentKind } from '../payment-breakdown';

describe('paymentKind', () => {
  it('knows credit by either name', () => {
    expect(paymentKind('Credit')).toBe('credit');
    expect(paymentKind('deni')).toBe('credit');
    expect(paymentKind('On credit')).toBe('credit');
    expect(paymentKind('M-Pesa')).toBe('mpesa');
    expect(paymentKind(null)).toBe('cash');
  });
});

describe('creditPart', () => {
  it('is the whole line for a sale fully on credit', () => {
    expect(creditPart({ id: '1', totalAmount: 1500, paymentMethod: 'Credit' })).toBe(1500);
  });

  it('is nothing for a paid sale', () => {
    expect(creditPart({ id: '1', totalAmount: 1500, paymentMethod: 'M-Pesa' })).toBe(0);
  });

  it('is the line\'s share of credit in a split checkout', () => {
    const breakdown = [{ method: 'Cash', amount: 500 }, { method: 'Credit', amount: 1500 }];
    // Two lines of 1,000 each share the checkout's 2,000; three quarters of each is on credit.
    expect(creditPart({ id: '1', totalAmount: 1000, paymentMethod: 'Cash + Credit', paymentBreakdown: breakdown })).toBe(750);
  });

  it('uses the base-currency amount when the sale was in another currency', () => {
    expect(creditPart({ id: '1', totalAmount: 10, baseAmount: 1300, paymentMethod: 'Credit' })).toBe(1300);
  });
});

describe('isCreditSale', () => {
  it('spots credit in a single method or a split', () => {
    expect(isCreditSale({ paymentMethod: 'Credit' })).toBe(true);
    expect(isCreditSale({ paymentMethod: 'Cash + Credit', paymentBreakdown: [{ method: 'Cash', amount: 1 }, { method: 'Credit', amount: 2 }] })).toBe(true);
    expect(isCreditSale({ paymentMethod: 'Cash' })).toBe(false);
  });
});

describe('customerBalances', () => {
  it('owed minus paid, ignoring deleted sales and payments', () => {
    const balances = customerBalances(
      [
        { id: '1', customerId: 'c1', totalAmount: 1000, paymentMethod: 'Credit' },
        { id: '2', customerId: 'c1', totalAmount: 500, paymentMethod: 'Credit', deletedAt: '2026-11-12T08:00:00Z' },
        { id: '3', customerId: 'c1', totalAmount: 800, paymentMethod: 'Cash' },
        { id: '4', customerId: null, totalAmount: 300, paymentMethod: 'Credit' },
      ],
      [
        { customerId: 'c1', amount: 400 },
        { customerId: 'c1', amount: '100' },
        { customerId: 'c1', amount: 999, deletedAt: '2026-11-12T09:00:00Z' },
      ],
    );
    expect(balances.get('c1')).toEqual({ customerId: 'c1', owedTotal: 1000, paidTotal: 500, balance: 500 });
    expect(balances.size).toBe(1);
  });

  it('shows money paid in advance as a negative balance', () => {
    const b = customerBalances([], [{ customerId: 'c2', amount: 200 }]).get('c2');
    expect(b?.balance).toBe(-200);
  });
});

describe('customer details', () => {
  it('tidies names and rejects too-short ones', () => {
    expect(cleanCustomerName('  Mama   Njeri ')).toBe('Mama Njeri');
    expect(cleanCustomerName('A')).toBeNull();
    expect(cleanCustomerName(42)).toBeNull();
  });

  it('accepts a blank or plausible phone and rejects junk', () => {
    expect(cleanCustomerPhone('')).toBeNull();
    expect(cleanCustomerPhone(undefined)).toBeNull();
    expect(cleanCustomerPhone('0712 345 678')).toBe('0712 345 678');
    expect(cleanCustomerPhone('call me')).toBeUndefined();
  });
});
