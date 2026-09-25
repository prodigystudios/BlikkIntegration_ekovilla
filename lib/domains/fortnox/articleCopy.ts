import type { FortnoxArticleInput, FortnoxArticlePriceInput } from './types';

/**
 * Kopiering av prods artikelregister (den lokala cachen) till Fortnox testbolag — ren logik utan
 * nätverk, så att urvalet och mappningen kan testas. Körs av
 * scripts/fortnox/copy-articles-to-test-company.ts, som också äger spärrarna mot fel databas/bolag.
 *
 * Cachen är inte en fullständig Fortnox-artikel: listendpointen skickar varken `Type` eller
 * prislistornas priser (bara standardlistans SalesPrice). Det som saknas blir Fortnox standardvärden,
 * och planen räknar hur många artiklar det gäller så att det syns innan något skrivs.
 */

/** En rad ur fortnox_articles_cache, som PostgREST levererar den (numeric kan komma som sträng). */
export type CachedArticleRow = {
  article_number: string;
  description: string | null;
  note: string | null;
  sales_price: number | string | null;
  purchase_price: number | string | null;
  unit: string | null;
  article_type: string | null;
  active: boolean;
  raw: Record<string, unknown> | null;
};

export type ArticleCopyItem = {
  articleNumber: string;
  input: FortnoxArticleInput;
  prices: FortnoxArticlePriceInput[];
  typeKnown: boolean;
};

export type ArticleCopyPlan = {
  items: ArticleCopyItem[];
  /** Enheter som saknas i testbolaget och skapas först. */
  unitsToCreate: string[];
  /** Enheter som finns i testbolaget med annan versal/gemen (t.ex. M3 → m3) och används som de är. */
  unitAliases: Record<string, string>;
  /** Artiklar som redan finns i testbolaget och lämnas orörda. */
  alreadyPresent: number;
};

function toNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Standardprislistan: "A" om testbolaget har den (Fortnox standard), annars den första. */
export function pickDefaultPriceList(lists: { code: string }[]): string | null {
  if (lists.some((l) => l.code === 'A')) return 'A';
  return lists[0]?.code ?? null;
}

export function cachedArticleToInput(
  row: CachedArticleRow,
  unit: string | null,
): { input: FortnoxArticleInput; typeKnown: boolean } {
  const raw = row.raw ?? {};
  const typeKnown = row.article_type === 'STOCK' || row.article_type === 'SERVICE';
  return {
    input: {
      ArticleNumber: row.article_number,
      Description: (row.description ?? '').trim() || row.article_number,
      PurchasePrice: toNumber(row.purchase_price),
      Unit: unit,
      // Okänd typ blir STOCK — samma som Fortnox eget standardval för en ny artikel.
      Type: typeKnown ? (row.article_type as FortnoxArticleInput['Type']) : 'STOCK',
      Active: row.active,
      VAT: typeof raw.VAT === 'number' ? raw.VAT : null,
      EAN: typeof raw.EAN === 'string' && raw.EAN.trim() ? raw.EAN.trim() : null,
      Manufacturer: null,
      ManufacturerArticleNumber: null,
      Note: row.note ?? null,
    },
    typeKnown,
  };
}

/**
 * Vad som ska göras i testbolaget: artiklarna som saknas där (jämfört mot testbolagets LEVANDE
 * register, inte mot cachens tidsstämplar), och enheterna de behöver.
 */
export function planArticleCopy(
  rows: CachedArticleRow[],
  presentArticleNumbers: Set<string>,
  presentUnits: string[],
  defaultPriceList: string | null,
): ArticleCopyPlan {
  const exactUnits = new Set(presentUnits);
  const byLowercase = new Map(presentUnits.map((u) => [u.toLowerCase(), u]));
  const unitsToCreate = new Set<string>();
  const unitAliases: Record<string, string> = {};

  const resolveUnit = (unit: string | null): string | null => {
    const code = unit?.trim() || null;
    if (!code || exactUnits.has(code)) return code;
    const existing = byLowercase.get(code.toLowerCase());
    if (existing) {
      unitAliases[code] = existing;
      return existing;
    }
    unitsToCreate.add(code);
    return code;
  };

  const missing = rows.filter((r) => !presentArticleNumbers.has(r.article_number));
  const items = missing
    .sort((a, b) => a.article_number.localeCompare(b.article_number, 'sv', { numeric: true }))
    .map((row) => {
      const { input, typeKnown } = cachedArticleToInput(row, resolveUnit(row.unit));
      const price = toNumber(row.sales_price);
      const prices = defaultPriceList && price !== null ? [{ priceList: defaultPriceList, price }] : [];
      return { articleNumber: row.article_number, input, prices, typeKnown };
    });

  return {
    items,
    unitsToCreate: [...unitsToCreate].sort(),
    unitAliases,
    alreadyPresent: rows.length - missing.length,
  };
}
