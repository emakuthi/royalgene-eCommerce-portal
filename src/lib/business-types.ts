// Business types a workspace can be set up as (safe to import from client or server).
//
// A type only decides the STARTING setup — the categories a new workspace gets
// and what its two product options are called. Everything stays editable in
// Settings afterwards, and every type shares the same stock/sales engine.
//
// Product options: every product can be tracked by up to two options. They are
// stored in the existing size/color columns (ShopStockVariant, SalesEntry,
// StockTransaction); only their names change per workspace. An empty name
// switches that option off.

export type BusinessTypeId = 'boutique' | 'hardware' | 'pharmacy' | 'supermarket' | 'restaurant' | 'general';

export interface BusinessTypeDef {
  id: BusinessTypeId;
  label: string;
  /** One line for the signup picker. */
  description: string;
  option1Label: string;
  option2Label: string;
  /** Unit new products default to. */
  defaultUnit: string;
  /** Starter product categories. */
  categories: string[];
}

export const BUSINESS_TYPES: BusinessTypeDef[] = [
  {
    id: 'boutique',
    label: 'Boutique / fashion',
    description: 'Clothing, shoes and accessories by size and colour',
    option1Label: 'Size',
    option2Label: 'Colour',
    defaultUnit: 'piece',
    categories: ['Dresses', 'Shoes', 'Trousers', 'Textiles', 'Tops', 'Bags', 'Accessories', 'Jewellery', 'Other'],
  },
  {
    id: 'hardware',
    label: 'Hardware / general shop',
    description: 'Tools, building materials and household goods',
    option1Label: 'Size',
    option2Label: '',
    defaultUnit: 'piece',
    categories: ['Building materials', 'Tools', 'Plumbing', 'Electrical', 'Paint', 'Fasteners', 'Household', 'Other'],
  },
  {
    id: 'pharmacy',
    label: 'Pharmacy / cosmetics',
    description: 'Medicines, beauty and personal care',
    option1Label: 'Strength',
    option2Label: 'Pack size',
    defaultUnit: 'pack',
    categories: ['Prescription', 'Over the counter', 'Vitamins & supplements', 'Personal care', 'Cosmetics', 'Baby care', 'First aid', 'Other'],
  },
  {
    id: 'supermarket',
    label: 'Supermarket / mini-mart',
    description: 'Groceries, drinks and everyday goods',
    option1Label: 'Size',
    option2Label: '',
    defaultUnit: 'piece',
    categories: ['Food & groceries', 'Fresh produce', 'Beverages', 'Dairy', 'Bakery', 'Household', 'Personal care', 'Other'],
  },
  {
    id: 'restaurant',
    label: 'Restaurant / café',
    description: 'Menu items, drinks and the ingredients behind them',
    option1Label: 'Portion',
    option2Label: '',
    defaultUnit: 'plate',
    categories: ['Starters', 'Main course', 'Sides', 'Desserts', 'Drinks', 'Ingredients', 'Other'],
  },
  {
    id: 'general',
    label: 'Other business',
    description: 'Anything else that sells stock',
    option1Label: 'Variant',
    option2Label: '',
    defaultUnit: 'piece',
    categories: ['General', 'Other'],
  },
];

/** Workspaces created before business types existed were all boutiques. */
export const DEFAULT_BUSINESS_TYPE: BusinessTypeId = 'boutique';

export function getBusinessType(id: string | null | undefined): BusinessTypeDef {
  return BUSINESS_TYPES.find((t) => t.id === id) ?? BUSINESS_TYPES.find((t) => t.id === DEFAULT_BUSINESS_TYPE)!;
}

export function isBusinessTypeId(id: unknown): id is BusinessTypeId {
  return typeof id === 'string' && BUSINESS_TYPES.some((t) => t.id === id);
}

/** Units a product can be counted in. Free text is also accepted; these are the suggestions. */
export const PRODUCT_UNITS = [
  'piece', 'pack', 'box', 'carton', 'dozen', 'pair', 'set',
  'kg', 'g', 'litre', 'ml', 'metre', 'bottle', 'tin', 'bag', 'roll', 'plate', 'cup',
] as const;

export const MAX_OPTION_LABEL_LENGTH = 24;
export const MAX_UNIT_LENGTH = 16;
export const MAX_CATEGORY_NAME_LENGTH = 40;

/** Slug stored on Product.category, e.g. "Over the counter" → "over-the-counter". */
export function categorySlug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/** "over-the-counter" → "Over the counter" — for a category slug with no stored name. */
export function categoryNameFromSlug(slug: string): string {
  const s = slug.replace(/-/g, ' ').trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : 'Other';
}

/** Normalise a unit: trimmed, lower-case, max length; empty → "piece". */
export function normalizeUnit(raw: unknown): string {
  if (typeof raw !== 'string') return 'piece';
  const u = raw.trim().toLowerCase().slice(0, MAX_UNIT_LENGTH);
  return u || 'piece';
}

const OPTION_EXAMPLES: Record<string, string> = {
  size: 'e.g. S, M, L, XL',
  colour: 'e.g. Red, Blue, Black',
  color: 'e.g. Red, Blue, Black',
  strength: 'e.g. 250mg, 500mg',
  'pack size': 'e.g. 10s, 30s, 100ml',
  portion: 'e.g. Regular, Large',
  flavour: 'e.g. Vanilla, Chocolate',
  weight: 'e.g. 500g, 1kg, 2kg',
};

/** Placeholder for an option's value input, e.g. "e.g. 250mg, 500mg" for Strength. */
export function optionExample(label: string): string {
  return OPTION_EXAMPLES[label.trim().toLowerCase()] ?? `e.g. the ${label.trim().toLowerCase() || 'option'} values you sell`;
}

/** "Size & colour" / "Strength" — what a product's breakdown is by; '' when both options are off. */
export function optionsTitle(option1Label: string, option2Label: string): string {
  const parts = [option1Label.trim(), option2Label.trim()].filter(Boolean);
  if (parts.length === 2) return `${parts[0]} & ${parts[1].toLowerCase()}`;
  return parts[0] ?? '';
}

/** Units that can be sold in fractions (0.5 kg, 1.25 litre). Everything else is counted in whole items. */
export const MEASURED_UNITS = ['kg', 'g', 'litre', 'ml', 'metre'] as const;

export function isMeasuredUnit(unit: string | null | undefined): boolean {
  return MEASURED_UNITS.includes(normalizeUnit(unit) as (typeof MEASURED_UNITS)[number]);
}

/** Quantities are stored with 3 decimals (numeric(14,3)) — grams / millilitres. */
export function roundQuantity(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * Why a quantity isn't acceptable for a product counted in `unit`, or null if
 * it is. Fractions only for measured units, so piece-counted stock stays whole
 * (older app builds read those as integers).
 */
export function quantityError(q: unknown, unit: string | null | undefined, opts: { allowZero?: boolean } = {}): string | null {
  const n = typeof q === 'number' ? q : Number(q);
  if (!Number.isFinite(n)) return 'Quantity must be a number';
  if (opts.allowZero ? n < 0 : n <= 0) return opts.allowZero ? 'Quantity cannot be negative' : 'Quantity must be more than 0';
  if (!isMeasuredUnit(unit) && !Number.isInteger(n)) {
    return `Quantity must be a whole number for items sold by the ${normalizeUnit(unit)}`;
  }
  if (roundQuantity(n) !== n && Math.abs(roundQuantity(n) - n) > 1e-9) return 'Use at most 3 decimal places';
  return null;
}
