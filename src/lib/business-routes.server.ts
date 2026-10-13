import 'server-only';
import { jsonResponse } from './apiResponse';
import logger from './logger';
import {
  BusinessSettingsError,
  createProductCategory,
  getBusinessSettings,
  updateBusinessSettings,
  updateProductCategory,
} from './business-settings.server';

// Shared bodies of the portal and mobile business-settings routes. Callers do
// the auth (tenant user to read, owner to write) and pass the org id.

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await request.json();
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function failure(err: unknown, what: string) {
  if (err instanceof BusinessSettingsError) {
    return jsonResponse({ success: false, error: err.message, code: 'VALIDATION_ERROR' }, 400);
  }
  logger.error(`[business] ${what} failed`, { error: err instanceof Error ? err.message : String(err) });
  return jsonResponse({ success: false, error: `Could not ${what}`, code: 'INTERNAL_ERROR' }, 500);
}

export async function businessSettingsGet(organizationId: string) {
  return jsonResponse({ success: true, data: await getBusinessSettings(organizationId) });
}

/** Body: { businessType?, option1Label?, option2Label? } */
export async function businessSettingsPut(organizationId: string, request: Request) {
  const body = await readJson(request);
  if (!body) return jsonResponse({ success: false, error: 'Invalid JSON body', code: 'VALIDATION_ERROR' }, 400);
  try {
    const data = await updateBusinessSettings(organizationId, {
      businessType: body.businessType,
      option1Label: body.option1Label,
      option2Label: body.option2Label,
    });
    return jsonResponse({ success: true, data });
  } catch (err) {
    return failure(err, 'update business settings');
  }
}

/** Body: { name } */
export async function productCategoryCreate(organizationId: string, request: Request) {
  const body = await readJson(request);
  try {
    const data = await createProductCategory(organizationId, body?.name);
    return jsonResponse({ success: true, data }, 201);
  } catch (err) {
    return failure(err, 'add category');
  }
}

/** Body: { name?, isActive?, sortOrder? } */
export async function productCategoryUpdate(organizationId: string, id: string, request: Request) {
  const body = await readJson(request);
  if (!body) return jsonResponse({ success: false, error: 'Invalid JSON body', code: 'VALIDATION_ERROR' }, 400);
  try {
    const data = await updateProductCategory(id, organizationId, body);
    if (!data) return jsonResponse({ success: false, error: 'Category not found', code: 'NOT_FOUND' }, 404);
    return jsonResponse({ success: true, data });
  } catch (err) {
    return failure(err, 'update category');
  }
}
