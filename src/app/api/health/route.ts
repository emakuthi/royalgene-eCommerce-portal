import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// Liveness only: a Supabase outage shouldn't make the deploy tooling restart the app.
export function GET() {
  return NextResponse.json({ status: 'ok' });
}
