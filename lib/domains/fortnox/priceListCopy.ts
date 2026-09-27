import { z } from 'zod';
import type { FortnoxListPrice } from './priceLists';

/**
 * Prislista 160 (Byggvaruhandel) till Fortnox TESTBOLAG — ren logik utan nätverk, så att urvalet
 * kan testas. Körs av scripts/fortnox/copy-price-list-160-to-test-company.ts, som äger spärrarna
 * mot fel databas och fel bolag.
 *
 * Lista 160 är återförsäljarnas inpris och det CRM:et ska publicera till återförsäljarportalen
 * (RESELLER_PORTAL_CRM_PLAN.md, fas 2b). Källan är portalens handinlästa kopia av prods lista,
 * `PRICELIST` i portalrepots `lib/data/mock/seed.ts`. Prods Fortnox läses aldrig härifrån: en
 * tokenförnyelse roterar refresh-token och kopplar ur prod.
 */

export const RESELLER_PRICE_LIST_CODE = '160';
export const RESELLER_PRICE_LIST_DESCRIPTION = 'Byggvaruhandel';

export type SourcePrice = { articleNumber: string; price: number };

export type PriceListCopyPlan = {
  /** Grundpriset saknas på listan och skapas. */
  toCreate: SourcePrice[];
  /** Grundpriset finns men skiljer sig från källan. */
  toUpdate: (SourcePrice & { current: number })[];
  /** Grundpriset stämmer redan på öret. */
  unchanged: number;
  /** Artikeln finns inte i testbolaget, så inget pris kan sättas. Kör artikelkopieringen först. */
  missingArticles: string[];
  /** Rader i källan som inte skickas alls. */
  rejected: { articleNumber: string; reason: string }[];
};

// Portalens `Pricelist`: bara fälten som behövs här; resten av artikeln får finnas.
const portalPricelistSchema = z.object({
  validFrom: z.string(),
  articles: z
    .array(z.object({ articleNumber: z.string().trim().min(1), unitCost: z.number().finite() }))
    .min(1),
});

/** Läser portalens `PRICELIST`. Kastar med en läsbar förklaring om formen har ändrats. */
export function parsePortalPricelist(value: unknown): { validFrom: string; prices: SourcePrice[] } {
  const parsed = portalPricelistSchema.safeParse(value);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.') || '(roten)'}: ${i.message}`);
    throw new Error(`Portalens PRICELIST har inte den väntade formen — ${issues.slice(0, 5).join('; ')}`);
  }
  return {
    validFrom: parsed.data.validFrom,
    prices: parsed.data.articles.map((a) => ({ articleNumber: a.articleNumber, price: a.unitCost })),
  };
}

/** Kronor → hela ören. Jämförelsen och det som skickas går på ören, så flyttalsbrus aldrig blir en ändring. */
export function toOre(kronor: number): number {
  return Math.round(kronor * 100);
}

/**
 * Vad som ska göras på testbolagets lista: jämför källans pris med listans GRUNDPRIS
 * (`FromQuantity` 0). Rader med mängdrabatt rörs inte.
 */
export function planPriceListCopy(
  source: SourcePrice[],
  presentArticleNumbers: Set<string>,
  existing: FortnoxListPrice[],
): PriceListCopyPlan {
  const basePrice = new Map(existing.filter((p) => p.fromQuantity === 0).map((p) => [p.articleNumber, p.price]));
  const plan: PriceListCopyPlan = { toCreate: [], toUpdate: [], unchanged: 0, missingArticles: [], rejected: [] };
  const seen = new Set<string>();

  const sorted = [...source].sort((a, b) => a.articleNumber.localeCompare(b.articleNumber, 'sv', { numeric: true }));
  for (const item of sorted) {
    if (seen.has(item.articleNumber)) {
      plan.rejected.push({ articleNumber: item.articleNumber, reason: 'står flera gånger i källan' });
      continue;
    }
    seen.add(item.articleNumber);

    if (!Number.isFinite(item.price) || item.price < 0) {
      plan.rejected.push({ articleNumber: item.articleNumber, reason: `ogiltigt pris ${item.price}` });
      continue;
    }
    if (!presentArticleNumbers.has(item.articleNumber)) {
      plan.missingArticles.push(item.articleNumber);
      continue;
    }

    const price = toOre(item.price) / 100;
    const current = basePrice.get(item.articleNumber);
    if (current === undefined) {
      plan.toCreate.push({ articleNumber: item.articleNumber, price });
    } else if (toOre(current) === toOre(price)) {
      plan.unchanged += 1;
    } else {
      plan.toUpdate.push({ articleNumber: item.articleNumber, price, current });
    }
  }
  return plan;
}
