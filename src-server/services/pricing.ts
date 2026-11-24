import type { Product, Promotion } from '../../src/types/index.ts';

/**
 * Half-Up rounding to nearest centavo per Edge Case #5 (e.g., 0.33 * 1500 = 495).
 */
export function roundHalfUpCents(value: number): number {
  if (value >= 0) {
    return Math.floor(value + 0.5 + 1e-9);
  }
  return -Math.floor(-value + 0.5 + 1e-9);
}

/**
 * Resolves the effective unit price for a product in a given price tier.
 * Falls back to the default tier (Tienda) if the selected tier has no price assigned.
 */
export function resolveProductPrice(
  product: Product,
  priceTierId: number,
  defaultTierId: number
): { price_cents: number; using_fallback: boolean } {
  const direct = product.prices[priceTierId];
  if (direct !== undefined && direct !== null) {
    return { price_cents: direct, using_fallback: false };
  }
  const fallback = product.prices[defaultTierId];
  return {
    price_cents: fallback !== undefined ? fallback : 0,
    using_fallback: priceTierId !== defaultTierId,
  };
}

/**
 * ISO day of week: 1 = Monday ... 7 = Sunday
 */
export function getIsoWeekday(date: Date): number {
  const d = date.getDay();
  return d === 0 ? 7 : d;
}

export function isPromotionActiveAt(promo: Promotion, now: Date = new Date()): boolean {
  if (!promo.is_active) return false;
  const isoDay = now.toISOString().slice(0, 10);
  if (promo.valid_from && isoDay < promo.valid_from.slice(0, 10)) return false;
  if (promo.valid_until && isoDay > promo.valid_until.slice(0, 10)) return false;
  if (promo.days_of_week && promo.days_of_week.length > 0) {
    const weekday = getIsoWeekday(now);
    if (!promo.days_of_week.includes(weekday)) return false;
  }
  return true;
}

export function evaluateBestLinePromotion(
  product: Product,
  quantity: number,
  unitPriceCents: number,
  promotions: Promotion[],
  now: Date = new Date()
): { discount_cents: number; promo_label: string | null } {
  const grossCents = roundHalfUpCents(quantity * unitPriceCents);
  let bestDiscount = 0;
  let bestLabel: string | null = null;

  for (const promo of promotions) {
    if (!isPromotionActiveAt(promo, now)) continue;
    const matches =
      promo.target_scope === 'ALL' ||
      (promo.target_scope === 'PRODUCT' && promo.target_id === product.id) ||
      (promo.target_scope === 'CATEGORY' && promo.target_id === product.category_id);

    if (!matches) continue;

    let discount = 0;
    const rule = promo.rule || {};

    if (promo.type === 'BUY_X_PAY_Y') {
      const buy = Number(rule.buy || 0);
      const pay = Number(rule.pay || 0);
      if (buy > 0 && pay >= 0 && buy > pay && quantity >= buy) {
        const groups = Math.floor(quantity / buy);
        const freeUnits = groups * (buy - pay);
        discount = roundHalfUpCents(freeUnits * unitPriceCents);
      }
    } else if (promo.type === 'PERCENT_DISCOUNT') {
      const pct = Number(rule.percent || 0);
      if (pct > 0 && pct <= 100) {
        discount = roundHalfUpCents((grossCents * pct) / 100);
      }
    } else if (promo.type === 'FIXED_AMOUNT_DISCOUNT') {
      const amt = Number(rule.amount_cents || 0);
      if (amt > 0) {
        discount = Math.min(grossCents, roundHalfUpCents(amt * quantity));
      }
    } else if (promo.type === 'BULK_QUANTITY_PRICE') {
      const minQty = Number(rule.min_qty || 0);
      const specialUnit = Number(rule.unit_price_cents || 0);
      if (minQty > 0 && quantity >= minQty && specialUnit >= 0 && specialUnit < unitPriceCents) {
        const discountedTotal = roundHalfUpCents(quantity * specialUnit);
        discount = Math.max(0, grossCents - discountedTotal);
      }
    }

    if (discount > bestDiscount) {
      bestDiscount = Math.min(grossCents, discount);
      bestLabel = promo.name;
    }
  }

  return { discount_cents: bestDiscount, promo_label: bestLabel };
}
