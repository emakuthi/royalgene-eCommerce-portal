import { NextRequest, NextResponse } from 'next/server';
import { handleStkCallback } from '@/lib/mpesa-payments.server';
import logger from '@/lib/logger';

// POST /api/webhooks/mpesa/[token] — Safaricom's STK push result for one
// payment. Called by Safaricom, not our apps; the unguessable per-payment token
// in the URL stands in for a signature, which Daraja doesn't provide. Always
// answers "accepted" so Safaricom doesn't keep retrying.
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const body = await request.json().catch(() => null);
  try {
    const matched = body ? await handleStkCallback(token, body) : false;
    if (!matched) logger.warn('[mpesa] callback did not match an open payment');
  } catch (err) {
    logger.error('[mpesa] callback failed', { error: err instanceof Error ? err.message : String(err) });
  }
  return NextResponse.json({ ResultCode: 0, ResultDesc: 'Accepted' });
}
