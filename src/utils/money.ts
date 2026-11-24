import type { UnitType } from '../types';

export function formatCents(cents: number): string {
  const safe = Number.isFinite(cents) ? cents : 0;
  const sign = safe < 0 ? '-' : '';
  return `${sign}$${(Math.abs(safe) / 100).toLocaleString('es-MX', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function pesosToCents(pesos: string | number): number {
  const cleaned = String(pesos).replace(/[$,\s]/g, '');
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

export function centsToPesosInput(cents: number | undefined | null): string {
  if (cents === undefined || cents === null) return '';
  return (cents / 100).toFixed(2);
}

export function roundHalfUpCents(value: number): number {
  if (value >= 0) {
    return Math.floor(value + 0.5 + 1e-9);
  }
  return -Math.floor(-value + 0.5 + 1e-9);
}

export function formatQty(qty: number, unit: UnitType): string {
  if (unit === 'PIECE') {
    return Number.isInteger(qty) ? String(qty) : qty.toFixed(2);
  }
  return Number.isInteger(qty) ? String(qty) : Number(qty.toFixed(3)).toString();
}

export function unitShort(unit: UnitType): string {
  if (unit === 'LITER') return 'L';
  if (unit === 'WEIGHT') return 'kg';
  return 'pz';
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso.replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('es-MX', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function todayIsoDate(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
