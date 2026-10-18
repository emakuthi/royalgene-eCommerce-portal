import { NextRequest } from 'next/server';
import { jsonResponse } from '@/lib/apiResponse';
import { verifyMobileShopAccess } from '@/lib/mobile-shop-auth';
import { normalizeBarcode, resolveBarcode } from '@/lib/barcode.server';
import logger from '@/lib/logger';

/**
 * GET /api/mobile/shops/[shopId]/products/by-barcode?code=…
 * Resolve a scanned code to the product, this shop's stock row and the
 * size/colour cell it pins. found:false (HTTP 200) means nothing matched.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ shopId: string }> }
) {
  try {
    const { shopId } = await context.params;
    const auth = await verifyMobileShopAccess(request, shopId);
    if (auth instanceof Response) return auth;

    const organizationId = auth.payload.organizationId;
    if (!organizationId) {
      return jsonResponse({ success: false, error: 'An organization context is required', code: 'NO_ORGANIZATION' }, 400);
    }

    const code = normalizeBarcode(new URL(request.url).searchParams.get('code'));
    if (!code) {
      return jsonResponse({ success: false, error: 'code is required', code: 'VALIDATION_ERROR' }, 400);
    }

    const result = await resolveBarcode({ organizationId, shopId, code });
    return jsonResponse({ success: true, data: result }, 200);
  } catch (err) {
    logger.error('Mobile barcode lookup failed', {
      error: err instanceof Error ? err.message : String(err),
      endpoint: '/api/mobile/shops/[shopId]/products/by-barcode',
    });
    return jsonResponse({ success: false, error: 'Barcode lookup failed', code: 'INTERNAL_ERROR' }, 500);
  }
}
