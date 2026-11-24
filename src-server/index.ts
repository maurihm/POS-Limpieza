import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { URL } from 'node:url';
import { initDatabase, getSettings, saveSettings } from './db/database.ts';
import { createDatabaseBackup, listBackups, startDailyBackupScheduler } from './db/backup.ts';
import {
  createUser,
  listAuditLogs,
  listRoles,
  listUsers,
  loginByPin,
  logAudit,
  updateRolePermissions,
  updateUser,
  verifyAdminPin,
} from './services/auth.ts';
import {
  adjustStock,
  bulkUpdateProducts,
  deletePromotion,
  listCategories,
  listInventoryMovements,
  listPriceTiers,
  listProducts,
  listPromotions,
  saveProduct,
  savePromotion,
  upsertCategory,
} from './services/inventory.ts';
import {
  addCashMovement,
  closeCashSession,
  computeCorteSummary,
  getActiveCashSession,
  listCashSessions,
  openCashSession,
} from './services/cash.ts';
import {
  createSale,
  deleteHeldTicket,
  getLastSale,
  getSaleById,
  listHeldTickets,
  listSales,
  refundSale,
  saveHeldTicket,
} from './services/sales.ts';
import {
  buildCorteTicket,
  buildDrawerKickCommand,
  buildSaleTicket,
  buildTestTicket,
} from './hardware/escpos.ts';
import { listSystemPrinters, sendRawEscPos } from './hardware/printer.ts';
import {
  applyImportPreview,
  exportComprehensiveMovementsReport,
  exportFullCatalog,
  exportImportTemplate,
  exportInventoryMovementsReport,
  exportSalesProfitReport,
  exportWhatsAppPriceList,
  parseImportExcel,
} from './exports/excel.ts';
import { generateQrSheetPdf } from './exports/qrPdf.ts';
import { processAndSaveProductImage } from './exports/images.ts';

const PORT = Number(process.env.POS_PORT || 3420);
const { db, dbPath } = initDatabase();
startDailyBackupScheduler(db, dbPath);

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function localTodayIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function sendJson(res: http.ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(JSON.stringify(data));
}

function sendBinary(
  res: http.ServerResponse,
  buffer: Buffer,
  contentType: string,
  filename: string
): void {
  res.writeHead(200, {
    'Content-Type': contentType,
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Content-Length': buffer.length,
    'Access-Control-Allow-Origin': '*',
  });
  res.end(buffer);
}

async function readBody(req: http.IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

async function readJson<T = Record<string, unknown>>(req: http.IncomingMessage): Promise<T> {
  const buf = await readBody(req);
  if (buf.length === 0) return {} as T;
  return JSON.parse(buf.toString('utf8')) as T;
}

function serveStaticFile(res: http.ServerResponse, filePath: string): boolean {
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) return false;
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600',
  });
  fs.createReadStream(filePath).pipe(res);
  return true;
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      });
      res.end();
      return;
    }

    const url = new URL(req.url || '/', `http://127.0.0.1:${PORT}`);
    const pathname = url.pathname;
    const method = req.method || 'GET';

    // Serve uploaded product images
    if (pathname.startsWith('/uploads/')) {
      const safeRel = path.normalize(pathname).replace(/^(\.\.(\/|\\|$))+/, '');
      const fullPath = path.join(process.cwd(), safeRel);
      if (serveStaticFile(res, fullPath)) return;
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    // --- API ROUTES ---
    if (pathname.startsWith('/api/')) {
      // Bootstrap & Health
      if (pathname === '/api/bootstrap' && method === 'GET') {
        return sendJson(res, 200, {
          settings: getSettings(db),
          users: listUsers(db),
          roles: listRoles(db),
          categories: listCategories(db, true),
          price_tiers: listPriceTiers(db),
          products: listProducts(db, { includeInactive: true }),
          promotions: listPromotions(db),
          active_session: getActiveCashSession(db),
          held_tickets: listHeldTickets(db),
        });
      }

      // Auth
      if (pathname === '/api/auth/pin' && method === 'POST') {
        const body = await readJson<{ pin: string }>(req);
        const user = loginByPin(db, body.pin || '');
        if (!user) return sendJson(res, 401, { error: 'PIN incorrecto o usuario inactivo.' });
        return sendJson(res, 200, { user });
      }
      if (pathname === '/api/auth/verify-admin' && method === 'POST') {
        const body = await readJson<{ pin: string }>(req);
        const admin = verifyAdminPin(db, body.pin || '');
        if (!admin) return sendJson(res, 401, { error: 'PIN de Administrador inválido.' });
        return sendJson(res, 200, { admin });
      }
      if (pathname === '/api/users' && method === 'GET') {
        return sendJson(res, 200, { users: listUsers(db), roles: listRoles(db) });
      }
      if (pathname === '/api/users' && method === 'POST') {
        const body = await readJson<{ name: string; pin: string; role_id: number }>(req);
        return sendJson(res, 201, { user: createUser(db, body) });
      }
      if (pathname.startsWith('/api/users/') && method === 'PUT') {
        const id = Number(pathname.split('/').pop());
        const body = await readJson<{ name?: string; pin?: string; role_id?: number; is_active?: boolean }>(req);
        return sendJson(res, 200, { user: updateUser(db, id, body) });
      }
      if (pathname.startsWith('/api/roles/') && method === 'PUT') {
        const id = Number(pathname.split('/').pop());
        const body = await readJson<{ permissions: Record<string, boolean> }>(req);
        return sendJson(res, 200, { role: updateRolePermissions(db, id, body.permissions as never) });
      }
      if (pathname === '/api/audit-logs' && method === 'GET') {
        return sendJson(res, 200, { logs: listAuditLogs(db, 150) });
      }

      // Categories
      if (pathname === '/api/categories' && method === 'GET') {
        return sendJson(res, 200, { categories: listCategories(db, true) });
      }
      if (pathname === '/api/categories' && method === 'POST') {
        const body = await readJson<{ id?: number; name: string; color_hex?: string; sort_order?: number; is_active?: boolean }>(req);
        return sendJson(res, 200, { category: upsertCategory(db, body) });
      }

      // Products
      if (pathname === '/api/products' && method === 'GET') {
        const includeInactive = url.searchParams.get('includeInactive') === '1';
        const search = url.searchParams.get('search') || undefined;
        const categoryId = url.searchParams.get('categoryId') ? Number(url.searchParams.get('categoryId')) : undefined;
        return sendJson(res, 200, { products: listProducts(db, { includeInactive, search, categoryId }) });
      }
      if (pathname === '/api/products' && method === 'POST') {
        const body = await readJson<{ product: Parameters<typeof saveProduct>[1]; user_id?: number }>(req);
        const product = saveProduct(db, body.product, body.user_id || 1);
        return sendJson(res, 200, { product });
      }
      if (pathname === '/api/products/upload-image' && method === 'POST') {
        const body = await readJson<{ data_url: string; sku?: string }>(req);
        const result = await processAndSaveProductImage(body.data_url, body.sku || 'prod');
        return sendJson(res, 200, result);
      }

      // Inventory & Kardex
      if (pathname === '/api/inventory/adjust' && method === 'POST') {
        const body = await readJson<Parameters<typeof adjustStock>[1]>(req);
        const product = adjustStock(db, body);
        return sendJson(res, 200, { product });
      }
      if (pathname === '/api/inventory/bulk' && method === 'POST') {
        const body = await readJson<{ rows: Parameters<typeof bulkUpdateProducts>[1]; user_id: number; reason?: string }>(req);
        const result = bulkUpdateProducts(db, body.rows, body.user_id || 1, body.reason);
        return sendJson(res, 200, result);
      }
      if (pathname === '/api/inventory/kardex' && method === 'GET') {
        const productId = url.searchParams.get('productId') ? Number(url.searchParams.get('productId')) : undefined;
        const limit = url.searchParams.get('limit') ? Number(url.searchParams.get('limit')) : 200;
        return sendJson(res, 200, { movements: listInventoryMovements(db, { productId, limit }) });
      }

      // Promotions
      if (pathname === '/api/promotions' && method === 'GET') {
        return sendJson(res, 200, { promotions: listPromotions(db) });
      }
      if (pathname === '/api/promotions' && method === 'POST') {
        const body = await readJson<Parameters<typeof savePromotion>[1]>(req);
        return sendJson(res, 200, { promotion: savePromotion(db, body) });
      }
      if (pathname.startsWith('/api/promotions/') && method === 'DELETE') {
        const id = Number(pathname.split('/').pop());
        deletePromotion(db, id);
        return sendJson(res, 200, { ok: true });
      }

      // Sales & Printing
      if (pathname === '/api/sales' && method === 'GET') {
        const sales = listSales(db, {
          date_from: url.searchParams.get('date_from') || undefined,
          date_to: url.searchParams.get('date_to') || undefined,
          folio: url.searchParams.get('folio') || undefined,
          method: (url.searchParams.get('method') as never) || '',
          price_tier_id: url.searchParams.get('price_tier_id') ? Number(url.searchParams.get('price_tier_id')) : undefined,
          product_query: url.searchParams.get('product_query') || undefined,
        });
        return sendJson(res, 200, { sales });
      }
      if (pathname === '/api/sales' && method === 'POST') {
        const body = await readJson<Parameters<typeof createSale>[1] & { print_ticket?: boolean }>(req);
        const sale = createSale(db, body);
        const settings = getSettings(db);
        const hasCashPayment = sale.payments.some((p) => p.method === 'CASH');
        const ticket = buildSaleTicket(sale, settings, {
          isReprint: false,
          openDrawer: settings.auto_open_drawer_on_cash && hasCashPayment,
        });
        const printResult =
          body.print_ticket === false
            ? { printed: true, mode: 'SKIPPED', preview_text: ticket.preview, escpos_hex_length: ticket.buffer.length }
            : await sendRawEscPos(ticket.buffer, ticket.preview, settings);
        return sendJson(res, 201, { sale, print_result: printResult });
      }
      if (pathname === '/api/sales/reprint-last' && method === 'POST') {
        const sale = getLastSale(db);
        if (!sale) return sendJson(res, 404, { error: 'Aún no hay ventas registradas.' });
        const settings = getSettings(db);
        const ticket = buildSaleTicket(sale, settings, { isReprint: true, openDrawer: false });
        const printResult = await sendRawEscPos(ticket.buffer, ticket.preview, settings);
        return sendJson(res, 200, { sale, print_result: printResult });
      }
      if (/^\/api\/sales\/\d+\/reprint$/.test(pathname) && method === 'POST') {
        const id = Number(pathname.split('/')[3]);
        const sale = getSaleById(db, id);
        if (!sale) return sendJson(res, 404, { error: 'Venta no encontrada.' });
        const settings = getSettings(db);
        const ticket = buildSaleTicket(sale, settings, { isReprint: true, openDrawer: false });
        const printResult = await sendRawEscPos(ticket.buffer, ticket.preview, settings);
        return sendJson(res, 200, { sale, print_result: printResult });
      }
      if (/^\/api\/sales\/\d+\/refund$/.test(pathname) && method === 'POST') {
        const id = Number(pathname.split('/')[3]);
        const body = await readJson<{
          user_id: number;
          reason: string;
          items?: Array<{ sale_item_id: number; quantity: number }>;
        }>(req);
        const sale = refundSale(db, { sale_id: id, ...body });
        return sendJson(res, 200, { sale });
      }

      // Held tickets
      if (pathname === '/api/held-tickets' && method === 'GET') {
        return sendJson(res, 200, { held_tickets: listHeldTickets(db) });
      }
      if (pathname === '/api/held-tickets' && method === 'POST') {
        const body = await readJson<Parameters<typeof saveHeldTicket>[1]>(req);
        return sendJson(res, 200, { held_ticket: saveHeldTicket(db, body) });
      }
      if (pathname.startsWith('/api/held-tickets/') && method === 'DELETE') {
        const id = decodeURIComponent(pathname.split('/').pop() || '');
        deleteHeldTicket(db, id);
        return sendJson(res, 200, { ok: true });
      }

      // Cash Register (Open, Movements, Corte X, Corte Z)
      if (pathname === '/api/cash/current' && method === 'GET') {
        const active = getActiveCashSession(db);
        return sendJson(res, 200, {
          active_session: active,
          corte_x: active ? computeCorteSummary(db, active.id) : null,
          history: listCashSessions(db, 30),
        });
      }
      if (pathname === '/api/cash/open' && method === 'POST') {
        const body = await readJson<{ user_id: number; opening_cash_cents: number; notes?: string }>(req);
        const session = openCashSession(db, body.user_id, body.opening_cash_cents, body.notes);
        return sendJson(res, 201, { session, corte_x: computeCorteSummary(db, session.id) });
      }
      if (pathname === '/api/cash/movement' && method === 'POST') {
        const body = await readJson<{ cash_session_id: number; user_id: number; type: 'IN' | 'OUT'; amount_cents: number; reason: string }>(req);
        const movement = addCashMovement(db, body);
        return sendJson(res, 201, { movement, corte_x: computeCorteSummary(db, body.cash_session_id) });
      }
      if (pathname === '/api/cash/print-corte-x' && method === 'POST') {
        const summary = computeCorteSummary(db);
        const settings = getSettings(db);
        const ticket = buildCorteTicket(summary, 'X', settings);
        const printResult = await sendRawEscPos(ticket.buffer, ticket.preview, settings);
        return sendJson(res, 200, { summary, print_result: printResult });
      }
      if (pathname === '/api/cash/close-z' && method === 'POST') {
        const body = await readJson<{ user_id: number; declared_cash_cents: number; notes?: string }>(req);
        const { summary, backup_file } = closeCashSession(db, dbPath, body);
        const settings = getSettings(db);
        const ticket = buildCorteTicket(summary, 'Z', settings);
        const printResult = await sendRawEscPos(ticket.buffer, ticket.preview, settings);
        return sendJson(res, 200, { summary, backup_file, print_result: printResult });
      }

      // Printer & Hardware
      if (pathname === '/api/hardware/printers' && method === 'GET') {
        const printers = await listSystemPrinters();
        return sendJson(res, 200, { printers });
      }
      if (pathname === '/api/hardware/test-print' && method === 'POST') {
        const settings = getSettings(db);
        const ticket = buildTestTicket(settings);
        const printResult = await sendRawEscPos(ticket.buffer, ticket.preview, settings);
        return sendJson(res, 200, { print_result: printResult });
      }
      if (pathname === '/api/hardware/open-drawer' && method === 'POST') {
        const body = await readJson<{ user_id: number; reason?: string }>(req);
        const settings = getSettings(db);
        const cmd = buildDrawerKickCommand();
        const printResult = await sendRawEscPos(cmd, '[PULSO APERTURA CAJÓN RJ11: 1B 70 00 19 FA]', settings);
        logAudit(db, body.user_id || 1, 'DRAWER_OPEN_NO_SALE', { reason: body.reason || 'Apertura manual' });
        return sendJson(res, 200, { print_result: printResult });
      }

      // Settings & Backups
      if (pathname === '/api/settings' && method === 'GET') {
        return sendJson(res, 200, { settings: getSettings(db), backups: listBackups(db) });
      }
      if (pathname === '/api/settings' && method === 'PUT') {
        const body = await readJson<Record<string, unknown>>(req);
        return sendJson(res, 200, { settings: saveSettings(db, body) });
      }
      if (pathname === '/api/backups/run' && method === 'POST') {
        const backup = createDatabaseBackup(db, dbPath, 'manual');
        return sendJson(res, 200, { backup, backups: listBackups(db) });
      }

      // Exports (Excel, CSV, QR PDF) & Bulk Import
      if (pathname === '/api/exports/catalog' && method === 'GET') {
        const fmt = url.searchParams.get('format') === 'csv' ? 'csv' : 'xlsx';
        const buf = exportFullCatalog(db, fmt);
        return sendBinary(
          res,
          buf,
          fmt === 'csv'
            ? 'text/csv; charset=utf-8'
            : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          `catalogo_completo.${fmt}`
        );
      }
      if (pathname === '/api/exports/price-list' && method === 'GET') {
        const fmt = url.searchParams.get('format') === 'csv' ? 'csv' : 'xlsx';
        const buf = exportWhatsAppPriceList(db, fmt);
        return sendBinary(
          res,
          buf,
          fmt === 'csv'
            ? 'text/csv; charset=utf-8'
            : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          `lista_precios_whatsapp.${fmt}`
        );
      }
      if (pathname === '/api/exports/sales-profit' && method === 'GET') {
        const fmt = url.searchParams.get('format') === 'csv' ? 'csv' : 'xlsx';
        const today = localTodayIso();
        const from = url.searchParams.get('date_from') || today;
        const to = url.searchParams.get('date_to') || today;
        const buf = exportSalesProfitReport(db, from, to, fmt);
        return sendBinary(
          res,
          buf,
          fmt === 'csv'
            ? 'text/csv; charset=utf-8'
            : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          `reporte_ventas_utilidades_${from}_${to}.${fmt}`
        );
      }
      if (pathname === '/api/exports/movements-report' && method === 'GET') {
        const today = localTodayIso();
        const from = url.searchParams.get('date_from') || today;
        const to = url.searchParams.get('date_to') || today;
        const label = url.searchParams.get('label') || 'Personalizado';
        const buf = exportComprehensiveMovementsReport(db, from, to, label);
        const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '_');
        return sendBinary(
          res,
          buf,
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          `reporte_movimientos_${slug}_${from}_${to}.xlsx`
        );
      }
      if (pathname === '/api/exports/kardex' && method === 'GET') {
        const fmt = url.searchParams.get('format') === 'csv' ? 'csv' : 'xlsx';
        const today = localTodayIso();
        const from = url.searchParams.get('date_from') || today;
        const to = url.searchParams.get('date_to') || today;
        const buf = exportInventoryMovementsReport(db, from, to, fmt);
        return sendBinary(
          res,
          buf,
          fmt === 'csv'
            ? 'text/csv; charset=utf-8'
            : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          `movimientos_inventario_${from}_${to}.${fmt}`
        );
      }
      if (pathname === '/api/exports/import-template' && method === 'GET') {
        const buf = exportImportTemplate(db);
        return sendBinary(
          res,
          buf,
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'plantilla_importacion_productos.xlsx'
        );
      }
      if (pathname === '/api/imports/preview' && method === 'POST') {
        const body = await readJson<{ base64: string }>(req);
        const buf = Buffer.from(body.base64, 'base64');
        const preview = parseImportExcel(db, buf);
        return sendJson(res, 200, { items: preview });
      }
      if (pathname === '/api/imports/apply' && method === 'POST') {
        const body = await readJson<{ items: Parameters<typeof applyImportPreview>[1]; user_id: number }>(req);
        const result = applyImportPreview(db, body.items, body.user_id || 1);
        return sendJson(res, 200, result);
      }
      if (pathname === '/api/exports/qr-pdf' && method === 'GET') {
        const categoryId = url.searchParams.get('categoryId')
          ? Number(url.searchParams.get('categoryId'))
          : undefined;
        const buf = await generateQrSheetPdf(db, { categoryId });
        return sendBinary(res, buf, 'application/pdf', `hoja_escaneo_qr.pdf`);
      }

      return sendJson(res, 404, { error: `Ruta API no encontrada: ${method} ${pathname}` });
    }

    // Serve compiled frontend from dist/ in production
    const distDir = path.resolve(process.cwd(), 'dist');
    const requestedFile = path.join(distDir, pathname === '/' ? 'index.html' : pathname);
    if (serveStaticFile(res, requestedFile)) return;
    if (serveStaticFile(res, path.join(distDir, 'index.html'))) return;

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Frontend aún no compilado. Ejecuta `npm run dev` o `npm run build`.');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[API Error]', message);
    sendJson(res, 400, { error: message });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[POS Limpieza API] Escuchando en http://127.0.0.1:${PORT} (SQLite WAL: ${dbPath})`);
});
