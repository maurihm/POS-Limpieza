import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownCircle,
  ArrowUpCircle,
  ClipboardList,
  History,
  Save,
  Table2,
} from 'lucide-react';
import { api } from '../../api/client';
import { useApp } from '../../context/AppContext';
import type { InventoryMovement, Product } from '../../types';
import { Modal } from '../../ui/Components';
import { centsToPesosInput, formatCents, formatDateTime, formatQty, pesosToCents, unitShort } from '../../utils/money';

interface DraftRow {
  stock: string;
  cost: string;
  tienda: string;
  revendedor: string;
  minStock: string;
}

export const InventoryScreen: React.FC = () => {
  const { currentUser, categories, priceTiers, defaultTier, products, refreshAll, notify } = useApp();

  const [tab, setTab] = useState<'stock' | 'bulk' | 'kardex'>('stock');
  const [catFilter, setCatFilter] = useState<number | 'ALL'>('ALL');
  const [onlyAlerts, setOnlyAlerts] = useState(false);

  // Stock movement modal
  const [moveProd, setMoveProd] = useState<Product | null>(null);
  const [moveType, setMoveType] = useState<'PURCHASE' | 'ADJUSTMENT' | 'WASTE'>('PURCHASE');
  const [moveQty, setMoveQty] = useState('');
  const [moveNewCost, setMoveNewCost] = useState('');
  const [moveReason, setMoveReason] = useState('');

  // Bulk spreadsheet edits (RF-02.3 & HU-06)
  const [drafts, setDrafts] = useState<Record<number, DraftRow>>({});
  const [savingBulk, setSavingBulk] = useState(false);

  // Kardex
  const [kardexProductId, setKardexProductId] = useState<number | 'ALL'>('ALL');
  const [kardex, setKardex] = useState<InventoryMovement[]>([]);

  const tiendaTier = defaultTier || priceTiers[0];
  const resellerTier = priceTiers.find((t) => t.id !== tiendaTier?.id);
  const canEdit = Boolean(currentUser?.permissions.can_edit_inventory);
  const canViewCosts = Boolean(currentUser?.permissions.can_view_costs);

  const physicalProducts = useMemo(() => {
    return products.filter((p) => {
      if (!p.is_active || p.is_bundle) return false;
      if (catFilter !== 'ALL' && p.category_id !== catFilter) return false;
      if (onlyAlerts && p.stock_quantity > p.min_stock_alert) return false;
      return true;
    });
  }, [products, catFilter, onlyAlerts]);

  const loadKardex = useCallback(async () => {
    try {
      const { movements } = await api.listKardex(
        kardexProductId === 'ALL' ? undefined : kardexProductId
      );
      setKardex(movements);
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Error cargando Kardex');
    }
  }, [kardexProductId, notify]);

  useEffect(() => {
    if (tab === 'kardex') void loadKardex();
  }, [tab, loadKardex]);

  const getDraft = (p: Product): DraftRow => {
    if (drafts[p.id]) return drafts[p.id];
    return {
      stock: String(p.stock_quantity),
      cost: centsToPesosInput(p.cost_cents),
      tienda: tiendaTier && p.prices[tiendaTier.id] !== undefined ? centsToPesosInput(p.prices[tiendaTier.id]) : '',
      revendedor:
        resellerTier && p.prices[resellerTier.id] !== undefined ? centsToPesosInput(p.prices[resellerTier.id]) : '',
      minStock: String(p.min_stock_alert),
    };
  };

  const updateDraft = (p: Product, field: keyof DraftRow, value: string) => {
    setDrafts((prev) => ({
      ...prev,
      [p.id]: { ...getDraft(p), [field]: value },
    }));
  };

  const handleSaveBulk = async () => {
    const entries = Object.entries(drafts);
    if (entries.length === 0) {
      notify('info', 'No hay cambios pendientes por guardar.');
      return;
    }
    setSavingBulk(true);
    try {
      const payload = entries.map(([pidStr, d]) => {
        const prices: Record<number, number | null> = {};
        if (tiendaTier && d.tienda.trim() !== '') prices[tiendaTier.id] = pesosToCents(d.tienda);
        if (resellerTier) {
          prices[resellerTier.id] = d.revendedor.trim() !== '' ? pesosToCents(d.revendedor) : null;
        }
        return {
          product_id: Number(pidStr),
          stock_quantity: Number(d.stock),
          cost_cents: pesosToCents(d.cost),
          min_stock_alert: Number(d.minStock),
          prices,
        };
      });
      const res = await api.bulkUpdateProducts(payload, currentUser?.id || 1, 'Edición rápida en tabla');
      setDrafts({});
      await refreshAll();
      notify(
        'success',
        `Se actualizaron ${res.updated} productos y se generaron ${res.kardex_entries} movimientos en el Kardex.`
      );
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Error guardando edición masiva');
    } finally {
      setSavingBulk(false);
    }
  };

  const openMovementModal = (p: Product, type: 'PURCHASE' | 'ADJUSTMENT' | 'WASTE') => {
    setMoveProd(p);
    setMoveType(type);
    setMoveQty('');
    setMoveNewCost(centsToPesosInput(p.cost_cents));
    setMoveReason(type === 'PURCHASE' ? 'Ingreso de mercancía / compra' : '');
  };

  const submitMovement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!moveProd || !currentUser) return;
    const qty = Number(moveQty);
    if (!Number.isFinite(qty) || (moveType !== 'ADJUSTMENT' && qty <= 0)) {
      notify('warning', 'Ingresa una cantidad válida.');
      return;
    }
    if (!moveReason.trim()) {
      notify('warning', 'El motivo es obligatorio.');
      return;
    }
    try {
      await api.adjustStock({
        product_id: moveProd.id,
        user_id: currentUser.id,
        type: moveType,
        quantity_delta: moveType === 'ADJUSTMENT' ? undefined : qty,
        new_stock: moveType === 'ADJUSTMENT' ? qty : undefined,
        new_cost_cents: moveType === 'PURCHASE' ? pesosToCents(moveNewCost) : undefined,
        reason: moveReason.trim(),
      });
      setMoveProd(null);
      await refreshAll();
      notify('success', 'Movimiento registrado en inventario y Kardex.');
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Error registrando movimiento');
    }
  };

  const lowCount = products.filter(
    (p) => p.is_active && !p.is_bundle && p.track_inventory && p.stock_quantity <= p.min_stock_alert
  ).length;

  return (
    <div className="flex h-full flex-col overflow-hidden p-5 gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold text-slate-900">Inventario y Kardex</h1>
          <p className="text-xs text-slate-500">
            Control único de existencias, edición rápida tipo hoja de cálculo, compras, mermas y trazabilidad completa
          </p>
        </div>

        {tab === 'bulk' && canEdit && (
          <button
            type="button"
            disabled={Object.keys(drafts).length === 0 || savingBulk}
            onClick={handleSaveBulk}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-[#16A34A] px-5 text-sm font-extrabold text-white shadow-sm hover:bg-green-700 disabled:opacity-40"
          >
            <Save className="h-4 w-4" />
            {savingBulk ? 'Guardando...' : `Guardar todo (${Object.keys(drafts).length} cambios)`}
          </button>
        )}
      </div>

      {/* Sub-tabs */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setTab('stock')}
            className={`inline-flex min-h-[42px] items-center gap-2 rounded-xl px-4 text-sm font-bold ${
              tab === 'stock' ? 'bg-slate-900 text-white' : 'border border-slate-200 bg-white text-slate-700'
            }`}
          >
            <ClipboardList className="h-4 w-4" /> Existencias
            {lowCount > 0 && (
              <span className="rounded-full bg-amber-500 px-2 py-0.5 text-[11px] font-extrabold text-white">
                {lowCount}
              </span>
            )}
          </button>
          {canEdit && (
            <button
              type="button"
              onClick={() => setTab('bulk')}
              className={`inline-flex min-h-[42px] items-center gap-2 rounded-xl px-4 text-sm font-bold ${
                tab === 'bulk' ? 'bg-blue-600 text-white' : 'border border-slate-200 bg-white text-slate-700'
              }`}
            >
              <Table2 className="h-4 w-4" /> Edición Rápida (Tabla)
            </button>
          )}
          <button
            type="button"
            onClick={() => setTab('kardex')}
            className={`inline-flex min-h-[42px] items-center gap-2 rounded-xl px-4 text-sm font-bold ${
              tab === 'kardex' ? 'bg-slate-900 text-white' : 'border border-slate-200 bg-white text-slate-700'
            }`}
          >
            <History className="h-4 w-4" /> Kardex Inmutable
          </button>
        </div>

        {tab !== 'kardex' && (
          <div className="flex items-center gap-2">
            <select
              value={catFilter}
              onChange={(e) => setCatFilter(e.target.value === 'ALL' ? 'ALL' : Number(e.target.value))}
              className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium"
            >
              <option value="ALL">Todas las categorías</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            {tab === 'stock' && (
              <button
                type="button"
                onClick={() => setOnlyAlerts((v) => !v)}
                className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-bold ${
                  onlyAlerts
                    ? 'border-amber-400 bg-amber-100 text-amber-900'
                    : 'border-slate-200 bg-white text-slate-600'
                }`}
              >
                <AlertTriangle className="h-4 w-4" /> Solo alertas ({lowCount})
              </button>
            )}
          </div>
        )}
      </div>

      {/* TAB 1: Existencias & Alertas */}
      {tab === 'stock' && (
        <div className="flex-1 overflow-auto rounded-2xl border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Producto</th>
                <th className="px-4 py-3">Categoría</th>
                <th className="px-4 py-3 text-right">Stock Actual</th>
                <th className="px-4 py-3 text-right">Mínimo</th>
                <th className="px-4 py-3">Estado</th>
                <th className="px-4 py-3 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {physicalProducts.map((p) => {
                const isNeg = p.stock_quantity < 0;
                const isLow = p.stock_quantity <= p.min_stock_alert;
                return (
                  <tr key={p.id} className={isNeg ? 'bg-red-50/50' : 'hover:bg-slate-50'}>
                    <td className="px-4 py-3">
                      <p className="font-bold text-slate-900">{p.name}</p>
                      <p className="text-xs font-mono text-slate-500">{p.sku}</p>
                    </td>
                    <td className="px-4 py-3 text-xs font-semibold text-slate-600">{p.category_name}</td>
                    <td className={`px-4 py-3 text-right font-extrabold text-base ${isNeg ? 'text-red-700' : 'text-slate-900'}`}>
                      {formatQty(p.stock_quantity, p.unit_type)} {unitShort(p.unit_type)}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-500">
                      {p.min_stock_alert} {unitShort(p.unit_type)}
                    </td>
                    <td className="px-4 py-3">
                      {isNeg ? (
                        <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-extrabold text-red-700">
                          Negativo (Regularizar)
                        </span>
                      ) : isLow ? (
                        <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-extrabold text-amber-800">
                          Stock bajo
                        </span>
                      ) : (
                        <span className="rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-bold text-green-800">
                          OK
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex items-center gap-1.5">
                        {canEdit && (
                          <>
                            <button
                              type="button"
                              onClick={() => openMovementModal(p, 'PURCHASE')}
                              className="inline-flex items-center gap-1 rounded-lg bg-emerald-50 border border-emerald-200 px-2.5 py-1.5 text-xs font-bold text-emerald-800 hover:bg-emerald-100"
                            >
                              <ArrowUpCircle className="h-3.5 w-3.5" /> Compra (+)
                            </button>
                            <button
                              type="button"
                              onClick={() => openMovementModal(p, 'WASTE')}
                              className="inline-flex items-center gap-1 rounded-lg bg-red-50 border border-red-200 px-2.5 py-1.5 text-xs font-bold text-red-700 hover:bg-red-100"
                            >
                              <ArrowDownCircle className="h-3.5 w-3.5" /> Merma (-)
                            </button>
                            <button
                              type="button"
                              onClick={() => openMovementModal(p, 'ADJUSTMENT')}
                              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-100"
                            >
                              Ajustar
                            </button>
                          </>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            setKardexProductId(p.id);
                            setTab('kardex');
                          }}
                          className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-bold text-blue-700 hover:bg-blue-50"
                        >
                          Kardex
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* TAB 2: Spreadsheet Bulk Edit (RF-02.3 & HU-06) */}
      {tab === 'bulk' && (
        <div className="flex-1 overflow-auto rounded-2xl border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Producto</th>
                <th className="px-4 py-3">Unidad</th>
                <th className="px-4 py-3 text-right">Stock Actual</th>
                <th className="px-4 py-3 text-right">Stock Mín.</th>
                {canViewCosts && <th className="px-4 py-3 text-right">Costo ($)</th>}
                <th className="px-4 py-3 text-right text-blue-700">Precio Tienda ($)</th>
                <th className="px-4 py-3 text-right text-amber-700">Precio Revendedor ($)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {physicalProducts.map((p) => {
                const d = getDraft(p);
                const dirty = Boolean(drafts[p.id]);
                return (
                  <tr key={p.id} className={dirty ? 'bg-blue-50/50' : ''}>
                    <td className="px-4 py-2 font-bold text-slate-900">
                      {p.name}
                      <span className="ml-2 text-xs font-mono font-normal text-slate-400">{p.sku}</span>
                    </td>
                    <td className="px-4 py-2 text-xs text-slate-500">{unitShort(p.unit_type)}</td>
                    <td className="px-4 py-2 text-right">
                      <input
                        type="number"
                        step="0.5"
                        value={d.stock}
                        onChange={(e) => updateDraft(p, 'stock', e.target.value)}
                        className="w-24 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-right font-bold"
                      />
                    </td>
                    <td className="px-4 py-2 text-right">
                      <input
                        type="number"
                        step="0.5"
                        value={d.minStock}
                        onChange={(e) => updateDraft(p, 'minStock', e.target.value)}
                        className="w-20 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-right"
                      />
                    </td>
                    {canViewCosts && (
                      <td className="px-4 py-2 text-right">
                        <input
                          type="number"
                          step="0.50"
                          value={d.cost}
                          onChange={(e) => updateDraft(p, 'cost', e.target.value)}
                          className="w-24 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-right"
                        />
                      </td>
                    )}
                    <td className="px-4 py-2 text-right">
                      <input
                        type="number"
                        step="0.50"
                        value={d.tienda}
                        onChange={(e) => updateDraft(p, 'tienda', e.target.value)}
                        className="w-24 rounded-lg border border-blue-200 bg-white px-2 py-1.5 text-right font-bold text-blue-800"
                      />
                    </td>
                    <td className="px-4 py-2 text-right">
                      <input
                        type="number"
                        step="0.50"
                        value={d.revendedor}
                        placeholder="Usa Tienda"
                        onChange={(e) => updateDraft(p, 'revendedor', e.target.value)}
                        className="w-24 rounded-lg border border-amber-200 bg-white px-2 py-1.5 text-right font-bold text-amber-800"
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* TAB 3: Kardex */}
      {tab === 'kardex' && (
        <div className="flex flex-1 flex-col gap-3 min-h-0">
          <div className="flex items-center gap-3">
            <select
              value={kardexProductId}
              onChange={(e) =>
                setKardexProductId(e.target.value === 'ALL' ? 'ALL' : Number(e.target.value))
              }
              className="rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-sm font-semibold"
            >
              <option value="ALL">Todos los productos (últimos 200 movimientos)</option>
              {products
                .filter((p) => !p.is_bundle)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.sku})
                  </option>
                ))}
            </select>
          </div>

          <div className="flex-1 overflow-auto rounded-2xl border border-slate-200 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Fecha</th>
                  <th className="px-4 py-3">Producto</th>
                  <th className="px-4 py-3">Tipo</th>
                  <th className="px-4 py-3 text-right">Movimiento</th>
                  <th className="px-4 py-3 text-right">Antes → Después</th>
                  <th className="px-4 py-3">Usuario</th>
                  <th className="px-4 py-3">Motivo / Referencia</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {kardex.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-12 text-center text-slate-400">
                      Sin movimientos registrados aún.
                    </td>
                  </tr>
                ) : (
                  kardex.map((m) => (
                    <tr key={m.id} className="hover:bg-slate-50">
                      <td className="px-4 py-2.5 text-xs text-slate-600">{formatDateTime(m.created_at)}</td>
                      <td className="px-4 py-2.5 font-bold text-slate-900">{m.product_name}</td>
                      <td className="px-4 py-2.5">
                        <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-700">
                          {m.type}
                        </span>
                      </td>
                      <td
                        className={`px-4 py-2.5 text-right font-extrabold ${
                          m.quantity_delta >= 0 ? 'text-emerald-700' : 'text-red-600'
                        }`}
                      >
                        {m.quantity_delta > 0 ? `+${m.quantity_delta}` : m.quantity_delta}
                      </td>
                      <td className="px-4 py-2.5 text-right text-xs font-mono text-slate-600">
                        {m.stock_before} → <strong>{m.stock_after}</strong>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-slate-600">{m.user_name}</td>
                      <td className="px-4 py-2.5 text-xs text-slate-600">{m.reason}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Movement Modal */}
      <Modal
        open={Boolean(moveProd)}
        title={
          moveType === 'PURCHASE'
            ? `Ingreso / Compra — ${moveProd?.name || ''}`
            : moveType === 'WASTE'
            ? `Registrar Merma — ${moveProd?.name || ''}`
            : `Ajuste de Stock — ${moveProd?.name || ''}`
        }
        subtitle={`Stock actual: ${moveProd ? formatQty(moveProd.stock_quantity, moveProd.unit_type) : 0} ${
          moveProd ? unitShort(moveProd.unit_type) : ''
        }`}
        onClose={() => setMoveProd(null)}
        maxWidth="max-w-md"
      >
        <form onSubmit={submitMovement} className="space-y-4">
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">
              {moveType === 'PURCHASE'
                ? 'Cantidad que ingresa (+)'
                : moveType === 'WASTE'
                ? 'Cantidad perdida / merma (-)'
                : 'Nuevo stock físico real exacto'}
            </label>
            <input
              type="number"
              step="0.1"
              required
              autoFocus
              value={moveQty}
              onChange={(e) => setMoveQty(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-lg font-bold"
            />
          </div>

          {moveType === 'PURCHASE' && canViewCosts && (
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">
                Costo unitario de compra ($)
              </label>
              <input
                type="number"
                step="0.01"
                value={moveNewCost}
                onChange={(e) => setMoveNewCost(e.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm font-bold"
              />
            </div>
          )}

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">Motivo obligatorio *</label>
            <input
              type="text"
              required
              value={moveReason}
              onChange={(e) => setMoveReason(e.target.value)}
              placeholder={
                moveType === 'WASTE'
                  ? 'Ej. Derrame de cloro / Envase roto'
                  : 'Ej. Factura proveedor #412 / Conteo físico'
              }
              className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setMoveProd(null)}
              className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-blue-700"
            >
              Confirmar Movimiento
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
