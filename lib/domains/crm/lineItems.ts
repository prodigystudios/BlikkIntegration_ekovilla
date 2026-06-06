import { parseDecimal } from '@/lib/shared/number';

export type LineItemQuantitySource = {
  pricing_mode?: string | null;
  m2?: string | null;
  thickness_mm?: string | null;
  quantity?: string | null;
};

// Effective quantity for a quote/order line. For m³ pricing it is the computed
// volume (m² × thickness_mm / 1000); otherwise the entered quantity. Anything other
// than 'item' is treated as m³ (matching the quote form's default).
//
// Shared by the quote form's live totals and the Fortnox offer/order push so the
// pushed quantity always matches what the seller saw on screen.
export function lineItemQuantity(item: LineItemQuantitySource): number {
  const isM3 = (item.pricing_mode ?? 'm3') !== 'item';
  if (isM3) {
    return Math.max(0, parseDecimal(item.m2) * (parseDecimal(item.thickness_mm) / 1000));
  }
  return parseDecimal(item.quantity);
}
