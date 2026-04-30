import type { NextApiRequest, NextApiResponse } from 'next';
import { verifyToken, type VerifiedPayload } from '@/lib/auth.server';

export interface AuthResult {
  success: true;
  payload: VerifiedPayload;
}

export interface AuthError {
  success: false;
  handled: true;
}

/**
 * Shared auth helper for pages/api mobile endpoints.
 * Extracts and verifies Bearer token, sends 401 response if invalid.
 * Returns payload on success, or { success: false, handled: true } if response was sent.
 */
export function authenticateRequest(
  req: NextApiRequest,
  res: NextApiResponse
): AuthResult | AuthError {
  const authHeader = req.headers.authorization;
  const token = authHeader?.replace('Bearer ', '');

  if (!token) {
    res.status(401).json({
      success: false,
      error: 'Unauthorized',
      code: 'UNAUTHORIZED'
    });
    return { success: false, handled: true };
  }

  const payload = verifyToken(token);
  if (!payload) {
    res.status(401).json({
      success: false,
      error: 'Invalid token',
      code: 'UNAUTHORIZED'
    });
    return { success: false, handled: true };
  }

  return { success: true, payload };
}

