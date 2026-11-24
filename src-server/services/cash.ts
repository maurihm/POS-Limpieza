import type { DatabaseSync } from 'node:sqlite';
import type { CashMovement, CashSession, CorteSummary } from '../../src/types/index.ts';
import { logAudit } from './auth.ts';
import { createDatabaseBackup } from '../db/backup.ts';

export function getActiveCashSession(db: DatabaseSync): CashSession | null {
  const row = db
    .prepare(
      `SELECT cs.*, u1.name as opened_by_name, u2.name as closed_by_name
       FROM cash_sessions cs
       LEFT JOIN users u1 ON u1.id = cs.opened_by_user_id
       LEFT JOIN users u2 ON u2.id = cs.closed_by_user_id
       WHERE cs.status = 'OPEN'
       ORDER BY cs.id DESC
       LIMIT 1`
    )
    .get() as unknown as CashSession | undefined;
  return row || null;
}

export function listCashSessions(db: DatabaseSync, limit = 30): CashSession[] {
  return db
    .prepare(
      `SELECT cs.*, u1.name as opened_by_name, u2.name as closed_by_name
       FROM cash_sessions cs
       LEFT JOIN users u1 ON u1.id = cs.opened_by_user_id
       LEFT JOIN users u2 ON u2.id = cs.closed_by_user_id
       ORDER BY cs.id DESC
       LIMIT ?`
    )
    .all(limit) as unknown as CashSession[];
}

export function openCashSession(
  db: DatabaseSync,
  userId: number,
  openingCashCents: number,
  notes = ''
): CashSession {
  const active = getActiveCashSession(db);
  if (active) {
    throw new Error(`Ya existe una caja abierta (Turno #${active.id}).`);
  }
  const cents = Math.max(0, Math.round(openingCashCents));
  const res = db
    .prepare(
      `INSERT INTO cash_sessions (opened_by_user_id, opening_cash_cents, expected_cash_cents, status, notes)
       VALUES (?, ?, ?, 'OPEN', ?)`
    )
    .run(userId, cents, cents, notes);

  logAudit(db, userId, 'CASH_OPEN', { session_id: Number(res.lastInsertRowid), opening_cash_cents: cents });
  return getActiveCashSession(db)!;
}

export function addCashMovement(
  db: DatabaseSync,
  input: { cash_session_id: number; user_id: number; type: 'IN' | 'OUT'; amount_cents: number; reason: string }
): CashMovement {
  if (!input.reason.trim()) {
    throw new Error('Debes indicar un motivo para el movimiento de efectivo.');
  }
  const amount = Math.round(input.amount_cents);
  if (amount <= 0) {
    throw new Error('El monto debe ser mayor a $0.00.');
  }
  const res = db
    .prepare(
      `INSERT INTO cash_movements (cash_session_id, user_id, type, amount_cents, reason)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(input.cash_session_id, input.user_id, input.type, amount, input.reason.trim());

  logAudit(db, input.user_id, input.type === 'IN' ? 'CASH_IN' : 'CASH_OUT', {
    cash_session_id: input.cash_session_id,
    amount_cents: amount,
    reason: input.reason.trim(),
  });

  return db
    .prepare(
      `SELECT cm.*, u.name as user_name
       FROM cash_movements cm
       LEFT JOIN users u ON u.id = cm.user_id
       WHERE cm.id = ?`
    )
    .get(res.lastInsertRowid) as unknown as CashMovement;
}

export function computeCorteSummary(db: DatabaseSync, sessionId?: number): CorteSummary {
  const session = sessionId
    ? (db
        .prepare(
          `SELECT cs.*, u1.name as opened_by_name, u2.name as closed_by_name
           FROM cash_sessions cs
           LEFT JOIN users u1 ON u1.id = cs.opened_by_user_id
           LEFT JOIN users u2 ON u2.id = cs.closed_by_user_id
           WHERE cs.id = ?`
        )
        .get(sessionId) as unknown as CashSession | undefined)
    : getActiveCashSession(db);

  if (!session) {
    throw new Error('No hay una sesión de caja abierta actualmente.');
  }

  const salesRows = db
    .prepare(
      `SELECT s.*, pt.name as price_tier_name
       FROM sales s
       JOIN price_tiers pt ON pt.id = s.price_tier_id
       WHERE s.cash_session_id = ?`
    )
    .all(session.id) as Array<{
    id: number;
    price_tier_id: number;
    price_tier_name: string;
    subtotal_cents: number;
    discount_cents: number;
    total_cents: number;
    status: string;
  }>;

  let salesCount = 0;
  let voidedCount = 0;
  let totalSalesCents = 0;
  let totalDiscountsCents = 0;
  let totalRefundsCents = 0;

  const tierMap = new Map<number, { tier_id: number; tier_name: string; sales_count: number; total_cents: number }>();

  for (const s of salesRows) {
    if (s.status === 'VOIDED') {
      voidedCount++;
      totalRefundsCents += s.total_cents;
      continue;
    }
    salesCount++;
    totalSalesCents += s.total_cents;
    totalDiscountsCents += s.discount_cents;
    const entry = tierMap.get(s.price_tier_id) || {
      tier_id: s.price_tier_id,
      tier_name: s.price_tier_name,
      sales_count: 0,
      total_cents: 0,
    };
    entry.sales_count += 1;
    entry.total_cents += s.total_cents;
    tierMap.set(s.price_tier_id, entry);
  }

  // Payments from non-voided sales
  const payRows = db
    .prepare(
      `SELECT sp.method, SUM(sp.amount_cents) as total
       FROM sale_payments sp
       JOIN sales s ON s.id = sp.sale_id
       WHERE s.cash_session_id = ? AND s.status != 'VOIDED'
       GROUP BY sp.method`
    )
    .all(session.id) as Array<{ method: 'CASH' | 'CARD' | 'TRANSFER'; total: number }>;

  const byMethod = { CASH: 0, CARD: 0, TRANSFER: 0 };
  for (const r of payRows) {
    byMethod[r.method] = Number(r.total || 0);
  }

  const movements = db
    .prepare(
      `SELECT cm.*, u.name as user_name
       FROM cash_movements cm
       LEFT JOIN users u ON u.id = cm.user_id
       WHERE cm.cash_session_id = ?
       ORDER BY cm.id DESC`
    )
    .all(session.id) as unknown as CashMovement[];

  let cashIn = 0;
  let cashOut = 0;
  for (const m of movements) {
    if (m.type === 'IN') cashIn += m.amount_cents;
    else cashOut += m.amount_cents;
  }

  const expectedCash = session.opening_cash_cents + byMethod.CASH + cashIn - cashOut;

  return {
    session: { ...session, expected_cash_cents: expectedCash },
    sales_count: salesCount,
    voided_count: voidedCount,
    total_sales_cents: totalSalesCents,
    total_discounts_cents: totalDiscountsCents,
    total_refunds_cents: totalRefundsCents,
    by_payment_method: byMethod,
    by_price_tier: Array.from(tierMap.values()),
    cash_in_cents: cashIn,
    cash_out_cents: cashOut,
    expected_cash_cents: expectedCash,
    movements,
  };
}

export function closeCashSession(
  db: DatabaseSync,
  dbPath: string,
  input: { user_id: number; declared_cash_cents: number; notes?: string }
): { summary: CorteSummary; backup_file: string | null } {
  const active = getActiveCashSession(db);
  if (!active) {
    throw new Error('No hay una caja abierta para cerrar.');
  }

  const liveSummary = computeCorteSummary(db, active.id);
  const declared = Math.round(input.declared_cash_cents);
  const expected = liveSummary.expected_cash_cents;
  const diff = declared - expected;

  db.prepare(
    `UPDATE cash_sessions
     SET closed_by_user_id = ?, closed_at = datetime('now', 'localtime'),
         expected_cash_cents = ?, declared_cash_cents = ?, difference_cents = ?,
         status = 'CLOSED', notes = ?
     WHERE id = ?`
  ).run(input.user_id, expected, declared, diff, input.notes || active.notes || '', active.id);

  logAudit(db, input.user_id, 'CASH_CLOSE_Z', {
    session_id: active.id,
    expected_cash_cents: expected,
    declared_cash_cents: declared,
    difference_cents: diff,
  });

  // RF-08.3: Automatic backup upon Corte Z
  let backupFile: string | null = null;
  try {
    const info = createDatabaseBackup(db, dbPath, `corteZ_turno${active.id}`);
    backupFile = info.filename;
  } catch (err) {
    console.error('[Corte Z Backup Error]', err);
  }

  const closedSummary = computeCorteSummary(db, active.id);
  return { summary: closedSummary, backup_file: backupFile };
}
