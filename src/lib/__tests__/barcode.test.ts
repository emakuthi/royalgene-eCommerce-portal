import { describe, it, expect, vi } from 'vitest';

// barcode.server imports the Supabase admin client; the pure helpers under test never touch it.
vi.mock('@/lib/supabase-client', () => ({ supabaseAdmin: {} }));

import { normalizeBarcode, validateBarcodeInputs } from '@/lib/barcode.server';

describe('normalizeBarcode', () => {
  it('trims whitespace and strips the CR/LF a scanner appends', () => {
    expect(normalizeBarcode('  6001234567890\r\n')).toBe('6001234567890');
  });

  it('returns an empty string for non-strings', () => {
    expect(normalizeBarcode(null)).toBe('');
    expect(normalizeBarcode(undefined)).toBe('');
    expect(normalizeBarcode(42)).toBe('');
  });
});

describe('validateBarcodeInputs', () => {
  it('accepts codes with optional size/colour and normalises them', () => {
    const r = validateBarcodeInputs([{ code: ' 123 ' }, { code: 'ABC', size: ' M ', color: 'Red' }]);
    expect(r).toEqual({
      ok: true,
      barcodes: [
        { code: '123', size: '', color: '' },
        { code: 'ABC', size: 'M', color: 'Red' },
      ],
    });
  });

  it('accepts an empty list (clears the product\'s barcodes)', () => {
    expect(validateBarcodeInputs([])).toEqual({ ok: true, barcodes: [] });
  });

  it('rejects a non-array', () => {
    expect(validateBarcodeInputs('123').ok).toBe(false);
  });

  it('rejects a blank code', () => {
    expect(validateBarcodeInputs([{ code: '   ' }]).ok).toBe(false);
  });

  it('rejects the same code twice, ignoring case', () => {
    const r = validateBarcodeInputs([{ code: 'abc' }, { code: 'ABC' }]);
    expect(r.ok).toBe(false);
  });

  it('rejects over-long codes and oversized lists', () => {
    expect(validateBarcodeInputs([{ code: 'x'.repeat(129) }]).ok).toBe(false);
    const many = Array.from({ length: 51 }, (_, i) => ({ code: `c${i}` }));
    expect(validateBarcodeInputs(many).ok).toBe(false);
  });
});
