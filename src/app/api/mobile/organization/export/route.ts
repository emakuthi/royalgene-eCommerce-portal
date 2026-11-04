/**
 * GET /api/mobile/organization/export
 * Downloads the whole workspace as a zip of CSV files, which the app saves
 * wherever the owner picks, such as Google Drive. Owners and admins only,
 * because it includes cost prices and staff details.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireTenantUser } from '@/lib/authorize';
import { rejectIfDeactivated } from '@/lib/deactivated-staff.server';
import { isOwnerLevelCaller } from '@/lib/permissions.server';
import { buildOrgExport, MAX_EXPORT_BYTES } from '@/lib/data-export.server';
import { trackFromRequest } from '@/lib/activity-tracker';
import { jsonResponse } from '@/lib/apiResponse';
import logger from '@/lib/logger';

export async function GET(request: NextRequest) {
  try {
    const auth = requireTenantUser(request);
    if (auth instanceof NextResponse) return auth;
    const payload = auth;

    const deactivated = await rejectIfDeactivated(payload);
    if (deactivated) return deactivated;

    if (!payload.organizationId || !(await isOwnerLevelCaller(payload))) {
      return jsonResponse({ success: false, error: 'Only the workspace owner or an admin can export data.', code: 'FORBIDDEN' }, 403);
    }

    const result = await buildOrgExport(payload.organizationId);
    if (result.zip.length > MAX_EXPORT_BYTES) {
      logger.warn('Data export too large', { organizationId: payload.organizationId, bytes: result.zip.length });
      return jsonResponse({
        success: false,
        error: 'Your data is too large to export from the app right now. Please contact support.',
        code: 'EXPORT_TOO_LARGE',
      }, 413);
    }

    await trackFromRequest(request, payload, {
      action: 'data.export', category: 'settings', resourceType: 'organization', resourceId: payload.organizationId,
      details: { files: result.counts, bytes: result.zip.length },
    });

    return new NextResponse(new Uint8Array(result.zip), {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${result.fileName}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    logger.error('Data export failed', { error: error instanceof Error ? error.message : String(error) });
    return jsonResponse({ success: false, error: 'Could not create the export. Please try again.', code: 'EXPORT_FAILED' }, 500);
  }
}
