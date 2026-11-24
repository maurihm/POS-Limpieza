import * as XLSX from 'xlsx';
import type { DatabaseSync } from 'node:sqlite';
import {
  getDefaultPriceTier,
  listCategories,
  listPriceTiers,
  listProducts,
  saveProduct,
  upsertCategory,
} from '../services/inventory.ts';
import { listSales } from '../services/sales.ts';
import type { UnitType } from '../../src/types/index.ts';

const UTF8_BOM = '\uFEFF';

function rowsToCsv(headers: string[], rows: Array<Array<string | number>>): Buffer {
  const escape = (v: string | number) => {
    const s = String(v ?? '');
    if (/[",\n\r]/.test(s)) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  const lines = [headers.map(escape).join(','), ...rows.map((r) => r.map(escape).join(','))];
  return Buffer.from(UTF8_BOM + lines.join('\r\n'), 'utf8');
}

function sheetToXlsx(sheetName: string, headers: string[], rows: Array<Array<string | number>>): Buffer {
  const wb = XLSX.utils.book_new();
  const aoa = [headers, ...rows];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = headers.map((h, i) => {
    const maxLen = Math.max(h.length, ...rows.map((r) => String(r[i] ?? '').length));
    return { wch: Math.min(40, Math.max(12, maxLen + 3)) };
  });
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}

function centsToNum(c: number | undefined): number {
  if (c === undefined || c === null) return 0;
  return Number((c / 100).toFixed(2));
}

export function exportFullCatalog(db: DatabaseSync, format: 'xlsx' | 'csv' = 'xlsx'): Buffer {
  const products = listProducts(db, { includeInactive: false });
  const tiers = listPriceTiers(db);
  const tienda = tiers.find((t) => t.is_default) || tiers[0];
  const revendedor = tiers.find((t) => !t.is_default) || tiers[1];

  const headers = [
    'SKU',
    'Código de Barras',
    'Nombre',
    'Categoría',
    'Unidad',
    'Costo ($)',
    `Precio ${tienda?.name || 'Tienda'} ($)`,
    `Precio ${revendedor?.name || 'Revendedor'} ($)`,
    'Stock Actual',
    'Stock Mínimo',
    'Es Combo',
  ];

  const rows = products.map((p) => [
    p.sku,
    p.barcode || '',
    p.name,
    p.category_name || 'Sin categoría',
    p.unit_type === 'LITER' ? 'Litro' : p.unit_type === 'WEIGHT' ? 'Kg' : 'Pieza',
    centsToNum(p.cost_cents),
    centsToNum(tienda ? p.prices[tienda.id] : 0),
    revendedor && p.prices[revendedor.id] !== undefined ? centsToNum(p.prices[revendedor.id]) : '',
    p.is_bundle ? 'Combo' : p.stock_quantity,
    p.min_stock_alert,
    p.is_bundle ? 'SI' : 'NO',
  ]);

  return format === 'csv'
    ? rowsToCsv(headers, rows)
    : sheetToXlsx('Catálogo Completo', headers, rows);
}

/**
 * HU-08: Clean price list for WhatsApp (NO costs, NO stock).
 */
export function exportWhatsAppPriceList(db: DatabaseSync, format: 'xlsx' | 'csv' = 'xlsx'): Buffer {
  const products = listProducts(db, { includeInactive: false });
  const tiers = listPriceTiers(db);
  const tienda = tiers.find((t) => t.is_default) || tiers[0];
  const revendedor = tiers.find((t) => !t.is_default) || tiers[1];

  const headers = [
    'Producto',
    'Categoría',
    `Precio ${tienda?.name || 'Tienda'}`,
    `Precio ${revendedor?.name || 'Revendedor'}`,
  ];

  const rows = products.map((p) => {
    const pTienda = tienda ? p.prices[tienda.id] ?? 0 : 0;
    const pRev = revendedor && p.prices[revendedor.id] !== undefined ? p.prices[revendedor.id] : pTienda;
    return [
      p.name,
      p.category_name || 'General',
      centsToNum(pTienda),
      centsToNum(pRev),
    ];
  });

  return format === 'csv'
    ? rowsToCsv(headers, rows)
    : sheetToXlsx('Lista de Precios', headers, rows);
}

export function exportSalesProfitReport(
  db: DatabaseSync,
  dateFrom: string,
  dateTo: string,
  format: 'xlsx' | 'csv' = 'xlsx'
): Buffer {
  const sales = listSales(db, { date_from: dateFrom, date_to: dateTo, limit: 5000 });
  const headers = [
    'Folio',
    'Fecha y Hora',
    'Cajero',
    'Tarifa',
    'Estado',
    'Subtotal ($)',
    'Descuento ($)',
    'Total Venta ($)',
    'Costo Estimado ($)',
    'Utilidad Bruta ($)',
    'Métodos de Pago',
  ];

  const rows = sales.map((s) => {
    const costCents =
      s.status === 'VOIDED'
        ? 0
        : s.items.reduce((acc, it) => acc + Math.round(it.cost_cents_snapshot * it.quantity), 0);
    const revenueCents = s.status === 'VOIDED' ? 0 : s.total_cents;
    const profitCents = revenueCents - costCents;
    const methods = s.payments.map((p) => p.method).join(' + ');
    return [
      `#${s.folio}`,
      s.created_at,
      s.user_name || '',
      s.price_tier_name || '',
      s.status,
      centsToNum(s.subtotal_cents),
      centsToNum(s.discount_cents),
      centsToNum(revenueCents),
      centsToNum(costCents),
      centsToNum(profitCents),
      methods,
    ];
  });

  return format === 'csv'
    ? rowsToCsv(headers, rows)
    : sheetToXlsx('Ventas y Utilidades', headers, rows);
}

export function exportImportTemplate(db: DatabaseSync): Buffer {
  const tiers = listPriceTiers(db);
  const tienda = tiers.find((t) => t.is_default) || tiers[0];
  const revendedor = tiers.find((t) => !t.is_default) || tiers[1];

  const headers = [
    'SKU',
    'CodigoBarras',
    'Nombre',
    'Categoria',
    'Unidad',
    'Costo',
    `Precio_${tienda?.name || 'Tienda'}`,
    `Precio_${revendedor?.name || 'Revendedor'}`,
    'Stock',
    'StockMinimo',
  ];

  const sampleRows: Array<Array<string | number>> = [
    ['LIQ-099', '7501000000998', 'Ejemplo Aromatizante 1L', 'Líquidos', 'LITER', 9.5, 19.0, 14.5, 30, 8],
    ['ENV-099', '7502000000995', 'Ejemplo Botella 1L', 'Envases', 'PIECE', 4.0, 8.5, 6.5, 50, 10],
  ];

  return sheetToXlsx('Plantilla Importación', headers, sampleRows);
}

export interface ImportPreviewItem {
  row_number: number;
  action: 'CREATE' | 'UPDATE';
  sku: string;
  barcode: string | null;
  name: string;
  category_name: string;
  unit_type: UnitType;
  cost_cents: number;
  tienda_price_cents: number;
  revendedor_price_cents: number | null;
  stock_quantity: number;
  min_stock_alert: number;
  existing_product_id?: number;
  error?: string;
}

export function parseImportExcel(db: DatabaseSync, fileBuffer: Buffer): ImportPreviewItem[] {
  const wb = XLSX.read(fileBuffer, { type: 'buffer' });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error('El archivo Excel no contiene hojas.');
  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[sheetName], { defval: '' });

  const existingProducts = listProducts(db, { includeInactive: true });
  const bySku = new Map(existingProducts.map((p) => [p.sku.toLowerCase(), p]));

  const getField = (row: Record<string, unknown>, candidates: string[]): unknown => {
    const keys = Object.keys(row);
    for (const c of candidates) {
      const found = keys.find((k) => k.toLowerCase().replace(/[^a-z0-9]/g, '') === c.toLowerCase().replace(/[^a-z0-9]/g, ''));
      if (found !== undefined) return row[found];
    }
    return undefined;
  };

  const toCents = (val: unknown): number => {
    const n = Number(String(val ?? '').replace(/[$,\s]/g, ''));
    return Number.isFinite(n) ? Math.round(n * 100) : 0;
  };

  const toUnit = (val: unknown): UnitType => {
    const s = String(val ?? '').trim().toUpperCase();
    if (s.startsWith('LIT') || s === 'L') return 'LITER';
    if (s.startsWith('KG') || s === 'WEIGHT' || s.startsWith('PES')) return 'WEIGHT';
    return 'PIECE';
  };

  return rawRows.map((row, idx) => {
    const sku = String(getField(row, ['SKU', 'Codigo']) || '').trim();
    const barcodeRaw = String(getField(row, ['CodigoBarras', 'Codigo de Barras', 'Barcode']) || '').trim();
    const name = String(getField(row, ['Nombre', 'Producto']) || '').trim();
    const categoryName = String(getField(row, ['Categoria', 'Categoría']) || 'Líquidos').trim();
    const unit = toUnit(getField(row, ['Unidad', 'UnitType']));
    const costCents = toCents(getField(row, ['Costo', 'Costo ($)']));
    const tiendaCents = toCents(getField(row, ['Precio_Tienda', 'Precio Tienda', 'Precio Tienda ($)']));
    const revRaw = getField(row, ['Precio_Revendedor', 'Precio Revendedor', 'Precio Revendedor ($)']);
    const revCents = revRaw !== undefined && String(revRaw).trim() !== '' ? toCents(revRaw) : null;
    const stock = Number(getField(row, ['Stock', 'Stock Actual']) || 0);
    const minStock = Number(getField(row, ['StockMinimo', 'Stock Mínimo']) || 5);

    const existing = sku ? bySku.get(sku.toLowerCase()) : undefined;
    let error: string | undefined;
    if (!sku) error = 'SKU faltante';
    else if (!name) error = 'Nombre faltante';

    return {
      row_number: idx + 2,
      action: existing ? 'UPDATE' : 'CREATE',
      sku,
      barcode: barcodeRaw || null,
      name,
      category_name: categoryName,
      unit_type: unit,
      cost_cents: costCents,
      tienda_price_cents: tiendaCents,
      revendedor_price_cents: revCents,
      stock_quantity: Number.isFinite(stock) ? stock : 0,
      min_stock_alert: Number.isFinite(minStock) ? minStock : 5,
      existing_product_id: existing?.id,
      error,
    };
  });
}

export function applyImportPreview(
  db: DatabaseSync,
  items: ImportPreviewItem[],
  userId: number
): { created: number; updated: number; skipped: number } {
  const tiers = listPriceTiers(db);
  const tienda = getDefaultPriceTier(db);
  const revendedor = tiers.find((t) => t.id !== tienda.id);

  let categories = listCategories(db, true);
  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const item of items) {
    if (item.error || !item.sku || !item.name) {
      skipped++;
      continue;
    }

    let cat = categories.find((c) => c.name.toLowerCase() === item.category_name.toLowerCase());
    if (!cat) {
      cat = upsertCategory(db, { name: item.category_name, color_hex: '#0EA5E9' });
      categories = listCategories(db, true);
    }

    const prices: Record<number, number | null> = { [tienda.id]: item.tienda_price_cents };
    if (revendedor && item.revendedor_price_cents !== null) {
      prices[revendedor.id] = item.revendedor_price_cents;
    }

    if (item.existing_product_id) {
      saveProduct(
        db,
        {
          id: item.existing_product_id,
          sku: item.sku,
          barcode: item.barcode,
          name: item.name,
          category_id: cat.id,
          unit_type: item.unit_type,
          cost_cents: item.cost_cents,
          min_stock_alert: item.min_stock_alert,
          prices,
        },
        userId
      );
      // Update stock & kardex if changed
      const cur = db.prepare('SELECT stock_quantity, is_bundle FROM products WHERE id = ?').get(item.existing_product_id) as {
        stock_quantity: number;
        is_bundle: number;
      };
      if (cur && !cur.is_bundle && Math.abs(cur.stock_quantity - item.stock_quantity) > 1e-6) {
        const delta = Number((item.stock_quantity - cur.stock_quantity).toFixed(4));
        db.prepare('UPDATE products SET stock_quantity = ? WHERE id = ?').run(
          item.stock_quantity,
          item.existing_product_id
        );
        db.prepare(
          `INSERT INTO inventory_movements (product_id, user_id, type, quantity_delta, stock_before, stock_after, reason)
           VALUES (?, ?, 'ADJUSTMENT', ?, ?, ?, 'Importación masiva desde Excel')`
        ).run(item.existing_product_id, userId, delta, cur.stock_quantity, item.stock_quantity);
      }
      updated++;
    } else {
      saveProduct(
        db,
        {
          sku: item.sku,
          barcode: item.barcode,
          name: item.name,
          category_id: cat.id,
          unit_type: item.unit_type,
          cost_cents: item.cost_cents,
          stock_quantity: item.stock_quantity,
          min_stock_alert: item.min_stock_alert,
          prices,
        },
        userId
      );
      created++;
    }
  }

  return { created, updated, skipped };
}
