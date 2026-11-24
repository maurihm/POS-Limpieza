import React, { useState } from 'react';
import {
  ClipboardList,
  History,
  Menu,
  Package,
  Settings,
  ShoppingCart,
  UserCheck,
  Wallet,
  X,
} from 'lucide-react';
import { api } from './api/client';
import { AppProvider, useApp } from './context/AppContext';
import { CashRegisterScreen } from './features/cash-register/CashRegisterScreen';
import { CatalogScreen } from './features/catalog/CatalogScreen';
import { InventoryScreen } from './features/inventory/InventoryScreen';
import { PosScreen } from './features/pos/PosScreen';
import { SalesHistoryScreen } from './features/sales-history/SalesHistoryScreen';
import { SettingsScreen } from './features/settings/SettingsScreen';
import { PinModal, TicketPreviewModal } from './ui/Components';

type NavKey = 'pos' | 'history' | 'catalog' | 'inventory' | 'cash' | 'settings';

const Shell: React.FC = () => {
  const {
    loading,
    currentUser,
    setCurrentUser,
    settings,
    activeSession,
    toasts,
    dismissToast,
    printFeedback,
    setPrintFeedback,
    notify,
  } = useApp();

  const [activeTab, setActiveTab] = useState<NavKey>('pos');
  const [menuOpen, setMenuOpen] = useState(false);
  const [pinSwitchOpen, setPinSwitchOpen] = useState(false);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#F8FAFC] text-slate-600 font-semibold">
        Iniciando POS Limpieza (SQLite WAL Offline)...
      </div>
    );
  }

  const perms = currentUser?.permissions;

  // Exactly 6 minimalist navigation items per §8.4 filtered by role permissions
  const allNavItems: Array<{ key: NavKey; label: string; icon: React.ReactNode; visible: boolean }> = [
    { key: 'pos', label: 'Vender', icon: <ShoppingCart className="h-5 w-5" />, visible: Boolean(perms?.can_sell) },
    { key: 'history', label: 'Historial', icon: <History className="h-5 w-5" />, visible: true },
    {
      key: 'catalog',
      label: 'Catálogo',
      icon: <Package className="h-5 w-5" />,
      visible: Boolean(perms?.can_edit_catalog || perms?.can_view_costs),
    },
    {
      key: 'inventory',
      label: 'Inventario',
      icon: <ClipboardList className="h-5 w-5" />,
      visible: Boolean(perms?.can_edit_inventory || perms?.can_edit_catalog),
    },
    {
      key: 'cash',
      label: 'Caja y Reportes',
      icon: <Wallet className="h-5 w-5" />,
      visible: Boolean(perms?.can_view_corte_x || perms?.can_close_corte_z || perms?.can_cash_movement),
    },
    {
      key: 'settings',
      label: 'Ajustes',
      icon: <Settings className="h-5 w-5" />,
      visible: Boolean(perms?.can_manage_settings),
    },
  ];
  const navItems = allNavItems.filter((item) => item.visible);

  const navigate = (key: string) => {
    const target = key as NavKey;
    if (navItems.some((n) => n.key === target)) {
      setActiveTab(target);
    } else {
      setActiveTab('pos');
    }
    setMenuOpen(false);
  };

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-[#F8FAFC]">
      {/* Top Bar matching Wireframe §8.3 */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-3.5 shadow-2xs">
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-bold text-slate-700 hover:bg-slate-100"
          >
            <Menu className="h-4 w-4" /> Menú
          </button>

          <span className="font-extrabold tracking-tight text-slate-900 text-base">
            {settings?.business_name || 'POS LIMPIEZA'}
          </span>

          {/* Desktop Quick Nav Pills */}
          <nav className="hidden lg:flex items-center gap-1 ml-3">
            {navItems.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => navigate(item.key)}
                className={`inline-flex min-h-[38px] items-center gap-1.5 rounded-xl px-3 text-xs font-bold transition ${
                  activeTab === item.key
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => navigate('cash')}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-extrabold ${
              activeSession
                ? 'bg-green-100 text-green-800 hover:bg-green-200'
                : 'bg-red-100 text-red-700 hover:bg-red-200'
            }`}
          >
            <span className={`h-2 w-2 rounded-full ${activeSession ? 'bg-green-600' : 'bg-red-600'}`} />
            Caja: {activeSession ? 'Abierta' : 'Cerrada'}
          </button>

          <button
            type="button"
            onClick={() => setPinSwitchOpen(true)}
            className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs font-bold text-slate-800 hover:bg-slate-100"
            title="Cambiar de usuario con PIN de 4 dígitos"
          >
            <UserCheck className="h-4 w-4 text-blue-600" />
            <span>{currentUser?.name || 'Iniciar sesión'}</span>
            <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-extrabold text-slate-600">
              {currentUser?.role_name}
            </span>
          </button>
        </div>
      </header>

      {/* Slide-out Minimalist Drawer */}
      {menuOpen && (
        <div className="fixed inset-0 z-40 flex bg-slate-900/35" onClick={() => setMenuOpen(false)}>
          <aside
            className="flex h-full w-64 flex-col bg-white shadow-2xl border-r border-slate-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3.5">
              <span className="font-extrabold text-slate-900">Navegación</span>
              <button
                type="button"
                onClick={() => setMenuOpen(false)}
                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 p-3 space-y-1.5">
              {navItems.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => navigate(item.key)}
                  className={`flex w-full min-h-[48px] items-center gap-3 rounded-xl px-4 text-sm font-bold transition ${
                    activeTab === item.key
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  {item.icon}
                  {item.label}
                </button>
              ))}
            </div>
            <div className="border-t border-slate-200 p-4 text-xs text-slate-500">
              POS Limpieza v1.0 · 100% Offline SQLite WAL
            </div>
          </aside>
        </div>
      )}

      {/* Active Feature View */}
      <main className="flex-1 min-h-0 overflow-hidden">
        {activeTab === 'pos' && <PosScreen onNavigate={navigate} />}
        {activeTab === 'history' && <SalesHistoryScreen />}
        {activeTab === 'catalog' && <CatalogScreen />}
        {activeTab === 'inventory' && <InventoryScreen />}
        {activeTab === 'cash' && <CashRegisterScreen />}
        {activeTab === 'settings' && <SettingsScreen />}
      </main>

      {/* Quick 4-digit PIN User Switch Modal (RF-08.1) */}
      <PinModal
        open={pinSwitchOpen}
        title="Cambiar Usuario (PIN 4 dígitos)"
        subtitle="Ingresa tu PIN personal para cambiar de turno al instante"
        onClose={() => setPinSwitchOpen(false)}
        onSubmitPin={async (pin) => {
          const { user } = await api.loginByPin(pin);
          setCurrentUser(user);
          setPinSwitchOpen(false);
          setActiveTab('pos');
          notify('success', `Sesión cambiada a ${user.name} (${user.role_name}).`);
        }}
      />

      {/* Thermal Ticket Preview & Non-blocking Retry Modal (Edge Case #1) */}
      <TicketPreviewModal feedback={printFeedback} onClose={() => setPrintFeedback(null)} />

      {/* Toasts */}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
        {toasts.map((t) => (
          <div
            key={t.id}
            onClick={() => dismissToast(t.id)}
            className={`cursor-pointer rounded-xl border px-4 py-3 text-sm font-semibold shadow-lg transition ${
              t.type === 'success'
                ? 'border-green-200 bg-green-600 text-white'
                : t.type === 'error'
                ? 'border-red-200 bg-red-600 text-white'
                : t.type === 'warning'
                ? 'border-amber-300 bg-amber-500 text-white'
                : 'border-slate-700 bg-slate-900 text-white'
            }`}
          >
            {t.text}
          </div>
        ))}
      </div>
    </div>
  );
};

export const App: React.FC = () => (
  <AppProvider>
    <Shell />
  </AppProvider>
);

export default App;
