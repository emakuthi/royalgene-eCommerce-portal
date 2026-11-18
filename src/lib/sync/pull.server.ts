import 'server-only';
import { supabaseAdmin } from '../supabase-client';
import logger from '../logger';
import { SYNC_ENTITIES, SYNC_ENTITY_NAMES, type SyncEntityName } from './syncable-entities';
import { redactCostFields } from '../cost-visibility.server';

const DEFAULT_PAGE_SIZE = 200;
const MAX_PAGE_SIZE = 500;

/**
 * How far back a caught-up cursor is held. A row's updatedAt is stamped by
 * the writer (often a `now` taken earlier in the same request), so a row can
 * become visible with a time older than rows a device has already pulled.
 * A cursor parked at the newest row would step over it for good — a sale's
 * stock decrement or a transfer's hold never reaching that phone. Holding
 * the cursor this far back re-sends the last few minutes of rows each pull
 * (the device applies them as plain upserts), so a late-landing row is
 * still picked up.
 */
export const SETTLE_LAG_MS = 5 * 60 * 1000;

/** One row's worth of change, in the shape the client applies to Room. */
export interface SyncChange {
  entity: SyncEntityName;
  id: string;
  operation: 'UPSERT' | 'DELETE';
  version: number | null;
  updatedAt: string;
  data: Record<string, unknown> | null;
}

/** Per-entity keyset position: the (updatedAt, id) of the last row already sent. */
export interface EntityCursor {
  updatedAt: string;
  id: string;
}

export type SyncCursor = Partial<Record<SyncEntityName, EntityCursor>>;

/** Cursors are opaque to the client — base64 JSON in, base64 JSON out. */
export function decodeCursor(raw: string | null): SyncCursor {
  if (!raw) return {};
  try {
    const json = Buffer.from(raw, 'base64url').toString('utf8');
    const parsed = JSON.parse(json);
    return typeof parsed === 'object' && parsed !== null ? parsed as SyncCursor : {};
  } catch {
    return {};
  }
}

export function encodeCursor(cursor: SyncCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

/**
 * Pull every change for `organizationId` since `cursor`, for the requested
 * entities (defaults to all synced entities). Keyset-paginated on
 * (updatedAt, id) per entity — robust against many rows sharing one
 * updatedAt, unlike a naive `updatedAt > cursor` cutoff.
 *
 * Soft-deleted rows are included (operation: DELETE) so a device can drop
 * them; StockTransaction (append-only, no deletedAt) is always UPSERT.
 *
 * `includeCostData` defaults to FALSE deliberately: cost/profit figures are
 * owner-only (see cost-visibility.server.ts), and this feed writes straight
 * into a device's local database, so a caller must opt in explicitly rather
 * than leak them by forgetting to opt out.
 */
export async function pullChanges(opts: {
  organizationId: string;
  cursor: SyncCursor;
  entities?: SyncEntityName[];
  pageSize?: number;
  includeCostData?: boolean;
  /** Shops whose sales this caller may see; null/undefined = every shop (admin, manager, owner). */
  salesShopIds?: string[] | null;
  /** For tests. */
  now?: number;
}): Promise<{ changes: SyncChange[]; cursor: SyncCursor; hasMore: boolean }> {
  const entities = (opts.entities?.length ? opts.entities : SYNC_ENTITY_NAMES)
    .filter((e): e is SyncEntityName => e in SYNC_ENTITIES);
  const pageSize = Math.min(opts.pageSize ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);

  const changes: SyncChange[] = [];
  const nextCursor: SyncCursor = { ...opts.cursor };
  let hasMore = false;

  for (const entityName of entities) {
    const spec = SYNC_ENTITIES[entityName];
    const position = opts.cursor[entityName];

    let query = supabaseAdmin
      .from(spec.table)
      .select('*')
      .eq(spec.orgColumn, opts.organizationId)
      .order('updatedAt', { ascending: true })
      .order('id', { ascending: true })
      .limit(pageSize);

    // A shopkeeper's device only ever receives its own shops' sales, and the
    // credit repayments those shops took.
    if ((entityName === 'SalesEntry' || entityName === 'CustomerPayment') && opts.salesShopIds) {
      if (opts.salesShopIds.length === 0) continue;
      query = query.in('shopId', opts.salesShopIds);
    }

    // Keyset predicate: (updatedAt, id) > (position.updatedAt, position.id).
    // Supabase-js has no native tuple comparator, so this is expressed as
    // updatedAt > X OR (updatedAt = X AND id > Y).
    if (position) {
      query = query.or(
        `updatedAt.gt.${position.updatedAt},and(updatedAt.eq.${position.updatedAt},id.gt.${position.id})`,
      );
    }

    const { data, error } = await query;
    if (error) {
      logger.error('[sync] pull failed', { entity: entityName, organizationId: opts.organizationId, error: error.message });
      continue; // one entity failing shouldn't block the others
    }

    const rows = (data ?? []) as Array<Record<string, unknown>>;
    for (const row of rows) {
      const isDeleted = spec.mode === 'mutable' && Boolean(row.deletedAt);
      changes.push({
        entity: entityName,
        id: String(row.id),
        operation: isDeleted ? 'DELETE' : 'UPSERT',
        version: typeof row.version === 'number' ? row.version : null,
        updatedAt: String(row.updatedAt),
        // A deleted Product still carries its row: products with sales are archived, not
        // erased, and phones need the name to show those sales. Other tombstones stay bare.
        data: isDeleted && entityName !== 'Product' ? null : (opts.includeCostData ? row : redactCostFields(entityName, row)),
      });
    }

    const reached = rows.length > 0
      ? { updatedAt: String(rows[rows.length - 1].updatedAt), id: String(rows[rows.length - 1].id) }
      : position;
    if (rows.length === pageSize) {
      // Mid-catch-up: continue exactly where this page ended.
      hasMore = true;
      if (reached) nextCursor[entityName] = reached;
    } else if (reached) {
      nextCursor[entityName] = settled(reached, (opts.now ?? Date.now()) - SETTLE_LAG_MS);
    }
  }

  return { changes, cursor: nextCursor, hasMore };
}

/** The cursor, but no later than `settleAt`, so rows stamped in the last few minutes are sent again. */
function settled(cursor: EntityCursor, settleAt: number): EntityCursor {
  const at = Date.parse(cursor.updatedAt);
  if (Number.isNaN(at) || at <= settleAt) return cursor;
  // '0' sorts before every real id, so rows stamped exactly at settleAt are included.
  return { updatedAt: new Date(settleAt).toISOString(), id: '0' };
}
