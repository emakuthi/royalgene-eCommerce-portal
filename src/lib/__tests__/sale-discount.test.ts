import { describe, it, expect } from 'vitest';
import { parseSaleDiscount } from '../sale-discount';

describe('parseSaleDiscount', () => {
  it('treats a missing discount as 0', () => {
    expect(parseSaleDiscount(undefined, 100)).toBe(0);
    expect(parseSaleDiscount(null, 100)).toBe(0);
    expect(parseSaleDiscount('', 100)).toBe(0);
  });

  it('accepts a discount up to the line gross, rounded to cents', () => {
    expect(parseSaleDiscount(25.004, 100)).toBe(25);
    expect(parseSaleDiscount('100', 100)).toBe(100);
  });

  it('rejects negative, non-numeric, or more-than-gross discounts', () => {
    expect(parseSaleDiscount(-1, 100)).toHaveProperty('error');
    expect(parseSaleDiscount('abc', 100)).toHaveProperty('error');
    expect(parseSaleDiscount(100.01, 100)).toHaveProperty('error');
  });
});
