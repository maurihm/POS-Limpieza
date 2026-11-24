import type { DatabaseSync } from 'node:sqlite';
import type {
  HeldTicket,
  PaymentMethod,
  Sale,
  SaleItem,
  SalePayment,
} from '../../src/types/index.ts';
import { getSettings } from '../db/database.ts';
import { logAudit } from './auth.ts';
import { getActiveCashSession } from './cash.ts';
import { getDefaultPriceTier, getProductById, listPromotions } from './inventory.ts';
import { evaluateBestLinePromotion, resolveProductPrice, roundHalfUpCents } from './pricing.ts';

export interface CreateSaleItemInput {
  product_id: number;
  quantity: number;
  unit_price_cents?: number;
  price_overridden?: boolean;
  manual_discount_cents?: number;
}

export interface CreateSaleInput {
  user_id: number;
  price_tier_id: number;
  items: CreateSaleItemInput[];
  ticket_discount_cents?: number;
  payments: Array<{
    method: PaymentMethod;
    amount_cents: number;
    tendered_cents: number;
  }>;
  now?: Date; // optional override for deterministic tests
}

function nextFolio(db: DatabaseSync): string {
  const row = db.prepare('SELECT MAX(id) as max_id FROM sales').get() as { max_id: number | null };
  const next = (row.max_id || 0) + 1;
  return String(next).padStart(6, '0');
}

export function createSale(db: DatabaseSync, input: CreateSaleInput): Sale {
  if (!input.items || input.items.length === 0) {
    throw new Error('El carrito está vacío.');
  }
  const session = getActiveCashSession(db);
  if (!session) {
    throw new Error('Debes abrir la caja antes de cobrar.');
  }

  const settings = getSettings(db);
  const defaultTier = getDefaultPriceTier(db);
  const promotions = listPromotions(db);
  const now = input.now || new Date();

  db.exec('BEGIN TRANSACTION');
  try {
    let subtotalCents = 0;
    let totalLineDiscountCents = 0;

    interface PreparedLine {
      product_id: number;
      name: string;
      quantity: number;
      unit_price_cents: number;
      cost_cents: number;
      discount_cents: number;
      promo_label: string | null;
      line_total_cents: number;
      price_overridden: boolean;
      is_bundle: boolean;
      track_inventory: boolean;
      bundle_snapshot: Array<{ component_product_id: number; quantity: number }>;
    }

    const preparedLines: PreparedLine[] = [];

    for (const item of input.items) {
      const prod = getProductById(db, item.product_id);
      if (!prod || !prod.is_active) {
        throw new Error(`Producto #${item.product_id} no encontrado o inactivo.`);
      }
      if (item.quantity <= 0) {
        throw new Error(`Cantidad inválida para ${prod.name}.`);
      }

      // Stock validation if negative stock is disallowed
      if (!settings.allow_negative_stock) {
        if (prod.is_bundle && prod.bundle_items) {
          for (const bi of prod.bundle_items) {
            const comp = db
              .prepare('SELECT name, stock_quantity, track_inventory FROM products WHERE id = ?')
              .get(bi.component_product_id) as { name: string; stock_quantity: number; track_inventory: number };
            if (comp.track_inventory && comp.stock_quantity < bi.quantity * item.quantity) {
              throw new Error(`Stock insuficiente de ${comp.name} para armar el combo ${prod.name}.`);
            }
          }
        } else if (prod.track_inventory && prod.stock_quantity < item.quantity) {
          throw new Error(`Stock insuficiente para ${prod.name} (disponible: ${prod.stock_quantity}).`);
        }
      }

      const resolved = resolveProductPrice(prod, input.price_tier_id, defaultTier.id);
      const unitPrice = item.price_overridden && item.unit_price_cents !== undefined
        ? Math.max(0, Math.round(item.unit_price_cents))
        : resolved.price_cents;

      const grossLine = roundHalfUpCents(item.quantity * unitPrice);
      const promo = item.price_overridden
        ? { discount_cents: 0, promo_label: null }
        : evaluateBestLinePromotion(prod, item.quantity, unitPrice, promotions, now);
      const manualDisc = Math.max(0, Math.round(item.manual_discount_cents || 0));
      const lineDisc = Math.min(grossLine, promo.discount_cents + manualDisc);
      const lineTotal = grossLine - lineDisc;

      subtotalCents += grossLine;
      totalLineDiscountCents += lineDisc;

      preparedLines.push({
        product_id: prod.id,
        name: prod.name,
        quantity: item.quantity,
        unit_price_cents: unitPrice,
        cost_cents: prod.cost_cents,
        discount_cents: lineDisc,
        promo_label: promo.promo_label,
        line_total_cents: lineTotal,
        price_overridden: Boolean(item.price_overridden),
        is_bundle: prod.is_bundle,
        track_inventory: prod.track_inventory,
        bundle_snapshot: (prod.bundle_items || []).map((bi) => ({
          component_product_id: bi.component_product_id,
          quantity: bi.quantity,
        })),
      });
    }

    const ticketDisc = Math.min(
      subtotalCents - totalLineDiscountCents,
      Math.max(0, Math.round(input.ticket_discount_cents || 0))
    );
    const totalDiscountCents = totalLineDiscountCents + ticketDisc;
    const totalCents = Math.max(0, subtotalCents - totalDiscountCents);

    // Validate payments
    const totalPaid = input.payments.reduce((acc, p) => acc + Math.round(p.amount_cents), 0);
    if (totalPaid < totalCents) {
      throw new Error(
        `El pago ($${(totalPaid / 100).toFixed(2)}) es menor al total ($${(totalCents / 100).toFixed(2)}).`
      );
    }

    const folio = nextFolio(db);
    const saleRes = db
      .prepare(
        `INSERT INTO sales (folio, cash_session_id, user_id, price_tier_id, subtotal_cents, discount_cents, total_cents, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'COMPLETED')`
      )
      .run(
        folio,
        session.id,
        input.user_id,
        input.price_tier_id,
        subtotalCents,
        totalDiscountCents,
        totalCents
      );
    const saleId = Number(saleRes.lastInsertRowid);

    const insItem = db.prepare(
      `INSERT INTO sale_items (sale_id, product_id, product_name_snapshot, quantity, unit_price_cents, cost_cents_snapshot, discount_cents, promo_label, line_total_cents, price_overridden, bundle_snapshot_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const getStock = db.prepare('SELECT stock_quantity, track_inventory FROM products WHERE id = ?');
    const updStock = db.prepare('UPDATE products SET stock_quantity = ? WHERE id = ?');
    const insKardex = db.prepare(
      `INSERT INTO inventory_movements (product_id, user_id, type, quantity_delta, stock_before, stock_after, reference_id, reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );

    for (const line of preparedLines) {
      insItem.run(
        saleId,
        line.product_id,
        line.name,
        line.quantity,
        line.unit_price_cents,
        line.cost_cents,
        line.discount_cents,
        line.promo_label,
        line.line_total_cents,
        line.price_overridden ? 1 : 0,
        line.is_bundle ? JSON.stringify(line.bundle_snapshot) : null
      );

      if (line.price_overridden) {
        logAudit(db, input.user_id, 'PRICE_OVERRIDE', {
          sale_id: saleId,
          folio,
          product_id: line.product_id,
          product_name: line.name,
          unit_price_cents: line.unit_price_cents,
        });
      }

      if (line.is_bundle) {
        // RF-03.2 & HU-02: Deduct exact component stock & log BUNDLE_DEDUCTION in Kardex
        for (const comp of line.bundle_snapshot) {
          const row = getStock.get(comp.component_product_id) as
            | { stock_quantity: number; track_inventory: number }
            | undefined;
          if (!row || !row.track_inventory) continue;
          const delta = Number((-comp.quantity * line.quantity).toFixed(4));
          const before = Number(row.stock_quantity);
          const after = Number((before + delta).toFixed(4));
          updStock.run(after, comp.component_product_id);
          insKardex.run(
            comp.component_product_id,
            input.user_id,
            'BUNDLE_DEDUCTION',
            delta,
            before,
            after,
            saleId,
            `Venta Combo #${folio} (${line.name})`
          );
        }
      } else if (line.track_inventory) {
        const row = getStock.get(line.product_id) as { stock_quantity: number };
        const delta = Number((-line.quantity).toFixed(4));
        const before = Number(row.stock_quantity);
        const after = Number((before + delta).toFixed(4));
        updStock.run(after, line.product_id);
        insKardex.run(
          line.product_id,
          input.user_id,
          'SALE',
          delta,
          before,
          after,
          saleId,
          `Venta #${folio}`
        );
      }
    }

    const insPay = db.prepare(
      `INSERT INTO sale_payments (sale_id, method, amount_cents, tendered_cents, change_cents)
       VALUES (?, ?, ?, ?, ?)`
    );
    for (const p of input.payments) {
      const amount = Math.round(p.amount_cents);
      const tendered = Math.round(p.tendered_cents);
      const change = Math.max(0, tendered - amount);
      insPay.run(saleId, p.method, amount, tendered, change);
    }

    db.exec('COMMIT');
    return getSaleById(db, saleId)!;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function getSaleById(db: DatabaseSync, id: number): Sale | null {
  const row = db
    .prepare(
      `SELECT s.*, u.name as user_name, pt.name as price_tier_name
       FROM sales s
       LEFT JOIN users u ON u.id = s.user_id
       LEFT JOIN price_tiers pt ON pt.id = s.price_tier_id
       WHERE s.id = ?`
    )
    .get(id) as unknown as Omit<Sale, 'items' | 'payments'> | undefined;
  if (!row) return null;

  const items = db
    .prepare('SELECT * FROM sale_items WHERE sale_id = ? ORDER BY id ASC')
    .all(id) as Array<Record<string, unknown>>;

  const payments = db
    .prepare('SELECT * FROM sale_payments WHERE sale_id = ? ORDER BY id ASC')
    .all(id) as unknown as SalePayment[];

  return {
    ...row,
    items: items.map((i) => ({
      id: Number(i.id),
      sale_id: Number(i.sale_id),
      product_id: Number(i.product_id),
      product_name_snapshot: String(i.product_name_snapshot),
      quantity: Number(i.quantity),
      refunded_quantity: Number(i.refunded_quantity || 0),
      unit_price_cents: Number(i.unit_price_cents),
      cost_cents_snapshot: Number(i.cost_cents_snapshot),
      discount_cents: Number(i.discount_cents),
      promo_label: i.promo_label ? String(i.promo_label) : null,
      line_total_cents: Number(i.line_total_cents),
      price_overridden: Boolean(i.price_overridden),
    })),
    payments,
  };
}

export function getLastSale(db: DatabaseSync): Sale | null {
  const row = db.prepare('SELECT id FROM sales ORDER BY id DESC LIMIT 1').get() as { id: number } | undefined;
  return row ? getSaleById(db, row.id) : null;
}

export interface SalesFilter {
  date_from?: string;
  date_to?: string;
  folio?: string;
  method?: PaymentMethod | '';
  price_tier_id?: number;
  product_query?: string;
  limit?: number;
}

export function listSales(db: DatabaseSync, filter: SalesFilter = {}): Sale[] {
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (filter.date_from) {
    conditions.push("date(s.created_at) >= date(?)");
    params.push(filter.date_from);
  }
  if (filter.date_to) {
    conditions.push("date(s.created_at) <= date(?)");
    params.push(filter.date_to);
  }
  if (filter.folio && filter.folio.trim()) {
    conditions.push('s.folio LIKE ?');
    params.push(`%${filter.folio.trim().replace(/^#/, '')}%`);
  }
  if (filter.price_tier_id) {
    conditions.push('s.price_tier_id = ?');
    params.push(filter.price_tier_id);
  }
  if (filter.method) {
    conditions.push('EXISTS (SELECT 1 FROM sale_payments sp WHERE sp.sale_id = s.id AND sp.method = ?)');
    params.push(filter.method);
  }
  if (filter.product_query && filter.product_query.trim()) {
    conditions.push(
      'EXISTS (SELECT 1 FROM sale_items si WHERE si.sale_id = s.id AND si.product_name_snapshot LIKE ?)'
    );
    params.push(`%${filter.product_query.trim()}%`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = filter.limit || 200;

  const ids = db
    .prepare(`SELECT s.id FROM sales s ${where} ORDER BY s.id DESC LIMIT ?`)
    .all(...params, limit) as Array<{ id: number }>;

  return ids.map((r) => getSaleById(db, r.id)!).filter(Boolean);
}

/**
 * RF-05.5 & Edge Case #7: Full void or partial refund, restoring regular products OR exact
 * combo component snapshots from `bundle_snapshot_json`, and deducting cash from current cash session.
 */
export function refundSale(
  db: DatabaseSync,
  input: {
    sale_id: number;
    user_id: number;
    reason: string;
    items?: Array<{ sale_item_id: number; quantity: number }>; // omit for full void
  }
): Sale {
  const sale = getSaleById(db, input.sale_id);
  if (!sale) throw new Error('Venta no encontrada.');
  if (sale.status === 'VOIDED') throw new Error('Esta venta ya fue cancelada.');

  const activeSession = getActiveCashSession(db);

  db.exec('BEGIN TRANSACTION');
  try {
    const rawItems = db
      .prepare('SELECT * FROM sale_items WHERE sale_id = ?')
      .all(input.sale_id) as Array<{
      id: number;
      product_id: number;
      product_name_snapshot: string;
      quantity: number;
      refunded_quantity: number;
      unit_price_cents: number;
      discount_cents: number;
      line_total_cents: number;
      bundle_snapshot_json: string | null;
    }>;

    const isFullVoid = !input.items || input.items.length === 0;
    const refundRequests = isFullVoid
      ? rawItems.map((ri) => ({
          sale_item_id: ri.id,
          quantity: Number((ri.quantity - (ri.refunded_quantity || 0)).toFixed(4)),
        }))
      : input.items!;

    let totalRefundCents = 0;

    const getStock = db.prepare('SELECT stock_quantity, track_inventory FROM products WHERE id = ?');
    const updStock = db.prepare('UPDATE products SET stock_quantity = ? WHERE id = ?');
    const insKardex = db.prepare(
      `INSERT INTO inventory_movements (product_id, user_id, type, quantity_delta, stock_before, stock_after, reference_id, reason)
       VALUES (?, ?, 'REFUND', ?, ?, ?, ?, ?)`
    );
    const updItemRefunded = db.prepare('UPDATE sale_items SET refunded_quantity = ? WHERE id = ?');

    for (const req of refundRequests) {
      if (req.quantity <= 0) continue;
      const item = rawItems.find((r) => r.id === req.sale_item_id);
      if (!item) throw new Error(`Línea de venta #${req.sale_item_id} no encontrada.`);

      const remaining = Number((item.quantity - (item.refunded_quantity || 0)).toFixed(4));
      if (req.quantity > remaining + 1e-6) {
        throw new Error(`No puedes devolver más de ${remaining} unidades de ${item.product_name_snapshot}.`);
      }

      const proportion = item.quantity > 0 ? req.quantity / item.quantity : 0;
      const refundAmount = roundHalfUpCents(item.line_total_cents * proportion);
      totalRefundCents += refundAmount;

      updItemRefunded.run(Number(((item.refunded_quantity || 0) + req.quantity).toFixed(4)), item.id);

      // Restore inventory (regular or combo snapshot)
      if (item.bundle_snapshot_json) {
        const snapshot = JSON.parse(item.bundle_snapshot_json) as Array<{
          component_product_id: number;
          quantity: number;
        }>;
        for (const comp of snapshot) {
          const row = getStock.get(comp.component_product_id) as
            | { stock_quantity: number; track_inventory: number }
            | undefined;
          if (!row || !row.track_inventory) continue;
          const delta = Number((comp.quantity * req.quantity).toFixed(4));
          const before = Number(row.stock_quantity);
          const after = Number((before + delta).toFixed(4));
          updStock.run(after, comp.component_product_id);
          insKardex.run(
            comp.component_product_id,
            input.user_id,
            delta,
            before,
            after,
            sale.id,
            `Devolución Combo #${sale.folio}: ${input.reason || 'Cancelación'}`
          );
        }
      } else {
        const row = getStock.get(item.product_id) as
          | { stock_quantity: number; track_inventory: number }
          | undefined;
        if (row && row.track_inventory) {
          const delta = Number(req.quantity.toFixed(4));
          const before = Number(row.stock_quantity);
          const after = Number((before + delta).toFixed(4));
          updStock.run(after, item.product_id);
          insKardex.run(
            item.product_id,
            input.user_id,
            delta,
            before,
            after,
            sale.id,
            `Devolución Venta #${sale.folio}: ${input.reason || 'Cancelación'}`
          );
        }
      }
    }

    // Check if all items are now fully refunded
    const updatedItems = db
      .prepare('SELECT quantity, refunded_quantity FROM sale_items WHERE sale_id = ?')
      .all(input.sale_id) as Array<{ quantity: number; refunded_quantity: number }>;
    const allRefunded = updatedItems.every((i) => i.refunded_quantity >= i.quantity - 1e-6);

    const newStatus = isFullVoid || allRefunded ? 'VOIDED' : 'PARTIALLY_REFUNDED';
    db.prepare('UPDATE sales SET status = ? WHERE id = ?').run(newStatus, input.sale_id);

    // For partial refunds (or void of a sale from a previous session), register cash OUT in active session
    if (activeSession && totalRefundCents > 0) {
      const sameSessionFullVoid = newStatus === 'VOIDED' && sale.cash_session_id === activeSession.id;
      if (!sameSessionFullVoid) {
        // Voiding a sale in the same session already excludes it from Corte X sales;
        // for partial refunds or past-session voids, log cash outflow so Corte X reflects the refund.
        db.prepare(
          `INSERT INTO cash_movements (cash_session_id, user_id, type, amount_cents, reason)
           VALUES (?, ?, 'OUT', ?, ?)`
        ).run(
          activeSession.id,
          input.user_id,
          totalRefundCents,
          `Devolución ticket #${sale.folio} (${input.reason || 'Sin motivo'})`
        );
      }
    }

    logAudit(db, input.user_id, newStatus === 'VOIDED' ? 'SALE_VOID' : 'SALE_PARTIAL_REFUND', {
      sale_id: sale.id,
      folio: sale.folio,
      refund_cents: totalRefundCents,
      reason: input.reason,
    });

    db.exec('COMMIT');
    return getSaleById(db, sale.id)!;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function listHeldTickets(db: DatabaseSync): HeldTicket[] {
  const rows = db.prepare('SELECT payload_json FROM held_tickets ORDER BY created_at DESC').all() as Array<{
    payload_json: string;
  }>;
  return rows.map((r) => JSON.parse(r.payload_json) as HeldTicket);
}

export function saveHeldTicket(db: DatabaseSync, ticket: HeldTicket): HeldTicket {
  db.prepare(
    'INSERT INTO held_tickets (id, payload_json) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET payload_json = excluded.payload_json'
  ).run(ticket.id, JSON.stringify(ticket));
  return ticket;
}

export function deleteHeldTicket(db: DatabaseSync, id: string): void {
  db.prepare('DELETE FROM held_tickets WHERE id = ?').run(id);
}
