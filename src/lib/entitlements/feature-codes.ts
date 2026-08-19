/**
 * Centralized entitlement catalog. Nothing in the app should compare a plan
 * name/tier string directly (e.g. `plan.tier === 'pro'`) to decide whether a
 * feature is available — always go through the entitlement service using
 * one of these codes.
 *
 * "wired" codes gate real functionality that exists in this app today.
 * "defined only" codes exist so `PlanEntitlement` rows and `FeatureGate` work
 * the moment a corresponding module (suppliers, barcode, eTIMS, ...) is
 * actually built — until then nothing enforces or surfaces them as usable.
 */

export const FeatureCode = {
  INVENTORY: 'INVENTORY', // wired
  PRODUCT_CATALOG: 'PRODUCT_CATALOG', // wired
  STOCK_MOVEMENT: 'STOCK_MOVEMENT', // wired
  STOCK_ADJUSTMENT: 'STOCK_ADJUSTMENT', // wired
  SUPPLIERS: 'SUPPLIERS', // defined only
  PURCHASE_ORDERS: 'PURCHASE_ORDERS', // defined only
  BASIC_REPORTS: 'BASIC_REPORTS', // wired
  LOW_STOCK_ALERTS: 'LOW_STOCK_ALERTS', // wired
  STOCK_TRANSFER: 'STOCK_TRANSFER', // wired
  SALES: 'SALES', // wired
  PURCHASING: 'PURCHASING', // defined only
  BARCODE: 'BARCODE', // defined only
  STOCK_VALUATION: 'STOCK_VALUATION', // defined only
  ADVANCED_REPORTS: 'ADVANCED_REPORTS', // defined only
  AUDIT_TRAIL: 'AUDIT_TRAIL', // wired
  BATCH_TRACKING: 'BATCH_TRACKING', // defined only
  SERIAL_TRACKING: 'SERIAL_TRACKING', // defined only
  APPROVAL_WORKFLOW: 'APPROVAL_WORKFLOW', // defined only
  ADVANCED_ANALYTICS: 'ADVANCED_ANALYTICS', // wired
  API_ACCESS: 'API_ACCESS', // defined only
  MPESA_INTEGRATION: 'MPESA_INTEGRATION', // wired
  ACCOUNTING_INTEGRATION: 'ACCOUNTING_INTEGRATION', // defined only
  ETIMS_INTEGRATION: 'ETIMS_INTEGRATION', // defined only
  CUSTOM_WORKFLOWS: 'CUSTOM_WORKFLOWS', // defined only
  ADVANCED_RBAC: 'ADVANCED_RBAC', // defined only
  CUSTOM_REPORTS: 'CUSTOM_REPORTS', // defined only
  DATA_MIGRATION: 'DATA_MIGRATION', // defined only
  DEDICATED_SUPPORT: 'DEDICATED_SUPPORT', // defined only
  SLA: 'SLA', // defined only
} as const;

export type FeatureCodeValue = (typeof FeatureCode)[keyof typeof FeatureCode];

/** Feature codes gating real, shipped functionality — everything else is a forward-compat placeholder. */
export const WIRED_FEATURE_CODES: readonly FeatureCodeValue[] = [
  FeatureCode.INVENTORY,
  FeatureCode.PRODUCT_CATALOG,
  FeatureCode.STOCK_MOVEMENT,
  FeatureCode.STOCK_ADJUSTMENT,
  FeatureCode.BASIC_REPORTS,
  FeatureCode.LOW_STOCK_ALERTS,
  FeatureCode.STOCK_TRANSFER,
  FeatureCode.SALES,
  FeatureCode.AUDIT_TRAIL,
  FeatureCode.ADVANCED_ANALYTICS,
  FeatureCode.MPESA_INTEGRATION,
];

export const LimitCode = {
  USERS: 'USERS', // wired — PortalUser count per org
  BRANCHES: 'BRANCHES', // wired — Shop count per org (this app's "branch")
  WAREHOUSES: 'WAREHOUSES', // defined only — no warehouse entity distinct from Shop exists
  PRODUCTS: 'PRODUCTS', // wired — Product count per org
  MONTHLY_TRANSACTIONS: 'MONTHLY_TRANSACTIONS', // wired — SalesEntry count in the current calendar month
  STORAGE_GB: 'STORAGE_GB', // defined only — no per-tenant file-size accounting exists
} as const;

export type LimitCodeValue = (typeof LimitCode)[keyof typeof LimitCode];

export const WIRED_LIMIT_CODES: readonly LimitCodeValue[] = [
  LimitCode.USERS,
  LimitCode.BRANCHES,
  LimitCode.PRODUCTS,
  LimitCode.MONTHLY_TRANSACTIONS,
];

/** Resource types that can be created and are subject to a plan limit. Maps 1:1 to a LimitCode. */
export const ResourceType = {
  USER: 'USER',
  BRANCH: 'BRANCH',
  PRODUCT: 'PRODUCT',
  TRANSACTION: 'TRANSACTION',
} as const;

export type ResourceTypeValue = (typeof ResourceType)[keyof typeof ResourceType];

export const RESOURCE_TO_LIMIT_CODE: Record<ResourceTypeValue, LimitCodeValue> = {
  USER: LimitCode.USERS,
  BRANCH: LimitCode.BRANCHES,
  PRODUCT: LimitCode.PRODUCTS,
  TRANSACTION: LimitCode.MONTHLY_TRANSACTIONS,
};
