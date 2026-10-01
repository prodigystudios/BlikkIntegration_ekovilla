import { basePrices, pricelistContentHash, roundToOre, type ListPrice, type PricelistArticle } from './pricelist';

/**
 * Den nya butikens egen lista när inbjudan gått fram (RESELLER_PORTAL_CRM_PLAN.md 10b3). Rent; läsningen och köandet
 * bor i ./invitePricelistStore.ts.
 *
 * Williams beslut 2026-10-01: listan byggs på den PUBLICERADE lista 160, med kortets grundpriser ovanpå. Den nya butiken
 * får alltså samma grund som de andra butikerna fick det datumet, och det som ändrats i Fortnox eller i portalfälten
 * sedan dess går ut först vid nästa publicering.
 *
 * Samma regel som publiceringen (partnerPricelistSources.ts: 160 med partnerlistans grundpris där den har ett), lagd på
 * de publicerade artiklarna: ett pris är 160:s grundpris (`unitCost`), och en butiks lista byter bara ut det. Är 160
 * oförändrad sedan publiceringen blir listan exakt den publiceringen hade gett, med samma hash, så att nästa
 * publicering med samma innehåll räknas som samma.
 *
 * Skillnad mot publiceringen: en artikel som saknar pris på 160 men har ett på kortets lista kommer inte med här (den
 * fanns inte i den publicerade listan). Den kommer med vid nästa publicering.
 */
export function listFromPublished(published: PricelistArticle[], partnerPrices: ListPrice[]): { articles: PricelistArticle[]; hash: string } {
  const partner = basePrices(partnerPrices);
  const articles = published.map((article) => {
    const price = partner.get(article.articleNumber);
    return price === undefined ? article : { ...article, unitCost: roundToOre(price) };
  });
  return { articles, hash: pricelistContentHash(articles) };
}
