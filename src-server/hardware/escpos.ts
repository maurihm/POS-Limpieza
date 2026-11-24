import type { AppSettings, CorteSummary, Sale } from '../../src/types/index.ts';

// CP850 / CP858 Spanish & Latin characters mapping (never send raw UTF-8 to POS-80)
const CP850_MAP: Record<string, number> = {
  'Ç': 0x80, 'ü': 0x81, 'é': 0x82, 'â': 0x83, 'ä': 0x84, 'à': 0x85,
  'ç': 0x87, 'ê': 0x88, 'ë': 0x89, 'è': 0x8a, 'ï': 0x8b, 'î': 0x8c,
  'ì': 0x8d, 'Ä': 0x8e, 'É': 0x90, 'ô': 0x93, 'ö': 0x94, 'ò': 0x95,
  'û': 0x96, 'ù': 0x97, 'Ö': 0x99, 'Ü': 0x9a, '£': 0x9c, '×': 0x9e,
  'á': 0xa0, 'í': 0xa1, 'ó': 0xa2, 'ú': 0xa3, 'ñ': 0xa4, 'Ñ': 0xa5,
  'ª': 0xa6, 'º': 0xa7, '¿': 0xa8, '¡': 0xad, '«': 0xae, '»': 0xaf,
  'Á': 0xb5, 'Â': 0xb6, 'À': 0xb7, '©': 0xb8, '¢': 0xbd, '¥': 0xbe,
  'ã': 0xc6, 'Ã': 0xc7, '¤': 0xcf, 'Ê': 0xd2, 'Ë': 0xd3, 'È': 0xd4,
  '€': 0xd5, // CP858 Euro sign (0xD5)
  'Í': 0xd6, 'Î': 0xd7, 'Ï': 0xd8, 'Ó': 0xe0, 'ß': 0xe1, 'Ô': 0xe2,
  'Ò': 0xe3, 'õ': 0xe4, 'Õ': 0xe5, 'Ú': 0xe9, 'Û': 0xea, 'Ù': 0xeb,
  '°': 0xf8, '·': 0xfa, '²': 0xfd,
};

export function encodeCodepage(text: string, codepage: 'CP850' | 'CP858' = 'CP850'): Buffer {
  const bytes: number[] = [];
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (code >= 0x20 && code <= 0x7e) {
      bytes.push(code);
    } else if (code === 0x0a || code === 0x0d || code === 0x09) {
      bytes.push(code);
    } else if (ch === '€' && codepage === 'CP850') {
      bytes.push(0x45); // 'E' fallback on pure CP850
    } else if (CP850_MAP[ch] !== undefined) {
      bytes.push(CP850_MAP[ch]);
    } else {
      // Strip diacritics fallback
      const normalized = ch.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      const fallback = normalized.charCodeAt(0);
      bytes.push(fallback >= 0x20 && fallback <= 0x7e ? fallback : 0x3f);
    }
  }
  return Buffer.from(bytes);
}

// Mandatory ESC/POS commands per §3.2.C
export const ESC_INIT = Buffer.from([0x1b, 0x40]);
export const ESC_CP850 = Buffer.from([0x1b, 0x74, 0x02]);
export const ESC_CP858 = Buffer.from([0x1b, 0x74, 0x13]);
export const ESC_ALIGN_LEFT = Buffer.from([0x1b, 0x61, 0x00]);
export const ESC_ALIGN_CENTER = Buffer.from([0x1b, 0x61, 0x01]);
export const ESC_ALIGN_RIGHT = Buffer.from([0x1b, 0x61, 0x02]);
export const ESC_BOLD_ON = Buffer.from([0x1b, 0x45, 0x01]);
export const ESC_BOLD_OFF = Buffer.from([0x1b, 0x45, 0x00]);
export const ESC_SIZE_DOUBLE = Buffer.from([0x1d, 0x21, 0x11]);
export const ESC_SIZE_NORMAL = Buffer.from([0x1d, 0x21, 0x00]);
export const ESC_PARTIAL_CUT = Buffer.from([0x1d, 0x56, 0x42, 0x03]);
export const ESC_OPEN_DRAWER = Buffer.from([0x1b, 0x70, 0x00, 0x19, 0xfa]);

export class EscPosBuilder {
  private chunks: Buffer[] = [];
  private previewLines: string[] = [];
  private cols: number;
  private codepage: 'CP850' | 'CP858';

  constructor(cols: 42 | 48 = 48, codepage: 'CP850' | 'CP858' = 'CP850') {
    this.cols = cols;
    this.codepage = codepage;
    this.chunks.push(ESC_INIT);
    this.chunks.push(codepage === 'CP858' ? ESC_CP858 : ESC_CP850);
  }

  align(mode: 'LEFT' | 'CENTER' | 'RIGHT'): this {
    this.chunks.push(
      mode === 'CENTER' ? ESC_ALIGN_CENTER : mode === 'RIGHT' ? ESC_ALIGN_RIGHT : ESC_ALIGN_LEFT
    );
    return this;
  }

  bold(on: boolean): this {
    this.chunks.push(on ? ESC_BOLD_ON : ESC_BOLD_OFF);
    return this;
  }

  doubleSize(on: boolean): this {
    this.chunks.push(on ? ESC_SIZE_DOUBLE : ESC_SIZE_NORMAL);
    return this;
  }

  line(text = '', alignPreview: 'LEFT' | 'CENTER' | 'RIGHT' = 'LEFT'): this {
    this.chunks.push(encodeCodepage(`${text}\n`, this.codepage));
    if (alignPreview === 'CENTER') {
      const pad = Math.max(0, Math.floor((this.cols - text.length) / 2));
      this.previewLines.push(' '.repeat(pad) + text);
    } else if (alignPreview === 'RIGHT') {
      const pad = Math.max(0, this.cols - text.length);
      this.previewLines.push(' '.repeat(pad) + text);
    } else {
      this.previewLines.push(text);
    }
    return this;
  }

  separator(char = '-'): this {
    return this.line(char.repeat(this.cols));
  }

  twoCols(left: string, right: string): this {
    const maxLeft = Math.max(1, this.cols - right.length - 1);
    const trimmedLeft = left.length > maxLeft ? left.slice(0, maxLeft) : left;
    const spaces = Math.max(1, this.cols - trimmedLeft.length - right.length);
    return this.line(`${trimmedLeft}${' '.repeat(spaces)}${right}`);
  }

  openDrawer(): this {
    this.chunks.push(ESC_OPEN_DRAWER);
    return this;
  }

  cut(): this {
    this.chunks.push(ESC_PARTIAL_CUT);
    return this;
  }

  build(): { buffer: Buffer; preview: string } {
    return {
      buffer: Buffer.concat(this.chunks),
      preview: this.previewLines.join('\n'),
    };
  }
}

export function fmtMoney(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

function fmtDate(iso: string): string {
  const d = new Date(iso.replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return iso.slice(0, 19);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function paymentLabel(method: string): string {
  if (method === 'CASH') return 'Efectivo';
  if (method === 'CARD') return 'Tarjeta';
  if (method === 'TRANSFER') return 'Transferencia';
  return method;
}

export function buildSaleTicket(
  sale: Sale,
  settings: AppSettings,
  options: { isReprint?: boolean; openDrawer?: boolean } = {}
): { buffer: Buffer; preview: string } {
  const cols = settings.printer_columns || 48;
  const b = new EscPosBuilder(cols, settings.printer_codepage || 'CP850');

  if (options.isReprint) {
    b.align('CENTER').bold(true).line('*** REIMPRESIÓN ***', 'CENTER').bold(false);
  }

  b.align('CENTER').bold(true).doubleSize(true).line(settings.business_name, 'CENTER');
  b.doubleSize(false).bold(false);
  if (settings.business_address) b.line(settings.business_address, 'CENTER');
  if (settings.business_phone) b.line(settings.business_phone, 'CENTER');

  b.align('LEFT').separator('-');
  b.twoCols(`Folio: #${sale.folio}`, fmtDate(sale.created_at));
  b.twoCols(
    `Cajero: ${sale.user_name || 'Cajero'}`,
    `Tarifa: ${(sale.price_tier_name || 'TIENDA').toUpperCase()}`
  );
  b.separator('-');

  // Column header matching §3.2.D (48 or 42 cols)
  const descWidth = cols >= 48 ? 22 : 16;
  const header = `${'CANT'.padEnd(6)}${'DESCRIPCION'.padEnd(descWidth)}${'P.UNIT'.padStart(9)}${'IMPORTE'.padStart(10)}`;
  b.bold(true).line(header).bold(false);
  b.separator('-');

  for (const item of sale.items) {
    const qtyStr = item.quantity.toFixed(2).padEnd(6);
    const nameStr = item.product_name_snapshot.slice(0, descWidth).padEnd(descWidth);
    const unitStr = fmtMoney(item.unit_price_cents).padStart(9);
    const totalStr = fmtMoney(item.line_total_cents).padStart(10);
    b.line(`${qtyStr}${nameStr}${unitStr}${totalStr}`);
    if (item.discount_cents > 0) {
      const label = item.promo_label ? `  Promo: ${item.promo_label}` : '  Desc. línea';
      b.twoCols(label, `-${fmtMoney(item.discount_cents)}`);
    }
  }

  b.separator('-');
  b.twoCols('SUBTOTAL:', fmtMoney(sale.subtotal_cents));
  b.twoCols('DESCUENTO:', `-${fmtMoney(sale.discount_cents)}`);
  b.bold(true).doubleSize(true).twoCols('TOTAL:', fmtMoney(sale.total_cents)).doubleSize(false).bold(false);
  b.separator('-');

  let totalChange = 0;
  for (const p of sale.payments) {
    b.twoCols(`Pago (${paymentLabel(p.method)}):`, fmtMoney(p.tendered_cents));
    totalChange += p.change_cents;
  }
  if (totalChange > 0 || sale.payments.some((p) => p.method === 'CASH')) {
    b.twoCols('Cambio:', fmtMoney(totalChange));
  }

  b.separator('-');
  b.align('CENTER');
  if (settings.ticket_footer_1) b.line(settings.ticket_footer_1, 'CENTER');
  if (settings.ticket_footer_2) b.line(settings.ticket_footer_2, 'CENTER');
  b.line('');

  if (options.openDrawer) {
    b.openDrawer();
  }
  b.cut();
  return b.build();
}

export function buildCorteTicket(
  summary: CorteSummary,
  type: 'X' | 'Z',
  settings: AppSettings
): { buffer: Buffer; preview: string } {
  const cols = settings.printer_columns || 48;
  const b = new EscPosBuilder(cols, settings.printer_codepage || 'CP850');

  b.align('CENTER').bold(true).doubleSize(true).line(settings.business_name, 'CENTER');
  b.doubleSize(false).line(type === 'X' ? '=== CORTE X (CONSULTA EN VIVO) ===' : '=== CORTE Z (CIERRE DE CAJA) ===', 'CENTER').bold(false);
  b.align('LEFT').separator('-');
  b.twoCols(`Turno #${summary.session.id}`, fmtDate(new Date().toISOString()));
  b.twoCols('Abrió:', summary.session.opened_by_name || '-');
  if (type === 'Z' && summary.session.closed_by_name) {
    b.twoCols('Cerró:', summary.session.closed_by_name);
  }
  b.separator('-');
  b.twoCols('Tickets cobrados:', String(summary.sales_count));
  b.twoCols('Tickets cancelados:', String(summary.voided_count));
  b.twoCols('Descuentos:', fmtMoney(summary.total_discounts_cents));
  b.twoCols('Devoluciones:', fmtMoney(summary.total_refunds_cents));
  b.bold(true).twoCols('TOTAL VENTAS:', fmtMoney(summary.total_sales_cents)).bold(false);
  b.separator('-');
  b.bold(true).line('DESGLOSE POR MÉTODO DE PAGO').bold(false);
  b.twoCols('  Efectivo:', fmtMoney(summary.by_payment_method.CASH));
  b.twoCols('  Tarjeta:', fmtMoney(summary.by_payment_method.CARD));
  b.twoCols('  Transferencia:', fmtMoney(summary.by_payment_method.TRANSFER));
  b.separator('-');
  b.bold(true).line('DESGLOSE POR TARIFA').bold(false);
  for (const t of summary.by_price_tier) {
    b.twoCols(`  ${t.tier_name} (${t.sales_count}):`, fmtMoney(t.total_cents));
  }
  b.separator('-');
  b.bold(true).line('CONTROL DE EFECTIVO').bold(false);
  b.twoCols('  Fondo inicial:', fmtMoney(summary.session.opening_cash_cents));
  b.twoCols('  Ventas efectivo:', fmtMoney(summary.by_payment_method.CASH));
  b.twoCols('  Entradas (+):', fmtMoney(summary.cash_in_cents));
  b.twoCols('  Salidas (-):', fmtMoney(summary.cash_out_cents));
  b.bold(true).twoCols('  EFECTIVO ESPERADO:', fmtMoney(summary.expected_cash_cents)).bold(false);

  if (type === 'Z' && summary.session.declared_cash_cents !== null) {
    b.twoCols('  Efectivo contado:', fmtMoney(summary.session.declared_cash_cents));
    const diff = summary.session.difference_cents || 0;
    const diffLabel = diff === 0 ? 'Cuadrado' : diff > 0 ? 'Sobrante' : 'Faltante';
    b.bold(true).twoCols(`  Diferencia (${diffLabel}):`, fmtMoney(diff)).bold(false);
  }

  b.separator('-');
  b.align('CENTER').line(type === 'X' ? 'Turno sigue ABIERTO' : 'Turno CERRADO correctamente', 'CENTER');
  b.line('');
  b.cut();
  return b.build();
}

export function buildTestTicket(settings: AppSettings): { buffer: Buffer; preview: string } {
  const cols = settings.printer_columns || 48;
  const b = new EscPosBuilder(cols, settings.printer_codepage || 'CP850');
  b.align('CENTER').bold(true).doubleSize(true).line(settings.business_name, 'CENTER');
  b.doubleSize(false).line('PRUEBA DE IMPRESORA POS-80', 'CENTER').bold(false);
  b.align('LEFT').separator('=');
  b.twoCols('Columnas configuradas:', String(cols));
  b.twoCols('Tabla caracteres:', settings.printer_codepage || 'CP850');
  b.twoCols('Modo:', settings.printer_mode);
  b.separator('-');
  b.line('Prueba de acentos español:');
  b.line('á é í ó ú Á É Í Ó Ú ñ Ñ ü Ü ¡ ¿ $123.45');
  b.separator('-');
  b.line('1234567890'.repeat(Math.ceil(cols / 10)).slice(0, cols));
  b.separator('=');
  b.align('CENTER').line('Si ves este texto nítido,', 'CENTER');
  b.line('tu impresora POS-80 está lista.', 'CENTER');
  b.line('');
  b.cut();
  return b.build();
}

export function buildDrawerKickCommand(): Buffer {
  return Buffer.concat([ESC_INIT, ESC_OPEN_DRAWER]);
}
