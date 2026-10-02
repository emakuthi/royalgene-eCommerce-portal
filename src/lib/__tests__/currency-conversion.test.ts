import { describe, it, expect, vi, beforeEach } from 'vitest';

const getRateMock = vi.fn();
const getCurrenciesMock = vi.fn(async () => ([
  { code: 'KES', name: 'Kenyan Shilling', symbol: 'KSh', decimals: 2, isActive: true, isBase: true },
  { code: 'USD', name: 'US Dollar', symbol: '$', decimals: 2, isActive: true, isBase: false },
  { code: 'UGX', name: 'Ugandan Shilling', symbol: 'USh', decimals: 0, isActive: true, isBase: false },
]));

vi.mock('../exchange-rates.server', () => ({
  getRate: (...args: unknown[]) => getRateMock(...args),
  getCurrencies: () => getCurrenciesMock(),
}));

import { convert } from '../currency-conversion.server';

describe('currency-conversion / convert', () => {
  beforeEach(() => { getRateMock.mockReset(); });

  it('converts USD→KES using the resolved rate', async () => {
    getRateMock.mockResolvedValue(129.5);
    const r = await convert(100, 'USD', 'KES');
    expect(r).not.toBeNull();
    expect(r!.amount).toBe(12950);
    expect(r!.rate).toBe(129.5);
  });

  it('supports reverse conversion KES→USD', async () => {
    getRateMock.mockResolvedValue(1 / 129.5);
    const r = await convert(12950, 'KES', 'USD');
    expect(r!.amount).toBeCloseTo(100, 2);
  });

  it('rounds to the target currency decimals (UGX = 0 dp)', async () => {
    getRateMock.mockResolvedValue(28.4);
    const r = await convert(100, 'KES', 'UGX');
    expect(r!.decimals).toBe(0);
    expect(Number.isInteger(r!.amount)).toBe(true);
    expect(r!.amount).toBe(2840);
  });

  it('passes date + organizationId through for historical/tenant rates', async () => {
    getRateMock.mockResolvedValue(130);
    await convert(10, 'USD', 'KES', { date: '2026-01-01', organizationId: 'org-1' });
    expect(getRateMock).toHaveBeenCalledWith('USD', 'KES', { date: '2026-01-01', organizationId: 'org-1' });
  });

  it('returns null when no rate is available (caller degrades gracefully)', async () => {
    getRateMock.mockResolvedValue(null);
    expect(await convert(100, 'USD', 'KES')).toBeNull();
  });

  it('rejects non-positive rates defensively', async () => {
    getRateMock.mockResolvedValue(0);
    expect(await convert(100, 'USD', 'KES')).toBeNull();
  });
});
