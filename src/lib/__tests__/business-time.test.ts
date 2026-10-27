import { describe, expect, it } from 'vitest';
import { businessDateKey, businessWeekKey, startOfBusinessDay } from '../business-time';

describe('business time (Kenya, UTC+3)', () => {
  it('puts a 01:30 Kenya sale on its own day, not the UTC day before', () => {
    // 2026-10-26 22:30 UTC = 2026-10-27 01:30 in Nairobi.
    expect(businessDateKey('2026-10-26T22:30:00Z')).toBe('2026-10-27');
    expect(businessDateKey('2026-10-26T20:59:59Z')).toBe('2026-10-26');
  });

  it('reads the zone-less UTC strings the old columns return the same as Z ones (server runs in UTC)', () => {
    expect(businessDateKey(new Date('2026-10-26T21:18:05.886Z'))).toBe('2026-10-27');
  });

  it('starts the day at Kenya midnight (21:00 UTC the day before)', () => {
    expect(startOfBusinessDay('2026-10-27T01:30:00+03:00').toISOString()).toBe('2026-10-26T21:00:00.000Z');
    expect(startOfBusinessDay('2026-10-27T01:30:00+03:00', 1).toISOString()).toBe('2026-10-27T21:00:00.000Z');
  });

  it('crosses month ends', () => {
    expect(startOfBusinessDay('2026-10-31T23:00:00+03:00', 1).toISOString()).toBe('2026-10-31T21:00:00.000Z');
  });

  it('keys weeks by the Kenya Sunday', () => {
    // Sun 2026-10-25 00:30 Nairobi = Sat 21:30 UTC — already the new week in Kenya.
    expect(businessWeekKey('2026-10-24T21:30:00Z')).toBe('2026-10-25');
    expect(businessWeekKey('2026-10-24T20:30:00Z')).toBe('2026-10-18');
  });

  it('handles a zone with daylight saving', () => {
    // Europe/London switched to GMT on 2026-10-25; midnight that day was still BST (23:00 UTC the day before).
    expect(startOfBusinessDay('2026-10-25T12:00:00Z', 0, 'Europe/London').toISOString()).toBe('2026-10-24T23:00:00.000Z');
    expect(startOfBusinessDay('2026-10-25T12:00:00Z', 1, 'Europe/London').toISOString()).toBe('2026-10-26T00:00:00.000Z');
  });
});
