import type { DatabaseSync } from 'node:sqlite';
import type {
  BundleItem,
  Category,
  InventoryMovement,
  InventoryMovementType,
  PriceTier,
  Product,
  Promotion,
  PromotionRule,
  PromoScope,
  PromoType,
  UnitType,
} from '../../src/types/index.ts';
import { logAudit } from './auth.ts';

export function listCategories(db: DatabaseSync, includeInactive = false): Category[] {
  const sql = includeInactive
    ? 'SELECT * FROM categories ORDER BY sort_order ASC, name ASC'
    : 'SELECT * FROM categories WHERE is_active = 1 ORDER BY sort_order ASC, name ASC';
  const rows = db.prepare(sql).all() as Array<{
    id: number;
    name: string;
    color_hex: string;
    image_path: string | null;
    sort_order: number;
    is_active: number;
  }>;
  return rows.map((r) => ({ ...r, is_active: Boolean(r.is_active) }));
}

export function upsertCategory(
  db: DatabaseSync,
  input: { id?: number; name: string; color_hex?: string; sort_order?: number; is_active?: boolean }
): Category {
  if (input.id) {
    db.prepare(
      'UPDATE categories SET name = ?, color_hex = ?, sort_order = ?, is_active = ? WHERE id = ?'
    ).run(
      input.name.trim(),
      input.color_hex || '#2563EB',
      input.sort_order ?? 0,
      input.is_active === false ? 0 : 1,
      input.id
    );
    const row = db.prepare('SELECT * FROM categories WHERE id = ?').get(input.id) as Record<string, unknown>;
    return { ...(row as unknown as Category), is_active: Boolean(row.is_active) };
  }
  const res = db
    .prepare('INSERT INTO categories (name, color_hex, sort_order, is_active) VALUES (?, ?, ?, 1)')
    .run(input.name.trim(), input.color_hex || '#2563EB', input.sort_order ?? 0);
  const row = db.prepare('SELECT * FROM categories WHERE id = ?').get(res.lastInsertRowid) as Record<string, unknown>;
  return { ...(row as unknown as Category), is_active: Boolean(row.is_active) };
}

export function listPriceTiers(db: DatabaseSync): PriceTier[] {
  const rows = db.prepare('SELECT * FROM price_tiers ORDER BY sort_order ASC, id ASC').all() as Array<{
    id: number;
    name: string;
    badge_color: string;
    is_default: number;
    sort_order: number;
  }>;
  return rows.map((r) => ({ ...r, is_default: Boolean(r.is_default) }));
}

export function getDefaultPriceTier(db: DatabaseSync): PriceTier {
  const tiers = listPriceTiers(db);
  return tiers.find((t) => t.is_default) || tiers[0];
}

export function listProducts(
  db: DatabaseSync,
  options: { includeInactive?: boolean; categoryId?: number; search?: string } = {}
): Product[] {
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (!options.includeInactive) {
    conditions.push('p.is_active = 1');
  }
  if (options.categoryId) {
    conditions.push('p.category_id = ?');
    params.push(options.categoryId);
  }
  if (options.search && options.search.trim()) {
    const q = `%${options.search.trim()}%`;
    conditions.push('(p.name LIKE ? OR p.sku LIKE ? OR p.barcode LIKE ?)');
    params.push(q, q, q);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = db
    .prepare(
      `SELECT p.*, c.name as category_name
       FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
       ${where}
       ORDER BY p.is_bundle ASC, p.name ASC`
    )
    .all(...params) as Array<Record<string, unknown>>;

  const pricesRows = db
    .prepare('SELECT product_id, price_tier_id, price_cents FROM product_prices')
    .all() as Array<{ product_id: number; price_tier_id: number; price_cents: number }>;

  const pricesMap = new Map<number, Record<number, number>>();
  for (const pr of pricesRows) {
    const map = pricesMap.get(pr.product_id) || {};
    map[pr.price_tier_id] = pr.price_cents;
    pricesMap.set(pr.product_id, map);
  }

  const bundleRows = db
    .prepare(
      `SELECT bi.id, bi.bundle_product_id, bi.component_product_id, bi.quantity,
              cp.name as component_name, cp.unit_type as component_unit_type,
              cp.cost_cents as component_cost_cents, cp.stock_quantity as component_stock
       FROM bundle_items bi
       JOIN products cp ON cp.id = bi.component_product_id`
    )
    .all() as unknown as Array<BundleItem & { bundle_product_id: number }>;

  const bundleMap = new Map<number, BundleItem[]>();
  for (const b of bundleRows) {
    const arr = bundleMap.get(b.bundle_product_id) || [];
    arr.push(b);
    bundleMap.set(b.bundle_product_id, arr);
  }

  return rows.map((r) => {
    const id = Number(r.id);
    return {
      id,
      sku: String(r.sku),
      barcode: r.barcode ? String(r.barcode) : null,
      name: String(r.name),
      category_id: r.category_id ? Number(r.category_id) : null,
      category_name: r.category_name ? String(r.category_name) : undefined,
      unit_type: r.unit_type as UnitType,
      cost_cents: Number(r.cost_cents),
      stock_quantity: Number(r.stock_quantity),
      min_stock_alert: Number(r.min_stock_alert),
      is_bundle: Boolean(r.is_bundle),
      track_inventory: Boolean(r.track_inventory),
      image_path: r.image_path ? String(r.image_path) : null,
      show_in_pos: Boolean(r.show_in_pos),
      is_active: Boolean(r.is_active),
      prices: pricesMap.get(id) || {},
      bundle_items: bundleMap.get(id) || [],
    };
  });
}

export function getProductById(db: DatabaseSync, id: number): Product | null {
  const list = listProducts(db, { includeInactive: true });
  return list.find((p) => p.id === id) || null;
}

export interface ProductSaveInput {
  id?: number;
  sku: string;
  barcode?: string | null;
  name: string;
  category_id: number | null;
  unit_type: UnitType;
  cost_cents: number;
  stock_quantity?: number;
  min_stock_alert?: number;
  is_bundle?: boolean;
  track_inventory?: boolean;
  image_path?: string | null;
  show_in_pos?: boolean;
  is_active?: boolean;
  prices: Record<number, number | null>;
  bundle_items?: Array<{ component_product_id: number; quantity: number }>;
}

export function saveProduct(db: DatabaseSync, input: ProductSaveInput, userId: number): Product {
  db.exec('BEGIN TRANSACTION');
  try {
    let productId = input.id;
    let computedCost = Math.round(input.cost_cents || 0);

    // If bundle with components, auto-compute sum of component costs if cost not explicitly higher
    if (input.is_bundle && input.bundle_items && input.bundle_items.length > 0) {
      let sumCost = 0;
      const getComp = db.prepare('SELECT cost_cents FROM products WHERE id = ?');
      for (const bi of input.bundle_items) {
        const comp = getComp.get(bi.component_product_id) as { cost_cents: number } | undefined;
        if (comp) {
          sumCost += Math.round(comp.cost_cents * bi.quantity);
        }
      }
      computedCost = sumCost;
    }

    if (productId) {
      db.prepare(
        `UPDATE products
         SET sku = ?, barcode = ?, name = ?, category_id = ?, unit_type = ?,
             cost_cents = ?, min_stock_alert = ?, is_bundle = ?, track_inventory = ?,
             image_path = COALESCE(?, image_path), show_in_pos = ?, is_active = ?
         WHERE id = ?`
      ).run(
        input.sku.trim(),
        input.barcode?.trim() || null,
        input.name.trim(),
        input.category_id,
        input.unit_type || 'PIECE',
        computedCost,
        input.min_stock_alert ?? 5,
        input.is_bundle ? 1 : 0,
        input.is_bundle ? 0 : input.track_inventory === false ? 0 : 1,
        input.image_path !== undefined ? input.image_path : null,
        input.show_in_pos === false ? 0 : 1,
        input.is_active === false ? 0 : 1,
        productId
      );
    } else {
      const res = db
        .prepare(
          `INSERT INTO products (sku, barcode, name, category_id, unit_type, cost_cents, stock_quantity, min_stock_alert, is_bundle, track_inventory, image_path, show_in_pos, is_active)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
        )
        .run(
          input.sku.trim(),
          input.barcode?.trim() || null,
          input.name.trim(),
          input.category_id,
          input.unit_type || 'PIECE',
          computedCost,
          input.is_bundle ? 0 : input.stock_quantity ?? 0,
          input.min_stock_alert ?? 5,
          input.is_bundle ? 1 : 0,
          input.is_bundle ? 0 : input.track_inventory === false ? 0 : 1,
          input.image_path || null,
          input.show_in_pos === false ? 0 : 1
        );
      productId = Number(res.lastInsertRowid);

      if (!input.is_bundle && (input.stock_quantity ?? 0) !== 0) {
        db.prepare(
          `INSERT INTO inventory_movements (product_id, user_id, type, quantity_delta, stock_before, stock_after, reason)
           VALUES (?, ?, 'PURCHASE', ?, 0, ?, 'Stock inicial al crear producto')`
        ).run(productId, userId, input.stock_quantity ?? 0, input.stock_quantity ?? 0);
      }
    }

    // Update prices
    db.prepare('DELETE FROM product_prices WHERE product_id = ?').run(productId);
    const insPrice = db.prepare(
      'INSERT INTO product_prices (product_id, price_tier_id, price_cents) VALUES (?, ?, ?)'
    );
    for (const [tierIdStr, cents] of Object.entries(input.prices || {})) {
      if (cents !== null && cents !== undefined && !Number.isNaN(Number(cents))) {
        insPrice.run(productId, Number(tierIdStr), Math.round(Number(cents)));
      }
    }

    // Update bundle components
    db.prepare('DELETE FROM bundle_items WHERE bundle_product_id = ?').run(productId);
    if (input.is_bundle && input.bundle_items && input.bundle_items.length > 0) {
      const insBi = db.prepare(
        'INSERT INTO bundle_items (bundle_product_id, component_product_id, quantity) VALUES (?, ?, ?)'
      );
      for (const bi of input.bundle_items) {
        if (bi.component_product_id !== productId && bi.quantity > 0) {
          insBi.run(productId, bi.component_product_id, bi.quantity);
        }
      }
    }

    db.exec('COMMIT');
    return getProductById(db, productId)!;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function adjustStock(
  db: DatabaseSync,
  input: {
    product_id: number;
    user_id: number;
    type: 'PURCHASE' | 'ADJUSTMENT' | 'WASTE';
    quantity_delta?: number;
    new_stock?: number;
    new_cost_cents?: number;
    reason: string;
  }
): Product {
  if (!input.reason || !input.reason.trim()) {
    throw new Error('El motivo del movimiento de inventario es obligatorio.');
  }
  db.exec('BEGIN TRANSACTION');
  try {
    const row = db
      .prepare('SELECT id, stock_quantity, cost_cents, is_bundle FROM products WHERE id = ?')
      .get(input.product_id) as { id: number; stock_quantity: number; cost_cents: number; is_bundle: number } | undefined;
    if (!row) throw new Error('Producto no encontrado');
    if (row.is_bundle) throw new Error('Los combos no tienen stock propio; ajusta sus productos componentes.');

    const before = Number(row.stock_quantity);
    let delta: number;
    let after: number;

    if (input.new_stock !== undefined) {
      after = Number(input.new_stock);
      delta = Number((after - before).toFixed(4));
    } else {
      delta = Number(input.quantity_delta || 0);
      if (input.type === 'WASTE' && delta > 0) {
        delta = -delta;
      }
      after = Number((before + delta).toFixed(4));
    }

    db.prepare('UPDATE products SET stock_quantity = ? WHERE id = ?').run(after, input.product_id);
    if (input.new_cost_cents !== undefined && input.new_cost_cents >= 0) {
      db.prepare('UPDATE products SET cost_cents = ? WHERE id = ?').run(
        Math.round(input.new_cost_cents),
        input.product_id
      );
    }

    db.prepare(
      `INSERT INTO inventory_movements (product_id, user_id, type, quantity_delta, stock_before, stock_after, reason)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(input.product_id, input.user_id, input.type, delta, before, after, input.reason.trim());

    logAudit(db, input.user_id, 'STOCK_EDIT', {
      product_id: input.product_id,
      type: input.type,
      before,
      after,
      delta,
      reason: input.reason.trim(),
    });

    db.exec('COMMIT');
    return getProductById(db, input.product_id)!;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export interface BulkEditRow {
  product_id: number;
  cost_cents?: number;
  stock_quantity?: number;
  min_stock_alert?: number;
  prices?: Record<number, number | null>;
}

/**
 * RF-02.3 & HU-06: Atomic spreadsheet-style bulk update with automatic Kardex generation.
 */
export function bulkUpdateProducts(
  db: DatabaseSync,
  rows: BulkEditRow[],
  userId: number,
  reason = 'Edición rápida en tabla'
): { updated: number; kardex_entries: number } {
  db.exec('BEGIN TRANSACTION');
  try {
    let updated = 0;
    let kardexEntries = 0;

    const getProd = db.prepare('SELECT id, stock_quantity, cost_cents, is_bundle FROM products WHERE id = ?');
    const updStock = db.prepare('UPDATE products SET stock_quantity = ? WHERE id = ?');
    const updCost = db.prepare('UPDATE products SET cost_cents = ? WHERE id = ?');
    const updMin = db.prepare('UPDATE products SET min_stock_alert = ? WHERE id = ?');
    const insKardex = db.prepare(
      `INSERT INTO inventory_movements (product_id, user_id, type, quantity_delta, stock_before, stock_after, reason)
       VALUES (?, ?, 'ADJUSTMENT', ?, ?, ?, ?)`
    );
    const delPrice = db.prepare('DELETE FROM product_prices WHERE product_id = ? AND price_tier_id = ?');
    const upsertPrice = db.prepare(
      `INSERT INTO product_prices (product_id, price_tier_id, price_cents) VALUES (?, ?, ?)
       ON CONFLICT(product_id, price_tier_id) DO UPDATE SET price_cents = excluded.price_cents`
    );

    for (const r of rows) {
      const prod = getProd.get(r.product_id) as
        | { id: number; stock_quantity: number; cost_cents: number; is_bundle: number }
        | undefined;
      if (!prod) continue;
      let changed = false;

      if (r.stock_quantity !== undefined && !prod.is_bundle) {
        const before = Number(prod.stock_quantity);
        const after = Number(r.stock_quantity);
        const delta = Number((after - before).toFixed(4));
        if (Math.abs(delta) > 1e-6) {
          updStock.run(after, r.product_id);
          insKardex.run(r.product_id, userId, delta, before, after, reason);
          kardexEntries++;
          changed = true;
        }
      }

      if (r.cost_cents !== undefined && Math.round(r.cost_cents) !== prod.cost_cents) {
        updCost.run(Math.round(r.cost_cents), r.product_id);
        changed = true;
      }

      if (r.min_stock_alert !== undefined) {
        updMin.run(Number(r.min_stock_alert), r.product_id);
        changed = true;
      }

      if (r.prices) {
        for (const [tierIdStr, cents] of Object.entries(r.prices)) {
          const tierId = Number(tierIdStr);
          if (cents === null || cents === undefined) {
            delPrice.run(r.product_id, tierId);
          } else {
            upsertPrice.run(r.product_id, tierId, Math.round(Number(cents)));
          }
          changed = true;
        }
      }

      if (changed) updated++;
    }

    logAudit(db, userId, 'BULK_EDIT', { updated, kardex_entries: kardexEntries, reason });
    db.exec('COMMIT');
    return { updated, kardex_entries: kardexEntries };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function listInventoryMovements(
  db: DatabaseSync,
  options: { productId?: number; limit?: number } = {}
): InventoryMovement[] {
  const limit = options.limit || 200;
  const where = options.productId ? 'WHERE m.product_id = ?' : '';
  const params = options.productId ? [options.productId, limit] : [limit];

  return db
    .prepare(
      `SELECT m.*, p.name as product_name, u.name as user_name
       FROM inventory_movements m
       JOIN products p ON p.id = m.product_id
       LEFT JOIN users u ON u.id = m.user_id
       ${where}
       ORDER BY m.id DESC
       LIMIT ?`
    )
    .all(...params) as unknown as InventoryMovement[];
}

export function listPromotions(db: DatabaseSync): Promotion[] {
  const rows = db.prepare('SELECT * FROM promotions ORDER BY is_active DESC, id DESC').all() as Array<{
    id: number;
    name: string;
    type: PromoType;
    target_scope: PromoScope;
    target_id: number | null;
    rule_json: string;
    valid_from: string | null;
    valid_until: string | null;
    days_of_week: string;
    is_active: number;
  }>;
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    type: r.type,
    target_scope: r.target_scope,
    target_id: r.target_id,
    rule: JSON.parse(r.rule_json || '{}') as PromotionRule,
    valid_from: r.valid_from,
    valid_until: r.valid_until,
    days_of_week: JSON.parse(r.days_of_week || '[]') as number[],
    is_active: Boolean(r.is_active),
  }));
}

export function savePromotion(
  db: DatabaseSync,
  input: Omit<Promotion, 'id'> & { id?: number }
): Promotion {
  if (input.id) {
    db.prepare(
      `UPDATE promotions
       SET name = ?, type = ?, target_scope = ?, target_id = ?, rule_json = ?,
           valid_from = ?, valid_until = ?, days_of_week = ?, is_active = ?
       WHERE id = ?`
    ).run(
      input.name.trim(),
      input.type,
      input.target_scope,
      input.target_scope === 'ALL' ? null : input.target_id,
      JSON.stringify(input.rule || {}),
      input.valid_from || null,
      input.valid_until || null,
      JSON.stringify(input.days_of_week || []),
      input.is_active ? 1 : 0,
      input.id
    );
    return listPromotions(db).find((p) => p.id === input.id)!;
  }

  const res = db
    .prepare(
      `INSERT INTO promotions (name, type, target_scope, target_id, rule_json, valid_from, valid_until, days_of_week, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.name.trim(),
      input.type,
      input.target_scope,
      input.target_scope === 'ALL' ? null : input.target_id,
      JSON.stringify(input.rule || {}),
      input.valid_from || null,
      input.valid_until || null,
      JSON.stringify(input.days_of_week || []),
      input.is_active ? 1 : 0
    );
  return listPromotions(db).find((p) => p.id === Number(res.lastInsertRowid))!;
}

export function deletePromotion(db: DatabaseSync, id: number): void {
  db.prepare('DELETE FROM promotions WHERE id = ?').run(id);
}
