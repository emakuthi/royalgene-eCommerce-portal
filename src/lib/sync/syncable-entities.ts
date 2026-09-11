/**
 * The entities the mobile app keeps a local copy of and synchronises through
 * /api/mobile/*. The pull feed and the push handlers both consult this list so
 * the two stay in step.
 *
 * `mutable` entities carry deletedAt + version + a touch trigger (migration
 * 20260910_05). `append-only` ones are immutable audit rows.
 */
export type SyncEntityName =
  | 'Product'
  | 'Shop'
  | 'ShopStock'
  | 'ShopStockVariant'
  | 'SalesEntry'
  | 'StockTransaction'
  | 'Alert';

export interface SyncEntitySpec {
  /** DB table name. */
  table: SyncEntityName;
  /** Column carrying the tenant scope. Every sync query filters on it. */
  orgColumn: 'organizationId';
  /** append-only rows are never updated or tombstoned. */
  mode: 'mutable' | 'append-only';
  /** Column the pull cursor advances on. */
  cursorColumn: 'updatedAt';
}

export const SYNC_ENTITIES: Record<SyncEntityName, SyncEntitySpec> = {
  Product:          { table: 'Product',          orgColumn: 'organizationId', mode: 'mutable',     cursorColumn: 'updatedAt' },
  Shop:             { table: 'Shop',             orgColumn: 'organizationId', mode: 'mutable',     cursorColumn: 'updatedAt' },
  ShopStock:        { table: 'ShopStock',        orgColumn: 'organizationId', mode: 'mutable',     cursorColumn: 'updatedAt' },
  ShopStockVariant: { table: 'ShopStockVariant', orgColumn: 'organizationId', mode: 'mutable',     cursorColumn: 'updatedAt' },
  SalesEntry:       { table: 'SalesEntry',       orgColumn: 'organizationId', mode: 'mutable',     cursorColumn: 'updatedAt' },
  StockTransaction: { table: 'StockTransaction', orgColumn: 'organizationId', mode: 'append-only', cursorColumn: 'updatedAt' },
  Alert:            { table: 'Alert',            orgColumn: 'organizationId', mode: 'mutable',     cursorColumn: 'updatedAt' },
};

export const SYNC_ENTITY_NAMES = Object.keys(SYNC_ENTITIES) as SyncEntityName[];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A client may supply the row id (for offline-created records) as long as it's a UUID. */
export function isValidClientId(id: unknown): id is string {
  return typeof id === 'string' && UUID_RE.test(id);
}
