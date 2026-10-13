import 'server-only';

// One Paystack account serves several Royal Gene apps, but Paystack allows a
// single webhook URL — this one. Events for another app are recognised by
// their transaction reference prefix and forwarded there unchanged (same raw
// body, same x-paystack-signature), so that app verifies the signature itself
// with the shared secret key.
//
// PAYSTACK_RELAY_ROUTES: comma-separated prefix=url pairs. Defaults to
// FleetTrack, whose references start with "ft-".
const DEFAULT_ROUTES = 'ft-=https://fleettrack.royalgenegroup.co.ke/api/v1/billing/webhook';

export function parseRelayRoutes(config: string | undefined): [prefix: string, url: string][] {
  return (config ?? '')
    .split(',')
    .map((pair) => pair.trim())
    .filter(Boolean)
    .map((pair) => {
      const i = pair.indexOf('=');
      const prefix = i > 0 ? pair.slice(0, i).trim() : '';
      const url = i > 0 ? pair.slice(i + 1).trim() : '';
      if (!prefix || !url.startsWith('https://')) throw new Error(`PAYSTACK_RELAY_ROUTES entry must be prefix=https://url: ${pair}`);
      return [prefix, url];
    });
}

/** Where an event with this reference belongs, or null when it is RoyalTrack's own. */
export function relayTargetFor(reference: string | null, config = process.env.PAYSTACK_RELAY_ROUTES ?? DEFAULT_ROUTES): string | null {
  if (!reference) return null;
  return parseRelayRoutes(config).find(([prefix]) => reference.startsWith(prefix))?.[1] ?? null;
}

/** Forwards the event unchanged; true when the app accepted it (2xx). */
export async function forwardWebhook(url: string, rawBody: string, signature: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-paystack-signature': signature },
      body: rawBody,
      signal: AbortSignal.timeout(20_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
