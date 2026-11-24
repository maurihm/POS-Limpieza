import React, { useEffect, useState } from 'react';
import { Banknote, CheckCircle2, CreditCard, Landmark, Plus, Trash2 } from 'lucide-react';
import type { PaymentMethod } from '../../types';
import { Modal } from '../../ui/Components';
import { formatCents, pesosToCents } from '../../utils/money';

interface PaymentEntry {
  id: string;
  method: PaymentMethod;
  tendered_cents: number;
}

const METHOD_META: Record<PaymentMethod, { label: string; icon: React.ReactNode }> = {
  CASH: { label: 'Efectivo', icon: <Banknote className="h-4 w-4" /> },
  CARD: { label: 'Tarjeta', icon: <CreditCard className="h-4 w-4" /> },
  TRANSFER: { label: 'Transferencia', icon: <Landmark className="h-4 w-4" /> },
};

const QUICK_BILLS = [2000, 5000, 10000, 20000, 50000];

export const PaymentModal: React.FC<{
  open: boolean;
  totalCents: number;
  tierName: string;
  isReseller: boolean;
  onClose: () => void;
  onConfirm: (
    payments: Array<{ method: PaymentMethod; amount_cents: number; tendered_cents: number }>,
    printTicket: boolean
  ) => Promise<void>;
}> = ({ open, totalCents, tierName, isReseller, onClose, onConfirm }) => {
  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [amountInput, setAmountInput] = useState('');
  const [entries, setEntries] = useState<PaymentEntry[]>([]);
  const [printTicket, setPrintTicket] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setMethod('CASH');
      setAmountInput((totalCents / 100).toFixed(2));
      setEntries([]);
      setPrintTicket(true);
      setSubmitting(false);
    }
  }, [open, totalCents]);

  const paidSoFar = entries.reduce((sum, e) => sum + e.tendered_cents, 0);
  const remaining = Math.max(0, totalCents - paidSoFar);
  const currentInputCents = pesosToCents(amountInput);

  // Effective preview if user confirms directly without clicking "+ Agregar pago"
  const effectiveEntries: PaymentEntry[] =
    entries.length > 0 && remaining === 0
      ? entries
      : currentInputCents > 0
      ? [...entries, { id: 'current', method, tendered_cents: currentInputCents }]
      : entries;

  const effectiveTotalTendered = effectiveEntries.reduce((s, e) => s + e.tendered_cents, 0);
  const effectiveChange = Math.max(0, effectiveTotalTendered - totalCents);
  const canConfirm = effectiveTotalTendered >= totalCents && totalCents >= 0 && !submitting;

  const addPartialPayment = () => {
    if (currentInputCents <= 0) return;
    const nextEntries = [
      ...entries,
      { id: `${Date.now()}_${Math.random()}`, method, tendered_cents: currentInputCents },
    ];
    setEntries(nextEntries);
    const nextPaid = nextEntries.reduce((s, e) => s + e.tendered_cents, 0);
    const nextRem = Math.max(0, totalCents - nextPaid);
    setAmountInput(nextRem > 0 ? (nextRem / 100).toFixed(2) : '');
  };

  const handleConfirm = async () => {
    if (!canConfirm) return;
    setSubmitting(true);
    try {
      // Allocate amount_cents vs tendered_cents accurately for mixed payments
      let rem = totalCents;
      const finalPayments = effectiveEntries.map((e) => {
        const applied = Math.min(rem, e.tendered_cents);
        rem = Math.max(0, rem - applied);
        return {
          method: e.method,
          amount_cents: applied,
          tendered_cents: e.tendered_cents,
        };
      });
      await onConfirm(finalPayments, printTicket);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      title="Cobrar Venta"
      subtitle={`Tarifa aplicada: ${tierName.toUpperCase()}`}
      onClose={onClose}
      maxWidth="max-w-xl"
    >
      <div className="space-y-4">
        <div
          className={`rounded-2xl border p-4 flex items-center justify-between ${
            isReseller ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-slate-50'
          }`}
        >
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Total a Cobrar</p>
            <p className="text-3xl font-extrabold text-slate-900">{formatCents(totalCents)}</p>
          </div>
          <div className="text-right">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              {effectiveChange > 0 ? 'Cambio a entregar' : 'Restante'}
            </p>
            <p
              className={`text-2xl font-extrabold ${
                effectiveChange > 0 ? 'text-green-600' : remaining > 0 ? 'text-amber-600' : 'text-slate-700'
              }`}
            >
              {effectiveChange > 0 ? formatCents(effectiveChange) : formatCents(Math.max(0, totalCents - effectiveTotalTendered))}
            </p>
          </div>
        </div>

        {/* Method Selector */}
        <div className="grid grid-cols-3 gap-2.5">
          {(['CASH', 'CARD', 'TRANSFER'] as PaymentMethod[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                setMethod(m);
                if (m !== 'CASH' && remaining > 0) {
                  setAmountInput((remaining / 100).toFixed(2));
                }
              }}
              className={`flex min-h-[48px] items-center justify-center gap-2 rounded-xl border-2 px-3 text-sm font-bold transition ${
                method === m
                  ? 'border-blue-600 bg-blue-50 text-blue-700'
                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              {METHOD_META[m].icon}
              {METHOD_META[m].label}
            </button>
          ))}
        </div>

        {/* Amount Input + Quick Bills */}
        <div className="space-y-2.5">
          <label className="block text-sm font-semibold text-slate-700">
            Monto recibido ({METHOD_META[method].label})
          </label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-lg font-bold text-slate-400">
                $
              </span>
              <input
                type="number"
                step="0.50"
                min="0"
                autoFocus
                value={amountInput}
                onChange={(e) => setAmountInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && canConfirm) {
                    e.preventDefault();
                    void handleConfirm();
                  }
                }}
                className="w-full rounded-xl border border-slate-300 py-3 pl-9 pr-4 text-xl font-bold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
              />
            </div>
            <button
              type="button"
              onClick={addPartialPayment}
              disabled={currentInputCents <= 0}
              className="inline-flex min-h-[48px] items-center gap-1.5 rounded-xl border border-slate-300 bg-slate-50 px-3.5 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-40"
              title="Agregar pago parcial para pago mixto"
            >
              <Plus className="h-4 w-4" /> Pago mixto
            </button>
          </div>

          {method === 'CASH' && (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setAmountInput((remaining / 100).toFixed(2))}
                className="min-h-[42px] rounded-xl border border-blue-200 bg-blue-50 px-3.5 text-sm font-bold text-blue-700 hover:bg-blue-100"
              >
                Exacto ({formatCents(remaining)})
              </button>
              {QUICK_BILLS.map((bill) => (
                <button
                  key={bill}
                  type="button"
                  onClick={() => setAmountInput((bill / 100).toFixed(2))}
                  className="min-h-[42px] rounded-xl border border-slate-200 bg-white px-3.5 text-sm font-bold text-slate-700 hover:bg-slate-100"
                >
                  {formatCents(bill)}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Added Partial Payments */}
        {entries.length > 0 && (
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-2">
            <p className="text-xs font-bold uppercase text-slate-500">Pagos agregados (Pago Mixto)</p>
            {entries.map((e) => (
              <div key={e.id} className="flex items-center justify-between rounded-lg bg-white px-3 py-2 border border-slate-200">
                <span className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700">
                  {METHOD_META[e.method].icon} {METHOD_META[e.method].label}
                </span>
                <div className="flex items-center gap-3">
                  <span className="font-bold text-slate-900">{formatCents(e.tendered_cents)}</span>
                  <button
                    type="button"
                    onClick={() => setEntries((prev) => prev.filter((x) => x.id !== e.id))}
                    className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-red-600 hover:bg-red-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Quitar
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <label className="flex items-center gap-2.5 text-sm font-medium text-slate-700 cursor-pointer">
          <input
            type="checkbox"
            checked={printTicket}
            onChange={(e) => setPrintTicket(e.target.checked)}
            className="h-5 w-5 rounded border-slate-300 text-green-600 focus:ring-green-500"
          />
          Imprimir ticket térmico automáticamente al confirmar
        </label>

        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 min-h-[52px] rounded-xl border border-slate-300 bg-white font-bold text-slate-700 hover:bg-slate-50"
          >
            Cancelar (Esc)
          </button>
          <button
            type="button"
            disabled={!canConfirm}
            onClick={handleConfirm}
            className="flex-[2] min-h-[52px] inline-flex items-center justify-center gap-2 rounded-xl bg-[#16A34A] text-base font-extrabold text-white shadow-sm hover:bg-green-700 disabled:opacity-40"
          >
            <CheckCircle2 className="h-5 w-5" />
            {submitting ? 'Guardando venta...' : `Confirmar Cobro (${formatCents(totalCents)})`}
          </button>
        </div>
      </div>
    </Modal>
  );
};
