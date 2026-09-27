import { z } from 'zod';
import type { FortnoxListPrice } from './priceLists';

/**
 * Prislista 160 (Byggvaruhandel) till Fortnox TESTBOLAG — ren logik utan nätverk, så att urvalet
 * kan testas. Körs av scripts/fortnox/copy-price-list-160-to-test-company.ts, som äger spärrarna
 * mot fel databas och fel bolag.
 *
 * Källan är portalens handinlästa kopia av prods lista, `PRICELIST` i portalrepots
 * `lib/data/mock/seed.ts`. Prods Fortnox läses aldrig härifrån: en tokenförnyelse roterar
 * refresh-token och kopplar ur prod.
 */

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
  /** Grundpriser på listan vars artikel inte står i källan. Rörs inte, men listan avviker från källan. */
  notInSource: string[];
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

/**
 * Samma pris på öret. Jämförs med en halv öres marginal i stället för att avrunda båda, så att
 * flyttalsbrus (1.1 + 2.2) inte blir en ändring och priset aldrig behöver avrundas innan det skickas.
 */
export function samePrice(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.005;
}

const byArticleNumber = (a: string, b: string) => a.localeCompare(b, 'sv', { numeric: true });

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
  const plan: PriceListCopyPlan = {
    toCreate: [],
    toUpdate: [],
    unchanged: 0,
    missingArticles: [],
    rejected: [],
    notInSource: [],
  };

  // En artikel som står flera gånger får inget pris alls: vilket pris som gäller går inte att veta.
  const occurrences = new Map<string, number>();
  for (const item of source) occurrences.set(item.articleNumber, (occurrences.get(item.articleNumber) ?? 0) + 1);

  const sorted = [...source].sort((a, b) => byArticleNumber(a.articleNumber, b.articleNumber));
  for (const item of sorted) {
    const count = occurrences.get(item.articleNumber) ?? 0;
    if (count > 1) {
      if (!plan.rejected.some((r) => r.articleNumber === item.articleNumber)) {
        plan.rejected.push({ articleNumber: item.articleNumber, reason: `står ${count} gånger i källan, inget pris sätts` });
      }
      continue;
    }

    // 0 kr är inget inpris — det hade publicerats till portalen som ett riktigt pris.
    if (!Number.isFinite(item.price) || item.price <= 0) {
      plan.rejected.push({ articleNumber: item.articleNumber, reason: `ogiltigt pris ${item.price}` });
      continue;
    }
    if (!presentArticleNumbers.has(item.articleNumber)) {
      plan.missingArticles.push(item.articleNumber);
      continue;
    }

    const current = basePrice.get(item.articleNumber);
    if (current === undefined) {
      plan.toCreate.push({ articleNumber: item.articleNumber, price: item.price });
    } else if (samePrice(current, item.price)) {
      plan.unchanged += 1;
    } else {
      plan.toUpdate.push({ articleNumber: item.articleNumber, price: item.price, current });
    }
  }

  plan.notInSource = [...basePrice.keys()].filter((n) => !occurrences.has(n)).sort(byArticleNumber);
  return plan;
}
