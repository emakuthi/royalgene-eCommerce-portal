# Mobile API Documentation

This API is designed for Android applications used by shopkeepers to record sales in different shops.

## Base URL

```
https://your-domain.com/api/mobile
```

## Authentication

All endpoints (except login) require a Bearer token in the Authorization header:

```
Authorization: Bearer <JWT_TOKEN>
```

## Base Response Format

### Success Response (2xx)
```json
{
  "success": true,
  "data": { /* endpoint specific data */ },
  "message": "Optional success message"
}
```

### Error Response (4xx, 5xx)
```json
{
  "success": false,
  "error": "Error message",
  "code": "ERROR_CODE"
}
```

## API Endpoints

### 1. Authentication

#### POST /auth/login
Login with shopkeeper credentials.

**Request Body:**
```json
{
  "email": "shopkeeper@example.com",
  "password": "password123"
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": {
      "id": "user-id",
      "email": "shopkeeper@example.com",
      "name": "John Doe",
      "role": "portal_user"
    },
    "shop": {
      "id": "shop-id",
      "name": "Shop Name",
      "location": "Nairobi",
      "phoneNumber": "+254712345678",
      "address": "123 Main Street"
    }
  },
  "message": "Login successful"
}
```

**Errors:**
- `400`: Missing email or password
- `401`: Invalid credentials
- `403`: User is not a shopkeeper

#### POST /auth/logout
Logout (optional, just clear token on client side).

### 2. Shops

Note: the database stores the shop phone in a column named `phone` (snake/camel mismatch). The API responses normalize this value and expose it as `phoneNumber` (camelCase). When querying the database directly use the `phone` column; when consuming the API expect `phoneNumber` in JSON responses.


#### GET /shops
Get list of shops accessible to the shopkeeper.

**Response (200):**
```json
{
  "success": true,
  "data": {
    "shops": [
      {
        "id": "shop-id-1",
        "name": "Downtown Shop",
        "location": "Nairobi",
        "phoneNumber": "+254712345678",
        "address": "123 Main Street"
      }
    ]
  }
}
```

#### GET /shops/{shopId}
Get shop details by ID.

**Response (200):**
```json
{
  "success": true,
  "data": {
    "shop": {
      "id": "shop-id",
      "name": "Downtown Shop",
      "location": "Nairobi",
      "phoneNumber": "+254712345678",
      "address": "123 Main Street",
      "totalStock": 1250,
      "totalSalestoday": 15000
    }
  }
}
```

**Errors:**
- `404`: Shop not found
- `403`: User not authorized to access this shop

### 3. Products & Inventory

#### GET /shops/{shopId}/products
Get available products in a shop with current stock levels.

**Query Parameters:**
- `category` (optional): Filter by category (dresses, shoes, trousers, textiles)
- `search` (optional): Search by product name or SKU
- `page` (optional): Page number (default: 1)
- `limit` (optional): Items per page (default: 20)

**Response (200):**
```json
{
  "success": true,
  "data": {
    "products": [
      {
        "id": "product-id",
        "shopStockId": "shopstock-id",
        "name": "Blue Dress",
        "sku": "DRESS-001",
        "category": "dresses",
        "description": "Beautiful blue dress",
        "price": 2500,
        "costPrice": 1500,
        "quantity": 15,
        "images": ["https://..."],
        "colors": ["blue"],
        "sizes": ["S", "M", "L"]
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 45,
      "pages": 3
    }
  }
}
```

#### GET /shops/{shopId}/products/{productId}
Get detailed product information.

**Response (200):**
```json
{
  "success": true,
  "data": {
    "product": {
      "id": "product-id",
      "shopStockId": "shopstock-id",
      "name": "Blue Dress",
      "sku": "DRESS-001",
      "category": "dresses",
      "description": "Beautiful blue dress",
      "price": 2500,
      "costPrice": 1500,
      "quantity": 15,
      "images": ["https://..."],
      "colors": ["blue"],
      "sizes": ["S", "M", "L"],
      "reorderLevel": 5
    }
  }
}
```

### 4. Sales Recording

#### POST /shops/{shopId}/sales
Record a new sale.

**Request Body:**
```json
{
  "productId": "product-id",
  "shopStockId": "shopstock-id",
  "quantity": 2,
  "unitPrice": 2500,
  "paymentMethod": "cash",
  "customerName": "Jane Doe",
  "customerPhone": "+254700000000",
  "notes": "Regular customer"
}
```

**Response (201):**
```json
{
  "success": true,
  "data": {
    "saleId": "sale-id",
    "saleNumber": "SALE-20260317-001",
    "timestamp": "2026-03-17T10:30:00Z",
    "product": {
      "name": "Blue Dress",
      "sku": "DRESS-001"
    },
    "quantity": 2,
    "unitPrice": 2500,
    "totalAmount": 5000,
    "costPrice": 1500,
    "profit": 2000,
    "marginPercentage": 40,
    "paymentMethod": "cash",
    "customerName": "Jane Doe",
    "customerPhone": "+254700000000"
  },
  "message": "Sale recorded successfully"
}
```

**Errors:**
- `400`: Missing required fields or insufficient stock
- `403`: User not authorized to sell at this shop
- `404`: Shop or product not found
- `409`: Insufficient stock available

#### GET /shops/{shopId}/sales
Get sales history for a shop.

**Query Parameters:**
- `startDate` (optional): Filter from date (ISO format)
- `endDate` (optional): Filter to date (ISO format)
- `page` (optional): Page number (default: 1)
- `limit` (optional): Items per page (default: 20)

**Response (200):**
```json
{
  "success": true,
  "data": {
    "sales": [
      {
        "saleId": "sale-id",
        "saleNumber": "SALE-20260317-001",
        "timestamp": "2026-03-17T10:30:00Z",
        "product": {
          "name": "Blue Dress",
          "sku": "DRESS-001"
        },
        "quantity": 2,
        "unitPrice": 2500,
        "totalAmount": 5000,
        "paymentMethod": "cash",
        "customerName": "Jane Doe"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 150,
      "pages": 8
    },
    "summary": {
      "totalSales": 150,
      "totalAmount": 375000,
      "totalProfit": 150000
    }
  }
}
```

#### GET /shops/{shopId}/sales/{saleId}
Get details of a specific sale.

**Response (200):**
```json
{
  "success": true,
  "data": {
    "sale": {
      "saleId": "sale-id",
      "saleNumber": "SALE-20260317-001",
      "timestamp": "2026-03-17T10:30:00Z",
      "shopId": "shop-id",
      "product": {
        "id": "product-id",
        "name": "Blue Dress",
        "sku": "DRESS-001",
        "category": "dresses"
      },
      "quantity": 2,
      "unitPrice": 2500,
      "totalAmount": 5000,
      "costPrice": 1500,
      "profit": 2000,
      "marginPercentage": 40,
      "paymentMethod": "cash",
      "customerName": "Jane Doe",
      "customerPhone": "+254700000000",
      "notes": "Regular customer",
      "recordedBy": "John Doe",
      "updatedAt": "2026-03-17T10:30:00Z"
    }
  }
}
```

### 5. Dashboard & Analytics

#### GET /shops/{shopId}/dashboard
Get dashboard summary for a shop.

**Query Parameters:**
- `period` (optional): "today", "week", "month" (default: "today")

**Response (200):**
```json
{
  "success": true,
  "data": {
    "summary": {
      "totalSales": 25,
      "totalRevenue": 62500,
      "totalProfit": 25000,
      "averageTransactionValue": 2500,
      "topProduct": {
        "name": "Blue Dress",
        "quantity": 8,
        "revenue": 20000
      }
    },
    "metrics": {
      "salesByPaymentMethod": {
        "cash": 15,
        "mpesa": 10
      },
      "topProducts": [
        {
          "id": "product-id",
          "name": "Blue Dress",
          "quantity": 8,
          "revenue": 20000,
          "profit": 8000
        }
      ]
    }
  }
}
```

#### GET /shops/{shopId}/analytics/sales
Get detailed sales analytics.

**Query Parameters:**
- `startDate` (optional): ISO date format
- `endDate` (optional): ISO date format
- `groupBy` (optional): "hour", "day", "week" (default: "day")

**Response (200):**
```json
{
  "success": true,
  "data": {
    "analytics": {
      "totalSales": 150,
      "totalRevenue": 375000,
      "totalProfit": 150000,
      "averageProfit": 1000,
      "profitMargin": 40,
      "salesTrend": [
        {
          "date": "2026-03-17",
          "sales": 25,
          "revenue": 62500,
          "profit": 25000
        }
      ]
    }
  }
}
```

### 6. Profile & Settings

#### GET /profile
Get current user profile.

**Response (200):**
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "user-id",
      "name": "John Doe",
      "email": "john@example.com",
      "phone": "+254712345678",
      "role": "portal_user",
      "shop": {
        "id": "shop-id",
        "name": "Downtown Shop"
      }
    }
  }
}
```

#### PUT /profile
Update user profile.

**Request Body:**
```json
{
  "name": "John Doe",
  "phone": "+254712345678",
  "currentPassword": "oldPassword",
  "newPassword": "newPassword" // optional
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "user-id",
      "name": "John Doe",
      "phone": "+254712345678"
    }
  },
  "message": "Profile updated successfully"
}
```

### 7. Inventory Management

#### GET /shops/{shopId}/inventory
Get detailed inventory for a shop.

**Query Parameters:**
- `low_stock` (optional): Boolean, show only low stock items
- `category` (optional): Filter by category

**Response (200):**
```json
{
  "success": true,
  "data": {
    "inventory": [
      {
        "id": "shopstock-id",
        "product": {
          "id": "product-id",
          "name": "Blue Dress",
          "sku": "DRESS-001",
          "category": "dresses"
        },
        "quantity": 5,
        "reorderLevel": 10,
        "lastRestocked": "2026-03-15T08:00:00Z",
        "estimatedDaysToRunOut": 2,
        "status": "low_stock"
      }
    ]
  }
}
```

## Error Codes

| Code | Status | Description |
|------|--------|-------------|
| `INVALID_CREDENTIALS` | 401 | Email or password is incorrect |
| `UNAUTHORIZED` | 401 | Missing or invalid token |
| `FORBIDDEN` | 403 | User not authorized for this action |
| `NOT_FOUND` | 404 | Resource not found |
| `VALIDATION_ERROR` | 400 | Invalid request data |
| `INSUFFICIENT_STOCK` | 409 | Not enough stock available |
| `INTERNAL_ERROR` | 500 | Server error |

## Rate Limiting

- Mobile API: 100 requests per minute per user
- Login: 5 attempts per minute per IP

## Offline Support

For offline functionality, the mobile app should:
1. Cache product list and inventory locally
2. Store sales locally with a flag `synced: false`
3. Sync pending sales when connection is restored
4. Validate inventory before recording sales (use cached data)

## Best Practices

1. **Always include error handling** for network failures
2. **Implement token refresh** - tokens expire after 7 days
3. **Cache product/shop data** for offline support
4. **Show loading states** while recording sales
5. **Validate data locally** before sending
6. **Implement retry logic** for failed requests
7. **Use exponential backoff** for rate-limited responses
8. **Clear sensitive data** from device storage on logout

## Implementation Notes

- All timestamps are in UTC (ISO 8601 format)
- All currency amounts are in Kenyan Shillings (KES)
- Stock quantities are integers
- Profit calculations are automatic (unitPrice * quantity - costPrice * quantity)

