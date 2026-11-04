import { execFileSync } from 'child_process';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { inflateRawSync } from 'zlib';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

type Row = Record<string, unknown>;
const ORG = 'org-1';
let tables: Record<string, Row[] | { error: { code?: string; message: string } }>;
const calls: Array<{ table: string; eq?: [string, string]; or?: string; from?: number }> = [];

vi.mock('@/lib/supabase-client', () => ({ supabaseAdmin: { from: (t: string) => fakeQuery(t) } }));
vi.mock('../supabase-client', () => ({ supabaseAdmin: { from: (t: string) => fakeQuery(t) } }));

function fakeQuery(table: string) {
  const call: { table: string; eq?: [string, string]; or?: string; from?: number } = { table };
  calls.push(call);
  const q = {
    select: () => q,
    eq: (c: string, v: string) => { call.eq = [c, v]; return q; },
    or: (s: string) => { call.or = s; return q; },
    order: () => q,
    range: async (from: number, to: number) => {
      call.from = from;
      const t = tables[table] ?? [];
      if (!Array.isArray(t)) return { data: null, error: t.error };
      return { data: t.slice(from, to + 1), error: null };
    },
    maybeSingle: async () => ({ data: { name: 'Acme Ltd', slug: 'acme' }, error: null }),
  };
  return q;
}

import { buildOrgExport, rowsToCsv } from '../data-export.server';

/** Reads a zip by its central directory, the way an unzip tool does. */
function unzip(zip: Buffer): Record<string, string> {
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  let p = zip.readUInt32LE(end + 16);
  const out: Record<string, string> = {};
  for (let i = 0; i < zip.readUInt16LE(end + 10); i++) {
    const size = zip.readUInt32LE(p + 20);
    const nameLen = zip.readUInt16LE(p + 28);
    const offset = zip.readUInt32LE(p + 42);
    const name = zip.subarray(p + 46, p + 46 + nameLen).toString();
    const start = offset + 30 + zip.readUInt16LE(offset + 26) + zip.readUInt16LE(offset + 28);
    out[name] = inflateRawSync(zip.subarray(start, start + size)).toString();
    p += 46 + nameLen;
  }
  return out;
}

describe('rowsToCsv', () => {
  it('drops columns that could hold a credential', () => {
    const csv = rowsToCsv([{ id: '1', name: 'A', passwordHash: 'x', resetToken: 'y', apiKey: 'z', client_secret: 'q' }]);
    expect(csv.split('\r\n')[0]).toBe('"id","name"');
    expect(csv).not.toMatch(/x|"y"|"z"|"q"/);
  });

  it('quotes commas and quotes, and neutralises spreadsheet formulas', () => {
    const csv = rowsToCsv([{ a: 'x,"y"', b: '=HYPERLINK("evil")', c: -5, d: null, e: { k: 1 } }]);
    expect(csv.split('\r\n')[1]).toBe('"x,""y""","\'=HYPERLINK(""evil"")","-5",,"{""k"":1}"');
  });
});

describe('buildOrgExport', () => {
  beforeEach(() => {
    calls.length = 0;
    tables = { Shop: [{ id: 's1', name: 'Main' }, { id: 's2', name: 'Branch' }], Product: [{ id: 'p1', name: 'Dress', costPrice: 100 }] };
  });

  it('scopes every read to the workspace and its own shops', async () => {
    await buildOrgExport(ORG);
    const reads = calls.filter((c) => c.table !== 'Organization');
    expect(reads.length).toBeGreaterThan(10);
    for (const c of reads) {
      if (c.or) expect(c.or).toBe(`organizationId.eq.${ORG},shopId.in.(s1,s2)`);
      else expect(c.eq).toEqual(['organizationId', ORG]);
    }
    expect(calls.find((c) => c.table === 'SalesEntry')?.or).toBeTruthy();
  });

  it('never reads login or platform tables', async () => {
    await buildOrgExport(ORG);
    const read = new Set(calls.map((c) => c.table));
    for (const t of ['User', 'PasswordResetCode', 'EmailVerificationToken', 'TenantOAuthConnection', 'TenantIntegrationConfig', 'Device']) {
      expect(read.has(t)).toBe(false);
    }
  });

  it('reads past the 1000 row page limit', async () => {
    tables.SalesEntry = Array.from({ length: 2500 }, (_, i) => ({ id: `e${i}` }));
    const { zip, counts } = await buildOrgExport(ORG);
    expect(counts.find((c) => c.file === 'sales.csv')?.rows).toBe(2500);
    expect(unzip(zip)['sales.csv'].split('\r\n')).toHaveLength(2501);
  });

  it('fails outright when a table errors, rather than giving a partial file', async () => {
    tables.SalesEntry = { error: { code: '57014', message: 'timeout' } };
    await expect(buildOrgExport(ORG)).rejects.toThrow('SalesEntry');
  });

  it('notes a table this database does not have yet', async () => {
    tables.RecipeItem = { error: { code: 'PGRST205', message: 'not found' } };
    const files = unzip((await buildOrgExport(ORG)).zip);
    expect(files['recipe-items.csv']).toBeUndefined();
    expect(files['README.txt']).toContain('Not available yet on this workspace: recipe-items.csv');
  });

  it('builds a zip a real unzip tool accepts', async () => {
    const { zip, fileName } = await buildOrgExport(ORG, new Date('2026-11-04T10:00:00Z'));
    expect(fileName).toBe('royaltrack-acme-2026-11-04.zip');
    const path = join(mkdtempSync(join(tmpdir(), 'zip-')), 'x.zip');
    writeFileSync(path, zip);
    expect(execFileSync('unzip', ['-t', path]).toString()).toContain('No errors');
    expect(execFileSync('unzip', ['-p', path, 'products.csv']).toString()).toContain('Dress');
  });
});
