import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from '../api/client';
import type {
  AppSettings,
  CashSession,
  Category,
  HeldTicket,
  PriceTier,
  PrintResult,
  Product,
  Promotion,
  Role,
  User,
} from '../types';

export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  text: string;
}

export interface PrintFeedbackState {
  title: string;
  result: PrintResult;
  onRetry?: () => Promise<void>;
}

interface AppContextValue {
  loading: boolean;
  currentUser: User | null;
  setCurrentUser: (u: User | null) => void;
  settings: AppSettings | null;
  users: User[];
  roles: Role[];
  categories: Category[];
  priceTiers: PriceTier[];
  defaultTier: PriceTier | null;
  products: Product[];
  promotions: Promotion[];
  activeSession: CashSession | null;
  heldTickets: HeldTicket[];
  refreshAll: () => Promise<void>;
  notify: (type: ToastMessage['type'], text: string) => void;
  toasts: ToastMessage[];
  dismissToast: (id: string) => void;
  printFeedback: PrintFeedbackState | null;
  setPrintFeedback: (fb: PrintFeedbackState | null) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [priceTiers, setPriceTiers] = useState<PriceTier[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [activeSession, setActiveSession] = useState<CashSession | null>(null);
  const [heldTickets, setHeldTickets] = useState<HeldTicket[]>([]);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [printFeedback, setPrintFeedback] = useState<PrintFeedbackState | null>(null);

  const notify = useCallback((type: ToastMessage['type'], text: string) => {
    const id = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    setToasts((prev) => [...prev, { id, type, text }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4200);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const refreshAll = useCallback(async () => {
    try {
      const data = await api.bootstrap();
      setSettings(data.settings);
      setUsers(data.users);
      setRoles(data.roles);
      setCategories(data.categories);
      setPriceTiers(data.price_tiers);
      setProducts(data.products);
      setPromotions(data.promotions);
      setActiveSession(data.active_session);
      setHeldTickets(data.held_tickets);

      setCurrentUser((prev) => {
        if (!prev) {
          // Auto-select default Admin user on initial boot or keep saved user id
          const savedId = Number(localStorage.getItem('pos_user_id') || '0');
          const match = data.users.find((u) => u.id === savedId && u.is_active);
          return match || data.users.find((u) => u.is_active) || null;
        }
        return data.users.find((u) => u.id === prev.id && u.is_active) || prev;
      });
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Error conectando al servidor local');
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  const handleSetUser = useCallback((u: User | null) => {
    setCurrentUser(u);
    if (u) localStorage.setItem('pos_user_id', String(u.id));
    else localStorage.removeItem('pos_user_id');
  }, []);

  const defaultTier = priceTiers.find((t) => t.is_default) || priceTiers[0] || null;

  return (
    <AppContext.Provider
      value={{
        loading,
        currentUser,
        setCurrentUser: handleSetUser,
        settings,
        users,
        roles,
        categories,
        priceTiers,
        defaultTier,
        products,
        promotions,
        activeSession,
        heldTickets,
        refreshAll,
        notify,
        toasts,
        dismissToast,
        printFeedback,
        setPrintFeedback,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp debe usarse dentro de AppProvider');
  return ctx;
}
