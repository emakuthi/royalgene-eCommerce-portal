import { describe, it, expect } from 'vitest';
import { activityLookupIds, describeActivity, humanizeKey, type ActivityLookups } from '../activity-describe';

const lookups = (over: Partial<ActivityLookups> = {}): ActivityLookups => ({
  shopNames: new Map([['shop-a', 'CBD'], ['shop-b', 'Westlands']]),
  productNames: new Map([['prod-1', 'Mira short pleated']]),
  transfers: new Map(),
  ...over,
});

describe('describeActivity', () => {
  it('reads a transfer the app sent, with names and no ids', () => {
    const d = describeActivity({
      action: 'stock.transfer',
      shop_id: 'shop-a',
      details: {
        transferId: 't-1', productId: 'prod-1', productName: 'Mira short pleated', quantity: 5,
        fromShopId: 'shop-a', fromShopName: 'CBD', toShopId: 'shop-b', toShopName: 'Westlands', notes: 'For the weekend',
        deviceName: 'Pixel 7', platform: 'android',
      },
    }, lookups());
    expect(d.summary).toBe('Sent 5 × Mira short pleated to Westlands — waiting for approval');
    expect(d.fields).toEqual([
      { label: 'Product', value: 'Mira short pleated' },
      { label: 'Quantity', value: '5' },
      { label: 'From', value: 'CBD' },
      { label: 'To', value: 'Westlands' },
      { label: 'Notes', value: 'For the weekend' },
    ]);
  });

  it('fills an older approval row (only the transfer id) from the StockTransfer row', () => {
    const d = describeActivity({
      action: 'stock.transfer.confirm',
      resource_type: 'StockTransfer',
      resource_id: 't-9',
      details: { fromShopId: 'shop-a', toShopId: 'shop-b' },
    }, lookups({ transfers: new Map([['t-9', { productId: 'prod-1', quantity: 2, fromShopId: 'shop-a', toShopId: 'shop-b' }]]) }));
    expect(d.summary).toBe('Approved 2 × Mira short pleated from CBD into Westlands');
  });

  it('shows rejection reasons and size/colour cells', () => {
    const d = describeActivity({
      action: 'stock.transfer.reject',
      details: {
        productName: 'Dress', quantity: 3, fromShopName: 'CBD', reason: 'Wrong colour',
        variants: [{ size: 'M', color: 'Red', quantity: 2 }, { size: 'L', color: '', quantity: 1 }],
      },
    }, lookups());
    expect(d.summary).toBe('Rejected 3 × Dress from CBD — sent back');
    expect(d.fields).toContainEqual({ label: 'Sizes / colours', value: 'M / Red × 2, L × 1' });
    expect(d.fields).toContainEqual({ label: 'Reason', value: 'Wrong colour' });
  });

  it('summarises an app sale', () => {
    const d = describeActivity({
      action: 'sale.record',
      shop_id: 'shop-b',
      details: { items: 3, amount: 1250.5, paymentMethod: 'M-Pesa', offline: true, deviceName: 'Tecno', platform: 'android' },
    }, lookups());
    expect(d.summary).toBe('3 items, total 1,250.5, paid by M-Pesa');
    expect(d.fields).toEqual([
      { label: 'Items', value: '3' },
      { label: 'Total', value: '1,250.5' },
      { label: 'Paid by', value: 'M-Pesa' },
      { label: 'Shop', value: 'Westlands' },
    ]);
  });

  it('lists each product edit as from → to', () => {
    const d = describeActivity({
      action: 'product.update',
      resource_type: 'product',
      resource_id: 'prod-1',
      details: { changes: [{ field: 'price', from: 900, to: 1000 }, { field: 'name', from: 'Mira short', to: 'Mira short pleated' }] },
    }, lookups());
    expect(d.summary).toBe('Mira short pleated: changed price, product name');
    expect(d.fields).toEqual([
      { label: 'Product', value: 'Mira short pleated' },
      { label: 'Price', value: '900 → 1,000' },
      { label: 'Product name', value: 'Mira short → Mira short pleated' },
    ]);
  });

  it('falls back to the first readable fields for anything else', () => {
    const d = describeActivity({ action: 'auth.login', details: { method: 'google', deviceName: 'Pixel 7' } }, lookups());
    expect(d.summary).toBe('Method: google');
    expect(describeActivity({ action: 'auth.logout', details: {} }, lookups())).toEqual({ summary: null, fields: [] });
  });
});

describe('activityLookupIds', () => {
  it('collects shop, product and transfer ids', () => {
    const ids = activityLookupIds([
      { action: 'stock.transfer.cancel', shop_id: 'shop-a', resource_type: 'StockTransfer', resource_id: 't-1', details: { toShopId: 'shop-b' } },
      { action: 'product.update', resource_type: 'product', resource_id: 'prod-1', details: {} },
    ]);
    expect(ids).toEqual({ shopIds: ['shop-a', 'shop-b'], productIds: ['prod-1'], transferIds: ['t-1'] });
  });
});

describe('humanizeKey', () => {
  it('reads camelCase and snake_case as words', () => {
    expect(humanizeKey('lowStockThreshold')).toBe('Low stock threshold');
    expect(humanizeKey('payment_method')).toBe('Payment method');
  });
});
