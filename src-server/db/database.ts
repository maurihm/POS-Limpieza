import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { AppSettings, RolePermissions } from '../../src/types/index.ts';

export const DEFAULT_ADMIN_PERMS: RolePermissions = {
  can_sell: true,
  can_switch_tier: true,
  can_reprint_last: true,
  can_reprint_any: true,
  can_cash_movement: true,
  can_view_corte_x: true,
  can_close_corte_z: true,
  can_override_price: true,
  can_apply_discount: true,
  can_void_sale: true,
  can_view_costs: true,
  can_edit_catalog: true,
  can_edit_inventory: true,
  can_manage_settings: true,
  can_open_drawer: true,
};

export const DEFAULT_CASHIER_PERMS: RolePermissions = {
  can_sell: true,
  can_switch_tier: true,
  can_reprint_last: true,
  can_reprint_any: true,
  can_cash_movement: true,
  can_view_corte_x: true,
  can_close_corte_z: true,
  can_override_price: false,
  can_apply_discount: true,
  can_void_sale: false,
  can_view_costs: false,
  can_edit_catalog: false,
  can_edit_inventory: false,
  can_manage_settings: false,
  can_open_drawer: false,
};

export const DEFAULT_SETTINGS: AppSettings = {
  business_name: 'LIMPIEZA TOTAL',
  business_address: 'Av. Principal #124, Col. Centro',
  business_phone: 'WhatsApp: 55-1234-5678',
  ticket_footer_1: '¡Gracias por su preferencia!',
  ticket_footer_2: 'Conserve su ticket para aclaraciones',
  printer_mode: 'SPOOLER',
  printer_name: 'POS-80',
  printer_com_port: process.platform === 'win32' ? 'COM3' : '/dev/usb/lp0',
  printer_baud_rate: 9600,
  printer_columns: 48,
  printer_codepage: 'CP850',
  auto_open_drawer_on_cash: true,
  allow_negative_stock: true,
  backup_dir: path.resolve(process.cwd(), 'backups'),
  backup_retention_days: 30,
  sound_enabled: true,
};

export function hashPin(pin: string): string {
  return crypto.createHash('sha256').update(`pos-limpieza-pin:${pin}`).digest('hex');
}

export function hashPassword(password: string): string {
  return crypto.createHash('sha256').update(`pos-limpieza-pwd:${password}`).digest('hex');
}

export function initDatabase(dbPath?: string): { db: DatabaseSync; dbPath: string } {
  const resolvedPath =
    dbPath ||
    process.env.POS_DB_PATH ||
    path.resolve(process.cwd(), 'data', 'pos_limpieza.db');

  if (resolvedPath !== ':memory:') {
    fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  }

  const db = new DatabaseSync(resolvedPath);
  if (resolvedPath !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL;');
    db.exec('PRAGMA synchronous = NORMAL;');
  }
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');

  runMigrations(db);
  seedIfEmpty(db);

  return { db, dbPath: resolvedPath };
}

function runMigrations(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS roles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      permissions_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      pin_hash TEXT NOT NULL,
      password_hash TEXT NOT NULL DEFAULT '',
      role_id INTEGER NOT NULL REFERENCES roles(id),
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      color_hex TEXT NOT NULL DEFAULT '#2563EB',
      image_path TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS price_tiers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      badge_color TEXT NOT NULL DEFAULT '#2563EB',
      is_default INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sku TEXT NOT NULL UNIQUE,
      barcode TEXT,
      name TEXT NOT NULL,
      category_id INTEGER REFERENCES categories(id),
      unit_type TEXT NOT NULL DEFAULT 'PIECE' CHECK (unit_type IN ('PIECE', 'LITER', 'WEIGHT')),
      cost_cents INTEGER NOT NULL DEFAULT 0,
      stock_quantity REAL NOT NULL DEFAULT 0,
      min_stock_alert REAL NOT NULL DEFAULT 5,
      is_bundle INTEGER NOT NULL DEFAULT 0,
      track_inventory INTEGER NOT NULL DEFAULT 1,
      image_path TEXT,
      show_in_pos INTEGER NOT NULL DEFAULT 1,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);
    CREATE INDEX IF NOT EXISTS idx_products_name ON products(name);
    CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);

    CREATE TABLE IF NOT EXISTS product_prices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      price_tier_id INTEGER NOT NULL REFERENCES price_tiers(id) ON DELETE CASCADE,
      price_cents INTEGER NOT NULL,
      UNIQUE(product_id, price_tier_id)
    );

    CREATE TABLE IF NOT EXISTS bundle_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bundle_product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      component_product_id INTEGER NOT NULL REFERENCES products(id),
      quantity REAL NOT NULL CHECK (quantity > 0),
      UNIQUE(bundle_product_id, component_product_id)
    );

    CREATE TABLE IF NOT EXISTS promotions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('BUY_X_PAY_Y', 'PERCENT_DISCOUNT', 'FIXED_AMOUNT_DISCOUNT', 'BULK_QUANTITY_PRICE')),
      target_scope TEXT NOT NULL CHECK (target_scope IN ('PRODUCT', 'CATEGORY', 'ALL')),
      target_id INTEGER,
      rule_json TEXT NOT NULL,
      valid_from TEXT,
      valid_until TEXT,
      days_of_week TEXT NOT NULL DEFAULT '[]',
      is_active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS cash_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      opened_by_user_id INTEGER NOT NULL REFERENCES users(id),
      closed_by_user_id INTEGER REFERENCES users(id),
      opened_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      closed_at TEXT,
      opening_cash_cents INTEGER NOT NULL DEFAULT 0,
      expected_cash_cents INTEGER NOT NULL DEFAULT 0,
      declared_cash_cents INTEGER,
      difference_cents INTEGER,
      status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLOSED')),
      notes TEXT
    );

    CREATE TABLE IF NOT EXISTS cash_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cash_session_id INTEGER NOT NULL REFERENCES cash_sessions(id),
      user_id INTEGER NOT NULL REFERENCES users(id),
      type TEXT NOT NULL CHECK (type IN ('IN', 'OUT')),
      amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
      reason TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      folio TEXT NOT NULL UNIQUE,
      cash_session_id INTEGER NOT NULL REFERENCES cash_sessions(id),
      user_id INTEGER NOT NULL REFERENCES users(id),
      price_tier_id INTEGER NOT NULL REFERENCES price_tiers(id),
      subtotal_cents INTEGER NOT NULL,
      discount_cents INTEGER NOT NULL DEFAULT 0,
      total_cents INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'COMPLETED' CHECK (status IN ('COMPLETED', 'VOIDED', 'PARTIALLY_REFUNDED')),
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_sales_created_at ON sales(created_at);
    CREATE INDEX IF NOT EXISTS idx_sales_session ON sales(cash_session_id);

    CREATE TABLE IF NOT EXISTS sale_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id),
      product_name_snapshot TEXT NOT NULL,
      quantity REAL NOT NULL,
      refunded_quantity REAL NOT NULL DEFAULT 0,
      unit_price_cents INTEGER NOT NULL,
      cost_cents_snapshot INTEGER NOT NULL DEFAULT 0,
      discount_cents INTEGER NOT NULL DEFAULT 0,
      promo_label TEXT,
      line_total_cents INTEGER NOT NULL,
      price_overridden INTEGER NOT NULL DEFAULT 0,
      bundle_snapshot_json TEXT
    );

    CREATE TABLE IF NOT EXISTS sale_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
      method TEXT NOT NULL CHECK (method IN ('CASH', 'CARD', 'TRANSFER')),
      amount_cents INTEGER NOT NULL,
      tendered_cents INTEGER NOT NULL,
      change_cents INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS inventory_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL REFERENCES products(id),
      user_id INTEGER NOT NULL REFERENCES users(id),
      type TEXT NOT NULL CHECK (type IN ('SALE', 'REFUND', 'PURCHASE', 'ADJUSTMENT', 'WASTE', 'BUNDLE_DEDUCTION')),
      quantity_delta REAL NOT NULL,
      stock_before REAL NOT NULL,
      stock_after REAL NOT NULL,
      reference_id INTEGER,
      reason TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_inv_mov_product ON inventory_movements(product_id);

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      action TEXT NOT NULL,
      details_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS held_tickets (
      id TEXT PRIMARY KEY,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );
  `);
}

function seedIfEmpty(db: DatabaseSync): void {
  const roleCount = db.prepare('SELECT COUNT(*) as c FROM roles').get() as { c: number };
  if (roleCount.c > 0) return;

  db.exec('BEGIN TRANSACTION');
  try {
    // 1. Roles
    const insertRole = db.prepare('INSERT INTO roles (name, permissions_json) VALUES (?, ?)');
    const adminRole = insertRole.run('ADMIN', JSON.stringify(DEFAULT_ADMIN_PERMS));
    const cashierRole = insertRole.run('CAJERO', JSON.stringify(DEFAULT_CASHIER_PERMS));

    // 2. Users (Admin PIN: 0000, Ana Cajero PIN: 1234)
    const insertUser = db.prepare(
      'INSERT INTO users (name, pin_hash, password_hash, role_id, is_active) VALUES (?, ?, ?, ?, 1)'
    );
    const adminUser = insertUser.run('Dueña (Admin)', hashPin('0000'), hashPassword('admin123'), adminRole.lastInsertRowid);
    insertUser.run('Ana', hashPin('1234'), hashPassword('cajero123'), cashierRole.lastInsertRowid);

    // 3. Price Tiers
    const insertTier = db.prepare(
      'INSERT INTO price_tiers (name, badge_color, is_default, sort_order) VALUES (?, ?, ?, ?)'
    );
    const tiendaTier = insertTier.run('Tienda', '#2563EB', 1, 1);
    const revendedorTier = insertTier.run('Revendedor', '#D97706', 0, 2);

    // 4. Categories
    const insertCat = db.prepare(
      'INSERT INTO categories (name, color_hex, sort_order, is_active) VALUES (?, ?, ?, 1)'
    );
    const catLiquidos = insertCat.run('Líquidos', '#0EA5E9', 1);
    const catEnvases = insertCat.run('Envases', '#8B5CF6', 2);
    const catJarceria = insertCat.run('Jarcería', '#10B981', 3);
    const catCombos = insertCat.run('Combos', '#F59E0B', 4);

    // 5. Products
    const insertProduct = db.prepare(`
      INSERT INTO products (sku, barcode, name, category_id, unit_type, cost_cents, stock_quantity, min_stock_alert, is_bundle, track_inventory, show_in_pos, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1)
    `);
    const insertPrice = db.prepare(
      'INSERT INTO product_prices (product_id, price_tier_id, price_cents) VALUES (?, ?, ?)'
    );

    const sampleProducts: Array<{
      sku: string;
      barcode: string;
      name: string;
      catId: number | bigint;
      unit: 'PIECE' | 'LITER' | 'WEIGHT';
      cost: number;
      tienda: number;
      revendedor: number | null;
      stock: number;
      min: number;
    }> = [
      { sku: 'LIQ-001', barcode: '7501000000011', name: 'Cloro Blanqueador 1L', catId: catLiquidos.lastInsertRowid, unit: 'LITER', cost: 700, tienda: 1500, revendedor: 1100, stock: 50, min: 10 },
      { sku: 'LIQ-002', barcode: '7501000000028', name: 'Pino Limpiador 1L', catId: catLiquidos.lastInsertRowid, unit: 'LITER', cost: 850, tienda: 1800, revendedor: 1350, stock: 38, min: 10 },
      { sku: 'LIQ-003', barcode: '7501000000035', name: 'Suavizante Telas 1L', catId: catLiquidos.lastInsertRowid, unit: 'LITER', cost: 1100, tienda: 2200, revendedor: 1700, stock: 24, min: 8 },
      { sku: 'LIQ-004', barcode: '7501000000042', name: 'Jabón Trastes 1L', catId: catLiquidos.lastInsertRowid, unit: 'LITER', cost: 1200, tienda: 2400, revendedor: 1900, stock: 30, min: 8 },
      { sku: 'LIQ-005', barcode: '7501000000059', name: 'Detergente Ropa Color 1L', catId: catLiquidos.lastInsertRowid, unit: 'LITER', cost: 1300, tienda: 2600, revendedor: 2050, stock: 4.5, min: 10 },
      { sku: 'LIQ-006', barcode: '7501000000066', name: 'Fabuloso Lavanda 1L', catId: catLiquidos.lastInsertRowid, unit: 'LITER', cost: 800, tienda: 1600, revendedor: 1200, stock: 42, min: 10 },
      { sku: 'LIQ-007', barcode: '7501000000073', name: 'Desengrasante Industrial 1L', catId: catLiquidos.lastInsertRowid, unit: 'LITER', cost: 1400, tienda: 2800, revendedor: 2200, stock: 16, min: 5 },
      { sku: 'GRA-001', barcode: '7505000000019', name: 'Detergente en Polvo (Granel kg)', catId: catLiquidos.lastInsertRowid, unit: 'WEIGHT', cost: 2100, tienda: 3600, revendedor: 2900, stock: 30, min: 8 },
      { sku: 'GRA-002', barcode: '7505000000026', name: 'Bicarbonato Limpieza (Granel kg)', catId: catLiquidos.lastInsertRowid, unit: 'WEIGHT', cost: 1800, tienda: 3200, revendedor: 2500, stock: 20, min: 5 },
      { sku: 'ENV-001', barcode: '7502000000018', name: 'Envase PET 1L c/Tapa', catId: catEnvases.lastInsertRowid, unit: 'PIECE', cost: 400, tienda: 800, revendedor: 600, stock: 120, min: 25 },
      { sku: 'ENV-002', barcode: '7502000000025', name: 'Atomizador Chico 500ml', catId: catEnvases.lastInsertRowid, unit: 'PIECE', cost: 800, tienda: 1500, revendedor: 1200, stock: 25, min: 10 },
      { sku: 'ENV-003', barcode: '7502000000032', name: 'Garrafón 4L c/Asa', catId: catEnvases.lastInsertRowid, unit: 'PIECE', cost: 1100, tienda: 2000, revendedor: 1600, stock: 35, min: 10 },
      { sku: 'ENV-004', barcode: '7502000000049', name: 'Bidón 20L Reforzado', catId: catEnvases.lastInsertRowid, unit: 'PIECE', cost: 4200, tienda: 6800, revendedor: 5600, stock: 12, min: 4 },
      { sku: 'JAR-001', barcode: '7503000000015', name: 'Escoba Suave Abanico', catId: catJarceria.lastInsertRowid, unit: 'PIECE', cost: 2600, tienda: 4500, revendedor: 3800, stock: 18, min: 5 },
      { sku: 'JAR-002', barcode: '7503000000022', name: 'Trapeador Microfibra #400', catId: catJarceria.lastInsertRowid, unit: 'PIECE', cost: 3100, tienda: 5500, revendedor: 4600, stock: 14, min: 5 },
      { sku: 'JAR-003', barcode: '7503000000039', name: 'Franela Roja (Metro)', catId: catJarceria.lastInsertRowid, unit: 'PIECE', cost: 900, tienda: 1800, revendedor: null, stock: 22, min: 6 },
      { sku: 'JAR-004', barcode: '7503000000046', name: 'Fibra Verde Doble Uso', catId: catJarceria.lastInsertRowid, unit: 'PIECE', cost: 500, tienda: 1200, revendedor: 950, stock: 40, min: 10 },
    ];

    const productIdsBySku: Record<string, number> = {};
    for (const p of sampleProducts) {
      const res = insertProduct.run(
        p.sku,
        p.barcode,
        p.name,
        p.catId,
        p.unit,
        p.cost,
        p.stock,
        p.min,
        0,
        1
      );
      const pid = Number(res.lastInsertRowid);
      productIdsBySku[p.sku] = pid;
      insertPrice.run(pid, tiendaTier.lastInsertRowid, p.tienda);
      if (p.revendedor !== null) {
        insertPrice.run(pid, revendedorTier.lastInsertRowid, p.revendedor);
      }
    }

    // 6. Sample Combo: "Kit Limpieza ($35)" = 1L Cloro + 1L Pino + 2 Envases 1L
    const comboRes = insertProduct.run(
      'CMB-001',
      '7504000000012',
      'Kit Limpieza Hogar',
      catCombos.lastInsertRowid,
      'PIECE',
      700 + 850 + 800,
      0,
      0,
      1,
      0
    );
    const comboId = Number(comboRes.lastInsertRowid);
    insertPrice.run(comboId, tiendaTier.lastInsertRowid, 3500);
    insertPrice.run(comboId, revendedorTier.lastInsertRowid, 3000);

    const insertBundleItem = db.prepare(
      'INSERT INTO bundle_items (bundle_product_id, component_product_id, quantity) VALUES (?, ?, ?)'
    );
    insertBundleItem.run(comboId, productIdsBySku['LIQ-001'], 1);
    insertBundleItem.run(comboId, productIdsBySku['LIQ-002'], 1);
    insertBundleItem.run(comboId, productIdsBySku['ENV-001'], 2);

    // 7. Sample Promotion: 2x1 Suavizante Fin de Semana (active, Sat & Sun [6,7])
    db.prepare(`
      INSERT INTO promotions (name, type, target_scope, target_id, rule_json, valid_from, valid_until, days_of_week, is_active)
      VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, 1)
    `).run(
      '2x1 Suavizante Fin de Semana',
      'BUY_X_PAY_Y',
      'PRODUCT',
      productIdsBySku['LIQ-003'],
      JSON.stringify({ buy: 2, pay: 1 }),
      JSON.stringify([6, 7])
    );

    // Sample Bulk Qty promo: A partir de 5L de Fabuloso baja a $13.00/L
    db.prepare(`
      INSERT INTO promotions (name, type, target_scope, target_id, rule_json, valid_from, valid_until, days_of_week, is_active)
      VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, 1)
    `).run(
      'Mayoreo Fabuloso 5L+',
      'BULK_QUANTITY_PRICE',
      'PRODUCT',
      productIdsBySku['LIQ-006'],
      JSON.stringify({ min_qty: 5, unit_price_cents: 1300 }),
      JSON.stringify([])
    );

    // 8. Default Settings
    const insertSetting = db.prepare('INSERT INTO settings (key, value_json) VALUES (?, ?)');
    for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
      insertSetting.run(k, JSON.stringify(v));
    }

    // 9. Open an initial cash session so store can start selling smoothly
    db.prepare(`
      INSERT INTO cash_sessions (opened_by_user_id, opening_cash_cents, expected_cash_cents, status, notes)
      VALUES (?, 50000, 50000, 'OPEN', 'Fondo inicial de turno')
    `).run(adminUser.lastInsertRowid);

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function getSettings(db: DatabaseSync): AppSettings {
  const rows = db.prepare('SELECT key, value_json FROM settings').all() as Array<{
    key: string;
    value_json: string;
  }>;
  const result = { ...DEFAULT_SETTINGS } as Record<string, unknown>;
  for (const row of rows) {
    try {
      result[row.key] = JSON.parse(row.value_json);
    } catch {
      // ignore malformed
    }
  }
  return result as unknown as AppSettings;
}

export function saveSettings(db: DatabaseSync, patch: Partial<AppSettings>): AppSettings {
  const upsert = db.prepare(
    'INSERT INTO settings (key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json'
  );
  db.exec('BEGIN TRANSACTION');
  try {
    for (const [k, v] of Object.entries(patch)) {
      if (v !== undefined) {
        upsert.run(k, JSON.stringify(v));
      }
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return getSettings(db);
}
