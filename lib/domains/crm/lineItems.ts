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

export type LineItemContentSource = {
  article_name?: string | null;
  article_number?: string | null;
  construction?: string | null;
  m2?: string | null;
  thickness_mm?: string | null;
  quantity?: string | null;
  unit_price?: string | null;
  discount_percent?: string | null;
  line_note?: string | null;
  labor_cost?: string | null;
  density?: string | null;
  is_rot_work?: boolean | null;
};

// Har raden något som skulle gå förlorat om den togs bort? Styr om offertformulärets ta bort-kryss
// frågar först eller tar bort raden direkt: att kräva en bekräftelse för en rad utan innehåll är
// bara i vägen, medan en ifylld rad inte går att få tillbaka.
//
// `auto_price` och `house_work_type` räknas medvetet INTE som innehåll — de bär defaultvärden som
// en orörd rad har utan att någon valt dem, och hade gjort varje ny rad "ifylld".
export function isBlankLineItem(item: LineItemContentSource): boolean {
  const empty = (v: string | null | undefined) => !v || !v.trim();
  return (
    empty(item.article_name) &&
    empty(item.article_number) &&
    empty(item.construction) &&
    empty(item.m2) &&
    empty(item.thickness_mm) &&
    empty(item.quantity) &&
    empty(item.unit_price) &&
    empty(item.discount_percent) &&
    empty(item.line_note) &&
    empty(item.labor_cost) &&
    empty(item.density) &&
    !item.is_rot_work
  );
}
