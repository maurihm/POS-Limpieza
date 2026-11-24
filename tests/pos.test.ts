import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as XLSX from 'xlsx';
import { initDatabase, getSettings } from '../src-server/db/database.ts';
import { createDatabaseBackup } from '../src-server/db/backup.ts';
import { loginByPin, verifyAdminPin } from '../src-server/services/auth.ts';
import {
  bulkUpdateProducts,
  listInventoryMovements,
  listPriceTiers,
  listProducts,
  savePromotion,
} from '../src-server/services/inventory.ts';
import { createSale, getSaleById, refundSale } from '../src-server/services/sales.ts';
import { addCashMovement, closeCashSession, computeCorteSummary } from '../src-server/services/cash.ts';
import { roundHalfUpCents } from '../src-server/services/pricing.ts';
import { buildSaleTicket, encodeCodepage } from '../src-server/hardware/escpos.ts';
import {
  applyImportPreview,
  exportFullCatalog,
  exportImportTemplate,
  exportWhatsAppPriceList,
  parseImportExcel,
} from '../src-server/exports/excel.ts';
import { generateQrSheetPdf } from '../src-server/exports/qrPdf.ts';

function freshDb() {
  const tmp = path.join(os.tmpdir(), `pos_test_${Date.now()}_${Math.random().toString(36).slice(2)}.db`);
  const ctx = initDatabase(tmp);
  return { ...ctx, cleanup: () => { ctx.db.close(); for (const suf of ['', '-wal', '-shm']) if (fs.existsSync(tmp + suf)) fs.unlinkSync(tmp + suf); } };
}

test('HU-01: Venta a Revendedor con descuento sobre inventario único', () => {
  const { db, cleanup } = freshDb();
  try {
    const tiers = listPriceTiers(db);
    const revendedor = tiers.find((t) => t.name === 'Revendedor')!;
    const cloro = listProducts(db).find((p) => p.sku === 'LIQ-001')!;
    assert.equal(cloro.stock_quantity, 50);

    const sale = createSale(db, {
      user_id: 2,
      price_tier_id: revendedor.id,
      items: [{ product_id: cloro.id, quantity: 10 }],
      payments: [{ method: 'CASH', amount_cents: 11000, tendered_cents: 20000 }],
    });

    assert.equal(sale.total_cents, 11000); // 10 * $11.00 = $110.00
    assert.equal(sale.price_tier_name, 'Revendedor');
    assert.equal(sale.payments[0].change_cents, 9000);

    const cloroAfter = listProducts(db).find((p) => p.sku === 'LIQ-001')!;
    assert.equal(cloroAfter.stock_quantity, 40);

    const ticket = buildSaleTicket(sale, getSettings(db));
    assert.match(ticket.preview, /Tarifa: REVENDEDOR/);
  } finally {
    cleanup();
  }
});

test('HU-02 & Edge Case #7: Venta de Combo con deducción automática de componentes y devolución desde snapshot', () => {
  const { db, cleanup } = freshDb();
  try {
    const tiers = listPriceTiers(db);
    const tienda = tiers.find((t) => t.is_default)!;
    const allBefore = listProducts(db);
    const combo = allBefore.find((p) => p.sku === 'CMB-001')!;
    const cloroBefore = allBefore.find((p) => p.sku === 'LIQ-001')!.stock_quantity;
    const pinoBefore = allBefore.find((p) => p.sku === 'LIQ-002')!.stock_quantity;
    const envBefore = allBefore.find((p) => p.sku === 'ENV-001')!.stock_quantity;

    const sale = createSale(db, {
      user_id: 2,
      price_tier_id: tienda.id,
      items: [{ product_id: combo.id, quantity: 1 }],
      payments: [{ method: 'CASH', amount_cents: 3500, tendered_cents: 5000 }],
    });

    assert.equal(sale.total_cents, 3500);
    const allAfter = listProducts(db);
    assert.equal(allAfter.find((p) => p.sku === 'LIQ-001')!.stock_quantity, cloroBefore - 1);
    assert.equal(allAfter.find((p) => p.sku === 'LIQ-002')!.stock_quantity, pinoBefore - 1);
    assert.equal(allAfter.find((p) => p.sku === 'ENV-001')!.stock_quantity, envBefore - 2);

    const kardex = listInventoryMovements(db);
    assert.ok(kardex.some((k) => k.type === 'BUNDLE_DEDUCTION'));

    // Edge Case #7: Void combo restores exact component quantities
    refundSale(db, { sale_id: sale.id, user_id: 1, reason: 'Cancelación prueba combo' });
    const allRestored = listProducts(db);
    assert.equal(allRestored.find((p) => p.sku === 'LIQ-001')!.stock_quantity, cloroBefore);
    assert.equal(allRestored.find((p) => p.sku === 'LIQ-002')!.stock_quantity, pinoBefore);
    assert.equal(allRestored.find((p) => p.sku === 'ENV-001')!.stock_quantity, envBefore);
    assert.equal(getSaleById(db, sale.id)!.status, 'VOIDED');
  } finally {
    cleanup();
  }
});

test('HU-03: Promoción 2x1 activa en sábado y automáticamente inactiva en lunes', () => {
  const { db, cleanup } = freshDb();
  try {
    const tienda = listPriceTiers(db).find((t) => t.is_default)!;
    const suavizante = listProducts(db).find((p) => p.sku === 'LIQ-003')!; // $22.00, seeded 2x1 Sat/Sun

    // Saturday 2026-11-28 (getDay() === 6)
    const saturday = new Date('2026-11-28T12:00:00');
    const saleSat = createSale(db, {
      user_id: 2,
      price_tier_id: tienda.id,
      items: [{ product_id: suavizante.id, quantity: 2 }],
      payments: [{ method: 'CASH', amount_cents: 2200, tendered_cents: 2200 }],
      now: saturday,
    });
    assert.equal(saleSat.subtotal_cents, 4400);
    assert.equal(saleSat.discount_cents, 2200);
    assert.equal(saleSat.total_cents, 2200);

    // Monday 2026-11-30 (getDay() === 1)
    const monday = new Date('2026-11-30T12:00:00');
    const saleMon = createSale(db, {
      user_id: 2,
      price_tier_id: tienda.id,
      items: [{ product_id: suavizante.id, quantity: 2 }],
      payments: [{ method: 'CASH', amount_cents: 4400, tendered_cents: 4400 }],
      now: monday,
    });
    assert.equal(saleMon.discount_cents, 0);
    assert.equal(saleMon.total_cents, 4400);
  } finally {
    cleanup();
  }
});

test('Edge Case #5: Redondeo Half-Up en líquidos fraccionados (0.33 L × $15.00 = $4.95)', () => {
  assert.equal(roundHalfUpCents(0.33 * 1500), 495);
  assert.equal(roundHalfUpCents(0.5 * 1500), 750);
  assert.equal(roundHalfUpCents(1.5 * 3), 5);
});

test('HU-05 & RF-06: Corte X en vivo, movimientos de efectivo, Corte Z y respaldo automático', () => {
  const { db, dbPath, cleanup } = freshDb();
  try {
    const tienda = listPriceTiers(db).find((t) => t.is_default)!;
    const cloro = listProducts(db).find((p) => p.sku === 'LIQ-001')!;

    // Mixed payment: $20 Cash + $10 Transfer = $30
    createSale(db, {
      user_id: 2,
      price_tier_id: tienda.id,
      items: [{ product_id: cloro.id, quantity: 2 }],
      payments: [
        { method: 'CASH', amount_cents: 2000, tendered_cents: 2000 },
        { method: 'TRANSFER', amount_cents: 1000, tendered_cents: 1000 },
      ],
    });

    const corteBefore = computeCorteSummary(db);
    assert.equal(corteBefore.total_sales_cents, 3000);
    assert.equal(corteBefore.by_payment_method.CASH, 2000);
    assert.equal(corteBefore.by_payment_method.TRANSFER, 1000);
    assert.equal(corteBefore.expected_cash_cents, 52000); // $500 opening + $20 cash

    addCashMovement(db, {
      cash_session_id: corteBefore.session.id,
      user_id: 1,
      type: 'OUT',
      amount_cents: 5000,
      reason: 'Pago proveedor envases',
    });

    const corteAfter = computeCorteSummary(db);
    assert.equal(corteAfter.expected_cash_cents, 47000);

    const closed = closeCashSession(db, dbPath, { user_id: 1, declared_cash_cents: 47000, notes: 'Cuadrado' });
    assert.equal(closed.summary.session.status, 'CLOSED');
    assert.equal(closed.summary.session.difference_cents, 0);
    assert.ok(closed.backup_file && closed.backup_file.endsWith('.db.gz'));
  } finally {
    cleanup();
  }
});

test('HU-06: Edición Rápida masiva en tabla actualiza stock y genera Kardex', () => {
  const { db, cleanup } = freshDb();
  try {
    const cloro = listProducts(db).find((p) => p.sku === 'LIQ-001')!;
    const res = bulkUpdateProducts(
      db,
      [{ product_id: cloro.id, stock_quantity: 85.5 }],
      1,
      'Conteo mensual líquidos'
    );
    assert.equal(res.updated, 1);
    assert.equal(res.kardex_entries, 1);
    assert.equal(listProducts(db).find((p) => p.id === cloro.id)!.stock_quantity, 85.5);
  } finally {
    cleanup();
  }
});

test('HU-08, RF-07 & ESC/POS CP850: Excel WhatsApp, Importación masiva, PDF QR y bytes ESC/POS', async () => {
  const { db, dbPath, cleanup } = freshDb();
  try {
    // WhatsApp price list Excel has clean headers & NO cost column
    const xlsxBuf = exportWhatsAppPriceList(db, 'xlsx');
    const wb = XLSX.read(xlsxBuf, { type: 'buffer' });
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]]);
    assert.ok(rows.length >= 10);
    assert.ok('Producto' in rows[0]);
    assert.ok('Categoría' in rows[0]);
    assert.ok(!('Costo ($)' in rows[0]));

    // CSV includes UTF-8 BOM
    const csvBuf = exportFullCatalog(db, 'csv');
    assert.equal(csvBuf[0], 0xef);
    assert.equal(csvBuf[1], 0xbb);
    assert.equal(csvBuf[2], 0xbf);

    // Import template roundtrip
    const tpl = exportImportTemplate(db);
    const preview = parseImportExcel(db, tpl);
    assert.equal(preview.length, 2);
    assert.equal(preview[0].action, 'CREATE');
    const applied = applyImportPreview(db, preview, 1);
    assert.equal(applied.created, 2);

    // QR PDF generation
    const pdfBuf = await generateQrSheetPdf(db);
    assert.equal(pdfBuf.subarray(0, 4).toString('ascii'), '%PDF');

    // ESC/POS CP850 encoding for ñ, á, ó, ¡
    const encoded = encodeCodepage('ñáó¡', 'CP850');
    assert.deepEqual(Array.from(encoded), [0xa4, 0xa0, 0xa2, 0xad]);

    // PIN authentication
    assert.equal(loginByPin(db, '1234')?.name, 'Ana');
    assert.equal(verifyAdminPin(db, '1234'), null);
    assert.equal(verifyAdminPin(db, '0000')?.role_name, 'ADMIN');

    // Manual backup
    const bkp = createDatabaseBackup(db, dbPath, 'test');
    assert.ok(fs.existsSync(bkp.filepath));
  } finally {
    cleanup();
  }
});
