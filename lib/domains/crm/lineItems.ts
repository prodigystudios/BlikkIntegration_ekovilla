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

export type LineItemPriceSource = {
  unit_price?: string | null;
  article_price?: number | null;
};

/**
 * Raden saknar prisförankring helt: varken skrivet A-pris eller vald artikel.
 *
 * `lineItemUnitPrice` svarar 0 på en sådan rad — och 0 är omöjligt att skilja från ett medvetet
 * nollpris när man bara ser summan. Det här predikatet skiljer dem åt: ett skrivet "0" ÄR ett
 * pris (en rad som ingår i priset), avsaknaden av källa är det inte.
 *
 * ⚠️ Finns för att stänga 900-stubben. Offertformuläret prissatte tidigare artikellösa rader med
 * en egen hårdkodad `computeUnitPrice()` som gav 900 kr/m³, medan varje annan yta — Fortnox-offert,
 * order, delfaktura, arbetsorderns artikelflik, planeringens ordervärde — räknade samma rad som
 * 0 kr. Säljaren såg alltså ett pris som aldrig nådde kundens dokument. Stubben är borta; det här
 * är spärren som ser till att hålet inte kan öppnas igen tyst, varken vid sparning eller push.
 */
export function isUnpricedLineItem(item: LineItemPriceSource): boolean {
  const hasExplicitPrice = item.unit_price != null && String(item.unit_price).trim() !== '';
  return !hasExplicitPrice && item.article_price == null;
}

export type LineItemConfiguredSource = {
  article_name?: string | null;
  m2?: string | null;
  quantity?: string | null;
  unit_price?: string | null;
};

/**
 * Raden är ifylld som en DEBITERBAR rad: den bär en artikel, en mängd eller ett pris.
 *
 * Smalare än motsatsen till `isBlankLineItem`, och det är hela poängen. En rad kan ha innehåll utan
 * att vara debiterbar — bara en radtext (`line_note`), bara en konstruktion, bara ett ikryssat
 * ROT-arbete. Sådana rader är tillåtna och pushas som textrader.
 *
 * ⚠️ ANVÄND SAMMA PREDIKAT PÅ BÅDA SIDOR om en rad ska ha ett pris. Offertformulärets spärr och
 * Fortnox-pushens spärr måste hålla med varandra: en form som säger "spara går bra" följd av en
 * push som svarar 409 gör offerten omöjlig att få iväg, utan att peka ut vilken rad det gäller.
 * Första utkastet av 900-fixen hade just den asymmetrin (formuläret läste den här definitionen,
 * pushen läste `isBlankLineItem`) — en ren textrad hade blivit permanent opushbar.
 */
export function isConfiguredLineItem(item: LineItemConfiguredSource): boolean {
  // String() och inte v.trim() rakt av: predikatet körs även på RÅ JSONB ur databasen
  // (assertLineItemsArePriced), och en gammal rad kan bära m2/quantity som tal. `.trim()` på ett tal
  // hade kastat TypeError inne i pushens try-block — alltså 500 och 'failed' i stället för det
  // 409-besked spärren finns för att ge. Samma försiktighet som isUnpricedLineItem.
  const filled = (v: unknown) => v != null && String(v).trim() !== '';
  return filled(item.article_name) || filled(item.m2) || filled(item.quantity) || filled(item.unit_price);
}
