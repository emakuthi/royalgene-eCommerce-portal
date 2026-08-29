export interface User {
  id: string;
  email: string;
  password: string;
  name: string;
  role: 'customer' | 'admin' | 'super_admin' | 'portal_user';
  /** null only for role === 'super_admin' (a platform-level, cross-tenant role) */
  organizationId?: string | null;
  phone?: string | null;
  address?: string | null;
  twoFactorEnabled: boolean;
  twoFactorSecret?: string | null;
  emailVerifiedAt?: string | null;
  createdAt: string | Date;
  updatedAt?: Date;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  status: 'pending_verification' | 'active' | 'suspended' | 'cancelled';
  planTier: 'free' | 'starter' | 'business' | 'pro' | 'enterprise' | 'legacy';
  paystackCustomerCode?: string | null;
  paystackSubscriptionCode?: string | null;
  paystackPlanCode?: string | null;
  billingEmail?: string | null;
  billingStatus?: string | null;
  trialEndsAt?: string | null;
  logoUrl?: string | null;
  tagline?: string | null;
  themeSettings?: ThemeSettings | null;
  customDomain?: string | null;
  customDomainStatus?: 'pending' | 'verified' | 'misconfigured' | null;
  /** KRA PIN for eTIMS-format invoice generation — an identifier, not a secret. */
  kraPin?: string | null;
  createdBy?: string | null;
  createdAt: string;
  updatedAt: string;
  /** Soft-delete marker (platform admin). NULL = live. */
  deletedAt?: string | null;
}

export interface PlatformPlan {
  id: string;
  code?: string | null;
  tier: 'starter' | 'business' | 'pro' | 'enterprise';
  name: string;
  description?: string | null;
  monthlyPriceKobo: number;
  annualPriceKobo: number;
  /** Display-only reference pricing for the pricing-page currency toggle — checkout always charges in KES. */
  monthlyPriceUSD?: number | null;
  annualPriceUSD?: number | null;
  currency: string;
  paystackMonthlyPlanCode?: string | null;
  paystackAnnualPlanCode?: string | null;
  maxShops?: number | null;
  maxUsers?: number | null;
  /** When true, assertCanCreate/assertStorageQuota let a tenant exceed their hard limit instead of blocking — billed via generateInvoice() instead. */
  allowOverage?: boolean;
  isActive: boolean;
  displayOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface PlanOverageRate {
  id: string;
  planId: string;
  limitCode: string;
  unit: number;
  pricePerUnitKobo: number;
  currency: string;
  createdAt: string;
  updatedAt: string;
}

// Named BillingInvoice (not Invoice) — this file already has an unrelated
// Invoice interface below (order invoices: orderId/invoiceNumber/dueDate)
// that TypeScript would otherwise silently declaration-merge this into.
export interface BillingInvoice {
  id: string;
  organizationId: string;
  period: string;
  basePriceKobo: number;
  overageKobo: number;
  totalKobo: number;
  currency: string;
  breakdown: BillingInvoiceLineItem[] | null;
  status: 'due' | 'paid' | 'void';
  paidAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BillingInvoiceLineItem {
  limitCode: string;
  description: string;
  quantity: number;
  unitPriceKobo: number;
  subtotalKobo: number;
}

export interface PlanEntitlement {
  id: string;
  planId: string;
  code: string;
  limitValue?: number | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'suspended' | 'cancelled' | 'expired';

export interface TenantSubscription {
  id: string;
  organizationId: string;
  planId?: string | null;
  status: SubscriptionStatus;
  billingInterval?: 'monthly' | 'annually' | null;
  currentPeriodStart?: string | null;
  currentPeriodEnd?: string | null;
  trialStart?: string | null;
  trialEnd?: string | null;
  cancelledAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Product {
  id: string;
  organizationId?: string;
  name: string;
  description: string;
  price: number;
  // costPrice stored in cents (optional in types to keep backward compatibility)
  costPrice?: number;
  category: 'dresses' | 'shoes' | 'trousers' | 'textiles';
  images: string[];
  sizes: string[];
  colors: string[];
  stockQuantity: number;
  sku: string;
  featured: boolean;
  trending: boolean;
  /** KRA VAT classification: A=exempt, B=16% standard (default), C=zero-rated, D=non-VAT. */
  taxType?: 'A' | 'B' | 'C' | 'D';
  createdAt: string;
  updatedAt: string;
}

export interface CartItem {
  productId: string;
  quantity: number;
  size: string;
  color: string;
  price: number;
}

export interface Order {
  id: string;
  orderNumber: string;
  userId?: string; // undefined for guest checkout
  guestEmail?: string;
  guestName?: string;
  guestPhone?: string;
  items: OrderItem[];
  total: number;
  status: 'pending' | 'processing' | 'shipped' | 'delivered' | 'cancelled';
  paymentMethod: 'mpesa' | 'card';
  paymentStatus: 'pending' | 'completed' | 'failed';
  paymentReference?: string;
  // M-Pesa specific fields
  mpesaReceiptNumber?: string;
  paymentAmount?: number;
  paymentVerifiedAt?: string;
  paymentFailureReason?: string;
  shippingAddress: Address;
  createdAt: string;
  updatedAt: string;
}

export interface OrderItem {
  productId: string;
  productName: string;
  productImage: string;
  quantity: number;
  size: string;
  color: string;
  price: number;
}

export interface Address {
  email?: string;
  name: string;
  phone: string;
  street: string;
  city: string;
  state: string;
  country: string;
  postalCode: string;
}

export interface Invoice {
  id: string;
  orderId: string;
  invoiceNumber: string;
  issueDate: string;
  dueDate: string;
  total: number;
  tax: number;
  subtotal: number;
}

export interface Receipt {
  id: string;
  orderId: string;
  receiptNumber: string;
  paymentDate: string;
  amount: number;
  paymentMethod: string;
}

export interface StockUpdate {
  productId: string;
  quantity: number;
  operation: 'add' | 'subtract' | 'set';
  timestamp: string;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface ThemeSettings {
  primaryColor: string;
  gradientStart: string;
  gradientEnd: string;
}

export interface Settings {
  id: string;
  key: string;
  value: string;
  updatedAt: string;
}

export interface Discount {
  id: string;
  code: string;
  name: string;
  description?: string;
  type: 'percentage' | 'fixed'; // percentage (0-100) or fixed amount
  value: number;
  applicableTo: 'all' | 'products' | 'categories' | 'customer_segment';
  applicableItems: string[]; // Product or category IDs
  minOrderAmount: number; // in cents
  maxDiscount?: number; // in cents (null = no limit)
  startDate: string;
  endDate: string;
  isActive: boolean;
  maxUses?: number; // null = unlimited
  maxUsesPerUser: number;
  usageCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface DiscountCode {
  id: string;
  discountId: string;
  orderNumber?: string;
  email: string;
  usedAt: string;
}

// ===== PORTAL TYPES =====

export interface Shop {
  id: string;
  organizationId?: string;
  name: string;
  location: string;
  phone?: string;
  email?: string;
  address?: string;
  manager?: string;
  description?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PortalUser {
  id: string;
  organizationId?: string;
  userId: string;
  shopId: string;
  shop?: Shop;
  // Accept both legacy app roles (manager/owner) and normalized DB enums (shop_manager/shop_owner)
  position: 'shopkeeper' | 'staff' | 'manager' | 'shop_manager' | 'owner' | 'shop_owner';
  isActive: boolean;
  /** Whether this portal user can log in via the mobile app (default true) */
  mobileAccess: boolean;
  lastLogin?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ShopStock {
  id: string;
  shopId: string;
  productId: string;
  quantity: number;
  lowStockThreshold: number;
  lastRestockDate?: string;
  lastRestockBy?: string;
  createdAt: string;
  updatedAt: string;
  // Optional per-shop metadata (mirrors the DB JSONB `metadata` column added by migration)
  metadata?: Record<string, unknown> | null;
}

export interface StockTransaction {
  id: string;
  shopStockId: string;
  portalUserId: string;
  type: 'add' | 'subtract' | 'adjustment' | 'restock';
  quantity: number;
  reason?: string;
  reference?: string;
  notes?: string;
  createdAt: string;
}

export interface SalesEntry {
  id: string;
  shopId: string;
  portalUserId: string;
  productId: string;
  quantity: number;
  unitPrice: number; // In cents
  totalAmount: number; // In cents
  paymentMethod: 'cash' | 'mpesa' | 'card';
  customerName?: string;
  customerPhone?: string;
  notes?: string;
  entryDate: string;
  createdAt: string;
}

export interface ProfitMargin {
  id: string;
  salesEntryId: string;
  costPrice: number; // In cents
  sellingPrice: number; // In cents
  profit: number; // In cents
  marginPercentage: number;
  createdAt: string;
}

export interface TaxInvoiceLineItem {
  description: string;
  quantity: number;
  unitPrice: number; // cents
  taxType: 'A' | 'B' | 'C' | 'D';
  taxAmount: number; // cents
  totalAmount: number; // cents
}

/** A KRA-format invoice generated for a sale — NOT submitted to KRA (no live OSCU/VSCU integration exists). */
export interface TaxInvoice {
  id: string;
  organizationId: string;
  salesEntryId: string;
  invoiceNumber: string;
  kraPin: string;
  itemsJson: TaxInvoiceLineItem[];
  totalTaxableAmount: number; // cents
  totalTaxAmount: number; // cents
  totalAmount: number; // cents
  qrCodeData: string;
  status: 'generated';
  createdAt: string;
}

export interface LowStockAlert {
  id: string;
  shopId: string;
  productId: string;
  productName: string;
  currentStock: number;
  threshold: number;
  alertLevel: 'warning' | 'critical';
  isResolved: boolean;
  resolvedAt?: string;
  createdAt: string;
}

export interface PortalDashboardStats {
  totalSales: number;
  totalProfit: number;
  averageMargin: number;
  lowStockProducts: number;
  topSellingProducts: Array<{ name: string; quantity: number; sales: number }>;
  salesToday: number;
  salesThisMonth: number;
}

export interface PaymentDetails {
  id: string;
  type: 'mpesa' | 'card' | 'bank_transfer';
  accountName?: string;
  accountNumber?: string;
  bankName?: string;
  bankCode?: string;
  swiftCode?: string;
  mpesaPhoneNumber?: string;
  mpesaBussinessName?: string;
  cardholderName?: string;
  // Only store last 4 digits — app uses camelCase `cardLast4`; DB column will be `card_last4`.
  cardLast4?: string; // last 4 digits only (PCI compliance)
  expiryDate?: string;
  // cvv intentionally removed — do NOT store CVV in the database or logs
  isActive: boolean;
  displayOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface BankTransferDetails {
  id: string;
  bankName: string;
  accountName: string;
  accountNumber: string;
  bankCode?: string;
  swiftCode?: string;
  branchName?: string;
  accountType: 'checking' | 'savings' | 'business';
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MpesaDetails {
  id: string;
  phoneNumber: string;
  businessName: string;
  mpesaAccountName: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CardDetails {
  id: string;
  cardholderName: string;
  // App uses camelCase cardNumberLast4; DB column will be `card_number_last4`.
  cardNumberLast4: string;
  expiryDate: string;
  cardBrand: 'visa' | 'mastercard' | 'amex';
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

// ===== ACTIVITY TRACKING TYPES =====

export interface ActivityLog {
  id: string;
  userId?: string | null;
  userEmail?: string | null;
  userRole?: string | null;
  action: string;
  category: 'auth' | 'product' | 'sale' | 'stock' | 'order' | 'settings' | 'admin' | 'shop' | 'payment' | 'general';
  source: 'web' | 'portal' | 'mobile' | 'system';
  endpoint?: string | null;
  httpMethod?: string | null;
  resourceType?: string | null;
  resourceId?: string | null;
  shopId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  deviceType?: 'desktop' | 'mobile' | 'tablet' | 'api' | null;
  details?: Record<string, unknown>;
  status: 'success' | 'failure' | 'denied';
  errorMessage?: string | null;
  durationMs?: number | null;
  createdAt: string;
}

