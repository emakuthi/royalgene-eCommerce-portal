import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSupabaseMock, type MockTables } from '../entitlements/__tests__/supabase-mock';

const ORG_ID = 'org-1';

let mockTables: MockTables;

vi.mock('../supabase-client', () => ({
  get supabaseAdmin() {
    return createSupabaseMock(mockTables);
  },
}));

function baseTables(): MockTables {
  return {
    Organization: [{ id: ORG_ID, planTier: 'starter', slug: 'acme', status: 'active' }],
    User: [{ id: 'user-1', email: 'existing@acme.com', organizationId: ORG_ID, role: 'admin' }],
    PlatformPlan: [{ id: 'plan-pro', tier: 'pro' }],
    TenantSubscription: [],
    Shop: [],
    PortalUser: [],
  };
}

beforeEach(() => {
  mockTables = baseTables();
});

describe('findOrProvisionUserForSocialIdentity', () => {
  it('returns the existing user without creating anything new', async () => {
    const { findOrProvisionUserForSocialIdentity } = await import('../social-auth-provision.server');
    const result = await findOrProvisionUserForSocialIdentity(
      { email: 'existing@acme.com', name: 'Existing User', provider: 'google' },
      ORG_ID,
    );

    expect(result).toEqual({ userId: 'user-1', isNewUser: false });
    expect(mockTables.Organization).toHaveLength(1); // no new org created
  });

  it('auto-provisions a brand-new tenant for a first-time identity', async () => {
    const { findOrProvisionUserForSocialIdentity } = await import('../social-auth-provision.server');
    const result = await findOrProvisionUserForSocialIdentity(
      { email: 'newperson@gmail.com', name: 'New Person', provider: 'google' },
      ORG_ID,
    );

    expect(result.isNewUser).toBe(true);

    // A new Organization, User, Shop, and PortalUser were all created.
    expect(mockTables.Organization).toHaveLength(2);
    const newOrg = mockTables.Organization.find((o) => o.id !== ORG_ID)!;
    expect(newOrg.name).toBe("New Person's Workspace");

    const newUser = mockTables.User.find((u) => u.id === result.userId)!;
    expect(newUser).toMatchObject({ email: 'newperson@gmail.com', role: 'admin', organizationId: newOrg.id });
    expect(newUser.password).toBeTruthy(); // a random password hash was set, not left null

    expect(mockTables.Shop).toHaveLength(1);
    expect(mockTables.Shop[0].organizationId).toBe(newOrg.id);

    expect(mockTables.PortalUser).toHaveLength(1);
    expect(mockTables.PortalUser[0].userId).toBe(result.userId);
    expect(mockTables.PortalUser[0].mobileAccess).toBe(true);
  });

  it('falls back to the email local-part when the provider has no name', async () => {
    const { findOrProvisionUserForSocialIdentity } = await import('../social-auth-provision.server');
    const result = await findOrProvisionUserForSocialIdentity(
      { email: 'anon.person@gmail.com', name: null, provider: 'facebook' },
      null,
    );

    const newOrg = mockTables.Organization.find((o) => o.id !== ORG_ID)!;
    expect(newOrg.name).toBe("anon.person's Workspace");
    expect(result.isNewUser).toBe(true);
  });

  it('scopes the existing-user lookup to the host org — a same-email user in another tenant does not match', async () => {
    mockTables.User = [{ id: 'user-other', email: 'shared@example.com', organizationId: 'org-other', role: 'admin' }];
    const { findOrProvisionUserForSocialIdentity } = await import('../social-auth-provision.server');
    const result = await findOrProvisionUserForSocialIdentity(
      { email: 'shared@example.com', name: 'Someone', provider: 'google' },
      ORG_ID, // host org differs from org-other
    );

    // Not found in this host's scope -> provisions a new tenant instead of
    // silently attaching to a different tenant's user.
    expect(result.isNewUser).toBe(true);
  });
});
