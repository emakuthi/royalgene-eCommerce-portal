import { NextRequest } from 'next/server';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { isSlugAvailable, isValidSlug, slugify } from '@/lib/organizations.server';
import { RESERVED_SUBDOMAINS } from '@/lib/tenant';

// GET /api/auth/check-slug?slug=acme — live subdomain-availability check for the signup form.
export async function GET(request: NextRequest) {
  const rawSlug = request.nextUrl.searchParams.get('slug') || '';
  const slug = slugify(rawSlug);

  if (!slug || !isValidSlug(slug)) {
    return jsonResponse({ success: true, data: { slug, available: false, reason: 'invalid' } });
  }

  if (RESERVED_SUBDOMAINS.includes(slug)) {
    return jsonResponse({ success: true, data: { slug, available: false, reason: 'reserved' } });
  }

  const available = await isSlugAvailable(slug);
  return jsonResponse({ success: true, data: { slug, available, reason: available ? null : 'taken' } });
}

export function OPTIONS() {
  return optionsResponse('GET,OPTIONS');
}
