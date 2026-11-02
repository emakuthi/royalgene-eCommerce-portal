/** Oldest sale time an app may claim. Further back is more likely a wrong phone clock than a real sale. */
const MAX_SOLD_AT_AGE_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * When a sale really happened, for one recorded offline and sent later. Phones'
 * clocks can be wrong and this decides which day's reports the sale lands in,
 * so anything missing, unreadable, in the future or implausibly old falls back
 * to the time it arrived.
 */
export function resolveSoldAt(raw: unknown, nowMs: number = Date.now()): string {
  const soldAtMs = typeof raw === 'string' ? Date.parse(raw) : NaN;
  const usable = Number.isFinite(soldAtMs) && soldAtMs <= nowMs && nowMs - soldAtMs <= MAX_SOLD_AT_AGE_MS;
  return new Date(usable ? soldAtMs : nowMs).toISOString();
}
