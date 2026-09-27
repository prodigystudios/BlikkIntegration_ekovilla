import { parseOptionalDecimal } from '@/lib/shared/number';
import { fortnoxGet, fortnoxPost } from './client';

/**
 * Prislistorna i Fortnox: att skapa en lista och att läsa alla priser på den. (Registret läses av
 * `listFortnoxPriceLists` i customers.ts, som kundkortet redan använder.)
 *
 * `GET /prices/sublist/{lista}` fungerar UTAN artikelnummer (provat mot testbolaget 2026-09-27):
 * 100 rader per sida som standard, `limit` och `page` fungerar, och varje rad har `ArticleNumber`,
 * `FromQuantity` och `Price` som tal. En artikel med mängdrabatt har en rad per `FromQuantity`;
 * grundpriset är raden med 0. Hur en BEFINTLIG lista utan priser svarar är inte provat.
 */

/**
 * Återförsäljarnas inpris: lista 160, "Byggvaruhandel". Det CRM:et publicerar till
 * återförsäljarportalen (RESELLER_PORTAL_CRM_PLAN.md, fas 2b).
 */
export const RESELLER_PRICE_LIST_CODE = '160';
export const RESELLER_PRICE_LIST_DESCRIPTION = 'Byggvaruhandel';

export type FortnoxListPrice = { articleNumber: string; fromQuantity: number; price: number };

type FortnoxPriceSublistResponse = {
  Prices?: { ArticleNumber?: string; FromQuantity?: unknown; Price?: unknown }[];
  MetaInformation?: { '@TotalPages'?: number };
};

const PRICE_PAGE_SIZE = '500';

/**
 * Alla priser på en prislista, alla sidor. En rad utan pris eller artikelnummer tas inte med —
 * tomt blir aldrig 0 kr. Ett fel från Fortnox (också 404) kastas: en publicering får aldrig tro
 * att en lista är tom för att den inte gick att läsa.
 */
export async function listFortnoxPriceListPrices(priceList: string): Promise<FortnoxListPrice[]> {
  const prices: FortnoxListPrice[] = [];
  for (let page = 1, pages = 1; page <= pages; page++) {
    const res = await fortnoxGet<FortnoxPriceSublistResponse>(`/prices/sublist/${encodeURIComponent(priceList)}`, {
      limit: PRICE_PAGE_SIZE,
      page: String(page),
    });
    for (const row of res.Prices ?? []) {
      const price = parseOptionalDecimal(row.Price);
      const fromQuantity = parseOptionalDecimal(row.FromQuantity);
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
