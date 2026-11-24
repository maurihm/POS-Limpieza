import type { Product, Promotion } from '../types';
import { roundHalfUpCents } from './money';

export function resolveProductPriceClient(
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

export function evaluateBestLinePromotionClient(
  product: Product,
  quantity: number,
  unitPriceCents: number,
  promotions: Promotion[],
  now: Date = new Date()
): { discount_cents: number; promo_label: string | null } {
  const grossCents = roundHalfUpCents(quantity * unitPriceCents);
  const pad = (n: number) => String(n).padStart(2, '0');
  const isoDay = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const jsDay = now.getDay();
  const isoWeekday = jsDay === 0 ? 7 : jsDay;

  let bestDiscount = 0;
  let bestLabel: string | null = null;

  for (const promo of promotions) {
    if (!promo.is_active) continue;
    if (promo.valid_from && isoDay < promo.valid_from.slice(0, 10)) continue;
    if (promo.valid_until && isoDay > promo.valid_until.slice(0, 10)) continue;
    if (promo.days_of_week && promo.days_of_week.length > 0 && !promo.days_of_week.includes(isoWeekday)) {
      continue;
    }

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
        discount = roundHalfUpCents(groups * (buy - pay) * unitPriceCents);
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
        discount = Math.max(0, grossCents - roundHalfUpCents(quantity * specialUnit));
      }
    }

    if (discount > bestDiscount) {
      bestDiscount = Math.min(grossCents, discount);
      bestLabel = promo.name;
    }
  }

  return { discount_cents: bestDiscount, promo_label: bestLabel };
}
