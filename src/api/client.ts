import type {
  AppSettings,
  AuditLog,
  CashMovement,
  CashSession,
  Category,
  CorteSummary,
  HeldTicket,
  InventoryMovement,
  PaymentMethod,
  PriceTier,
  PrintResult,
  Product,
  Promotion,
  Role,
  RolePermissions,
  Sale,
  User,
} from '../types';

export interface BootstrapResponse {
  settings: AppSettings;
  users: User[];
  roles: Role[];
  categories: Category[];
  price_tiers: PriceTier[];
  products: Product[];
  promotions: Promotion[];
  active_session: CashSession | null;
  held_tickets: HeldTicket[];
}

export interface BackupInfo {
  filename: string;
  filepath: string;
  size_bytes: number;
  created_at: string;
}

export interface ImportPreviewItem {
  row_number: number;
  action: 'CREATE' | 'UPDATE';
  sku: string;
  barcode: string | null;
  name: string;
  category_name: string;
  unit_type: 'PIECE' | 'LITER' | 'WEIGHT';
  cost_cents: number;
  tienda_price_cents: number;
  revendedor_price_cents: number | null;
  stock_quantity: number;
  min_stock_alert: number;
  existing_product_id?: number;
  error?: string;
}

async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || `Error HTTP ${res.status}`);
  }
  return data as T;
}

export const api = {
  bootstrap: () => request<BootstrapResponse>('/api/bootstrap'),

  // Auth & Users
  loginByPin: (pin: string) =>
    request<{ user: User }>('/api/auth/pin', { method: 'POST', body: JSON.stringify({ pin }) }),
  verifyAdminPin: (pin: string) =>
    request<{ admin: User }>('/api/auth/verify-admin', { method: 'POST', body: JSON.stringify({ pin }) }),
  listUsers: () => request<{ users: User[]; roles: Role[] }>('/api/users'),
  createUser: (payload: { name: string; pin: string; role_id: number }) =>
    request<{ user: User }>('/api/users', { method: 'POST', body: JSON.stringify(payload) }),
  updateUser: (id: number, payload: { name?: string; pin?: string; role_id?: number; is_active?: boolean }) =>
    request<{ user: User }>(`/api/users/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  updateRolePermissions: (roleId: number, permissions: RolePermissions) =>
    request<{ role: Role }>(`/api/roles/${roleId}`, {
      method: 'PUT',
      body: JSON.stringify({ permissions }),
    }),
  listAuditLogs: () => request<{ logs: AuditLog[] }>('/api/audit-logs'),

  // Categories
  saveCategory: (payload: { id?: number; name: string; color_hex?: string; sort_order?: number; is_active?: boolean }) =>
    request<{ category: Category }>('/api/categories', { method: 'POST', body: JSON.stringify(payload) }),

  // Products
  listProducts: (includeInactive = false) =>
    request<{ products: Product[] }>(`/api/products?includeInactive=${includeInactive ? '1' : '0'}`),
  saveProduct: (product: Record<string, unknown>, userId: number) =>
    request<{ product: Product }>('/api/products', {
      method: 'POST',
      body: JSON.stringify({ product, user_id: userId }),
    }),
  uploadProductImage: (dataUrl: string, sku: string) =>
    request<{ image_path: string; size_bytes: number }>('/api/products/upload-image', {
      method: 'POST',
      body: JSON.stringify({ data_url: dataUrl, sku }),
    }),

  // Inventory & Kardex
  adjustStock: (payload: {
    product_id: number;
    user_id: number;
    type: 'PURCHASE' | 'ADJUSTMENT' | 'WASTE';
    quantity_delta?: number;
    new_stock?: number;
    new_cost_cents?: number;
    reason: string;
  }) =>
    request<{ product: Product }>('/api/inventory/adjust', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  bulkUpdateProducts: (
    rows: Array<{
      product_id: number;
      cost_cents?: number;
      stock_quantity?: number;
      min_stock_alert?: number;
      prices?: Record<number, number | null>;
    }>,
    userId: number,
    reason?: string
  ) =>
    request<{ updated: number; kardex_entries: number }>('/api/inventory/bulk', {
      method: 'POST',
      body: JSON.stringify({ rows, user_id: userId, reason }),
    }),
  listKardex: (productId?: number) =>
    request<{ movements: InventoryMovement[] }>(
      `/api/inventory/kardex${productId ? `?productId=${productId}` : ''}`
    ),

  // Promotions
  savePromotion: (promo: Omit<Promotion, 'id'> & { id?: number }) =>
    request<{ promotion: Promotion }>('/api/promotions', {
      method: 'POST',
      body: JSON.stringify(promo),
    }),
  deletePromotion: (id: number) =>
    request<{ ok: boolean }>(`/api/promotions/${id}`, { method: 'DELETE' }),

  // Sales
  listSales: (params: {
    date_from?: string;
    date_to?: string;
    folio?: string;
    method?: string;
    price_tier_id?: string;
    product_query?: string;
  }) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v) qs.set(k, v);
    });
    return request<{ sales: Sale[] }>(`/api/sales?${qs.toString()}`);
  },
  createSale: (payload: {
    user_id: number;
    price_tier_id: number;
    items: Array<{
      product_id: number;
      quantity: number;
      unit_price_cents?: number;
      price_overridden?: boolean;
      manual_discount_cents?: number;
    }>;
    ticket_discount_cents?: number;
    payments: Array<{ method: PaymentMethod; amount_cents: number; tendered_cents: number }>;
    print_ticket?: boolean;
  }) =>
    request<{ sale: Sale; print_result: PrintResult }>('/api/sales', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  reprintLastSale: () =>
    request<{ sale: Sale; print_result: PrintResult }>('/api/sales/reprint-last', { method: 'POST' }),
  reprintSale: (saleId: number) =>
    request<{ sale: Sale; print_result: PrintResult }>(`/api/sales/${saleId}/reprint`, { method: 'POST' }),
  refundSale: (
    saleId: number,
    payload: {
      user_id: number;
      reason: string;
      items?: Array<{ sale_item_id: number; quantity: number }>;
    }
  ) =>
    request<{ sale: Sale }>(`/api/sales/${saleId}/refund`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  // Held Tickets
  saveHeldTicket: (ticket: HeldTicket) =>
    request<{ held_ticket: HeldTicket }>('/api/held-tickets', {
      method: 'POST',
      body: JSON.stringify(ticket),
    }),
  deleteHeldTicket: (id: string) =>
    request<{ ok: boolean }>(`/api/held-tickets/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  // Cash Register
  getCashCurrent: () =>
    request<{ active_session: CashSession | null; corte_x: CorteSummary | null; history: CashSession[] }>(
      '/api/cash/current'
    ),
  openCash: (payload: { user_id: number; opening_cash_cents: number; notes?: string }) =>
    request<{ session: CashSession; corte_x: CorteSummary }>('/api/cash/open', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  addCashMovement: (payload: {
    cash_session_id: number;
    user_id: number;
    type: 'IN' | 'OUT';
    amount_cents: number;
    reason: string;
  }) =>
    request<{ movement: CashMovement; corte_x: CorteSummary }>('/api/cash/movement', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  printCorteX: () =>
    request<{ summary: CorteSummary; print_result: PrintResult }>('/api/cash/print-corte-x', {
      method: 'POST',
    }),
  closeCorteZ: (payload: { user_id: number; declared_cash_cents: number; notes?: string }) =>
    request<{ summary: CorteSummary; backup_file: string | null; print_result: PrintResult }>(
      '/api/cash/close-z',
      { method: 'POST', body: JSON.stringify(payload) }
    ),

  // Hardware & Settings
  listPrinters: () => request<{ printers: string[] }>('/api/hardware/printers'),
  testPrint: () => request<{ print_result: PrintResult }>('/api/hardware/test-print', { method: 'POST' }),
  openDrawer: (userId: number, reason = 'Apertura manual') =>
    request<{ print_result: PrintResult }>('/api/hardware/open-drawer', {
      method: 'POST',
      body: JSON.stringify({ user_id: userId, reason }),
    }),
  getSettings: () => request<{ settings: AppSettings; backups: BackupInfo[] }>('/api/settings'),
  saveSettings: (patch: Partial<AppSettings>) =>
    request<{ settings: AppSettings }>('/api/settings', {
      method: 'PUT',
      body: JSON.stringify(patch),
    }),
  runBackup: () => request<{ backup: BackupInfo; backups: BackupInfo[] }>('/api/backups/run', { method: 'POST' }),

  // Bulk Excel Import
  previewImportExcel: (base64: string) =>
    request<{ items: ImportPreviewItem[] }>('/api/imports/preview', {
      method: 'POST',
      body: JSON.stringify({ base64 }),
    }),
  applyImportExcel: (items: ImportPreviewItem[], userId: number) =>
    request<{ created: number; updated: number; skipped: number }>('/api/imports/apply', {
      method: 'POST',
      body: JSON.stringify({ items, user_id: userId }),
    }),
};

export function triggerDownload(url: string): void {
  const a = document.createElement('a');
  a.href = url;
  a.target = '_blank';
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
