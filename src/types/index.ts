export type UnitType = 'PIECE' | 'LITER' | 'WEIGHT';

export type PromoType =
  | 'BUY_X_PAY_Y'
  | 'PERCENT_DISCOUNT'
  | 'FIXED_AMOUNT_DISCOUNT'
  | 'BULK_QUANTITY_PRICE';

export type PromoScope = 'PRODUCT' | 'CATEGORY' | 'ALL';

export type PaymentMethod = 'CASH' | 'CARD' | 'TRANSFER';

export type SaleStatus = 'COMPLETED' | 'VOIDED' | 'PARTIALLY_REFUNDED';

export type InventoryMovementType =
  | 'SALE'
  | 'REFUND'
  | 'PURCHASE'
  | 'ADJUSTMENT'
  | 'WASTE'
  | 'BUNDLE_DEDUCTION';

export interface RolePermissions {
  can_sell: boolean;
  can_switch_tier: boolean;
  can_reprint_last: boolean;
  can_reprint_any: boolean;
  can_cash_movement: boolean;
  can_view_corte_x: boolean;
  can_close_corte_z: boolean;
  can_override_price: boolean;
  can_apply_discount: boolean;
  can_void_sale: boolean;
  can_view_costs: boolean;
  can_edit_catalog: boolean;
  can_edit_inventory: boolean;
  can_manage_settings: boolean;
  can_open_drawer: boolean;
}

export interface Role {
  id: number;
  name: string;
  permissions: RolePermissions;
}

export interface User {
  id: number;
  name: string;
  role_id: number;
  role_name: string;
  permissions: RolePermissions;
  is_active: boolean;
  created_at: string;
}

export interface Category {
  id: number;
  name: string;
  color_hex: string;
  image_path: string | null;
  sort_order: number;
  is_active: boolean;
}

export interface PriceTier {
  id: number;
  name: string;
  badge_color: string;
  is_default: boolean;
  sort_order: number;
}

export interface ProductPrice {
  id?: number;
  product_id?: number;
  price_tier_id: number;
  price_cents: number;
}

export interface BundleItem {
  id?: number;
  bundle_product_id?: number;
  component_product_id: number;
  component_name?: string;
  component_unit_type?: UnitType;
  component_cost_cents?: number;
  component_stock?: number;
  quantity: number;
}

export interface Product {
  id: number;
  sku: string;
  barcode: string | null;
  name: string;
  category_id: number | null;
  category_name?: string;
  unit_type: UnitType;
  cost_cents: number;
  stock_quantity: number;
  min_stock_alert: number;
  is_bundle: boolean;
  track_inventory: boolean;
  image_path: string | null;
  show_in_pos: boolean;
  is_active: boolean;
  prices: Record<number, number>; // price_tier_id -> price_cents
  bundle_items?: BundleItem[];
}

export interface PromotionRule {
  buy?: number;
  pay?: number;
  percent?: number;
  amount_cents?: number;
  min_qty?: number;
  unit_price_cents?: number;
}

export interface Promotion {
  id: number;
  name: string;
  type: PromoType;
  target_scope: PromoScope;
  target_id: number | null;
  rule: PromotionRule;
  valid_from: string | null;
  valid_until: string | null;
  days_of_week: number[]; // 1=Mon .. 7=Sun
  is_active: boolean;
}

export interface CashSession {
  id: number;
  opened_by_user_id: number;
  opened_by_name?: string;
  closed_by_user_id: number | null;
  closed_by_name?: string | null;
  opened_at: string;
  closed_at: string | null;
  opening_cash_cents: number;
  expected_cash_cents: number;
  declared_cash_cents: number | null;
  difference_cents: number | null;
  status: 'OPEN' | 'CLOSED';
  notes: string | null;
}

export interface CashMovement {
  id: number;
  cash_session_id: number;
  user_id: number;
  user_name?: string;
  type: 'IN' | 'OUT';
  amount_cents: number;
  reason: string;
  created_at: string;
}

export interface SaleItem {
  id: number;
  sale_id: number;
  product_id: number;
  product_name_snapshot: string;
  quantity: number;
  refunded_quantity?: number;
  unit_price_cents: number;
  cost_cents_snapshot: number;
  discount_cents: number;
  promo_label?: string | null;
  line_total_cents: number;
  price_overridden: boolean;
}

export interface SalePayment {
  id?: number;
  sale_id?: number;
  method: PaymentMethod;
  amount_cents: number;
  tendered_cents: number;
  change_cents: number;
}

export interface Sale {
  id: number;
  folio: string;
  cash_session_id: number;
  user_id: number;
  user_name?: string;
  price_tier_id: number;
  price_tier_name?: string;
  subtotal_cents: number;
  discount_cents: number;
  total_cents: number;
  status: SaleStatus;
  created_at: string;
  items: SaleItem[];
  payments: SalePayment[];
}

export interface InventoryMovement {
  id: number;
  product_id: number;
  product_name?: string;
  user_id: number;
  user_name?: string;
  type: InventoryMovementType;
  quantity_delta: number;
  stock_before: number;
  stock_after: number;
  reference_id: number | null;
  reason: string;
  created_at: string;
}

export interface AuditLog {
  id: number;
  user_id: number;
  user_name?: string;
  action: string;
  details: Record<string, unknown>;
  created_at: string;
}

export interface CorteSummary {
  session: CashSession;
  sales_count: number;
  voided_count: number;
  total_sales_cents: number;
  total_discounts_cents: number;
  total_refunds_cents: number;
  by_payment_method: {
    CASH: number;
    CARD: number;
    TRANSFER: number;
  };
  by_price_tier: Array<{
    tier_id: number;
    tier_name: string;
    sales_count: number;
    total_cents: number;
  }>;
  cash_in_cents: number;
  cash_out_cents: number;
  expected_cash_cents: number;
  movements: CashMovement[];
}

export interface AppSettings {
  business_name: string;
  business_address: string;
  business_phone: string;
  ticket_footer_1: string;
  ticket_footer_2: string;
  printer_mode: 'SPOOLER' | 'SERIAL' | 'PREVIEW';
  printer_name: string;
  printer_com_port: string;
  printer_baud_rate: number;
  printer_columns: 42 | 48;
  printer_codepage: 'CP850' | 'CP858';
  auto_open_drawer_on_cash: boolean;
  allow_negative_stock: boolean;
  backup_dir: string;
  backup_retention_days: number;
  sound_enabled: boolean;
}

export interface PrintResult {
  printed: boolean;
  mode: string;
  preview_text: string;
  escpos_hex_length: number;
  error?: string;
}

export interface CartLine {
  uid: string;
  product: Product;
  quantity: number;
  unit_price_cents: number;
  using_fallback_tier_price: boolean;
  price_overridden: boolean;
  manual_discount_cents: number;
  promo_discount_cents: number;
  promo_label: string | null;
  line_total_cents: number;
}

export interface HeldTicket {
  id: string;
  label: string;
  price_tier_id: number;
  lines: CartLine[];
  ticket_discount_type: 'PERCENT' | 'FIXED';
  ticket_discount_value: number;
  created_at: string;
}
