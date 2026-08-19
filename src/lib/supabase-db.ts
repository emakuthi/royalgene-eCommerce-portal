import { supabaseAdmin, supabaseClient } from './supabase-client';
import { v4 as uuidv4 } from 'uuid';
import type { User, Product, Order, Invoice, Receipt, PaymentDetails, BankTransferDetails, MpesaDetails, CardDetails } from './types';

// Helper function to check if credentials are available
export function hasValidCredentials(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const hasValidUrl = Boolean(url && url !== 'https://placeholder.supabase.co');
  const hasValidKey = Boolean(key && key !== 'placeholder-key');

  return hasValidUrl && hasValidKey;
}

// Normalize unknown errors into a string message safely
function errorToMessage(err: unknown): string {
  if (!err) return '';
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message;
  try {
    // PostgrestError and other objects may be returned; attempt to read a message
    const asObj = err as Record<string, unknown>;
    if (typeof asObj.message === 'string') return asObj.message;
    return JSON.stringify(asObj);
  } catch (err) {
    return String(err);
  }
}

// Helper to read multiple possible keys from a DB row safely without using `any`
function getField<T = unknown>(row: Record<string, unknown>, ...keys: string[]): T | undefined {
  for (const k of keys) {
    const v = (row as Record<string, unknown>)[k];
    if (v !== undefined) return v as T;
  }
  return undefined;
}

/**
 * ============================================================
 * PRODUCTS TABLE OPERATIONS
 * ============================================================
 */

export async function createProduct(productData: Omit<Product, 'id' | 'createdAt' | 'updatedAt'> & { organizationId: string }) {
  try {
    if (!hasValidCredentials()) {
      throw new Error('Supabase credentials not configured');
    }

    console.log('[Supabase] Creating product:', productData.name);

    const { data, error } = await supabaseAdmin
      .from('Product')
      .insert([
        {
          id: uuidv4(),
          ...productData,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ])
      .select();

    if (error) {
      const msg = errorToMessage(error) || 'Failed to create product';
      console.error('[Supabase] Product creation failed:', msg);
      throw new Error(msg);
    }

    console.log('[Supabase] Product created successfully');
    return (data && Array.isArray(data) ? data[0] : data) || null;
  } catch (error) {
    console.error('[Supabase] Create product error:', errorToMessage(error));
    throw error;
  }
}

export async function updateProduct(productId: string, updateData: Partial<Product>) {
  try {
    console.log('[Supabase] Updating product:', productId);

    const { data, error } = await supabaseAdmin
      .from('Product')
      .update({
        ...updateData,
        updatedAt: new Date().toISOString(),
      })
      .eq('id', productId)
      .select();

    if (error) {
      const msg = errorToMessage(error) || 'Failed to update product';
      console.error('[Supabase] Product update failed:', msg);
      throw new Error(msg);
    }

    console.log('[Supabase] Product updated successfully:', productId);

    // Touch related ShopStock rows so portal joined selects reflect the change
    try {
      const touch = await supabaseAdmin
        .from('ShopStock')
        .update({ updatedAt: new Date().toISOString() })
        .eq('productId', productId);

      const touchErr = (touch as { error?: unknown }).error;
      if (touchErr) {
        console.warn('[Supabase] Failed to touch ShopStock rows after product update:', errorToMessage(touchErr));
      }
    } catch (touchErr) {
      console.warn('[Supabase] Error touching ShopStock rows:', errorToMessage(touchErr));
    }

    return (data && Array.isArray(data) ? data[0] : data) || null;
  } catch (error) {
    console.error('[Supabase] Update product error:', errorToMessage(error));
    throw error;
  }
}

export async function deleteProduct(productId: string) {
  try {
    console.log('[Supabase] Deleting product:', productId);

    const { error } = await supabaseAdmin
      .from('Product')
      .delete()
      .eq('id', productId);

    if (error) {
      const msg = errorToMessage(error) || 'Failed to delete product';
      console.error('[Supabase] Product deletion failed:', msg);
      throw new Error(msg);
    }

    // Remove associated ShopStock rows to avoid orphaned stock records
    try {
      const { error: stockErr } = await supabaseAdmin
        .from('ShopStock')
        .delete()
        .eq('productId', productId);

      if (stockErr) {
        console.warn('[Supabase] Failed to delete ShopStock rows for product:', productId, errorToMessage(stockErr));
      }
    } catch (stockDeleteErr) {
      console.warn('[Supabase] Error deleting ShopStock rows after product deletion:', errorToMessage(stockDeleteErr));
    }

    console.log('[Supabase] Product deleted successfully:', productId);
  } catch (error) {
    console.error('[Supabase] Delete product error:', errorToMessage(error));
    throw error;
  }
}

export async function getProducts(limit?: number) {
  try {
    console.log('[Supabase] Fetching products');

    let query = supabaseClient.from('Product').select('*');

    if (limit) query = query.limit(limit);

    const { data, error } = await query;
    if (error) {
      const msg = errorToMessage(error) || 'Failed to fetch products';
      console.error('[Supabase] Fetch products failed:', msg);
      throw new Error(msg);
    }

    return data || [];
  } catch (error) {
    console.error('[Supabase] Get products error:', errorToMessage(error));
    throw error;
  }
}

export async function getProductById(productId: string) {
  try {
    const { data, error } = await supabaseClient
      .from('Product')
      .select('*')
      .eq('id', productId)
      .single();

    if (error) {
      const msg = errorToMessage(error) || 'Failed to fetch product';
      console.error('[Supabase] Fetch product failed:', msg);
      throw new Error(msg);
    }

    return data || null;
  } catch (error) {
    console.error('[Supabase] Get product by ID error:', errorToMessage(error));
    throw error;
  }
}

/**
 * Recalculate and persist total stockQuantity for a Product by summing ShopStock.quantity rows.
 * Keep storefront product.stockQuantity in sync with per-shop ShopStock updates coming from the portal.
 */
export async function syncProductStockFromShopStocks(productId: string) {
  try {
    if (!productId) return null;
    console.log('[Supabase] Syncing product stock from ShopStock rows for product:', productId);

    const supaRes = await supabaseAdmin
      .from('ShopStock')
      .select('quantity')
      .eq('productId', productId);

    const stocks = (supaRes as { data?: Array<{ quantity: number }> | null; error?: unknown }).data || [];
    if ((supaRes as { error?: unknown }).error) {
      console.warn('[Supabase] Failed to fetch ShopStock rows for sync:', errorToMessage((supaRes as { error?: unknown }).error));
      return null;
    }

    const total = stocks.reduce((sum: number, row) => sum + (Number(row.quantity) || 0), 0);

    const { data, error } = await supabaseAdmin
      .from('Product')
      .update({ stockQuantity: total, updatedAt: new Date().toISOString() })
      .eq('id', productId)
      .select()
      .single();

    if (error) {
      console.warn('[Supabase] Failed to update Product stockQuantity during sync:', errorToMessage(error));
      return null;
    }

    console.log('[Supabase] Synced product stockQuantity:', productId, total);
    return data || null;
  } catch (err) {
    console.error('[Supabase] syncProductStockFromShopStocks error:', errorToMessage(err));
    return null;
  }
}

/**
 * ============================================================
 * ORDERS, INVOICES, RECEIPTS (lightweight wrappers)
 * ============================================================
 */

export async function createOrder(orderData: Record<string, unknown>) {
  try {
    const record = { id: uuidv4(), ...orderData, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } as Record<string, unknown>;
    const { data, error } = await supabaseAdmin.from('Order').insert([record]).select().single();
    if (error) throw error;
    return data || null;
  } catch (err) {
    console.error('[Supabase] createOrder error:', errorToMessage(err));
    throw err;
  }
}

export async function updateOrder(orderId: string, updateData: Partial<Order>) {
  try {
    const { data, error } = await supabaseAdmin
      .from('Order')
      .update({ ...updateData, updatedAt: new Date().toISOString() })
      .eq('id', orderId)
      .select()
      .single();
    if (error) throw error;
    return data || null;
  } catch (err) {
    console.error('[Supabase] updateOrder error:', errorToMessage(err));
    throw err;
  }
}

export async function updateOrderPaymentStatus(orderId: string, paymentStatus: 'pending' | 'completed' | 'failed', paymentData?: Record<string, unknown>) {
  try {
    const update: Record<string, unknown> = { paymentStatus: paymentStatus, updatedAt: new Date().toISOString(), ...paymentData };
    const { data, error } = await supabaseAdmin.from('Order').update(update).eq('id', orderId).select().single();
    if (error) throw error;
    return data || null;
  } catch (err) {
    console.error('[Supabase] updateOrderPaymentStatus error:', errorToMessage(err));
    throw err;
  }
}

export async function getOrders(userId?: string) {
  try {
    let query = supabaseClient.from('Order').select('*');
    if (userId) query = query.eq('userId', userId);
    const { data, error } = await query.order('createdAt', { ascending: false });
    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error('[Supabase] getOrders error:', errorToMessage(err));
    throw err;
  }
}

export async function getOrderById(orderId: string) {
  try {
    const { data, error } = await supabaseClient.from('Order').select('*').eq('id', orderId).single();
    if (error) throw error;
    return data || null;
  } catch (err) {
    console.error('[Supabase] getOrderById error:', errorToMessage(err));
    throw err;
  }
}

export async function createInvoice(invoiceData: Record<string, unknown>) {
  try {
    const record = { id: uuidv4(), ...invoiceData, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } as Record<string, unknown>;
    const { data, error } = await supabaseAdmin.from('Invoice').insert([record]).select().single();
    if (error) throw error;
    return data || null;
  } catch (err) {
    console.error('[Supabase] createInvoice error:', errorToMessage(err));
    throw err;
  }
}

export async function getInvoices(userId?: string) {
  try {
    let query = supabaseClient.from('Invoice').select('*');
    if (userId) query = query.eq('user_id', userId);
    const { data, error } = await query.order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error('[Supabase] getInvoices error:', errorToMessage(err));
    throw err;
  }
}

export async function createReceipt(receiptData: Record<string, unknown>) {
  try {
    const record = { id: uuidv4(), ...receiptData, createdAt: new Date().toISOString() } as Record<string, unknown>;
    const { data, error } = await supabaseAdmin.from('Receipt').insert([record]).select().single();
    if (error) throw error;
    return data || null;
  } catch (err) {
    console.error('[Supabase] createReceipt error:', errorToMessage(err));
    throw err;
  }
}

export async function getReceipts(userId?: string) {
  try {
    let query = supabaseClient.from('Receipt').select('*');
    if (userId) query = query.eq('user_id', userId);
    const { data, error } = await query.order('payment_date', { ascending: false });
    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error('[Supabase] getReceipts error:', errorToMessage(err));
    throw err;
  }
}

/**
 * USERS
 */

export async function createUser(userData: Record<string, unknown>) {
  try {
    const record = { id: uuidv4(), ...userData, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } as Record<string, unknown>;
    const { data, error } = await supabaseAdmin.from('User').insert([record]).select().single();
    if (error) throw error;
    return data || null;
  } catch (err) {
    console.error('[Supabase] createUser error:', errorToMessage(err));
    throw err;
  }
}

export async function updateUser(userId: string, updateData: Record<string, unknown>) {
  try {
    const { data, error } = await supabaseAdmin.from('User').update({ ...updateData, updatedAt: new Date().toISOString() }).eq('id', userId).select().single();
    if (error) throw error;
    return data || null;
  } catch (err) {
    console.error('[Supabase] updateUser error:', errorToMessage(err));
    throw err;
  }
}

export async function getUserByEmail(email: string) {
  try {
    const { data, error } = await supabaseAdmin.from('User').select('*').eq('email', email).single();
    if (error) return null;
    return data || null;
  } catch (err) {
    console.error('[Supabase] getUserByEmail error:', errorToMessage(err));
    throw err;
  }
}

export async function getUserById(id: string) {
  try {
    const { data, error } = await supabaseAdmin.from('User').select('*').eq('id', id).single();
    if (error) return null;
    return data || null;
  } catch (err) {
    console.error('[Supabase] getUserById error:', errorToMessage(err));
    throw err;
  }
}

export async function getAllUsers() {
  try {
    const { data, error } = await supabaseAdmin.from('User').select('*');
    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error('[Supabase] getAllUsers error:', errorToMessage(err));
    throw err;
  }
}

export async function deleteUserById(id: string) {
  try {
    const { error } = await supabaseAdmin.from('User').delete().eq('id', id);
    if (error) throw error;
    return true;
  } catch (err) {
    console.error('[Supabase] deleteUserById error:', errorToMessage(err));
    throw err;
  }
}

/**
 * ============================================================
 * PAYMENT DETAILS & BANK INFORMATION OPERATIONS
 * ============================================================
 */

// Helper: build DB payloads and sanitize incoming payment data
export function buildPaymentDbRecords(paymentData: Record<string, unknown>) {
  // Normalize incoming shapes: support cardNumber (full or last4) or cardLast4
  const cardLast4FromNumber = (num?: string | unknown) => {
    if (!num) return undefined;
    const trimmed = String(num).trim();
    if (trimmed.length <= 4) return trimmed;
    return trimmed.slice(-4);
  };

  // Do NOT accept or persist cvv if present
  const sanitized = { ...paymentData };
  if ('cvv' in sanitized) delete sanitized.cvv;

  // Compute cardLast4 if provided via cardNumber
  const cardLast4 = sanitized.cardLast4 || cardLast4FromNumber(sanitized.cardNumber) || null;

  // Build legacy (camelCase) record and new snake_case record
  const legacyRecord: Record<string, unknown> = {
    ...sanitized,
    cardNumber: cardLast4, // legacy app previously used cardNumber to store last4
    // keep original timestamps out of the sanitized object if present; we'll set createdAt/updatedAt externally
  };

  const newRecord: Record<string, unknown> = {
    type: sanitized.type,
    account_name: sanitized.accountName,
    account_number: sanitized.accountNumber,
    bank_name: sanitized.bankName,
    bank_code: sanitized.bankCode,
    swift_code: sanitized.swiftCode,
    mpesa_phone_number: sanitized.mpesaPhoneNumber,
    mpesa_business_name: sanitized.mpesaBussinessName,
    cardholder_name: sanitized.cardholderName,
    card_last4: cardLast4,
    expiry_date: sanitized.expiryDate,
    is_active: sanitized.isActive,
    display_order: sanitized.displayOrder,
  };

  return { legacyRecord, newRecord };
}

export async function createPaymentDetails(paymentData: Omit<PaymentDetails, 'id' | 'createdAt' | 'updatedAt'>): Promise<PaymentDetails> {
  try {
    if (!hasValidCredentials()) {
      throw new Error('Supabase credentials not configured');
    }

    // sanitize and prepare payloads
    const { legacyRecord, newRecord } = buildPaymentDbRecords(paymentData as Record<string, unknown>);

    const id = uuidv4();
    const now = new Date().toISOString();

    // attach id/timestamps to both payloads
    const legacyPayload = { id, ...legacyRecord, createdAt: now, updatedAt: now };
    const newPayload = { id, ...newRecord, created_at: now, updated_at: now };

    // Try inserting into normalized snake_case table first
    let created: Record<string, unknown> | null = null;
    try {
      const { data, error } = await supabaseAdmin.from('payment_details').insert([newPayload]).select().single();
      if (error) throw error;
      created = data || null;
    } catch (err) {
      // If the new table doesn't exist or insert failed, log and fallback to legacy
      console.warn('[Supabase] createPaymentDetails: insert to payment_details failed, will try legacy table:', errorToMessage(err));
    }

    // Also attempt legacy insert for compatibility (non-blocking if fails)
    try {
      const { data, error } = await supabaseAdmin.from('PaymentDetails').insert([legacyPayload]).select().single();
      if (error) {
        console.warn('[Supabase] createPaymentDetails: legacy insert failed:', errorToMessage(error));
      } else if (!created) {
        created = data || null;
      }
    } catch (err) {
      console.warn('[Supabase] createPaymentDetails: legacy insert exception:', errorToMessage(err));
    }

    if (!created) {
      throw new Error('Failed to create payment details in both new and legacy tables');
    }

    return created as unknown as PaymentDetails;
  } catch (err) {
    console.error('[Supabase] createPaymentDetails error:', errorToMessage(err));
    throw err;
  }
}

export async function getPaymentDetails(): Promise<PaymentDetails[]> {
  try {
    if (!hasValidCredentials()) {
      throw new Error('Supabase credentials not configured');
    }

    // Prefer the normalized snake_case table; fallback to legacy CamelCase table if necessary
    try {
      const { data, error } = await supabaseClient
        .from('payment_details')
        .select('*')
        .order('display_order', { ascending: true });

      if (!error) {
        // Map DB snake_case -> app camelCase for card field
        const mapped = (data || []).map((row: Record<string, unknown>) => {
          return ({
            id: getField<string>(row, 'id', 'ID') ?? null,
            type: getField<string>(row, 'type', 'payment_type', 'paymentType') ?? null,
            ...row,
            // provide legacy-like keys to avoid wide app changes
            cardLast4: getField<string>(row, 'card_last4', 'cardLast4') ?? null,
            accountName: getField<string>(row, 'account_name', 'accountName'),
            accountNumber: getField<string>(row, 'account_number', 'accountNumber'),
            bankName: getField<string>(row, 'bank_name', 'bankName'),
            bankCode: getField<string>(row, 'bank_code', 'bankCode'),
            swiftCode: getField<string>(row, 'swift_code', 'swiftCode'),
            mpesaPhoneNumber: getField<string>(row, 'mpesa_phone_number', 'mpesaPhoneNumber'),
            mpesaBussinessName: getField<string>(row, 'mpesa_business_name', 'mpesaBussinessName'),
            cardholderName: getField<string>(row, 'cardholder_name', 'cardholderName'),
            expiryDate: getField<string>(row, 'expiry_date', 'expiryDate'),
            isActive: getField<boolean>(row, 'is_active', 'isActive'),
            displayOrder: getField<number>(row, 'display_order', 'displayOrder'),
            createdAt: getField<string>(row, 'created_at', 'createdAt'),
            updatedAt: getField<string>(row, 'updated_at', 'updatedAt'),
          } as unknown as PaymentDetails);
        });

        return mapped as PaymentDetails[];
       }
     } catch (err) {
       console.warn('[Supabase] getPaymentDetails: reading payment_details failed, falling back to legacy:', errorToMessage(err));
     }

    // Fallback to legacy table
    const { data, error } = await supabaseClient
      .from('PaymentDetails')
      .select('*')
      .order('displayOrder', { ascending: true });

    if (error) throw error;

    return (data as PaymentDetails[]) || [];
  } catch (err) {
    console.error('[Supabase] getPaymentDetails error:', errorToMessage(err));
    throw err;
  }
}

export async function getActivePaymentDetails(): Promise<PaymentDetails[]> {
  try {
    if (!hasValidCredentials()) {
      throw new Error('Supabase credentials not configured');
    }

    try {
      const { data, error } = await supabaseClient
        .from('payment_details')
        .select('*')
        .eq('is_active', true)
        .order('display_order', { ascending: true });

      if (!error) {
        const mapped = (data || []).map((row: Record<string, unknown>) => {
          return ({
            id: getField<string>(row, 'id', 'ID') ?? null,
            type: getField<string>(row, 'type', 'payment_type', 'paymentType') ?? null,
            ...row,
            cardLast4: getField<string>(row, 'card_last4', 'cardLast4') ?? null,
            accountName: getField<string>(row, 'account_name', 'accountName'),
            accountNumber: getField<string>(row, 'account_number', 'accountNumber'),
            bankName: getField<string>(row, 'bank_name', 'bankName'),
            bankCode: getField<string>(row, 'bank_code', 'bankCode'),
            swiftCode: getField<string>(row, 'swift_code', 'swiftCode'),
            mpesaPhoneNumber: getField<string>(row, 'mpesa_phone_number', 'mpesaPhoneNumber'),
            mpesaBussinessName: getField<string>(row, 'mpesa_business_name', 'mpesaBussinessName'),
            cardholderName: getField<string>(row, 'cardholder_name', 'cardholderName'),
            expiryDate: getField<string>(row, 'expiry_date', 'expiryDate'),
            isActive: getField<boolean>(row, 'is_active', 'isActive'),
            displayOrder: getField<number>(row, 'display_order', 'displayOrder'),
            createdAt: getField<string>(row, 'created_at', 'createdAt'),
            updatedAt: getField<string>(row, 'updated_at', 'updatedAt'),
          } as unknown as PaymentDetails);
        });

        return mapped as PaymentDetails[];
       }
     } catch (err) {
       console.warn('[Supabase] getActivePaymentDetails: reading payment_details failed, falling back to legacy:', errorToMessage(err));
     }

    const { data, error } = await supabaseClient
      .from('PaymentDetails')
      .select('*')
      .eq('isActive', true)
      .order('displayOrder' as const, { ascending: true });

    if (error) throw error;
    return (data as PaymentDetails[]) || [];
  } catch (err) {
    console.error('[Supabase] getActivePaymentDetails error:', errorToMessage(err));
    throw err;
  }
}

export async function updatePaymentDetails(id: string, updateData: Partial<PaymentDetails>) {
  try {
    if (!hasValidCredentials()) {
      throw new Error('Supabase credentials not configured');
    }

    // Sanitize and map update payload
    const { legacyRecord, newRecord } = buildPaymentDbRecords(updateData as Record<string, never>);
    const updatedAt = new Date().toISOString();

    // Try to update normalized table first
    try {
      const { data, error } = await supabaseAdmin
        .from('payment_details')
        .update({ ...newRecord, updated_at: updatedAt })
        .eq('id', id)
        .select()
        .single();

      if (!error) return data || null;
    } catch (err) {
      console.warn('[Supabase] updatePaymentDetails: update to payment_details failed, will attempt legacy update:', errorToMessage(err));
    }

    // Fallback/dual-update legacy table
    const { data, error } = await supabaseAdmin
      .from('PaymentDetails')
      .update({ ...legacyRecord, updatedAt })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return data || null;
  } catch (err) {
    console.error('[Supabase] updatePaymentDetails error:', errorToMessage(err));
    throw err;
  }
}

export async function deletePaymentDetails(id: string) {
  try {
    if (!hasValidCredentials()) {
      throw new Error('Supabase credentials not configured');
    }

    // Attempt to delete from both tables; ignore missing-table errors for new table
    try {
      const { error } = await supabaseAdmin.from('payment_details').delete().eq('id', id);
      if (error) {
        console.warn('[Supabase] deletePaymentDetails: deletion from payment_details failed:', errorToMessage(error));
      }
    } catch (err) {
      console.warn('[Supabase] deletePaymentDetails: delete payment_details exception:', errorToMessage(err));
    }

    const { error } = await supabaseAdmin.from('PaymentDetails').delete().eq('id', id);
    if (error) throw error;
    return true;
  } catch (err) {
    console.error('[Supabase] deletePaymentDetails error:', errorToMessage(err));
    throw err;
  }
}

// Bank Transfer Details
export async function createBankTransferDetails(bankData: Omit<BankTransferDetails, 'id' | 'createdAt' | 'updatedAt'>) {
  try {
    if (!hasValidCredentials()) {
      throw new Error('Supabase credentials not configured');
    }

    const record = {
      id: uuidv4(),
      ...bankData,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const { data, error } = await supabaseAdmin.from('BankTransferDetails').insert([record]).select().single();
    if (error) throw error;
    return data || null;
  } catch (err) {
    console.error('[Supabase] createBankTransferDetails error:', errorToMessage(err));
    throw err;
  }
}

export async function getBankTransferDetails() {
  try {
    if (!hasValidCredentials()) {
      throw new Error('Supabase credentials not configured');
    }

    const { data, error } = await supabaseClient
      .from('BankTransferDetails')
      .select('*');

    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error('[Supabase] getBankTransferDetails error:', errorToMessage(err));
    throw err;
  }
}

export async function updateBankTransferDetails(id: string, updateData: Partial<BankTransferDetails>) {
  try {
    if (!hasValidCredentials()) {
      throw new Error('Supabase credentials not configured');
    }

    const { data, error } = await supabaseAdmin
      .from('BankTransferDetails')
      .update({ ...updateData, updatedAt: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return data || null;
  } catch (err) {
    console.error('[Supabase] updateBankTransferDetails error:', errorToMessage(err));
    throw err;
  }
}

export async function deleteBankTransferDetails(id: string) {
  try {
    if (!hasValidCredentials()) {
      throw new Error('Supabase credentials not configured');
    }

    const { error } = await supabaseAdmin
      .from('BankTransferDetails')
      .delete()
      .eq('id', id);

    if (error) throw error;
    return true;
  } catch (err) {
    console.error('[Supabase] deleteBankTransferDetails error:', errorToMessage(err));
    throw err;
  }
}

// M-Pesa Details
export async function createMpesaDetails(mpesaData: Omit<MpesaDetails, 'id' | 'createdAt' | 'updatedAt'>) {
  try {
    if (!hasValidCredentials()) {
      throw new Error('Supabase credentials not configured');
    }

    const record = {
      id: uuidv4(),
      ...mpesaData,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const { data, error } = await supabaseAdmin.from('MpesaDetails').insert([record]).select().single();
    if (error) throw error;
    return data || null;
  } catch (err) {
    console.error('[Supabase] createMpesaDetails error:', errorToMessage(err));
    throw err;
  }
}

export async function getMpesaDetails() {
  try {
    if (!hasValidCredentials()) {
      throw new Error('Supabase credentials not configured');
    }

    const { data, error } = await supabaseClient
      .from('MpesaDetails')
      .select('*');

    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error('[Supabase] getMpesaDetails error:', errorToMessage(err));
    throw err;
  }
}

export async function updateMpesaDetails(id: string, updateData: Partial<MpesaDetails>) {
  try {
    if (!hasValidCredentials()) {
      throw new Error('Supabase credentials not configured');
    }

    const { data, error } = await supabaseAdmin
      .from('MpesaDetails')
      .update({ ...updateData, updatedAt: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return data || null;
  } catch (err) {
    console.error('[Supabase] updateMpesaDetails error:', errorToMessage(err));
    throw err;
  }
}

export async function deleteMpesaDetails(id: string) {
  try {
    if (!hasValidCredentials()) {
      throw new Error('Supabase credentials not configured');
    }

    const { error } = await supabaseAdmin
      .from('MpesaDetails')
      .delete()
      .eq('id', id);

    if (error) throw error;
    return true;
  } catch (err) {
    console.error('[Supabase] deleteMpesaDetails error:', errorToMessage(err));
    throw err;
  }
}

// Card Details
export async function createCardDetails(cardData: Omit<CardDetails, 'id' | 'createdAt' | 'updatedAt'>) {
  try {
    if (!hasValidCredentials()) {
      throw new Error('Supabase credentials not configured');
    }

    // sanitize: compute last4 only
    const cardDataRecord = cardData as Record<string, unknown>;
    const cardNumberLast4 = (cardDataRecord.cardNumberLast4 as string | undefined) || (cardDataRecord.cardNumber ? String(cardDataRecord.cardNumber).slice(-4) : null);
    const id = uuidv4();
    const now = new Date().toISOString();

    const newPayload = {
      id,
      cardholder_name: cardData.cardholderName,
      card_number_last4: cardNumberLast4,
      expiry_date: cardData.expiryDate,
      card_brand: cardData.cardBrand,
      is_active: cardData.isActive,
      created_at: now,
      updated_at: now,
    };

    let created: Record<string, unknown> | null = null;
    try {
      const { data, error } = await supabaseAdmin.from('card_details').insert([newPayload]).select().single();
      if (error) throw error;
      created = data || null;
    } catch (err) {
      console.warn('[Supabase] createCardDetails: insert to card_details failed, will fallback to legacy:', errorToMessage(err));
    }

    // Legacy insert (store last4 in cardNumber field to keep compatibility)
    try {
      const legacyPayload = {
        id,
        cardholderName: cardData.cardholderName,
        cardNumberLast4: cardNumberLast4,
        expiryDate: cardData.expiryDate,
        cardBrand: cardData.cardBrand,
        isActive: cardData.isActive,
        createdAt: now,
        updatedAt: now,
      };
      const { data, error } = await supabaseAdmin.from('CardDetails').insert([legacyPayload]).select().single();
      if (error) {
        console.warn('[Supabase] createCardDetails: legacy insert failed:', errorToMessage(error));
      } else if (!created) {
        created = data || null;
      }
    } catch (err) {
      console.warn('[Supabase] createCardDetails: legacy insert exception:', errorToMessage(err));
    }

    if (!created) throw new Error('Failed to create card details in both new and legacy tables');
    return created as unknown as PaymentDetails;
  } catch (err) {
    console.error('[Supabase] createCardDetails error:', errorToMessage(err));
    throw err;
  }
}

export async function getCardDetails() {
  try {
    if (!hasValidCredentials()) {
      throw new Error('Supabase credentials not configured');
    }

    try {
      const { data, error } = await supabaseClient.from('card_details').select('*');
      if (!error) {
        return (data || []).map((r: Record<string, unknown>) => ({
          ...r,
          cardNumberLast4: getField<string>(r, 'card_number_last4', 'cardNumberLast4'),
          expiryDate: getField<string>(r, 'expiry_date', 'expiryDate'),
          cardholderName: getField<string>(r, 'cardholder_name', 'cardholderName'),
          cardBrand: getField<string>(r, 'card_brand', 'cardBrand'),
          isActive: getField<boolean>(r, 'is_active', 'isActive'),
          createdAt: getField<string>(r, 'created_at', 'createdAt'),
          updatedAt: getField<string>(r, 'updated_at', 'updatedAt'),
        }));
      }
    } catch (err) {
      console.warn('[Supabase] getCardDetails: reading card_details failed, falling back to legacy:', errorToMessage(err));
    }

    const { data, error } = await supabaseClient.from('CardDetails').select('*');
    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error('[Supabase] getCardDetails error:', errorToMessage(err));
    throw err;
  }
}

export async function updateCardDetails(id: string, updateData: Partial<CardDetails>) {
  try {
    if (!hasValidCredentials()) {
      throw new Error('Supabase credentials not configured');
    }

    const updateDataRecord = updateData as Record<string, unknown>;
    const cardNumberLast4 = (updateDataRecord.cardNumberLast4 as string | undefined) || (updateDataRecord.cardNumber ? String(updateDataRecord.cardNumber).slice(-4) : null);
    const updatedAt = new Date().toISOString();

    try {
      const { data, error } = await supabaseAdmin
        .from('card_details')
        .update({
          cardholder_name: updateData.cardholderName,
          card_number_last4: cardNumberLast4,
          expiry_date: updateData.expiryDate,
          card_brand: updateData.cardBrand,
          is_active: updateData.isActive,
          updated_at: updatedAt,
        })
        .eq('id', id)
        .select()
        .single();

      if (!error) return data || null;
    } catch (err) {
      console.warn('[Supabase] updateCardDetails: update card_details failed, will fallback to legacy:', errorToMessage(err));
    }

    const { data, error } = await supabaseAdmin
      .from('CardDetails')
      .update({
        cardholderName: updateData.cardholderName,
        cardNumberLast4: cardNumberLast4,
        expiryDate: updateData.expiryDate,
        cardBrand: updateData.cardBrand,
        isActive: updateData.isActive,
        updatedAt: updatedAt,
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return data || null;
  } catch (err) {
    console.error('[Supabase] updateCardDetails error:', errorToMessage(err));
    throw err;
  }
}

export async function deleteCardDetails(id: string) {
  try {
    if (!hasValidCredentials()) {
      throw new Error('Supabase credentials not configured');
    }

    try {
      const { error } = await supabaseAdmin.from('card_details').delete().eq('id', id);
      if (error) console.warn('[Supabase] deleteCardDetails: deletion from card_details failed:', errorToMessage(error));
    } catch (err) {
      console.warn('[Supabase] deleteCardDetails: delete card_details exception:', errorToMessage(err));
    }

    const { error } = await supabaseAdmin.from('CardDetails').delete().eq('id', id);
    if (error) throw error;
    return true;
  } catch (err) {
    console.error('[Supabase] deleteCardDetails error:', errorToMessage(err));
    throw err;
  }
}
