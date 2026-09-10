import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const slugAvailable = vi.fn(async (..._a: unknown[]) => true);
const shopNameAvailable = vi.fn(async (..._a: unknown[]) => true);
const createOrg = vi.fn(async (..._a: unknown[]) => ({ id: 'org-1', name: 'Acme', slug: 'acme', status: 'pending_verification' }));

vi.mock('@/lib/organizations.server', () => ({
  isSlugAvailable: (...a: unknown[]) => slugAvailable(...a),
  isValidSlug: (s: string) => /^[a-z0-9-]{3,}$/.test(s),
  slugify: (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
  createOrganization: (...a: unknown[]) => createOrg(...a),
}));
vi.mock('@/lib/shops.server', () => ({ isShopNameAvailable: (...a: unknown[]) => shopNameAvailable(...a) }));
vi.mock('@/lib/auth.server', () => ({
  hashPassword: async () => 'hashed',
  signAuthToken: () => 'signed.jwt.token',
}));
vi.mock('@/lib/email/verification-email', () => ({ sendVerificationEmail: async () => ({ ok: true }) }));

const inserts: Record<string, unknown[]> = {};
let existingEmailRows: unknown[] = [];
vi.mock('@/lib/supabase-client', () => ({
  supabaseAdmin: {
    from(table: string) {
      return {
        insert: async (rows: unknown[]) => {
          (inserts[table] ??= []).push(...rows);
          return { error: null };
        },
        delete: () => ({ eq: async () => ({ error: null }) }),
        // provisionWorkspace's "is this email already taken?" pre-check:
        //   from('User').select('id').eq('email', ...).limit(1)
        select: () => ({
          eq: () => ({
            limit: async () => ({ data: existingEmailRows, error: null }),
          }),
        }),
      };
    },
  },
}));

import { provisionWorkspace, SignupError } from '@/lib/signup.server';

beforeEach(() => {
  for (const k of Object.keys(inserts)) delete inserts[k];
  existingEmailRows = [];
  slugAvailable.mockResolvedValue(true);
  shopNameAvailable.mockResolvedValue(true);
});
afterEach(() => { vi.clearAllMocks(); });

const base = { orgName: 'Acme', name: 'Jane', email: 'JANE@Acme.io', password: 'longenough', sendEmail: false };

describe('provisionWorkspace validation', () => {
  it('rejects a short password with 400', async () => {
    await expect(provisionWorkspace({ ...base, password: 'short' })).rejects.toMatchObject({ status: 400 });
  });

  it('rejects a taken slug with 409', async () => {
    slugAvailable.mockResolvedValue(false);
    await expect(provisionWorkspace(base)).rejects.toMatchObject({ status: 409 });
  });

  it('rejects a taken shop name with 409', async () => {
    shopNameAvailable.mockResolvedValue(false);
    await expect(provisionWorkspace(base)).rejects.toBeInstanceOf(SignupError);
  });

  it('rejects an email already registered anywhere with 409', async () => {
    existingEmailRows = [{ id: 'existing-user' }];
    await expect(provisionWorkspace(base)).rejects.toMatchObject({ status: 409 });
  });
});

describe('provisionWorkspace happy path', () => {
  it('creates org + admin user + shop + portal user and returns a token', async () => {
    const result = await provisionWorkspace(base);

    expect(result.token).toBe('signed.jwt.token');
    expect(result.normalizedEmail).toBe('jane@acme.io');
    expect(result.organization.id).toBe('org-1');
    expect(createOrg).toHaveBeenCalledWith({ name: 'Acme', slug: 'acme' });

    expect(inserts.User).toHaveLength(1);
    expect(inserts.User[0]).toMatchObject({ email: 'jane@acme.io', role: 'admin', organizationId: 'org-1' });
    expect(inserts.Shop[0]).toMatchObject({ name: 'Acme', organizationId: 'org-1' });
    expect(inserts.PortalUser[0]).toMatchObject({ position: 'shop_owner', mobileAccess: true });
    expect(inserts.EmailVerificationToken).toHaveLength(1);
  });
});
