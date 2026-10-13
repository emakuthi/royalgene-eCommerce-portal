import 'server-only';
import { v4 as uuidv4 } from 'uuid';
import { supabaseAdmin } from './supabase-client';
import { syncProductStockFromShopStocks } from './supabase-db';
import { normalizeUnit, quantityError, roundQuantity } from './business-types';
import logger from './logger';
import { jsonResponse } from './apiResponse';

// Restaurant mode (migration 20261014_03): a "menu" product has no stock of
// its own; selling one uses up its recipe's ingredients at the selling shop.
// A sale is never blocked for a short ingredient — the kitchen may hold stock
// nobody recorded — the ingredient just stops at zero.

export type ProductKind = 'stock' | 'menu';

export interface RecipeLine {
  ingredientProductId: string;
  /** Of the ingredient's unit, for ONE of the menu item. */
  quantity: number;
  name?: string;
  unit?: string;
}

export class RecipeError extends Error {}

/** 'menu' when the product is made to order; 'stock' otherwise (or before the migration). */
export async function productKind(productId: string | null | undefined): Promise<ProductKind> {
  if (!productId) return 'stock';
  const { data, error } = await supabaseAdmin.from('Product').select('kind').eq('id', productId).maybeSingle();
  if (error || !data) return 'stock';
  return (data as { kind?: string }).kind === 'menu' ? 'menu' : 'stock';
}

export function isProductKind(v: unknown): v is ProductKind {
  return v === 'stock' || v === 'menu';
}

export async function getRecipe(organizationId: string, productId: string): Promise<RecipeLine[]> {
  const { data, error } = await supabaseAdmin
    .from('RecipeItem')
    .select('ingredientProductId, quantity')
    .eq('organizationId', organizationId)
    .eq('productId', productId);
  if (error) {
    logger.warn('[recipes] getRecipe failed', { productId, error: error.message });
    return [];
  }
  const rows = (data ?? []) as { ingredientProductId: string; quantity: number | string }[];
  if (rows.length === 0) return [];
  // Separate lookup rather than an embed — see the ExpenseCategory note in
  // expenses.server.ts: an embed silently needs a declared FK.
  const { data: products } = await supabaseAdmin
    .from('Product').select('id, name, unit').in('id', rows.map((r) => r.ingredientProductId));
  const byId = new Map(((products ?? []) as { id: string; name: string; unit?: string }[]).map((p) => [p.id, p]));
  return rows.map((r) => ({
    ingredientProductId: r.ingredientProductId,
    quantity: Number(r.quantity) || 0,
    name: byId.get(r.ingredientProductId)?.name ?? 'Removed product',
    unit: normalizeUnit(byId.get(r.ingredientProductId)?.unit),
  }));
}

/**
 * Replaces a menu item's recipe. Ingredients must be stock-kind products of the
 * same workspace; amounts follow the ingredient's unit (fractions only for
 * kg / litre ...). An empty list clears the recipe.
 */
export async function setRecipe(organizationId: string, productId: string, raw: unknown): Promise<RecipeLine[]> {
  if (!Array.isArray(raw)) throw new RecipeError('items[] is required');
  const { data: menuItem } = await supabaseAdmin
    .from('Product').select('id').eq('id', productId).eq('organizationId', organizationId).maybeSingle();
  if (!menuItem) throw new RecipeError('Menu item not found');

  const merged = new Map<string, number>();
  for (const item of raw as Array<Record<string, unknown>>) {
    const id = typeof item?.ingredientProductId === 'string' ? item.ingredientProductId : '';
    if (!id) throw new RecipeError('Each ingredient needs ingredientProductId');
    if (id === productId) throw new RecipeError('A menu item cannot be its own ingredient');
    const q = Number(item.quantity);
    if (!Number.isFinite(q) || q <= 0) throw new RecipeError('Each ingredient needs an amount more than 0');
    merged.set(id, roundQuantity((merged.get(id) ?? 0) + q));
  }

  const ids = [...merged.keys()];
  if (ids.length > 0) {
    const { data: ingredients } = await supabaseAdmin
      .from('Product').select('id, name, unit, kind, deletedAt').eq('organizationId', organizationId).in('id', ids);
    const found = new Map(((ingredients ?? []) as { id: string; name: string; unit?: string; kind?: string; deletedAt?: string | null }[]).map((p) => [p.id, p]));
    for (const [id, q] of merged) {
      const p = found.get(id);
      if (!p || p.deletedAt) throw new RecipeError('An ingredient is not a product in this workspace');
      if (p.kind === 'menu') throw new RecipeError(`${p.name} is a menu item — ingredients must be stocked products`);
      const problem = quantityError(q, p.unit);
      if (problem) throw new RecipeError(`${p.name}: ${problem}`);
    }
  }

  const { error: delError } = await supabaseAdmin.from('RecipeItem').delete().eq('organizationId', organizationId).eq('productId', productId);
  if (delError) throw new Error(delError.message);
  if (ids.length > 0) {
    const now = new Date().toISOString();
    const { error } = await supabaseAdmin.from('RecipeItem').insert(
      ids.map((id) => ({ organizationId, productId, ingredientProductId: id, quantity: merged.get(id), createdAt: now, updatedAt: now })),
    );
    if (error) throw new Error(error.message);
  }
  return getRecipe(organizationId, productId);
}

export interface IngredientMove {
  organizationId: string;
  shopId: string;
  /** The menu item sold. */
  productId: string;
  /** How many of the menu item. Positive = used up (a sale); negative = put back (a delete / reduced edit). */
  menuQuantity: number;
  portalUserId: string | null;
  /** e.g. "sale-<id>" — recorded on each StockTransaction. */
  reference: string;
  reason: string;
}

/**
 * Takes each ingredient out of (or puts it back into) the shop's stock for
 * [menuQuantity] of the menu item. Best-effort per ingredient: a missing
 * stock row or failed update is logged, never thrown — the sale itself has
 * already happened.
 */
export async function moveIngredients(move: IngredientMove): Promise<void> {
  if (!move.menuQuantity) return;
  const recipe = await getRecipe(move.organizationId, move.productId);
  if (recipe.length === 0) return;
  const now = new Date().toISOString();
  const menuName = (await supabaseAdmin.from('Product').select('name').eq('id', move.productId).maybeSingle()).data?.name ?? 'menu item';

  for (const line of recipe) {
    const amount = roundQuantity(line.quantity * move.menuQuantity);
    try {
      const { data: stock } = await supabaseAdmin
        .from('ShopStock')
        .select('id, quantity')
        .eq('shopId', move.shopId)
        .eq('productId', line.ingredientProductId)
        .maybeSingle();
      if (!stock) {
        logger.warn('[recipes] ingredient not stocked at this shop — skipped', {
          shopId: move.shopId, menuItem: move.productId, ingredient: line.ingredientProductId,
        });
        continue;
      }
      const before = Number(stock.quantity) || 0;
      const after = Math.max(0, roundQuantity(before - amount));
      const { error } = await supabaseAdmin.from('ShopStock').update({ quantity: after, updatedAt: now }).eq('id', stock.id);
      if (error) throw new Error(error.message);
      await supabaseAdmin.from('StockTransaction').insert([{
        id: uuidv4(),
        organizationId: move.organizationId,
        shopStockId: stock.id,
        portalUserId: move.portalUserId,
        type: amount > 0 ? 'subtract' : 'add',
        quantity: roundQuantity(after - before),
        reason: `${move.reason}: ${menuName}`,
        reference: move.reference,
        createdAt: now,
      }]);
      await syncProductStockFromShopStocks(line.ingredientProductId);
    } catch (err) {
      logger.error('[recipes] ingredient stock move failed', {
        shopId: move.shopId, ingredient: line.ingredientProductId, error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

/** Shared GET/PUT body for the portal and mobile recipe routes; callers do auth. */
export async function recipeResponse(organizationId: string, productId: string, method: 'GET' | 'PUT', request?: Request) {
  try {
    const { data: product } = await supabaseAdmin
      .from('Product').select('id, kind').eq('id', productId).eq('organizationId', organizationId).maybeSingle();
    if (!product) return jsonResponse({ success: false, error: 'Product not found', code: 'NOT_FOUND' }, 404);
    if (method === 'GET') {
      return jsonResponse({ success: true, data: { kind: (product as { kind?: string }).kind ?? 'stock', items: await getRecipe(organizationId, productId) } });
    }
    const body = (await request!.json().catch(() => null)) as { items?: unknown } | null;
    const items = await setRecipe(organizationId, productId, body?.items);
    return jsonResponse({ success: true, data: { kind: (product as { kind?: string }).kind ?? 'stock', items } });
  } catch (err) {
    if (err instanceof RecipeError) return jsonResponse({ success: false, error: err.message, code: 'VALIDATION_ERROR' }, 400);
    logger.error('[recipes] request failed', { productId, error: err instanceof Error ? err.message : String(err) });
    return jsonResponse({ success: false, error: 'Could not save the recipe', code: 'INTERNAL_ERROR' }, 500);
  }
}
