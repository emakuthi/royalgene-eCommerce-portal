import { describe, expect, it } from 'vitest';
import { resolveSoldAt } from '../sale-time';

const now = Date.parse('2026-11-03T12:00:00.000Z');
const arrival = '2026-11-03T12:00:00.000Z';

describe('resolveSoldAt', () => {
  it('keeps the time of a sale made offline yesterday', () => {
    expect(resolveSoldAt('2026-11-02T09:30:00.000Z', now)).toBe('2026-11-02T09:30:00.000Z');
  });

  it('reads a time with an offset as the instant it is', () => {
    expect(resolveSoldAt('2026-11-02T12:30:00.000+03:00', now)).toBe('2026-11-02T09:30:00.000Z');
  });

  it.each([
    ['missing', undefined],
    ['null', null],
    ['not text', 1762000000000],
    ['unreadable', 'yesterday-ish'],
    ['in the future', '2026-11-03T12:00:01.000Z'],
    ['more than 90 days old', '2026-08-01T00:00:00.000Z'],
  ])('falls back to the arrival time when %s', (_label, raw) => {
    expect(resolveSoldAt(raw, now)).toBe(arrival);
  });
});
