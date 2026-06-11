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

// Raw per-unit price: the explicit override when set, else the article's catalogue price.
export function lineItemUnitPrice(item: Pick<PricingLineItem, 'unit_price' | 'article_price'>): number {
  const explicit = item.unit_price != null && String(item.unit_price).trim() !== '';
  return explicit ? parseDecimal(item.unit_price) : (item.article_price ?? 0);
}

// Discount percentage, clamped to [0,100].
export function lineItemDiscountPercent(item: Pick<PricingLineItem, 'discount_percent'>): number {
  return Math.min(100, Math.max(0, parseDecimal(item.discount_percent)));
}

// Unit price after discount (never negative). The SINGLE source of truth for every per-row money
// calculation — line totals, recorded invoice-round amounts, the Fortnox row price basis, and the
// UI breakdowns all derive from this, so the figure can never drift between them.
export function lineItemEffectiveUnitPrice(
  item: Pick<PricingLineItem, 'unit_price' | 'article_price' | 'discount_percent'>,
): number {
  return Math.max(0, lineItemUnitPrice(item) * (1 - lineItemDiscountPercent(item) / 100));
}

// Row total = effective quantity (m³ volume or entered amount) × discounted unit price.
export function lineItemRowTotal(item: PricingLineItem): number {
  return Math.max(0, lineItemQuantity(item) * lineItemEffectiveUnitPrice(item));
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

// ─── VAT display convention (agreed with finance) ──────────────────────────────
// How a quote's amount is presented to the seller / customer differs by customer type:
//   • private customer  → lead with the price to pay INCL moms (what they actually pay)
//   • business customer → lead with the price EX moms, with the moms shown alongside
// The figures themselves come from the stored pricing_summary, which is always
// {subtotal: ex moms, vat, total: incl moms} in both the line-item and manual-amount
// save paths — so display is unambiguous even though the scalar `amount` is not.

export type QuoteVatBreakdown = { subtotal: number; vat: number; total: number; vatPercent: number };

// Resolve a quote's VAT breakdown for display. Prefers the stored pricing_summary;
// for legacy rows that predate it, derives from the scalar amount + vat%, treating
// `amount` as the incl-moms total (the line-item path's meaning, the common case).
export function resolveQuoteVatBreakdown(input: {
  pricing_summary?: { subtotal?: number; vat?: number; total?: number } | null;
  amount?: number | string | null;
  vat_percent?: number | string | null;
}): QuoteVatBreakdown {
  const vatPercent = parseDecimal(input.vat_percent, 25);
  const ps = input.pricing_summary;
  const isNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
  if (ps && isNum(ps.subtotal) && isNum(ps.total)) {
    const vat = isNum(ps.vat) ? ps.vat : ps.total - ps.subtotal;
    return { subtotal: ps.subtotal, vat, total: ps.total, vatPercent };
  }
  // Legacy fallback: treat the scalar amount as the incl-moms total and split out moms.
  const total = parseDecimal(input.amount, 0);
  const subtotal = vatPercent > 0 ? total / (1 + vatPercent / 100) : total;
  return { subtotal, vat: total - subtotal, total, vatPercent };
}

export type QuoteAmountDisplay = {
  isPrivate: boolean;
  reverseCharge: boolean; // omvänd skattskyldighet (byggmoms): business customer billed at 0 % VAT
  primary: number;      // the headline figure for this customer type
  primaryLabel: string; // label for the headline ('Att betala inkl. moms' | 'Belopp ex moms')
  basisSuffix: string;  // compact basis tag for list rows ('inkl. moms' | 'ex moms')
} & QuoteVatBreakdown;

// Apply the display convention to a resolved breakdown. Pure — the caller formats the
// numbers (locale/currency) so this stays unit-testable and UI-agnostic.
//
// Reverse charge (omvänd skattskyldighet / byggmoms) = a business quote at 0 % VAT: the buyer
// accounts for the VAT, so we lead with the ex-moms amount and label it explicitly rather than
// showing a plain "0 % moms" that reads like a waiver.
export function quoteAmountDisplay(
  quoteType: 'private' | 'business',
  breakdown: QuoteVatBreakdown,
): QuoteAmountDisplay {
  const isPrivate = quoteType === 'private';
  const reverseCharge = !isPrivate && breakdown.vatPercent === 0;
  return {
    ...breakdown,
    isPrivate,
    reverseCharge,
    primary: isPrivate ? breakdown.total : breakdown.subtotal,
    primaryLabel: isPrivate ? 'Att betala inkl. moms' : reverseCharge ? 'Belopp (omvänd skattskyldighet)' : 'Belopp ex moms',
    basisSuffix: isPrivate ? 'inkl. moms' : reverseCharge ? 'omvänd skattskyldighet' : 'ex moms',
  };
}
