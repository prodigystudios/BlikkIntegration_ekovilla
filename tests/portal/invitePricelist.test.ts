import { describe, expect, it } from 'vitest';
import { emptyPortalArticleFields, type PortalArticleFields } from '@/lib/domains/portal/articleFields';
import { listFromPublished } from '@/lib/domains/portal/invitePricelist';
import { overlayListPrices } from '@/lib/domains/portal/partnerPricelists';
import { buildPricelistDraft, pricelistContentHash, type ListPrice, type RegisterArticle } from '@/lib/domains/portal/pricelist';

/**
 * Den nya butikens lista när inbjudan gått fram (RESELLER_PORTAL_CRM_PLAN.md 10b3): den publicerade lista 160 med kortets
 * grundpriser ovanpå (Williams beslut 2026-10-01). Det som skyddas:
 *   - med en oförändrad 160 blir listan EXAKT den publiceringen hade byggt, med samma hash: nästa publicering med samma
 *     innehåll räknas då som samma, och butiken får inte en annan lista än den hade fått av en publicering;
 *   - bara kortets grundpris räknas (FromQuantity 0), och ett pris som inte är ett tal på 0 kr eller mer räknas inte;
 *   - en artikel som inte fanns i den publicerade 160 kommer inte med.
 */

function field(articleNumber: string, sortOrder: number): PortalArticleFields {
  return { ...emptyPortalArticleFields(articleNumber), customer_name: `Kund ${articleNumber}`, category: 'losull', publish: true, sort_order: sortOrder };
}
function reg(articleNumber: string): RegisterArticle {
  return { article_number: articleNumber, description: `Fortnox ${articleNumber}`, unit: 'st', active: true };
}
function price(articleNumber: string, value: number, fromQuantity = 0): ListPrice {
  return { articleNumber, fromQuantity, price: value };
}

const fields = [field('100', 10), field('200', 20), field('300', 30)];
const register = [reg('100'), reg('200'), reg('300')];
const prices160 = [price('100', 560), price('200', 99.5), price('300', 1200)];
const published = buildPricelistDraft({ fields, register, prices: prices160 });

describe('listFromPublished', () => {
  it('ger samma lista och hash som publiceringen hade byggt med en oförändrad 160', () => {
    const partner = [price('100', 650), price('300', 1100.004), price('300', 900, 10)];
    const fromBatch = buildPricelistDraft({ fields, register, prices: overlayListPrices(prices160, partner) });

    const list = listFromPublished(published.articles, partner);

    expect(list.articles).toEqual(fromBatch.articles);
    expect(list.hash).toBe(fromBatch.hash);
    expect(list.hash).not.toBe(published.hash);
  });

  it('byter bara grundpriset, avrundat till ören, och lämnar resten', () => {
    const list = listFromPublished(published.articles, [price('200', 120.456), price('100', 300, 5)]);

    expect(list.articles.map((a) => [a.articleNumber, a.unitCost])).toEqual([
      ['100', 560],
      ['200', 120.46],
      ['300', 1200],
    ]);
    expect(list.articles[1]).toEqual({ ...published.articles[1], unitCost: 120.46 });
    expect(list.hash).toBe(pricelistContentHash(list.articles));
  });

  it('räknar inte ett pris som inte är ett tal på 0 kr eller mer', () => {
    const list = listFromPublished(published.articles, [price('100', -1), price('200', Number.NaN), price('300', 0)]);
    expect(list.articles.map((a) => a.unitCost)).toEqual([560, 99.5, 0]);
  });

  it('tar inte med en artikel som inte fanns i den publicerade 160', () => {
    const list = listFromPublished(published.articles, [price('999', 10)]);
    expect(list.articles).toEqual(published.articles);
    expect(list.hash).toBe(published.hash);
  });
});
