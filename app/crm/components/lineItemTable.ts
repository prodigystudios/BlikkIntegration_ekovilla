// Vad artikeltabellens celler visar för en rad: underraden under namnet, mängdens enhet, à-priset och
// rabatten. Delad mellan offertens och arbetsorderns tabell (LineItemRow). Ren logik, enhetstestad —
// den ligger utanför "use client"-filen just för det.

import { parseDecimal } from '@/lib/shared/number';
import { formatQuantity } from '@/app/crm/lib/format';

export type LineItemTableFields = {
  article_number?: string | null;
  article_unit_name?: string | null;
  pricing_mode?: 'm3' | 'item';
  m2?: string;
  thickness_mm?: string;
  density?: string;
  discount_percent?: string;
};

/**
 * En enhet som den ska LÄSAS: Fortnox skriver "m3" och "m2", tabellen "m³" och "m²". Bara visning —
 * själva enhetsnamnet på raden (article_unit_name) och prisläget som härleds ur det rörs inte.
 */
export function displayUnit(unit: string): string {
  const u = unit.trim();
  if (/^m3$/i.test(u)) return 'm³';
  if (/^m2$/i.test(u)) return 'm²';
  return u;
}

/**
 * Enheten raden prissätts i: m³ för en kubikrad, annars artikelns enhet (st om den saknas).
 *
 * En kubikartikel som prissätts per styck (arbetsorderns "Pris per st") räknas i STYCK, inte i m³ —
 * annars stod "Antal 5 m³" och "kr/m³" bredvid knappen som säger "Pris per st".
 */
export function lineItemUnitLabel(row: LineItemTableFields): string {
  if ((row.pricing_mode ?? 'm3') === 'm3') return 'm³';
  const unit = displayUnit(row.article_unit_name ?? '');
  return !unit || unit === 'm³' ? 'st' : unit;
}

// Ett mått som det skrevs ("19,5"), som tal ("19,5") — eller inget alls när det saknas eller är noll.
function measure(value: string | undefined, unit: string): string | null {
  const n = parseDecimal(value);
  return n > 0 ? `${formatQuantity(n)} ${unit}` : null;
}

/**
 * Raden under artikelnamnet: artikelnumret och, för en kubikrad, måtten volymen räknas ur. Det är de
 * som avgör beloppet, så de ska synas utan att raden fälls ut. Styckrader har inga mått.
 */
export function lineItemSubline(row: LineItemTableFields): string {
  const parts: string[] = [];
  if (row.article_number?.trim()) parts.push(`Art.nr ${row.article_number.trim()}`);
  if ((row.pricing_mode ?? 'm3') === 'm3') {
    const measures = [measure(row.m2, 'm²'), measure(row.thickness_mm, 'mm'), measure(row.density, 'kg/m³')].filter(Boolean);
    if (measures.length) parts.push(measures.join(', '));
  }
  return parts.join(', ');
}

/**
 * Ett à-pris. Till skillnad från beloppen (formatCurrency, hela kronor) behåller det ören: 85,50 kr
 * avrundat till "86 kr" i à-priskolumnen hade inte gått att räkna radens belopp ur.
 */
const WHOLE_KRONOR = new Intl.NumberFormat('sv-SE', { style: 'currency', currency: 'SEK', maximumFractionDigits: 0 });
const WITH_ORE = new Intl.NumberFormat('sv-SE', { style: 'currency', currency: 'SEK', minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function formatUnitPrice(value: number): string {
  if (!Number.isFinite(value)) return '–';
  // Avrundat till ören FÖRST: avgörs "hela kronor" på det oavrundade talet blir 85,995 "86,00 kr"
  // medan 85,996 blir "86 kr" — samma kolumn i två format.
  const rounded = Math.round(value * 100) / 100;
  return (Number.isInteger(rounded) ? WHOLE_KRONOR : WITH_ORE).format(rounded);
}

/** Rabatten som den står i kolumnen: "10 %", eller ett streck när raden saknar rabatt. */
export function formatDiscount(discountPercent: string | undefined): string {
  const n = parseDecimal(discountPercent);
  return n > 0 ? `${formatQuantity(n)} %` : '–';
}

// ─── Tabellens kolumner ───────────────────────────────────────────────────────
// Här och inte i LineItemRow, så att den genererade ROT-raden (LineItemSummary) står i samma kolumner.

// Kolumnerna. Raden är två nivåer: numret (med draghandtaget) och en KNAPP som bär resten av cellerna —
// draghandtaget är självt en knapp och kan inte ligga inuti radens. Knappens egna rutnät har samma fasta
// bredder som rubrikens, så kolumnerna står i linje utan subgrid.
//
// Klasserna står utskrivna i sin helhet: Tailwind hittar bara klassnamn som finns ordagrant i källan.
export const ROW_OUTER = 'grid grid-cols-[1.5rem_minmax(0,1fr)] items-center gap-x-3 px-3';

export function innerColumns(marginColumn: boolean, interactive: boolean): string {
  if (marginColumn) {
    return interactive
      ? 'md:grid-cols-[minmax(0,1fr)_6.5rem_6.5rem_4rem_5.25rem_7.5rem_1.5rem]'
      : 'md:grid-cols-[minmax(0,1fr)_6.5rem_6.5rem_4rem_5.25rem_7.5rem]';
  }
  return interactive
    ? 'md:grid-cols-[minmax(0,1fr)_6.5rem_6.5rem_4rem_7.5rem_1.5rem]'
    : 'md:grid-cols-[minmax(0,1fr)_6.5rem_6.5rem_4rem_7.5rem]';
}

// Telefonen: namn och belopp, med "mängd × à-pris" på en rad under. Kolumnerna kommer från md.
export const INNER_BASE = 'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5';
