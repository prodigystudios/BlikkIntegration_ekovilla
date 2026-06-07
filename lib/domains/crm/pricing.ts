import { parseDecimal } from '@/lib/shared/number';
import { lineItemQuantity } from './lineItems';

// Shared CRM line-item pricing. Single source of truth so the quote form, the work
// order article editor, the server recompute, and the Fortnox row builder never
// diverge. Price source matches buildOrderRows/buildOfferRows: explicit `unit_price`
// when set, otherwise the chosen article's `article_price`. (The quote form keeps its
// own `computeUnitPrice` stub for auto-priced rows without a chosen article — those are
// a quote-stage concern; work order rows always carry a concrete price.)

export type PricingLineItem = {
  pricing_mode?: string | null;
  m2?: string | null;
  thickness_mm?: string | null;
  quantity?: string | null;
  unit_price?: string | null;
  article_price?: number | null;
  discount_percent?: string | null;
  is_rot_work?: boolean | null;
};

export type RotPricingInput = {
  enabled?: boolean | null;
  rot_percent?: number | string | null;
  max_deduction?: number | string | null;
};

export type PricingSummary = {
  subtotal: number;
  vat: number;
  total: number;
  vatPercent: number;
  rotDeduction: number;
  toPay: number;
};

function unitPrice(item: PricingLineItem): number {
  const explicit = item.unit_price != null && String(item.unit_price).trim() !== '';
  return explicit ? parseDecimal(item.unit_price) : (item.article_price ?? 0);
}

// Row total = effective quantity (m³ volume or entered amount) × unit price × (1 − discount).
export function lineItemRowTotal(item: PricingLineItem): number {
  const quantity = lineItemQuantity(item);
  const discount = Math.min(100, Math.max(0, parseDecimal(item.discount_percent)));
  const effectiveUnit = Math.max(0, unitPrice(item) * (1 - discount / 100));
  return Math.max(0, quantity * effectiveUnit);
}

export function computePricing(
  items: PricingLineItem[],
  vatPercentInput: number | string | null,
  opts?: { isPrivate?: boolean; rot?: RotPricingInput | null },
): PricingSummary {
  const subtotal = Math.max(0, items.reduce((sum, item) => sum + lineItemRowTotal(item), 0));
  const vatPercent = parseDecimal(vatPercentInput, 25);
  const vat = Math.max(0, subtotal * (vatPercent / 100));
  const total = subtotal + vat;

  // ROT (private only): tax-reduction % of the husarbete rows' amount INCL VAT, capped at
  // the max deduction, floored to whole krona (matches Fortnox/Skatteverket — see quotes).
  const rotActive = Boolean(opts?.isPrivate && opts?.rot?.enabled);
  const rotBaseInclVat = rotActive
    ? items.filter((i) => i.is_rot_work).reduce((sum, i) => sum + lineItemRowTotal(i) * (1 + vatPercent / 100), 0)
    : 0;
  const rotPercent = parseDecimal(opts?.rot?.rot_percent ?? 30, 30);
  const maxDeduction = parseDecimal(opts?.rot?.max_deduction ?? 50000, 50000);
  const rotDeduction = rotActive ? Math.min(maxDeduction, Math.floor(rotBaseInclVat * (rotPercent / 100))) : 0;

  return { subtotal, vat, total, vatPercent, rotDeduction, toPay: total - rotDeduction };
}
