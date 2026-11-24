import React, { useCallback, useEffect, useState } from 'react';
import {
  Database,
  HardDriveDownload,
  Info,
  KeyRound,
  Printer,
  Save,
  Shield,
  Store,
  UserPlus,
  Vault,
} from 'lucide-react';
import { api, type BackupInfo } from '../../api/client';
import { useApp } from '../../context/AppContext';
import type { AppSettings, AuditLog, RolePermissions } from '../../types';
import { Modal } from '../../ui/Components';
import { formatDateTime } from '../../utils/money';

const PERM_LABELS: Array<{ key: keyof RolePermissions; label: string }> = [
  { key: 'can_sell', label: 'Realizar ventas en POS' },
  { key: 'can_switch_tier', label: 'Cambiar tarifa Tienda ↔ Revendedor' },
  { key: 'can_reprint_last', label: 'Reimprimir último ticket' },
  { key: 'can_reprint_any', label: 'Reimprimir cualquier ticket del historial' },
  { key: 'can_cash_movement', label: 'Registrar entradas/salidas de efectivo' },
  { key: 'can_view_corte_x', label: 'Ver Corte X en vivo' },
  { key: 'can_close_corte_z', label: 'Cerrar caja (Corte Z)' },
  { key: 'can_apply_discount', label: 'Aplicar descuentos rápidos' },
  { key: 'can_override_price', label: 'Editar precios manualmente sin PIN Admin' },
  { key: 'can_void_sale', label: 'Cancelar o devolver ventas' },
  { key: 'can_view_costs', label: 'Ver costos de compra y utilidades' },
  { key: 'can_edit_catalog', label: 'Crear/editar productos, combos y promos' },
  { key: 'can_edit_inventory', label: 'Editar existencias y mermas' },
  { key: 'can_open_drawer', label: 'Abrir cajón de dinero sin venta' },
  { key: 'can_manage_settings', label: 'Acceso a Ajustes y Usuarios' },
];

export const SettingsScreen: React.FC = () => {
  const { currentUser, settings, users, roles, refreshAll, notify, setPrintFeedback } = useApp();

  const [tab, setTab] = useState<'printer' | 'business' | 'users' | 'backups'>('printer');
  const [form, setForm] = useState<AppSettings | null>(settings);
  const [printers, setPrinters] = useState<string[]>([]);
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [saving, setSaving] = useState(false);

  // User create modal
  const [userModalOpen, setUserModalOpen] = useState(false);
  const [newUserName, setNewUserName] = useState('');
  const [newUserPin, setNewUserPin] = useState('');
  const [newUserRoleId, setNewUserRoleId] = useState<number>(roles.find((r) => r.name === 'CAJERO')?.id || 2);

  useEffect(() => {
    if (settings) setForm(settings);
  }, [settings]);

  const loadExtras = useCallback(async () => {
    try {
      const [pRes, sRes, aRes] = await Promise.all([
        api.listPrinters(),
        api.getSettings(),
        api.listAuditLogs(),
      ]);
      setPrinters(pRes.printers);
      setBackups(sRes.backups);
      setAuditLogs(aRes.logs);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    void loadExtras();
  }, [loadExtras]);

  if (!form) return null;

  const saveForm = async () => {
    setSaving(true);
    try {
      await api.saveSettings(form);
      await refreshAll();
      notify('success', 'Configuración guardada correctamente.');
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Error guardando ajustes');
    } finally {
      setSaving(false);
    }
  };

  const handleTestPrint = async () => {
    await saveForm();
    const { print_result } = await api.testPrint();
    setPrintFeedback({
      title: 'Ticket de Prueba — POS-80',
      result: print_result,
    });
  };

  const handleOpenDrawer = async () => {
    if (!currentUser) return;
    const { print_result } = await api.openDrawer(currentUser.id, 'Prueba / Apertura desde Ajustes');
    setPrintFeedback({
      title: 'Pulso de Apertura de Cajón (RJ11)',
      result: print_result,
    });
    void loadExtras();
  };

  const handleRunBackup = async () => {
    try {
      const res = await api.runBackup();
      setBackups(res.backups);
      notify('success', `Respaldo creado: ${res.backup.filename}`);
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Error creando respaldo');
    }
  };

  const cashierRole = roles.find((r) => r.name === 'CAJERO');

  return (
    <div className="flex h-full flex-col overflow-hidden p-5 gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold text-slate-900">Ajustes del Sistema</h1>
          <p className="text-xs text-slate-500">
            Impresora térmica POS-80, encabezado de tickets, usuarios con PIN, permisos y respaldos automáticos
          </p>
        </div>
        {(tab === 'printer' || tab === 'business' || tab === 'backups') && (
          <button
            type="button"
            disabled={saving}
            onClick={saveForm}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-blue-600 px-5 text-sm font-bold text-white hover:bg-blue-700"
          >
            <Save className="h-4 w-4" /> {saving ? 'Guardando...' : 'Guardar Cambios'}
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-2">
        {[
          { id: 'printer', label: 'Impresora POS-80', icon: <Printer className="h-4 w-4" /> },
          { id: 'business', label: 'Negocio y Ticket', icon: <Store className="h-4 w-4" /> },
          { id: 'users', label: 'Usuarios y Permisos', icon: <Shield className="h-4 w-4" /> },
          { id: 'backups', label: 'Respaldos y Bitácora', icon: <Database className="h-4 w-4" /> },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id as typeof tab)}
            className={`inline-flex min-h-[42px] items-center gap-2 rounded-xl px-4 text-sm font-bold ${
              tab === t.id ? 'bg-slate-900 text-white' : 'border border-slate-200 bg-white text-slate-700'
            }`}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* TAB 1: PRINTER POS-80 */}
        {tab === 'printer' && (
          <div className="max-w-2xl space-y-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
              <h2 className="font-extrabold text-slate-900">Conexión y Comandos ESC/POS (80 mm)</h2>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">Modo de comunicación</label>
                  <select
                    value={form.printer_mode}
                    onChange={(e) => setForm({ ...form, printer_mode: e.target.value as AppSettings['printer_mode'] })}
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-bold"
                  >
                    <option value="SPOOLER">Windows Spooler RAW (Recomendado)</option>
                    <option value="SERIAL">Puerto Serial Virtual (COM) / USB Directo</option>
                    <option value="PREVIEW">Vista Previa en Pantalla (Sin impresora física)</option>
                  </select>
                </div>

                {form.printer_mode === 'SERIAL' ? (
                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1">Puerto COM / Dispositivo</label>
                    <input
                      type="text"
                      value={form.printer_com_port}
                      onChange={(e) => setForm({ ...form, printer_com_port: e.target.value })}
                      placeholder="COM3 o /dev/usb/lp0"
                      className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm font-mono font-bold"
                    />
                  </div>
                ) : (
                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1">Nombre de impresora en sistema</label>
                    <input
                      type="text"
                      list="printers-datalist"
                      value={form.printer_name}
                      onChange={(e) => setForm({ ...form, printer_name: e.target.value })}
                      className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm font-bold"
                    />
                    <datalist id="printers-datalist">
                      {printers.map((p) => (
                        <option key={p} value={p} />
                      ))}
                    </datalist>
                  </div>
                )}

                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">Ancho de columnas (Fuente A)</label>
                  <select
                    value={form.printer_columns}
                    onChange={(e) => setForm({ ...form, printer_columns: Number(e.target.value) as 42 | 48 })}
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-bold"
                  >
                    <option value={48}>48 columnas (Estándar 80 mm)</option>
                    <option value={42}>42 columnas (Modelos económicos)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">Tabla de caracteres (Español)</label>
                  <select
                    value={form.printer_codepage}
                    onChange={(e) => setForm({ ...form, printer_codepage: e.target.value as 'CP850' | 'CP858' })}
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-bold"
                  >
                    <option value="CP850">CP850 (1B 74 02 — Recomendado)</option>
                    <option value="CP858">CP858 (1B 74 13 — Con Euro)</option>
                  </select>
                </div>
              </div>

              <label className="flex items-center gap-2.5 text-sm font-semibold text-slate-700 pt-1">
                <input
                  type="checkbox"
                  checked={form.auto_open_drawer_on_cash}
                  onChange={(e) => setForm({ ...form, auto_open_drawer_on_cash: e.target.checked })}
                  className="h-4 w-4 rounded"
                />
                Abrir cajón de dinero (RJ11 Pin 2) automáticamente solo en pagos con Efectivo
              </label>

              {/* Edge Case #6: Upside-down thermal roll diagnostic note */}
              <div className="rounded-xl border border-blue-200 bg-blue-50 p-3.5 text-xs text-blue-900 flex items-start gap-2.5">
                <Info className="h-4 w-4 shrink-0 text-blue-600 mt-0.5" />
                <div>
                  <p className="font-bold">Diagnóstico rápido de papel térmico:</p>
                  <p className="mt-0.5">
                    Si al presionar "Imprimir Ticket de Prueba" el papel avanza pero sale en blanco,{' '}
                    <strong>invierte el rollo de papel térmico y prueba de nuevo</strong> (solo un lado es sensible al calor).
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap gap-3 pt-1">
                <button
                  type="button"
                  onClick={handleTestPrint}
                  className="inline-flex min-h-[46px] items-center gap-2 rounded-xl bg-slate-900 px-5 text-sm font-bold text-white hover:bg-slate-800"
                >
                  <Printer className="h-4 w-4" /> Imprimir Ticket de Prueba
                </button>
                <button
                  type="button"
                  onClick={handleOpenDrawer}
                  className="inline-flex min-h-[46px] items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-bold text-slate-700 hover:bg-slate-50"
                >
                  <Vault className="h-4 w-4" /> Probar Apertura de Cajón
                </button>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: BUSINESS & TICKET */}
        {tab === 'business' && (
          <div className="max-w-2xl rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
            <h2 className="font-extrabold text-slate-900">Datos del Negocio y Reglas Operativas</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">Nombre del negocio (Encabezado ticket)</label>
                <input
                  type="text"
                  value={form.business_name}
                  onChange={(e) => setForm({ ...form, business_name: e.target.value })}
                  className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm font-bold"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">Dirección</label>
                <input
                  type="text"
                  value={form.business_address}
                  onChange={(e) => setForm({ ...form, business_address: e.target.value })}
                  className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">Teléfono / WhatsApp</label>
                <input
                  type="text"
                  value={form.business_phone}
                  onChange={(e) => setForm({ ...form, business_phone: e.target.value })}
                  className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">Pie de ticket (Línea 1)</label>
                  <input
                    type="text"
                    value={form.ticket_footer_1}
                    onChange={(e) => setForm({ ...form, ticket_footer_1: e.target.value })}
                    className="w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">Pie de ticket (Línea 2)</label>
                  <input
                    type="text"
                    value={form.ticket_footer_2}
                    onChange={(e) => setForm({ ...form, ticket_footer_2: e.target.value })}
                    className="w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm"
                  />
                </div>
              </div>
            </div>

            <div className="border-t border-slate-200 pt-4 space-y-3">
              <label className="flex items-start gap-2.5 text-sm text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.allow_negative_stock}
                  onChange={(e) => setForm({ ...form, allow_negative_stock: e.target.checked })}
                  className="h-4 w-4 mt-0.5 rounded"
                />
                <span>
                  <strong>Permitir venta con stock negativo (Recomendado):</strong> No detiene la fila si llegó mercancía aún sin capturar; marca el stock en rojo en Inventario para regularizar después.
                </span>
              </label>

              <label className="flex items-center gap-2.5 text-sm text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.sound_enabled}
                  onChange={(e) => setForm({ ...form, sound_enabled: e.target.checked })}
                  className="h-4 w-4 rounded"
                />
                <strong>Sonidos sutiles de feedback</strong> al escanear/agregar productos y cobrar.
              </label>
            </div>
          </div>
        )}

        {/* TAB 3: USERS, PINS & PERMISSIONS MATRIX */}
        {tab === 'users' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="font-extrabold text-slate-900">Usuarios y PIN de 4 dígitos</h2>
                <button
                  type="button"
                  onClick={() => {
                    setNewUserName('');
                    setNewUserPin('');
                    setUserModalOpen(true);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-blue-700"
                >
                  <UserPlus className="h-4 w-4" /> Nuevo Usuario
                </button>
              </div>

              <div className="divide-y divide-slate-100">
                {users.map((u) => (
                  <div key={u.id} className="flex items-center justify-between py-3">
                    <div>
                      <p className="font-bold text-slate-900">{u.name}</p>
                      <span
                        className={`rounded-md px-2 py-0.5 text-[11px] font-bold ${
                          u.role_name === 'ADMIN'
                            ? 'bg-purple-100 text-purple-800'
                            : 'bg-blue-100 text-blue-700'
                        }`}
                      >
                        {u.role_name}
                      </span>
                    </div>
                    <button
                      type="button"
                      disabled={u.id === currentUser?.id}
                      onClick={async () => {
                        await api.updateUser(u.id, { is_active: !u.is_active });
                        await refreshAll();
                        notify('info', `Usuario ${u.name} ${u.is_active ? 'desactivado' : 'reactivado'}.`);
                      }}
                      className={`rounded-lg border px-3 py-1.5 text-xs font-bold disabled:opacity-40 ${
                        u.is_active
                          ? 'border-green-200 bg-green-50 text-green-800'
                          : 'border-slate-200 bg-slate-100 text-slate-500'
                      }`}
                    >
                      {u.is_active ? 'Activo' : 'Inactivo'}
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Role Permissions Matrix for CAJERO */}
            {cashierRole && (
              <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3">
                <h2 className="font-extrabold text-slate-900">Matriz de Permisos — Rol CAJERO</h2>
                <p className="text-xs text-slate-500">
                  El rol ADMIN siempre tiene acceso total. Personaliza qué acciones puede realizar un cajero:
                </p>
                <div className="divide-y divide-slate-100">
                  {PERM_LABELS.map((item) => (
                    <label key={item.key} className="flex items-center justify-between py-2 text-sm cursor-pointer">
                      <span className="text-slate-700">{item.label}</span>
                      <input
                        type="checkbox"
                        checked={Boolean(cashierRole.permissions[item.key])}
                        onChange={async (e) => {
                          const updated: RolePermissions = {
                            ...cashierRole.permissions,
                            [item.key]: e.target.checked,
                          };
                          await api.updateRolePermissions(cashierRole.id, updated);
                          await refreshAll();
                          notify('success', 'Permisos del rol Cajero actualizados.');
                        }}
                        className="h-4 w-4 rounded text-blue-600"
                      />
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 4: BACKUPS & AUDIT LOGS */}
        {tab === 'backups' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="font-extrabold text-slate-900">Respaldos Automáticos SQLite (.db.gz)</h2>
                <button
                  type="button"
                  onClick={handleRunBackup}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-emerald-700"
                >
                  <HardDriveDownload className="h-4 w-4" /> Respaldar Ahora
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-bold text-slate-600 mb-1">
                    Carpeta de respaldos (local / OneDrive / Drive / USB)
                  </label>
                  <input
                    type="text"
                    value={form.backup_dir}
                    onChange={(e) => setForm({ ...form, backup_dir: e.target.value })}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">Retención (días)</label>
                  <input
                    type="number"
                    min="7"
                    max="365"
                    value={form.backup_retention_days}
                    onChange={(e) => setForm({ ...form, backup_retention_days: Number(e.target.value) || 30 })}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-bold"
                  />
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 divide-y divide-slate-100 max-h-72 overflow-y-auto">
                {backups.length === 0 ? (
                  <p className="p-4 text-center text-xs text-slate-400">Aún no se han generado respaldos.</p>
                ) : (
                  backups.map((b) => (
                    <div key={b.filename} className="flex items-center justify-between px-3.5 py-2.5 text-xs">
                      <div>
                        <p className="font-mono font-bold text-slate-800">{b.filename}</p>
                        <p className="text-slate-500">{formatDateTime(b.created_at)}</p>
                      </div>
                      <span className="font-semibold text-slate-600">{(b.size_bytes / 1024).toFixed(1)} KB</span>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3">
              <h2 className="font-extrabold text-slate-900">Bitácora de Seguridad (Audit Logs)</h2>
              <div className="rounded-xl border border-slate-200 divide-y divide-slate-100 max-h-96 overflow-y-auto">
                {auditLogs.length === 0 ? (
                  <p className="p-4 text-center text-xs text-slate-400">Sin eventos registrados.</p>
                ) : (
                  auditLogs.map((log) => (
                    <div key={log.id} className="px-3.5 py-2.5 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="rounded bg-slate-100 px-2 py-0.5 font-mono font-bold text-slate-800">
                          {log.action}
                        </span>
                        <span className="text-slate-400">{formatDateTime(log.created_at)}</span>
                      </div>
                      <p className="mt-1 text-slate-600">
                        <strong>{log.user_name}:</strong> {JSON.stringify(log.details)}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Create User Modal */}
      <Modal open={userModalOpen} title="Nuevo Usuario" onClose={() => setUserModalOpen(false)} maxWidth="max-w-sm">
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1">Nombre *</label>
            <input
              type="text"
              value={newUserName}
              onChange={(e) => setNewUserName(e.target.value)}
              placeholder="Ej. Laura"
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-bold"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1">PIN de acceso rápido (4 dígitos) *</label>
            <input
              type="password"
              maxLength={4}
              value={newUserPin}
              onChange={(e) => setNewUserPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
              placeholder="Ej. 5678"
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-lg font-mono font-bold tracking-widest"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1">Rol</label>
            <select
              value={newUserRoleId}
              onChange={(e) => setNewUserRoleId(Number(e.target.value))}
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-bold"
            >
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setUserModalOpen(false)} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold">
              Cancelar
            </button>
            <button
              type="button"
              onClick={async () => {
                try {
                  await api.createUser({ name: newUserName, pin: newUserPin, role_id: newUserRoleId });
                  setUserModalOpen(false);
                  await refreshAll();
                  notify('success', 'Usuario creado correctamente.');
                } catch (err) {
                  notify('error', err instanceof Error ? err.message : 'Error creando usuario');
                }
              }}
              className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white"
            >
              <KeyRound className="h-4 w-4" /> Crear Usuario
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
};
