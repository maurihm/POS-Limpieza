import React, { useCallback, useEffect, useState } from 'react';
import {
  ArrowDownCircle,
  ArrowUpCircle,
  Calculator,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Lock,
  Printer,
  QrCode,
  Unlock,
  Upload,
} from 'lucide-react';
import { api, triggerDownload, type ImportPreviewItem } from '../../api/client';
import { useApp } from '../../context/AppContext';
import type { CashSession, CorteSummary } from '../../types';
import { Modal } from '../../ui/Components';
import { formatCents, formatDateTime, pesosToCents, todayIsoDate } from '../../utils/money';

const DENOMS = [
  { label: '$1,000', cents: 100000 },
  { label: '$500', cents: 50000 },
  { label: '$200', cents: 20000 },
  { label: '$100', cents: 10000 },
  { label: '$50', cents: 5000 },
  { label: '$20', cents: 2000 },
  { label: '$10', cents: 1000 },
  { label: '$5', cents: 500 },
  { label: '$2', cents: 200 },
  { label: '$1', cents: 100 },
  { label: '$0.50', cents: 50 },
];

export const CashRegisterScreen: React.FC = () => {
  const { currentUser, categories, refreshAll, notify, setPrintFeedback } = useApp();

  const [activeSession, setActiveSession] = useState<CashSession | null>(null);
  const [corteX, setCorteX] = useState<CorteSummary | null>(null);
  const [history, setHistory] = useState<CashSession[]>([]);

  // Open Cash
  const [openingCash, setOpeningCash] = useState('500.00');
  const [openingNotes, setOpeningNotes] = useState('');

  // Cash IN/OUT modal
  const [movModal, setMovModal] = useState<'IN' | 'OUT' | null>(null);
  const [movAmount, setMovAmount] = useState('');
  const [movReason, setMovReason] = useState('');

  // Corte Z guided count modal
  const [showCorteZModal, setShowCorteZModal] = useState(false);
  const [denomCounts, setDenomCounts] = useState<Record<number, number>>({});
  const [directDeclared, setDirectDeclared] = useState('');
  const [useDenominations, setUseDenominations] = useState(true);
  const [closeNotes, setCloseNotes] = useState('');

  // Exports & QR PDF
  const [reportFrom, setReportFrom] = useState(todayIsoDate());
  const [reportTo, setReportTo] = useState(todayIsoDate());
  const [periodLabel, setPeriodLabel] = useState('Diario (Hoy)');
  const [qrCatId, setQrCatId] = useState<string>('');

  const applyPeriodPreset = (preset: 'today' | 'week' | 'last7' | 'month' | 'lastMonth' | 'year') => {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const toIso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const today = toIso(now);

    if (preset === 'today') {
      setReportFrom(today);
      setReportTo(today);
      setPeriodLabel('Diario (Hoy)');
    } else if (preset === 'week') {
      const day = now.getDay();
      const diffToMonday = day === 0 ? 6 : day - 1;
      const mon = new Date(now);
      mon.setDate(now.getDate() - diffToMonday);
      setReportFrom(toIso(mon));
      setReportTo(today);
      setPeriodLabel('Semanal (Esta semana)');
    } else if (preset === 'last7') {
      const start = new Date(now);
      start.setDate(now.getDate() - 6);
      setReportFrom(toIso(start));
      setReportTo(today);
      setPeriodLabel('Últimos 7 días');
    } else if (preset === 'month') {
      const first = new Date(now.getFullYear(), now.getMonth(), 1);
      setReportFrom(toIso(first));
      setReportTo(today);
      setPeriodLabel('Mensual (Este mes)');
    } else if (preset === 'lastMonth') {
      const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const last = new Date(now.getFullYear(), now.getMonth(), 0);
      setReportFrom(toIso(first));
      setReportTo(toIso(last));
      setPeriodLabel('Mes pasado');
    } else if (preset === 'year') {
      const first = new Date(now.getFullYear(), 0, 1);
      setReportFrom(toIso(first));
      setReportTo(today);
      setPeriodLabel(`Anual (${now.getFullYear()})`);
    }
  };

  // Bulk Excel Import
  const [importPreview, setImportPreview] = useState<ImportPreviewItem[] | null>(null);
  const [importing, setImporting] = useState(false);

  const loadCash = useCallback(async () => {
    try {
      const data = await api.getCashCurrent();
      setActiveSession(data.active_session);
      setCorteX(data.corte_x);
      setHistory(data.history);
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Error cargando estado de caja');
    }
  }, [notify]);

  useEffect(() => {
    void loadCash();
  }, [loadCash]);

  const handleOpenCash = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) return;
    try {
      await api.openCash({
        user_id: currentUser.id,
        opening_cash_cents: pesosToCents(openingCash),
        notes: openingNotes,
      });
      await Promise.all([loadCash(), refreshAll()]);
      notify('success', 'Caja abierta correctamente.');
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Error abriendo caja');
    }
  };

  const handleCashMovement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeSession || !currentUser || !movModal) return;
    try {
      await api.addCashMovement({
        cash_session_id: activeSession.id,
        user_id: currentUser.id,
        type: movModal,
        amount_cents: pesosToCents(movAmount),
        reason: movReason,
      });
      setMovModal(null);
      setMovAmount('');
      setMovReason('');
      await loadCash();
      notify('success', movModal === 'IN' ? 'Entrada de efectivo registrada.' : 'Salida de efectivo registrada.');
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Error registrando movimiento');
    }
  };

  const handlePrintCorteX = async () => {
    try {
      const { print_result } = await api.printCorteX();
      setPrintFeedback({
        title: 'Corte X — Consulta en Vivo (Turno Abierto)',
        result: print_result,
      });
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Error imprimiendo Corte X');
    }
  };

  const denomTotalCents = DENOMS.reduce((sum, d) => sum + d.cents * (denomCounts[d.cents] || 0), 0);
  const declaredCashCents = useDenominations ? denomTotalCents : pesosToCents(directDeclared);
  const diffCents = corteX ? declaredCashCents - corteX.expected_cash_cents : 0;

  const handleCloseCorteZ = async () => {
    if (!currentUser) return;
    try {
      const res = await api.closeCorteZ({
        user_id: currentUser.id,
        declared_cash_cents: declaredCashCents,
        notes: closeNotes,
      });
      setShowCorteZModal(false);
      await Promise.all([loadCash(), refreshAll()]);
      notify(
        'success',
        `Corte Z completado.${res.backup_file ? ` Respaldo automático creado: ${res.backup_file}` : ''}`
      );
      setPrintFeedback({
        title: `Corte Z — Cierre de Turno #${res.summary.session.id}`,
        result: res.print_result,
      });
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Error cerrando Corte Z');
    }
  };

  const handleExcelFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const str = String(reader.result);
          resolve(str.includes(',') ? str.split(',')[1] : str);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const { items } = await api.previewImportExcel(base64);
      setImportPreview(items);
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Error leyendo archivo Excel');
    } finally {
      e.target.value = '';
    }
  };

  const handleConfirmImport = async () => {
    if (!importPreview || !currentUser) return;
    setImporting(true);
    try {
      const res = await api.applyImportExcel(importPreview, currentUser.id);
      setImportPreview(null);
      await refreshAll();
      notify(
        'success',
        `Importación aplicada: ${res.created} creados, ${res.updated} actualizados, ${res.skipped} omitidos.`
      );
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Error aplicando importación');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto p-5 space-y-5">
      <div>
        <h1 className="text-xl font-extrabold text-slate-900">Caja, Reportes Excel y Hojas QR</h1>
        <p className="text-xs text-slate-500">
          Control de efectivo en vivo (Corte X), Cierre de Caja (Corte Z), exportación limpia a Excel y hojas de escaneo QR en PDF
        </p>
      </div>

      {/* SECTION 1: CASH REGISTER (OPEN OR CORTE X / Z) */}
      {!activeSession || !corteX ? (
        <form
          onSubmit={handleOpenCash}
          className="max-w-lg rounded-2xl border border-slate-200 bg-white p-6 space-y-4 shadow-xs"
        >
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-green-50 text-green-600">
              <Unlock className="h-6 w-6" />
            </div>
            <div>
              <h2 className="text-lg font-extrabold text-slate-900">Apertura de Caja</h2>
              <p className="text-xs text-slate-500">Ingresa el fondo inicial en efectivo para iniciar el turno</p>
            </div>
          </div>

          <div>
            <label className="block text-sm font-bold text-slate-700 mb-1">Fondo inicial en efectivo ($)</label>
            <input
              type="number"
              step="0.50"
              min="0"
              required
              value={openingCash}
              onChange={(e) => setOpeningCash(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-2xl font-extrabold text-slate-900"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">Notas (opcional)</label>
            <input
              type="text"
              value={openingNotes}
              onChange={(e) => setOpeningNotes(e.target.value)}
              placeholder="Ej. Turno matutino con morralla"
              className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm"
            />
          </div>

          <button
            type="submit"
            className="w-full min-h-[50px] rounded-xl bg-[#16A34A] text-base font-extrabold text-white hover:bg-green-700"
          >
            Abrir Caja e Iniciar Turno
          </button>
        </form>
      ) : (
        <div className="space-y-4">
          {/* Live Corte X Header */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-green-200 bg-white p-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="h-3 w-3 rounded-full bg-green-500" />
                <h2 className="text-lg font-extrabold text-slate-900">
                  Resumen en Vivo — Corte X (Turno #{corteX.session.id})
                </h2>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Abierto por <strong>{corteX.session.opened_by_name}</strong> el {formatDateTime(corteX.session.opened_at)}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {currentUser?.permissions.can_cash_movement && (
                <>
                  <button
                    type="button"
                    onClick={() => setMovModal('IN')}
                    className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 text-xs font-bold text-emerald-800 hover:bg-emerald-100"
                  >
                    <ArrowUpCircle className="h-4 w-4" /> Entrada Efectivo
                  </button>
                  <button
                    type="button"
                    onClick={() => setMovModal('OUT')}
                    className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-3.5 text-xs font-bold text-amber-900 hover:bg-amber-100"
                  >
                    <ArrowDownCircle className="h-4 w-4" /> Salida Efectivo
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={handlePrintCorteX}
                className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl bg-blue-600 px-4 text-xs font-bold text-white hover:bg-blue-700"
              >
                <Printer className="h-4 w-4" /> Imprimir Corte X (Sin cerrar)
              </button>
              {currentUser?.permissions.can_close_corte_z && (
                <button
                  type="button"
                  onClick={() => {
                    setDenomCounts({});
                    setDirectDeclared((corteX.expected_cash_cents / 100).toFixed(2));
                    setCloseNotes('');
                    setShowCorteZModal(true);
                  }}
                  className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl bg-slate-900 px-4 text-xs font-bold text-white hover:bg-slate-800"
                >
                  <Lock className="h-4 w-4" /> Cerrar Caja (Corte Z)
                </button>
              )}
            </div>
          </div>

          {/* KPI Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <p className="text-xs font-bold uppercase text-slate-500">Total Vendido Hoy</p>
              <p className="mt-1 text-2xl font-extrabold text-slate-900">{formatCents(corteX.total_sales_cents)}</p>
              <p className="text-xs text-slate-500 mt-1">
                {corteX.sales_count} tickets cobrados · {corteX.voided_count} cancelados
              </p>
            </div>
            <div className="rounded-2xl border border-green-200 bg-green-50/50 p-4">
              <p className="text-xs font-bold uppercase text-green-800">Efectivo Esperado en Caja</p>
              <p className="mt-1 text-2xl font-extrabold text-green-700">{formatCents(corteX.expected_cash_cents)}</p>
              <p className="text-xs text-green-700 mt-1">
                Fondo {formatCents(corteX.session.opening_cash_cents)} + Ventas {formatCents(corteX.by_payment_method.CASH)}
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <p className="text-xs font-bold uppercase text-slate-500">Por Método de Pago</p>
              <div className="mt-1.5 space-y-0.5 text-xs">
                <div className="flex justify-between"><span>Efectivo:</span><strong>{formatCents(corteX.by_payment_method.CASH)}</strong></div>
                <div className="flex justify-between"><span>Tarjeta:</span><strong>{formatCents(corteX.by_payment_method.CARD)}</strong></div>
                <div className="flex justify-between"><span>Transferencia:</span><strong>{formatCents(corteX.by_payment_method.TRANSFER)}</strong></div>
              </div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <p className="text-xs font-bold uppercase text-slate-500">Desglose por Tarifa</p>
              <div className="mt-1.5 space-y-1 text-xs">
                {corteX.by_price_tier.length === 0 ? (
                  <p className="text-slate-400">Sin ventas aún</p>
                ) : (
                  corteX.by_price_tier.map((t) => (
                    <div key={t.tier_id} className="flex justify-between">
                      <span>{t.tier_name} ({t.sales_count}):</span>
                      <strong>{formatCents(t.total_cents)}</strong>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Cash Movements List */}
          {corteX.movements.length > 0 && (
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <h3 className="text-sm font-extrabold text-slate-800 mb-2">
                Movimientos de Efectivo del Turno (+{formatCents(corteX.cash_in_cents)} / -{formatCents(corteX.cash_out_cents)})
              </h3>
              <div className="divide-y divide-slate-100 text-sm">
                {corteX.movements.map((m) => (
                  <div key={m.id} className="flex items-center justify-between py-2">
                    <div>
                      <span
                        className={`mr-2 rounded px-1.5 py-0.5 text-[11px] font-extrabold ${
                          m.type === 'IN' ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-700'
                        }`}
                      >
                        {m.type === 'IN' ? 'ENTRADA' : 'SALIDA'}
                      </span>
                      <span className="font-semibold text-slate-800">{m.reason}</span>
                      <span className="ml-2 text-xs text-slate-400">
                        ({m.user_name} · {formatDateTime(m.created_at)})
                      </span>
                    </div>
                    <span className={`font-extrabold ${m.type === 'IN' ? 'text-emerald-700' : 'text-red-600'}`}>
                      {m.type === 'IN' ? '+' : '-'}
                      {formatCents(m.amount_cents)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* SECTION 2: REPORTES EXCEL POR PERIODO (DIARIO / SEMANAL / MENSUAL / ANUAL) */}
      <div className="rounded-2xl border border-emerald-200 bg-white p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-emerald-700">
              <FileSpreadsheet className="h-5 w-5" />
              <h3 className="text-base font-extrabold text-slate-900">
                Reportes Excel de Movimientos y Ventas (Diario, Semanal, Mensual, Anual)
              </h3>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Elige el periodo con un clic y descarga un libro Excel completo con 5 hojas: <strong>Resumen, Ventas, Productos Vendidos, Movimientos Inventario (Kardex) y Movimientos de Caja</strong>.
            </p>
          </div>
          <span className="rounded-full bg-emerald-50 border border-emerald-200 px-3 py-1 text-xs font-extrabold text-emerald-800">
            Periodo: {periodLabel} ({reportFrom} → {reportTo})
          </span>
        </div>

        {/* Period Quick Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          {[
            { id: 'today', label: 'Hoy (Diario)' },
            { id: 'week', label: 'Esta Semana' },
            { id: 'last7', label: 'Últimos 7 días' },
            { id: 'month', label: 'Este Mes (Mensual)' },
            { id: 'lastMonth', label: 'Mes Pasado' },
            { id: 'year', label: 'Este Año' },
          ].map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => applyPeriodPreset(p.id as 'today' | 'week' | 'last7' | 'month' | 'lastMonth' | 'year')}
              className={`min-h-[38px] rounded-xl border px-3.5 text-xs font-extrabold transition ${
                periodLabel.toLowerCase().includes(p.label.split(' ')[0].toLowerCase())
                  ? 'border-emerald-600 bg-emerald-600 text-white'
                  : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
              }`}
            >
              {p.label}
            </button>
          ))}
          <div className="flex items-center gap-1.5 ml-auto">
            <input
              type="date"
              value={reportFrom}
              onChange={(e) => {
                setReportFrom(e.target.value);
                setPeriodLabel('Personalizado');
              }}
              className="rounded-xl border border-slate-300 px-2.5 py-1.5 text-xs font-semibold"
            />
            <span className="text-xs text-slate-400">a</span>
            <input
              type="date"
              value={reportTo}
              onChange={(e) => {
                setReportTo(e.target.value);
                setPeriodLabel('Personalizado');
              }}
              className="rounded-xl border border-slate-300 px-2.5 py-1.5 text-xs font-semibold"
            />
          </div>
        </div>

        {/* Download Actions for Selected Period */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 pt-1">
          <button
            type="button"
            onClick={() =>
              triggerDownload(
                `/api/exports/movements-report?date_from=${reportFrom}&date_to=${reportTo}&label=${encodeURIComponent(periodLabel)}`
              )
            }
            className="min-h-[48px] inline-flex items-center justify-center gap-2 rounded-xl bg-[#16A34A] px-4 text-sm font-extrabold text-white shadow-xs hover:bg-green-700"
          >
            <Download className="h-4 w-4" /> Excel Completo 5 Hojas (.xlsx)
          </button>
          <button
            type="button"
            onClick={() =>
              triggerDownload(`/api/exports/kardex?format=xlsx&date_from=${reportFrom}&date_to=${reportTo}`)
            }
            className="min-h-[48px] inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-bold text-slate-800 hover:bg-slate-50"
          >
            <Download className="h-4 w-4 text-blue-600" /> Movimientos Inventario / Kardex (.xlsx)
          </button>
          <button
            type="button"
            onClick={() =>
              triggerDownload(`/api/exports/sales-profit?format=xlsx&date_from=${reportFrom}&date_to=${reportTo}`)
            }
            className="min-h-[48px] inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-bold text-slate-800 hover:bg-slate-50"
          >
            <Download className="h-4 w-4 text-emerald-600" /> Solo Ventas y Utilidades (.xlsx)
          </button>
        </div>
      </div>

      {/* SECTION 3: CATÁLOGO EXCEL, IMPORTACIÓN MASIVA & HOJAS QR PDF (RF-07) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Catalog & WhatsApp Exports */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3">
          <div className="flex items-center gap-2 text-emerald-700">
            <FileSpreadsheet className="h-5 w-5" />
            <h3 className="font-extrabold text-slate-900">Catálogo y Lista de Precios</h3>
          </div>
          <p className="text-xs text-slate-500">
            Columnas limpias con acentos UTF-8 listos para abrir en Microsoft Excel o compartir por WhatsApp.
          </p>

          <div className="space-y-2 pt-1">
            <button
              type="button"
              onClick={() => triggerDownload('/api/exports/price-list?format=xlsx')}
              className="w-full min-h-[44px] inline-flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 text-sm font-bold text-emerald-900 hover:bg-emerald-100"
            >
              <span>Lista de Precios WhatsApp (.xlsx)</span>
              <Download className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => triggerDownload('/api/exports/catalog?format=xlsx')}
              className="w-full min-h-[44px] inline-flex items-center justify-between rounded-xl border border-slate-200 bg-white px-3.5 text-sm font-bold text-slate-700 hover:bg-slate-50"
            >
              <span>Catálogo Completo con Costos (.xlsx)</span>
              <Download className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => triggerDownload('/api/exports/catalog?format=csv')}
              className="w-full min-h-[40px] inline-flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3.5 text-xs font-bold text-slate-600 hover:bg-slate-100"
            >
              <span>Catálogo en CSV (UTF-8 BOM)</span>
              <Download className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Bulk Excel Import (RF-07.2) */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3">
          <div className="flex items-center gap-2 text-blue-700">
            <Upload className="h-5 w-5" />
            <h3 className="font-extrabold text-slate-900">Importación Masiva desde Excel</h3>
          </div>
          <p className="text-xs text-slate-500">
            Descarga la plantilla, llena o actualiza precios y existencias, y revisa la vista previa antes de aplicar cambios.
          </p>

          <button
            type="button"
            onClick={() => triggerDownload('/api/exports/import-template')}
            className="w-full min-h-[44px] inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3.5 text-sm font-bold text-slate-700 hover:bg-slate-100"
          >
            <Download className="h-4 w-4" /> 1. Descargar Plantilla (.xlsx)
          </button>

          <label className="flex min-h-[48px] w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-bold text-white hover:bg-blue-700">
            <Upload className="h-4 w-4" /> 2. Subir Excel y Previsualizar
            <input type="file" accept=".xlsx,.xls,.csv" onChange={handleExcelFileSelect} className="hidden" />
          </label>
        </div>

        {/* QR Scan Sheet PDF Generator (RF-07.3) */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3">
          <div className="flex items-center gap-2 text-purple-700">
            <QrCode className="h-5 w-5" />
            <h3 className="font-extrabold text-slate-900">Hojas de Escaneo QR (PDF Carta)</h3>
          </div>
          <p className="text-xs text-slate-500">
            Genera cuadrículas imprimibles con foto, nombre, precio y código QR para productos sin etiqueta (líquidos a granel).
          </p>

          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1">Categoría a imprimir</label>
            <select
              value={qrCatId}
              onChange={(e) => setQrCatId(e.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-semibold"
            >
              <option value="">Todos los productos</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            onClick={() =>
              triggerDownload(`/api/exports/qr-pdf${qrCatId ? `?categoryId=${qrCatId}` : ''}`)
            }
            className="w-full min-h-[48px] inline-flex items-center justify-center gap-2 rounded-xl bg-purple-600 px-4 text-sm font-bold text-white hover:bg-purple-700"
          >
            <QrCode className="h-4 w-4" /> Generar PDF de Códigos QR
          </button>
        </div>
      </div>

      {/* SECTION 3: CLOSED SESSIONS HISTORY */}
      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
        <div className="border-b border-slate-200 px-4 py-3 bg-slate-50">
          <h3 className="text-sm font-extrabold text-slate-800">Historial Reciente de Turnos / Cortes Z</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase text-slate-500 border-b border-slate-200">
              <tr>
                <th className="px-4 py-2.5">Turno</th>
                <th className="px-4 py-2.5">Apertura</th>
                <th className="px-4 py-2.5">Cierre</th>
                <th className="px-4 py-2.5 text-right">Fondo</th>
                <th className="px-4 py-2.5 text-right">Esperado</th>
                <th className="px-4 py-2.5 text-right">Contado</th>
                <th className="px-4 py-2.5 text-right">Diferencia</th>
                <th className="px-4 py-2.5">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {history.map((s) => (
                <tr key={s.id}>
                  <td className="px-4 py-2.5 font-bold">#{s.id}</td>
                  <td className="px-4 py-2.5 text-xs text-slate-600">
                    {formatDateTime(s.opened_at)} ({s.opened_by_name})
                  </td>
                  <td className="px-4 py-2.5 text-xs text-slate-600">
                    {s.closed_at ? `${formatDateTime(s.closed_at)} (${s.closed_by_name})` : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-right">{formatCents(s.opening_cash_cents)}</td>
                  <td className="px-4 py-2.5 text-right font-semibold">{formatCents(s.expected_cash_cents)}</td>
                  <td className="px-4 py-2.5 text-right font-semibold">
                    {s.declared_cash_cents !== null ? formatCents(s.declared_cash_cents) : '—'}
                  </td>
                  <td
                    className={`px-4 py-2.5 text-right font-extrabold ${
                      s.difference_cents === null
                        ? 'text-slate-400'
                        : s.difference_cents === 0
                        ? 'text-green-600'
                        : s.difference_cents > 0
                        ? 'text-blue-600'
                        : 'text-red-600'
                    }`}
                  >
                    {s.difference_cents !== null ? formatCents(s.difference_cents) : '—'}
                  </td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${
                        s.status === 'OPEN' ? 'bg-green-100 text-green-800' : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {s.status === 'OPEN' ? 'Abierto' : 'Cerrado'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Cash IN/OUT Modal */}
      <Modal
        open={Boolean(movModal)}
        title={movModal === 'IN' ? 'Registrar Entrada de Efectivo' : 'Registrar Salida de Efectivo'}
        onClose={() => setMovModal(null)}
        maxWidth="max-w-md"
      >
        <form onSubmit={handleCashMovement} className="space-y-4">
          <div>
            <label className="block text-sm font-bold text-slate-700 mb-1">Monto ($)</label>
            <input
              type="number"
              step="0.50"
              min="0.50"
              required
              autoFocus
              value={movAmount}
              onChange={(e) => setMovAmount(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-xl font-bold"
            />
          </div>
          <div>
            <label className="block text-sm font-bold text-slate-700 mb-1">Motivo obligatorio *</label>
            <input
              type="text"
              required
              value={movReason}
              onChange={(e) => setMovReason(e.target.value)}
              placeholder={movModal === 'OUT' ? 'Ej. Pago a proveedor de envases / Retiro' : 'Ej. Ingreso de cambio / morralla'}
              className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setMovModal(null)} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold">
              Cancelar
            </button>
            <button type="submit" className="rounded-xl bg-blue-600 px-5 py-2 text-sm font-bold text-white">
              Guardar Movimiento
            </button>
          </div>
        </form>
      </Modal>

      {/* Guided Corte Z Modal (RF-06.3) */}
      <Modal
        open={showCorteZModal}
        title="Cierre de Caja — Corte Z"
        subtitle="Cuenta el efectivo físico en caja. Al cerrar se imprimirá el ticket y se creará respaldo automático."
        onClose={() => setShowCorteZModal(false)}
        maxWidth="max-w-xl"
      >
        {corteX && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setUseDenominations(true)}
                className={`min-h-[42px] inline-flex items-center justify-center gap-1.5 rounded-xl border-2 text-xs font-bold ${
                  useDenominations ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-600'
                }`}
              >
                <Calculator className="h-4 w-4" /> Conteo por Billetes / Monedas
              </button>
              <button
                type="button"
                onClick={() => setUseDenominations(false)}
                className={`min-h-[42px] rounded-xl border-2 text-xs font-bold ${
                  !useDenominations ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-600'
                }`}
              >
                Capturar Monto Directo
              </button>
            </div>

            {useDenominations ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {DENOMS.map((d) => (
                  <div key={d.cents} className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2">
                    <span className="text-sm font-bold text-slate-700">{d.label}</span>
                    <input
                      type="number"
                      min="0"
                      value={denomCounts[d.cents] || ''}
                      placeholder="0"
                      onChange={(e) =>
                        setDenomCounts((prev) => ({ ...prev, [d.cents]: Math.max(0, Number(e.target.value) || 0) }))
                      }
                      className="w-16 rounded-lg border border-slate-300 px-2 py-1 text-right font-bold"
                    />
                  </div>
                ))}
              </div>
            ) : (
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1">Efectivo contado en caja ($)</label>
                <input
                  type="number"
                  step="0.50"
                  value={directDeclared}
                  onChange={(e) => setDirectDeclared(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-4 py-3 text-2xl font-extrabold"
                />
              </div>
            )}

            <div className="rounded-xl bg-slate-50 border border-slate-200 p-4 space-y-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-600">Efectivo esperado según sistema:</span>
                <strong>{formatCents(corteX.expected_cash_cents)}</strong>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600">Efectivo contado declarado:</span>
                <strong className="text-lg">{formatCents(declaredCashCents)}</strong>
              </div>
              <div className="flex justify-between border-t border-slate-200 pt-2 text-base font-extrabold">
                <span>Diferencia ({diffCents === 0 ? 'Cuadrado' : diffCents > 0 ? 'Sobrante' : 'Faltante'}):</span>
                <span className={diffCents === 0 ? 'text-green-600' : diffCents > 0 ? 'text-blue-600' : 'text-red-600'}>
                  {formatCents(diffCents)}
                </span>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-600 mb-1">Observaciones de cierre</label>
              <input
                type="text"
                value={closeNotes}
                onChange={(e) => setCloseNotes(e.target.value)}
                placeholder="Opcional"
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowCorteZModal(false)} className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold">
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleCloseCorteZ}
                className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-extrabold text-white hover:bg-slate-800"
              >
                <CheckCircle2 className="h-4 w-4" /> Confirmar Corte Z y Respaldar
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Bulk Excel Import Preview Modal (RF-07.2) */}
      <Modal
        open={Boolean(importPreview)}
        title="Vista Previa de Importación Masiva"
        subtitle="Revisa los productos nuevos y actualizaciones antes de confirmar"
        onClose={() => setImportPreview(null)}
        maxWidth="max-w-4xl"
      >
        {importPreview && (
          <div className="space-y-4">
            <div className="max-h-96 overflow-auto rounded-xl border border-slate-200">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Acción</th>
                    <th className="px-3 py-2">SKU</th>
                    <th className="px-3 py-2">Nombre</th>
                    <th className="px-3 py-2">Categoría</th>
                    <th className="px-3 py-2 text-right">Costo</th>
                    <th className="px-3 py-2 text-right">Tienda</th>
                    <th className="px-3 py-2 text-right">Revend.</th>
                    <th className="px-3 py-2 text-right">Stock</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {importPreview.map((it) => (
                    <tr key={it.row_number} className={it.error ? 'bg-red-50' : ''}>
                      <td className="px-3 py-2">
                        {it.error ? (
                          <span className="rounded bg-red-100 px-1.5 py-0.5 font-bold text-red-700">{it.error}</span>
                        ) : (
                          <span
                            className={`rounded px-1.5 py-0.5 font-bold ${
                              it.action === 'CREATE'
                                ? 'bg-green-100 text-green-800'
                                : 'bg-blue-100 text-blue-800'
                            }`}
                          >
                            {it.action === 'CREATE' ? 'NUEVO' : 'ACTUALIZAR'}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 font-mono">{it.sku}</td>
                      <td className="px-3 py-2 font-bold">{it.name}</td>
                      <td className="px-3 py-2">{it.category_name}</td>
                      <td className="px-3 py-2 text-right">{formatCents(it.cost_cents)}</td>
                      <td className="px-3 py-2 text-right font-bold">{formatCents(it.tienda_price_cents)}</td>
                      <td className="px-3 py-2 text-right">
                        {it.revendedor_price_cents !== null ? formatCents(it.revendedor_price_cents) : '—'}
                      </td>
                      <td className="px-3 py-2 text-right font-bold">{it.stock_quantity}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setImportPreview(null)} className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold">
                Cancelar
              </button>
              <button
                type="button"
                disabled={importing}
                onClick={handleConfirmImport}
                className="rounded-xl bg-[#16A34A] px-5 py-2.5 text-sm font-extrabold text-white hover:bg-green-700"
              >
                {importing ? 'Aplicando...' : `Confirmar e Importar (${importPreview.filter((i) => !i.error).length} filas)`}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};
