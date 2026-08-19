import { FeatureCode, type FeatureCodeValue } from '@/lib/entitlements/feature-codes';

/** Human-readable labels for the feature checklist shown on pricing/plan-comparison cards. */
export const FEATURE_LABELS: Partial<Record<FeatureCodeValue, string>> = {
  [FeatureCode.INVENTORY]: 'Inventory management',
  [FeatureCode.PRODUCT_CATALOG]: 'Product catalog',
  [FeatureCode.STOCK_MOVEMENT]: 'Stock movement tracking',
  [FeatureCode.STOCK_ADJUSTMENT]: 'Stock adjustments',
  [FeatureCode.STOCK_TRANSFER]: 'Multi-branch stock transfers',
  [FeatureCode.LOW_STOCK_ALERTS]: 'Low stock alerts',
  [FeatureCode.SALES]: 'Sales recording',
  [FeatureCode.BASIC_REPORTS]: 'Basic reports',
  [FeatureCode.ADVANCED_REPORTS]: 'Advanced reports',
  [FeatureCode.ADVANCED_ANALYTICS]: 'Advanced analytics',
  [FeatureCode.AUDIT_TRAIL]: 'Audit trail',
  [FeatureCode.MPESA_INTEGRATION]: 'M-Pesa integration',
  [FeatureCode.SUPPLIERS]: 'Supplier management',
  [FeatureCode.PURCHASE_ORDERS]: 'Purchase orders',
  [FeatureCode.BARCODE]: 'Barcode scanning',
  [FeatureCode.API_ACCESS]: 'API access',
  [FeatureCode.ADVANCED_RBAC]: 'Advanced roles & permissions',
  [FeatureCode.DEDICATED_SUPPORT]: 'Dedicated support',
  [FeatureCode.SLA]: 'Uptime SLA',
};

/** Display order for the checklist — only codes present here are ever shown on a plan card. */
export const PLAN_CARD_FEATURE_ORDER: FeatureCodeValue[] = [
  FeatureCode.INVENTORY,
  FeatureCode.STOCK_TRANSFER,
  FeatureCode.SALES,
  FeatureCode.MPESA_INTEGRATION,
  FeatureCode.SUPPLIERS,
  FeatureCode.PURCHASE_ORDERS,
  FeatureCode.BARCODE,
  FeatureCode.BASIC_REPORTS,
  FeatureCode.ADVANCED_REPORTS,
  FeatureCode.ADVANCED_ANALYTICS,
  FeatureCode.AUDIT_TRAIL,
  FeatureCode.ADVANCED_RBAC,
  FeatureCode.API_ACCESS,
  FeatureCode.DEDICATED_SUPPORT,
  FeatureCode.SLA,
];
