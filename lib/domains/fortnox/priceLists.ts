import { fortnoxGet, fortnoxPost } from './client';

/**
 * Prislistorna i Fortnox: att skapa en lista och att läsa alla priser på den.
 *
 * `GET /prices/sublist/{lista}` fungerar UTAN artikelnummer (provat mot testbolaget 2026-09-27):
 * 100 rader per sida som standard, `limit` och `page` fungerar, och varje rad har `ArticleNumber`,
 * `FromQuantity` och `Price` som tal. En artikel med mängdrabatt har en rad per `FromQuantity`;
 * grundpriset är raden med 0.
 */

export type FortnoxListPrice = { articleNumber: string; fromQuantity: number; price: number };

type FortnoxPriceSublistResponse = {
  Prices?: { ArticleNumber?: string; FromQuantity?: number | string; Price?: number | string | null }[];
  MetaInformation?: { '@TotalPages'?: number };
};

const PRICE_PAGE_SIZE = '500';

/** Tal eller null. `null` och tom sträng är inget pris — `Number('')` hade gjort dem till 0. */
function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || !value.trim()) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Alla priser på en prislista, alla sidor. En rad utan pris eller artikelnummer tas inte med. */
export async function listFortnoxPriceListPrices(priceList: string): Promise<FortnoxListPrice[]> {
  const prices: FortnoxListPrice[] = [];
  for (let page = 1, pages = 1; page <= pages; page++) {
    const res = await fortnoxGet<FortnoxPriceSublistResponse>(`/prices/sublist/${encodeURIComponent(priceList)}`, {
      limit: PRICE_PAGE_SIZE,
      page: String(page),
    });
    for (const row of res.Prices ?? []) {
      const price = toFiniteNumber(row.Price);
      const fromQuantity = toFiniteNumber(row.FromQuantity);
      if (!row.ArticleNumber || price === null || fromQuantity === null) continue;
      prices.push({ articleNumber: row.ArticleNumber, fromQuantity, price });
    }
    pages = res.MetaInformation?.['@TotalPages'] ?? 1;
  }
  return prices;
}

/** Skapar en prislista i registret. Koden är nyckeln och går inte att ändra efteråt. */
export async function createFortnoxPriceList(code: string, description: string): Promise<void> {
  await fortnoxPost<unknown>('/pricelists', { PriceList: { Code: code, Description: description } });
}
