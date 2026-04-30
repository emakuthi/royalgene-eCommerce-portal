import type { User, Product, Order, Invoice, Receipt, Settings, Discount, DiscountCode, OrderItem, ShopStock, StockTransaction } from './types';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';

// In-memory database (replace with real DB in production)
export const db = {
  users: [] as User[],
  products: [] as Product[],
  orders: [] as Order[],
  invoices: [] as Invoice[],
  receipts: [] as Receipt[],
  settings: [] as Settings[],
  discounts: [] as Discount[],
  discountCodes: [] as DiscountCode[],
  // Use concrete typed arrays for in-memory fallback stores
  shopStocks: [] as ShopStock[],
  stockTransactions: [] as StockTransaction[],
};

// Initialize with sample data
export async function initializeDb() {
  // Create admin user
  const adminPassword = await bcrypt.hash('admin123', 10);
  db.users.push({
    id: uuidv4(),
    email: 'admin@textile.com',
    password: adminPassword,
    name: 'Admin User',
    role: 'admin',
    twoFactorEnabled: false,
    createdAt: new Date().toISOString(),
  });

  // Sample products
  const sampleProducts: Omit<Product, 'id' | 'createdAt' | 'updatedAt'>[] = [
    {
      name: 'Elegant Evening Dress',
      description: 'Beautiful evening dress perfect for special occasions',
      price: 4500,
      category: 'dresses',
      images: ['https://images.unsplash.com/photo-1595777457583-95e059d581b8?w=800'],
      sizes: ['S', 'M', 'L', 'XL'],
      colors: ['Black', 'Navy', 'Burgundy'],
      stockQuantity: 25,
      sku: 'DRS-001',
      featured: false,
      trending: true,
    },
    {
      name: 'Casual Summer Dress',
      description: 'Light and comfortable dress for everyday wear',
      price: 2800,
      category: 'dresses',
      images: ['https://images.unsplash.com/photo-1572804013309-59a88b7e92f1?w=800'],
      sizes: ['S', 'M', 'L', 'XL'],
      colors: ['White', 'Pink', 'Blue'],
      stockQuantity: 30,
      sku: 'DRS-002',
      featured: false,
      trending: false,
    },
    {
      name: 'Classic Leather Heels',
      description: 'Timeless leather heels for any occasion',
      price: 3200,
      category: 'shoes',
      images: ['https://images.unsplash.com/photo-1543163521-1bf539c55dd2?w=800'],
      sizes: ['36', '37', '38', '39', '40', '41'],
      colors: ['Black', 'Nude', 'Red'],
      stockQuantity: 20,
      sku: 'SHO-001',
      featured: false,
      trending: false,
    },
    {
      name: 'Casual Sneakers',
      description: 'Comfortable sneakers for everyday style',
      price: 2500,
      category: 'shoes',
      images: ['https://images.unsplash.com/photo-1549298916-b41d501d3772?w=800'],
      sizes: ['36', '37', '38', '39', '40', '41'],
      colors: ['White', 'Black', 'Pink'],
      stockQuantity: 35,
      sku: 'SHO-002',
      featured: false,
      trending: false,
    },
    {
      name: 'High-Waisted Trousers',
      description: 'Stylish high-waisted trousers for office or casual wear',
      price: 3500,
      category: 'trousers',
      images: ['https://images.unsplash.com/photo-1594633312681-425c7b97ccd1?w=800'],
      sizes: ['S', 'M', 'L', 'XL'],
      colors: ['Black', 'Grey', 'Navy'],
      stockQuantity: 28,
      sku: 'TRS-001',
      featured: false,
      trending: true,
    },
    {
      name: 'Wide Leg Trousers',
      description: 'Trendy wide leg trousers for a chic look',
      price: 3800,
      category: 'trousers',
      images: ['https://images.unsplash.com/photo-1506629082955-511b1aa562c8?w=800'],
      sizes: ['S', 'M', 'L', 'XL'],
      colors: ['Beige', 'White', 'Olive'],
      stockQuantity: 22,
      sku: 'TRS-002',
      featured: false,
      trending: false,
    },
    {
      name: 'Premium Cotton Fabric',
      description: 'High-quality cotton fabric - 5 meters',
      price: 1500,
      category: 'textiles',
      images: ['https://images.unsplash.com/photo-1569074187119-c87815b476da?w=800'],
      sizes: ['5m', '10m', '20m'],
      colors: ['White', 'Cream', 'Navy', 'Black'],
      stockQuantity: 50,
      sku: 'TXT-001',
      featured: true,
      trending: false,
    },
    {
      name: 'Silk Blend Fabric',
      description: 'Luxurious silk blend fabric - 5 meters',
      price: 2200,
      category: 'textiles',
      images: ['https://images.unsplash.com/photo-1558769132-cb1aea9c4845?w=800'],
      sizes: ['5m', '10m'],
      colors: ['Gold', 'Silver', 'Rose'],
      stockQuantity: 30,
      sku: 'TXT-002',
      featured: true,
      trending: false,
    },
  ];

  const now = new Date().toISOString();
  db.products = sampleProducts.map(product => ({
    ...product,
    id: uuidv4(),
    createdAt: now,
    updatedAt: now,
  }));

  // Initialize theme settings
  db.settings.push({
    id: uuidv4(),
    key: 'theme',
    value: JSON.stringify({
      primaryColor: '#ec4899',
      gradientStart: '#ec4899',
      gradientEnd: '#8b5cf6',
    }),
    updatedAt: now,
  });
}

// Helper functions
export function findUserByEmail(email: string): User | undefined {
  return db.users.find(user => user.email === email);
}

export function findUserById(id: string): User | undefined {
  return db.users.find(user => user.id === id);
}

export function createUser(userData: Omit<User, 'id' | 'createdAt'>): User {
  const user: User = {
    ...userData,
    id: uuidv4(),
    createdAt: new Date().toISOString(),
  };
  db.users.push(user);
  return user;
}

export function findProductById(id: string): Product | undefined {
  return db.products.find(product => product.id === id);
}

export function createOrder(orderData: Omit<Order, 'id' | 'orderNumber' | 'createdAt' | 'updatedAt'>): Order {
  const orderNumber = `ORD-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const order: Order = {
    ...orderData,
    id: uuidv4(),
    orderNumber,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  db.orders.push(order);
  return order;
}

export function findOrderById(id: string): Order | undefined {
  return db.orders.find(order => order.id === id);
}

export function getUserOrders(userId: string): Order[] {
  return db.orders.filter(order => order.userId === userId);
}

// Discount management functions
export function createDiscount(discountData: Omit<Discount, 'id' | 'usageCount' | 'createdAt' | 'updatedAt'>): Discount {
  const discount: Discount = {
    ...discountData,
    id: uuidv4(),
    usageCount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  db.discounts.push(discount);
  return discount;
}

export function findDiscountByCode(code: string): Discount | undefined {
  return db.discounts.find(discount => discount.code.toUpperCase() === code.toUpperCase());
}

export function findDiscountById(id: string): Discount | undefined {
  return db.discounts.find(discount => discount.id === id);
}

export function getAllDiscounts(): Discount[] {
  return db.discounts;
}

export function updateDiscount(id: string, data: Partial<Discount>): Discount | null {
  const discount = findDiscountById(id);
  if (!discount) return null;

  const updated = {
    ...discount,
    ...data,
    id: discount.id,
    createdAt: discount.createdAt,
    updatedAt: new Date().toISOString(),
  };

  const index = db.discounts.findIndex(d => d.id === id);
  db.discounts[index] = updated;
  return updated;
}

export function deleteDiscount(id: string): boolean {
  const index = db.discounts.findIndex(d => d.id === id);
  if (index === -1) return false;

  db.discounts.splice(index, 1);
  // Also delete associated codes
  db.discountCodes = db.discountCodes.filter(dc => dc.discountId !== id);
  return true;
}

export function validateAndApplyDiscount(
  code: string,
  orderTotal: number,
  orderItems: OrderItem[],
  customerEmail: string
): { discount: Discount; discountAmount: number } | null {
  const discount = findDiscountByCode(code);

  if (!discount) {
    return null;
  }

  // Check if active
  const now = new Date();
  const startDate = new Date(discount.startDate);
  const endDate = new Date(discount.endDate);

  if (!discount.isActive || now < startDate || now > endDate) {
    return null;
  }

  // Check minimum order amount
  if (orderTotal < discount.minOrderAmount) {
    return null;
  }

  // Check if applicable to items
  if (discount.applicableTo !== 'all') {
    const itemsApplicable = orderItems.some(item =>
      discount.applicableItems.includes(item.productId)
    );
    if (!itemsApplicable) {
      return null;
    }
  }

  // Check usage limits
  if (discount.maxUses && discount.usageCount >= discount.maxUses) {
    return null;
  }

  // Check per-user usage limit
  const userUsageCount = db.discountCodes.filter(
    dc => dc.discountId === discount.id && dc.email === customerEmail
  ).length;

  if (userUsageCount >= discount.maxUsesPerUser) {
    return null;
  }

  // Calculate discount amount
  let discountAmount: number;
  if (discount.type === 'percentage') {
    discountAmount = Math.floor((orderTotal * discount.value) / 100);
  } else {
    discountAmount = Math.floor(discount.value);
  }

  // Apply max discount cap if set
  if (discount.maxDiscount && discountAmount > discount.maxDiscount) {
    discountAmount = discount.maxDiscount;
  }

  return {
    discount,
    discountAmount,
  };
}

// Record discount usage when order is completed
// This will be called from the order creation endpoint
export function recordDiscountUsage(discountId: string, orderNumber: string, customerEmail: string): DiscountCode {
  const code: DiscountCode = {
    id: uuidv4(),
    discountId,
    orderNumber,
    email: customerEmail,
    usedAt: new Date().toISOString(),
  };

  db.discountCodes.push(code);

  // Increment usage count on discount
  const discount = findDiscountById(discountId);
  if (discount) {
    updateDiscount(discountId, { usageCount: discount.usageCount + 1 });
  }

  return code;
}

// Shop stock helpers (in-memory fallback)
export function createShopStock(stockData: Partial<ShopStock> & { metadata?: Record<string, unknown> | null }) {
  const now = new Date().toISOString();
  const stock: ShopStock = {
    id: typeof stockData.id === 'string' && stockData.id ? String(stockData.id) : uuidv4(),
    shopId: String(stockData.shopId ?? ''),
    productId: String(stockData.productId ?? ''),
    quantity: typeof stockData.quantity === 'number' ? stockData.quantity : Number(stockData.quantity) || 0,
    lowStockThreshold: typeof stockData.lowStockThreshold === 'number' ? stockData.lowStockThreshold : Number(stockData.lowStockThreshold) || 0,
    createdAt: now,
    updatedAt: now,
    // preserve metadata if provided
    metadata: stockData.metadata ?? null,
  };
  db.shopStocks.push(stock);
  return stock;
}

export function updateShopStock(id: string, data: Partial<ShopStock>) {
  const idx = db.shopStocks.findIndex(s => s.id === id);
  if (idx === -1) return null;
  const updated: ShopStock = {
    ...db.shopStocks[idx],
    ...data,
    id: db.shopStocks[idx].id,
    createdAt: db.shopStocks[idx].createdAt,
    updatedAt: new Date().toISOString(),
  };
  db.shopStocks[idx] = updated;
  return updated;
}

export function recordStockTransaction(tx: Partial<StockTransaction>) {
  const record: StockTransaction = {
    id: typeof tx.id === 'string' && tx.id ? String(tx.id) : uuidv4(),
    shopStockId: String(tx.shopStockId ?? ''),
    portalUserId: String(tx.portalUserId ?? ''),
    type: (tx.type as StockTransaction['type']) || 'adjustment',
    quantity: typeof tx.quantity === 'number' ? tx.quantity : Number(tx.quantity) || 0,
    reason: typeof tx.reason === 'string' ? tx.reason : undefined,
    reference: typeof tx.reference === 'string' ? tx.reference : undefined,
    notes: typeof tx.notes === 'string' ? tx.notes : undefined,
    createdAt: new Date().toISOString(),
  };
  db.stockTransactions.push(record);
  return record;
}

// Initialize database
initializeDb();
