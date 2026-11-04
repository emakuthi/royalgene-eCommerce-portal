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
    // Google already verified the address — no email round-trip, workspace live straight away.
    expect(newUser.emailVerifiedAt).toEqual(expect.any(String));
    expect(newOrg.status).toBe('active');
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

  it('matches an existing account by email regardless of the request host', async () => {
    mockTables.User = [{ id: 'user-other', email: 'shared@example.com', organizationId: 'org-other', role: 'admin' }];
    const { findOrProvisionUserForSocialIdentity } = await import('../social-auth-provision.server');
    const result = await findOrProvisionUserForSocialIdentity(
      { email: 'shared@example.com', name: 'Someone', provider: 'google' },
      ORG_ID, // host differs from the account's org — no longer relevant
    );

    // Email is globally unique now: a verified identity is the same person
    // whatever host they came in on. Attach, don't provision a second tenant.
    expect(result).toEqual({ userId: 'user-other', isNewUser: false });
    expect(mockTables.Organization).toHaveLength(1);
  });
});

describe('findOrProvisionUserForAppleIdentity', () => {
  it('finds a linked person even when Apple sends no email', async () => {
    mockTables.AppleIdentity = [{ subject: 'sub-1', userId: 'user-1' }];
    const { findOrProvisionUserForAppleIdentity } = await import('../social-auth-provision.server');
    await expect(
      findOrProvisionUserForAppleIdentity({ subject: 'sub-1', email: null, name: null }),
    ).resolves.toEqual({ userId: 'user-1', isNewUser: false });
  });

  it('goes by the link when the Apple email has changed, without a new workspace', async () => {
    mockTables.AppleIdentity = [{ subject: 'sub-1', userId: 'user-1' }];
    const { findOrProvisionUserForAppleIdentity } = await import('../social-auth-provision.server');
    await expect(
      findOrProvisionUserForAppleIdentity({ subject: 'sub-1', email: 'changed@acme.com', name: null }),
    ).resolves.toEqual({ userId: 'user-1', isNewUser: false });
    expect(mockTables.Organization).toHaveLength(1);
  });

  it('matches an existing account by email and remembers the Apple id', async () => {
    mockTables.AppleIdentity = [];
    const { findOrProvisionUserForAppleIdentity } = await import('../social-auth-provision.server');
    await expect(
      findOrProvisionUserForAppleIdentity({ subject: 'sub-1', email: 'existing@acme.com', name: null }),
    ).resolves.toEqual({ userId: 'user-1', isNewUser: false });
    expect(mockTables.AppleIdentity).toEqual([expect.objectContaining({ subject: 'sub-1', userId: 'user-1' })]);
    expect(mockTables.Organization).toHaveLength(1);
  });

  it('creates a workspace for a first-time person and remembers the Apple id', async () => {
    mockTables.AppleIdentity = [];
    const { findOrProvisionUserForAppleIdentity } = await import('../social-auth-provision.server');
    const result = await findOrProvisionUserForAppleIdentity({ subject: 'sub-2', email: 'new@privaterelay.appleid.com', name: 'New Person' });
    expect(result?.isNewUser).toBe(true);
    expect(mockTables.Organization.find((o) => o.id !== ORG_ID)?.name).toBe("New Person's Workspace");
    expect(mockTables.AppleIdentity).toEqual([expect.objectContaining({ subject: 'sub-2', userId: result?.userId })]);
  });

  it('returns null when there is no link and no email', async () => {
    mockTables.AppleIdentity = [];
    const { findOrProvisionUserForAppleIdentity } = await import('../social-auth-provision.server');
    await expect(
      findOrProvisionUserForAppleIdentity({ subject: 'sub-3', email: null, name: null }),
    ).resolves.toBeNull();
    expect(mockTables.Organization).toHaveLength(1);
  });
});
