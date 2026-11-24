import React, { useCallback, useEffect, useState } from 'react';
import {
  Ban,
  Filter,
  Printer,
  RefreshCw,
  RotateCcw,
  Search,
} from 'lucide-react';
import { api } from '../../api/client';
import { useApp } from '../../context/AppContext';
import type { Sale } from '../../types';
import { Modal, PinModal } from '../../ui/Components';
import { formatCents, formatDateTime, todayIsoDate } from '../../utils/money';

export const SalesHistoryScreen: React.FC = () => {
  const { currentUser, priceTiers, notify, setPrintFeedback, refreshAll } = useApp();

  // RF-05.1: Auto-load TODAY's sales ordered most recent first
  const [dateFrom, setDateFrom] = useState(todayIsoDate());
  const [dateTo, setDateTo] = useState(todayIsoDate());
  const [folio, setFolio] = useState('');
  const [method, setMethod] = useState('');
  const [tierId, setTierId] = useState('');
  const [productQuery, setProductQuery] = useState('');

  const [sales, setSales] = useState<Sale[]>([]);
  const [selectedSale, setSelectedSale] = useState<Sale | null>(null);
  const [loading, setLoading] = useState(false);

  // Refund / Void modal
  const [refundTarget, setRefundTarget] = useState<Sale | null>(null);
  const [refundReason, setRefundReason] = useState('');
  const [refundQtyByItem, setRefundQtyByItem] = useState<Record<number, number>>({});
  const [refundFullVoid, setRefundFullVoid] = useState(true);
  const [pendingRefundPin, setPendingRefundPin] = useState(false);

  const loadSales = useCallback(async () => {
    setLoading(true);
    try {
      const { sales: data } = await api.listSales({
        date_from: dateFrom,
        date_to: dateTo,
        folio,
        method,
        price_tier_id: tierId,
        product_query: productQuery,
      });
      setSales(data);
      setSelectedSale((prev) => (prev ? data.find((s) => s.id === prev.id) || data[0] || null : data[0] || null));
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Error cargando historial');
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, folio, method, tierId, productQuery, notify]);

  useEffect(() => {
    void loadSales();
  }, [loadSales]);

  const handleReprint = async (sale: Sale) => {
    try {
      const { print_result } = await api.reprintSale(sale.id);
      setPrintFeedback({
        title: `Reimpresión Ticket #${sale.folio}`,
        result: print_result,
        onRetry: async () => {
          const retry = await api.reprintSale(sale.id);
          setPrintFeedback({ title: `Reimpresión Ticket #${sale.folio}`, result: retry.print_result });
        },
      });
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Error reimprimiendo');
    }
  };

  const openRefundDialog = (sale: Sale) => {
    setRefundTarget(sale);
    setRefundReason('');
    setRefundFullVoid(true);
    const initial: Record<number, number> = {};
    for (const it of sale.items) {
      initial[it.id] = Math.max(0, it.quantity - (it.refunded_quantity || 0));
    }
    setRefundQtyByItem(initial);
  };

  const executeRefund = async (authorizingUserId: number) => {
    if (!refundTarget) return;
    try {
      const items = refundFullVoid
        ? undefined
        : Object.entries(refundQtyByItem)
            .filter(([, q]) => q > 0)
            .map(([id, quantity]) => ({ sale_item_id: Number(id), quantity }));
      await api.refundSale(refundTarget.id, {
        user_id: authorizingUserId,
        reason: refundReason || 'Devolución en mostrador',
        items,
      });
      notify(
        'success',
        refundFullVoid
          ? `Venta #${refundTarget.folio} cancelada e inventario reintegrado.`
          : `Devolución parcial registrada en venta #${refundTarget.folio}.`
      );
      setRefundTarget(null);
      setPendingRefundPin(false);
      await Promise.all([loadSales(), refreshAll()]);
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Error al procesar devolución');
    }
  };

  const submitRefundClick = () => {
    if (!refundReason.trim()) {
      notify('warning', 'Indica el motivo de la cancelación o devolución.');
      return;
    }
    if (currentUser?.permissions.can_void_sale) {
      void executeRefund(currentUser.id);
    } else {
      setPendingRefundPin(true);
    }
  };

  const statusBadge = (status: Sale['status']) => {
    if (status === 'VOIDED') {
      return <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-bold text-red-700">Cancelado</span>;
    }
    if (status === 'PARTIALLY_REFUNDED') {
      return <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-bold text-amber-800">Dev. Parcial</span>;
    }
    return <span className="rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-bold text-green-800">Cobrado</span>;
  };

  return (
    <div className="flex h-full flex-col overflow-hidden p-5 gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold text-slate-900">Historial de Ventas</h1>
          <p className="text-xs text-slate-500">
            Mostrando ventas del periodo seleccionado ordenadas de la más reciente a la más antigua
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadSales()}
          className="inline-flex min-h-[42px] items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 hover:bg-slate-50"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Actualizar
        </button>
      </div>

      {/* Filters */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-2.5 rounded-2xl border border-slate-200 bg-white p-3.5">
        <div>
          <label className="block text-[11px] font-bold text-slate-500 mb-1">Desde</label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="w-full rounded-xl border border-slate-300 px-2.5 py-2 text-sm font-medium"
          />
        </div>
        <div>
          <label className="block text-[11px] font-bold text-slate-500 mb-1">Hasta</label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="w-full rounded-xl border border-slate-300 px-2.5 py-2 text-sm font-medium"
          />
        </div>
        <div>
          <label className="block text-[11px] font-bold text-slate-500 mb-1">Folio</label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
            <input
              type="text"
              placeholder="#000001"
              value={folio}
              onChange={(e) => setFolio(e.target.value)}
              className="w-full rounded-xl border border-slate-300 pl-8 pr-2.5 py-2 text-sm"
            />
          </div>
        </div>
        <div>
          <label className="block text-[11px] font-bold text-slate-500 mb-1">Método de pago</label>
          <select
            value={method}
            onChange={(e) => setMethod(e.target.value)}
            className="w-full rounded-xl border border-slate-300 px-2.5 py-2 text-sm bg-white"
          >
            <option value="">Todos</option>
            <option value="CASH">Efectivo</option>
            <option value="CARD">Tarjeta</option>
            <option value="TRANSFER">Transferencia</option>
          </select>
        </div>
        <div>
          <label className="block text-[11px] font-bold text-slate-500 mb-1">Tarifa</label>
          <select
            value={tierId}
            onChange={(e) => setTierId(e.target.value)}
            className="w-full rounded-xl border border-slate-300 px-2.5 py-2 text-sm bg-white"
          >
            <option value="">Todas</option>
            {priceTiers.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-[11px] font-bold text-slate-500 mb-1">Producto</label>
          <div className="relative">
            <Filter className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
            <input
              type="text"
              placeholder="Ej. Cloro"
              value={productQuery}
              onChange={(e) => setProductQuery(e.target.value)}
              className="w-full rounded-xl border border-slate-300 pl-8 pr-2.5 py-2 text-sm"
            />
          </div>
        </div>
      </div>

      {/* Master-Detail View */}
      <div className="grid flex-1 min-h-0 grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Sales Table */}
        <div className="lg:col-span-7 flex flex-col rounded-2xl border border-slate-200 bg-white overflow-hidden">
          <div className="overflow-y-auto flex-1">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Folio</th>
                  <th className="px-4 py-3">Fecha</th>
                  <th className="px-4 py-3">Tarifa</th>
                  <th className="px-4 py-3">Estado</th>
                  <th className="px-4 py-3 text-right">Total</th>
                  <th className="px-4 py-3 text-right">Acción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sales.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center text-slate-400">
                      No hay ventas registradas para estos filtros.
                    </td>
                  </tr>
                ) : (
                  sales.map((s) => (
                    <tr
                      key={s.id}
                      onClick={() => setSelectedSale(s)}
                      className={`cursor-pointer transition ${
                        selectedSale?.id === s.id ? 'bg-blue-50/70' : 'hover:bg-slate-50'
                      }`}
                    >
                      <td className="px-4 py-3 font-extrabold text-slate-900">#{s.folio}</td>
                      <td className="px-4 py-3 text-slate-600 text-xs">{formatDateTime(s.created_at)}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`rounded-md px-2 py-0.5 text-xs font-bold ${
                            s.price_tier_name?.toLowerCase().includes('revend')
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-blue-100 text-blue-700'
                          }`}
                        >
                          {s.price_tier_name}
                        </span>
                      </td>
                      <td className="px-4 py-3">{statusBadge(s.status)}</td>
                      <td className="px-4 py-3 text-right font-extrabold text-slate-900">
                        {formatCents(s.total_cents)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleReprint(s);
                          }}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-100"
                        >
                          <Printer className="h-3.5 w-3.5" /> Reimprimir
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Ticket Detail */}
        <div className="lg:col-span-5 flex flex-col rounded-2xl border border-slate-200 bg-white overflow-hidden">
          {!selectedSale ? (
            <div className="flex flex-1 items-center justify-center text-sm text-slate-400">
              Selecciona un ticket para ver su detalle
            </div>
          ) : (
            <div className="flex flex-1 flex-col overflow-y-auto p-5 space-y-4">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-lg font-extrabold text-slate-900">Ticket #{selectedSale.folio}</h2>
                  <p className="text-xs text-slate-500">
                    {formatDateTime(selectedSale.created_at)} · Cajero: {selectedSale.user_name} · Tarifa:{' '}
                    <strong>{selectedSale.price_tier_name}</strong>
                  </p>
                </div>
                {statusBadge(selectedSale.status)}
              </div>

              <div className="rounded-xl border border-slate-200 divide-y divide-slate-100">
                {selectedSale.items.map((it) => (
                  <div key={it.id} className="flex items-center justify-between px-3.5 py-2.5 text-sm">
                    <div>
                      <p className="font-bold text-slate-800">{it.product_name_snapshot}</p>
                      <p className="text-xs text-slate-500">
                        {it.quantity} × {formatCents(it.unit_price_cents)}
                        {it.promo_label && ` · ${it.promo_label}`}
                        {(it.refunded_quantity || 0) > 0 && (
                          <span className="ml-1 font-bold text-red-600">
                            (Devueltos: {it.refunded_quantity})
                          </span>
                        )}
                      </p>
                    </div>
                    <span className="font-bold text-slate-900">{formatCents(it.line_total_cents)}</span>
                  </div>
                ))}
              </div>

              <div className="space-y-1 rounded-xl bg-slate-50 p-3.5 text-sm">
                <div className="flex justify-between text-slate-600">
                  <span>Subtotal</span>
                  <span>{formatCents(selectedSale.subtotal_cents)}</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>Descuento</span>
                  <span>-{formatCents(selectedSale.discount_cents)}</span>
                </div>
                <div className="flex justify-between border-t border-slate-200 pt-1.5 text-base font-extrabold text-slate-900">
                  <span>Total</span>
                  <span>{formatCents(selectedSale.total_cents)}</span>
                </div>
                <div className="pt-2 border-t border-slate-200 text-xs text-slate-600 space-y-0.5">
                  {selectedSale.payments.map((p, idx) => (
                    <div key={idx} className="flex justify-between">
                      <span>Pago ({p.method === 'CASH' ? 'Efectivo' : p.method === 'CARD' ? 'Tarjeta' : 'Transferencia'})</span>
                      <span>
                        {formatCents(p.tendered_cents)}
                        {p.change_cents > 0 ? ` (Cambio: ${formatCents(p.change_cents)})` : ''}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex flex-wrap gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => void handleReprint(selectedSale)}
                  className="flex-1 min-h-[48px] inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-bold text-white hover:bg-blue-700"
                >
                  <Printer className="h-4 w-4" /> Reimprimir Ticket
                </button>
                {selectedSale.status !== 'VOIDED' && (
                  <button
                    type="button"
                    onClick={() => openRefundDialog(selectedSale)}
                    className="flex-1 min-h-[48px] inline-flex items-center justify-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 text-sm font-bold text-red-700 hover:bg-red-100"
                  >
                    <RotateCcw className="h-4 w-4" /> Cancelar / Devolver
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Refund / Void Modal */}
      <Modal
        open={Boolean(refundTarget)}
        title={`Devolución / Cancelación #${refundTarget?.folio || ''}`}
        subtitle="Reintegra inventario (incluidos componentes de combos) y ajusta el corte de caja"
        onClose={() => setRefundTarget(null)}
        maxWidth="max-w-lg"
      >
        {refundTarget && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setRefundFullVoid(true)}
                className={`min-h-[44px] rounded-xl border-2 text-sm font-bold ${
                  refundFullVoid
                    ? 'border-red-600 bg-red-50 text-red-700'
                    : 'border-slate-200 text-slate-600'
                }`}
              >
                Cancelación Total
              </button>
              <button
                type="button"
                onClick={() => setRefundFullVoid(false)}
                className={`min-h-[44px] rounded-xl border-2 text-sm font-bold ${
                  !refundFullVoid
                    ? 'border-amber-600 bg-amber-50 text-amber-800'
                    : 'border-slate-200 text-slate-600'
                }`}
              >
                Devolución Parcial
              </button>
            </div>

            {!refundFullVoid && (
              <div className="space-y-2 rounded-xl border border-slate-200 p-3">
                <p className="text-xs font-bold uppercase text-slate-500">Cantidades a devolver</p>
                {refundTarget.items.map((it) => {
                  const maxRem = Math.max(0, it.quantity - (it.refunded_quantity || 0));
                  return (
                    <div key={it.id} className="flex items-center justify-between gap-2 text-sm">
                      <span className="font-medium text-slate-800">
                        {it.product_name_snapshot} (máx. {maxRem})
                      </span>
                      <input
                        type="number"
                        min="0"
                        max={maxRem}
                        step="0.5"
                        value={refundQtyByItem[it.id] ?? 0}
                        onChange={(e) =>
                          setRefundQtyByItem((prev) => ({
                            ...prev,
                            [it.id]: Math.min(maxRem, Math.max(0, Number(e.target.value) || 0)),
                          }))
                        }
                        className="w-24 rounded-lg border border-slate-300 px-2 py-1 text-right font-bold"
                      />
                    </div>
                  );
                })}
              </div>
            )}

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">
                Motivo obligatorio *
              </label>
              <input
                type="text"
                value={refundReason}
                onChange={(e) => setRefundReason(e.target.value)}
                placeholder="Ej. Cliente cambió de opinión / Envase con fuga"
                className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setRefundTarget(null)}
                className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={submitRefundClick}
                className="inline-flex items-center gap-1.5 rounded-xl bg-red-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-red-700"
              >
                <Ban className="h-4 w-4" /> Confirmar Devolución
              </button>
            </div>
          </div>
        )}
      </Modal>

      <PinModal
        open={pendingRefundPin}
        title="Autorización de Administrador"
        subtitle="Solo un Administrador puede autorizar cancelaciones o devoluciones."
        onClose={() => setPendingRefundPin(false)}
        onSubmitPin={async (pin) => {
          const { admin } = await api.verifyAdminPin(pin);
          await executeRefund(admin.id);
        }}
      />
    </div>
  );
};
