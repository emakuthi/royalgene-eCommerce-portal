import { describe, it, expect, vi } from 'vitest';
import jwt from 'jsonwebtoken';

vi.mock('server-only', () => ({}));
vi.mock('../logger', () => ({ default: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

import { verifyToken } from '../auth.server';

const SECRET = process.env.JWT_SECRET || 'dev_jwt_secret';
const now = Math.floor(Date.now() / 1000);
const DAY = 86400;
const sign = (claims: Record<string, unknown>, expAgoDays: number, secret = SECRET) =>
  jwt.sign({ userId: 'u1', role: 'portal_user', ...claims, exp: now - expAgoDays * DAY }, secret);

describe('verifyToken expiry grace', () => {
  it('accepts an app token that expired recently, flagged as such', () => {
    const p = verifyToken(sign({ deviceId: 'dev-1' }, 1));
    expect(p).toMatchObject({ userId: 'u1', deviceId: 'dev-1', expiredWithinGrace: true });
  });

  it('accepts an app token issued without a device id (key present, null)', () => {
    expect(verifyToken(sign({ deviceId: null }, 1))?.userId).toBe('u1');
  });

  it('rejects an app token expired longer than the grace window', () => {
    expect(verifyToken(sign({ deviceId: 'dev-1' }, 31))).toBeNull();
  });

  it('never extends a web token (no deviceId claim)', () => {
    expect(verifyToken(sign({}, 1))).toBeNull();
  });

  it('still rejects a token with a bad signature', () => {
    expect(verifyToken(sign({ deviceId: 'dev-1' }, 1, 'not-the-secret'))).toBeNull();
  });

  it('leaves a valid token unflagged', () => {
    const p = verifyToken(sign({ deviceId: 'dev-1' }, -5));
    expect(p?.expiredWithinGrace).toBeUndefined();
  });
});
