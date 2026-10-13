import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { forwardWebhook, parseRelayRoutes, relayTargetFor } from '../paystack-relay.server';

const FT = 'https://fleettrack.example.com/api/v1/billing/webhook';

describe('relayTargetFor', () => {
  it('routes FleetTrack references to FleetTrack', () => {
    expect(relayTargetFor('ft-123', `ft-=${FT}`)).toBe(FT);
  });

  it('keeps RoyalTrack references local', () => {
    expect(relayTargetFor('RT_abc123', `ft-=${FT}`)).toBeNull();
    expect(relayTargetFor(null, `ft-=${FT}`)).toBeNull();
  });

  it('defaults to the FleetTrack route', () => {
    const saved = process.env.PAYSTACK_RELAY_ROUTES;
    delete process.env.PAYSTACK_RELAY_ROUTES;
    try {
      expect(relayTargetFor('ft-9')).toBe('https://fleettrack.royalgenegroup.co.ke/api/v1/billing/webhook');
    } finally {
      if (saved !== undefined) process.env.PAYSTACK_RELAY_ROUTES = saved;
    }
  });

  it('can be switched off with an empty value', () => {
    expect(relayTargetFor('ft-9', '')).toBeNull();
  });
});

describe('parseRelayRoutes', () => {
  it('rejects malformed or non-https entries', () => {
    expect(() => parseRelayRoutes('ft-')).toThrow();
    expect(() => parseRelayRoutes('ft-=http://insecure.example.com')).toThrow();
  });
});

describe('forwardWebhook', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('forwards the exact body and signature', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(forwardWebhook(FT, '{"a":1}', 'sig')).resolves.toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(FT);
    expect(init.body).toBe('{"a":1}');
    expect((init.headers as Record<string, string>)['x-paystack-signature']).toBe('sig');
  });

  it('reports failure on non-2xx or network errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 401 })));
    await expect(forwardWebhook(FT, '{}', 'sig')).resolves.toBe(false);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down'); }));
    await expect(forwardWebhook(FT, '{}', 'sig')).resolves.toBe(false);
  });
});
