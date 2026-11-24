import React, { useEffect, useState } from 'react';
import { Banknote, CheckCircle2, Scale } from 'lucide-react';
import type { Product } from '../../types';
import { Modal } from '../../ui/Components';
import { formatCents, pesosToCents, roundHalfUpCents, unitShort } from '../../utils/money';

const LITER_PRESETS = [
  { label: '250 ml', qty: 0.25 },
  { label: '500 ml', qty: 0.5 },
  { label: '1 L', qty: 1 },
  { label: '2 L', qty: 2 },
  { label: 'Galón (3.785 L)', qty: 3.785 },
  { label: '4 L', qty: 4 },
  { label: '10 L', qty: 10 },
  { label: '20 L', qty: 20 },
];

const WEIGHT_PRESETS = [
  { label: '100 g', qty: 0.1 },
  { label: '250 g', qty: 0.25 },
  { label: '500 g', qty: 0.5 },
  { label: '1 kg', qty: 1 },
  { label: '2 kg', qty: 2 },
  { label: '5 kg', qty: 5 },
  { label: '10 kg', qty: 10 },
];

const PESO_PRESETS = [500, 1000, 1500, 2000, 3000, 5000, 10000];

export const BulkSaleModal: React.FC<{
  product: Product | null;
  unitPriceCents: number;
  initialQty?: number;
  onClose: () => void;
  onConfirm: (quantity: number) => void;
}> = ({ product, unitPriceCents, initialQty = 1, onClose, onConfirm }) => {
  const [mode, setMode] = useState<'QTY' | 'AMOUNT'>('QTY');
  const [qtyInput, setQtyInput] = useState('1');
  const [amountInput, setAmountInput] = useState('20.00');

  useEffect(() => {
    if (product) {
      setMode('QTY');
      setQtyInput(String(initialQty));
      setAmountInput((roundHalfUpCents(initialQty * unitPriceCents) / 100).toFixed(2));
    }
  }, [product, initialQty, unitPriceCents]);

  if (!product) return null;

  const uShort = unitShort(product.unit_type);
  const presets = product.unit_type === 'WEIGHT' ? WEIGHT_PRESETS : LITER_PRESETS;

  const computedQty =
    mode === 'QTY'
      ? Math.max(0, Number(qtyInput) || 0)
      : unitPriceCents > 0
      ? Number((pesosToCents(amountInput) / unitPriceCents).toFixed(4))
      : 0;

  const computedTotalCents =
    mode === 'AMOUNT' ? pesosToCents(amountInput) : roundHalfUpCents(computedQty * unitPriceCents);

  const canConfirm = computedQty > 0;

  const submit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!canConfirm) return;
    onConfirm(Number(computedQty.toFixed(4)));
  };

  return (
    <Modal
      open={Boolean(product)}
      title={`Venta a Granel — ${product.name}`}
      subtitle={`Precio vigente: ${formatCents(unitPriceCents)} por ${product.unit_type === 'WEIGHT' ? 'kilogramo' : 'litro'} · Stock: ${product.stock_quantity} ${uShort}`}
      onClose={onClose}
      maxWidth="max-w-lg"
    >
      <form onSubmit={submit} className="space-y-4">
        {/* Mode Switcher: By Quantity vs By Pesos ($) */}
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setMode('QTY')}
            className={`min-h-[48px] inline-flex items-center justify-center gap-2 rounded-xl border-2 text-sm font-extrabold transition ${
              mode === 'QTY'
                ? 'border-sky-600 bg-sky-50 text-sky-800'
                : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
            }`}
          >
            <Scale className="h-4 w-4" /> Por Cantidad ({uShort})
          </button>
          <button
            type="button"
            onClick={() => setMode('AMOUNT')}
            className={`min-h-[48px] inline-flex items-center justify-center gap-2 rounded-xl border-2 text-sm font-extrabold transition ${
              mode === 'AMOUNT'
                ? 'border-emerald-600 bg-emerald-50 text-emerald-800'
                : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
            }`}
          >
            <Banknote className="h-4 w-4" /> Por Pesos ($)
          </button>
        </div>

        {mode === 'QTY' ? (
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-1">
                Cantidad en {product.unit_type === 'WEIGHT' ? 'kilogramos (kg)' : 'litros (L)'}
              </label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                autoFocus
                value={qtyInput}
                onChange={(e) => setQtyInput(e.target.value)}
                className="w-full rounded-xl border border-slate-300 px-4 py-3 text-2xl font-extrabold text-slate-900 focus:border-sky-500 focus:outline-none"
              />
            </div>

            <div className="flex flex-wrap gap-2">
              {presets.map((p) => (
                <button
                  key={p.qty}
                  type="button"
                  onClick={() => setQtyInput(String(p.qty))}
                  className={`min-h-[40px] rounded-xl border px-3 text-xs font-extrabold transition ${
                    Math.abs(Number(qtyInput) - p.qty) < 0.001
                      ? 'border-sky-600 bg-sky-600 text-white'
                      : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-1">
                ¿Cuánto quiere el cliente en pesos ($)?
              </label>
              <div className="relative">
                <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-xl font-bold text-slate-400">
                  $
                </span>
                <input
                  type="number"
                  step="0.50"
                  min="0.50"
                  autoFocus
                  value={amountInput}
                  onChange={(e) => setAmountInput(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 py-3 pl-10 pr-4 text-2xl font-extrabold text-slate-900 focus:border-emerald-500 focus:outline-none"
                />
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {PESO_PRESETS.map((cents) => (
                <button
                  key={cents}
                  type="button"
                  onClick={() => setAmountInput((cents / 100).toFixed(2))}
                  className={`min-h-[40px] rounded-xl border px-3.5 text-xs font-extrabold transition ${
                    pesosToCents(amountInput) === cents
                      ? 'border-emerald-600 bg-emerald-600 text-white'
                      : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  {formatCents(cents)}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Live Conversion Summary */}
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 flex items-center justify-between">
          <div>
            <p className="text-xs font-bold uppercase text-slate-500">Cantidad a despachar</p>
            <p className="text-xl font-extrabold text-sky-700">
              {computedQty.toFixed(computedQty % 1 === 0 ? 0 : 3)} {uShort}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs font-bold uppercase text-slate-500">Importe en Ticket</p>
            <p className="text-2xl font-extrabold text-slate-900">{formatCents(computedTotalCents)}</p>
          </div>
        </div>

        <div className="flex gap-2.5 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 min-h-[48px] rounded-xl border border-slate-300 bg-white text-sm font-bold text-slate-700 hover:bg-slate-50"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={!canConfirm}
            className="flex-[2] min-h-[48px] inline-flex items-center justify-center gap-2 rounded-xl bg-[#16A34A] text-sm font-extrabold text-white hover:bg-green-700 disabled:opacity-40"
          >
            <CheckCircle2 className="h-5 w-5" />
            Agregar al Ticket ({formatCents(computedTotalCents)})
          </button>
        </div>
      </form>
    </Modal>
  );
};
