import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ROOT_DOMAIN is read from process.env at module load, so each test that
// needs a different root domain re-imports after setting the env var.
const loadUrls = async () => {
  vi.resetModules();
  return import('@/lib/urls');
};

describe('getOrgUrl / getOrgUrlFor', () => {
  const originalRootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_ROOT_DOMAIN = 'royaltrack.royalgenegroup.co.ke';
  });

  afterEach(() => {
    process.env.NEXT_PUBLIC_ROOT_DOMAIN = originalRootDomain;
  });

  it('builds a platform-subdomain URL from a slug', async () => {
    const { getOrgUrl } = await loadUrls();
    expect(getOrgUrl('acme', '/verify-email?token=abc')).toBe(
      'https://acme.royaltrack.royalgenegroup.co.ke/verify-email?token=abc',
    );
  });

  it('normalizes a path without a leading slash', async () => {
    const { getOrgUrl } = await loadUrls();
    expect(getOrgUrl('acme', 'session-bridge')).toBe('https://acme.royaltrack.royalgenegroup.co.ke/session-bridge');
  });

  it('uses a passed custom domain as the host', async () => {
    const { getOrgUrl } = await loadUrls();
    expect(getOrgUrl('acme', '/x', 'shop.acme.com')).toBe('https://shop.acme.com/x');
  });

  it('getOrgUrlFor prefers a verified custom domain', async () => {
    const { getOrgUrlFor } = await loadUrls();
    expect(
      getOrgUrlFor({ slug: 'acme', customDomain: 'shop.acme.com', customDomainStatus: 'verified' }, '/settings'),
    ).toBe('https://shop.acme.com/settings');
  });

  it('getOrgUrlFor ignores an unverified custom domain', async () => {
    const { getOrgUrlFor } = await loadUrls();
    for (const status of ['pending', 'misconfigured', null] as const) {
      expect(
        getOrgUrlFor({ slug: 'acme', customDomain: 'shop.acme.com', customDomainStatus: status }, '/settings'),
      ).toBe('https://acme.royaltrack.royalgenegroup.co.ke/settings');
    }
  });

  it('ignores custom domains in local dev', async () => {
    process.env.NEXT_PUBLIC_ROOT_DOMAIN = 'localhost:3001';
    const { getOrgUrlFor } = await loadUrls();
    expect(
      getOrgUrlFor({ slug: 'acme', customDomain: 'shop.acme.com', customDomainStatus: 'verified' }, '/x'),
    ).toBe('http://acme.localhost:3001/x');
  });
});
