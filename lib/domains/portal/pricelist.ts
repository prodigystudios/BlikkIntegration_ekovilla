import { createHash } from 'node:crypto';
import { canonicalJson } from './canonicalJson';
import {
  PORTAL_PUBLISH_BLOCKER_LABELS,
  portalPublishBlockers,
  type PortalArticleCategory,
  type PortalArticleFields,
  type PortalPublishBlocker,
} from './articleFields';

/**
 * Prislistan till återförsäljarportalen (kontraktet, "Flöde 1"; RESELLER_PORTAL_CRM_PLAN.md fas 2b). Ren: allt
 * läses av anroparen (pricelistPublish.ts) och skickas in, så att reglerna går att pröva utan Fortnox.
 *
 *   priset     grundpriset på lista 160, alltså raden med FromQuantity 0. Rader för mängdrabatt tas inte med.
 *   enheten    ur artikelregistret, med gemener (`m3`, `st`, `förp`). Portalen räknar bara `m3` ur yta och tjocklek.
 *   övrigt     portalfälten per artikel (fas 2a).
 *
 * En markerad artikel som är inaktiv, saknar enhet, saknar pris eller saknar namn skickas inte; den hamnar i
 * `skipped` med skälen, så att sidan kan visa den. Artiklar med pris på listan som inte är markerade hamnar i
 * `unmarked`, så att en ny artikel i Fortnox syns.
 *
 * Idempotency-Key är `pricelist-<validFrom>-<hash>`. Hashen tas över artiklarna, så samma innehåll och datum är samma
 * publicering, och portalen svarar på den som på den första.
 */

export const PRICELIST_PATH = '/api/ekovilla/pricelists';
/** Prislistorna går fram i den ordning de publicerades. */
export const PRICELIST_ORDERING_KEY = 'pricelist';

export type PricelistArticle = {
  articleNumber: string;
  name: string;
  customerName: string;
  note: string;
  category: PortalArticleCategory;
  unit: string;
  unitCost: number;
  laborShare: number;
  sortOrder: number;
};

export type PricelistPayload = {
  validFrom: string;
  /** null = listan gäller alla butiker (kontraktet). */
  resellerId: null;
  articles: PricelistArticle[];
};

/** En rad ur artikelregistret (`fortnox_articles_cache`). */
export type RegisterArticle = {
  article_number: string;
  description: string | null;
  unit: string | null;
  active: boolean;
};

/** En rad på prislistan, som `listFortnoxPriceListPrices` ger den. */
export type ListPrice = { articleNumber: string; fromQuantity: number; price: number };

export type PricelistSkipReason = PortalPublishBlocker | 'not_in_register' | 'missing_name' | 'incomplete_fields';

export const PRICELIST_SKIP_REASON_LABELS: Record<PricelistSkipReason, string> = {
  ...PORTAL_PUBLISH_BLOCKER_LABELS,
  not_in_register: 'Artikeln finns inte i artikelregistret',
  missing_name: 'Artikeln saknar namn i Fortnox',
  incomplete_fields: 'Kundnamn eller kategori saknas',
};

export type SkippedArticle = { articleNumber: string; customerName: string; reasons: PricelistSkipReason[] };
export type UnmarkedArticle = { articleNumber: string; name: string; unitCost: number };

export type PricelistDraft = {
  articles: PricelistArticle[];
  skipped: SkippedArticle[];
  unmarked: UnmarkedArticle[];
  hash: string;
};

/**
 * Kronor avrundade till hela ören (kontraktet). Via exponentnotation, så att 1.005 blir 1.01 och inte 1.00 som
 * `Math.round(1.005 * 100) / 100` ger.
 */
export function roundToOre(value: number): number {
  // Ett tal som redan skrivs med exponent (1e-7, 1e21) hade blivit "1e-7e2" = NaN; där räcker multiplikationen.
  if (/e/i.test(String(value))) return Math.round(value * 100) / 100;
  return Number(`${Math.round(Number(`${value}e2`))}e-2`);
}

/** Grundpriset per artikel: raden med FromQuantity 0. Ett pris som inte är ett tal på 0 kr eller mer räknas inte. */
export function basePrices(prices: ListPrice[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const p of prices) {
    if (p.fromQuantity !== 0 || out.has(p.articleNumber)) continue;
    if (!Number.isFinite(p.price) || p.price < 0) continue;
    out.set(p.articleNumber, p.price);
  }
  return out;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** sha256 (hex) av artiklarna som JSON med sorterade nycklar. Ordningen på artiklarna är en del av innehållet. */
export function pricelistContentHash(articles: PricelistArticle[]): string {
  return createHash('sha256').update(canonicalJson(articles), 'utf8').digest('hex');
}

export function pricelistIdempotencyKey(validFrom: string, hash: string): string {
  return `pricelist-${validFrom}-${hash}`;
}

export function buildPricelistDraft(input: {
  fields: PortalArticleFields[];
  register: RegisterArticle[];
  prices: ListPrice[];
}): PricelistDraft {
  const register = new Map(input.register.map((a) => [a.article_number, a]));
  const base = basePrices(input.prices);
  const articles: PricelistArticle[] = [];
  const skipped: (SkippedArticle & { sortOrder: number })[] = [];

  for (const f of input.fields) {
    if (!f.publish) continue;
    const skip = (reasons: PricelistSkipReason[]) =>
      skipped.push({ articleNumber: f.article_number, customerName: f.customer_name, reasons, sortOrder: f.sort_order });

    // Databasen kräver båda för en publicerad rad; prövas ändå, eftersom typen tillåter null.
    if (!f.category || !f.customer_name) {
      skip(['incomplete_fields']);
      continue;
    }
    const article = register.get(f.article_number);
    if (!article) {
      skip(['not_in_register']);
      continue;
    }
    const price = base.get(f.article_number) ?? null;
    const reasons: PricelistSkipReason[] = portalPublishBlockers({ active: article.active, unit: article.unit, resellerPrice: price });
    const name = article.description?.trim() ?? '';
    if (!name) reasons.push('missing_name');
    // `price` och `unit` är redan prövade av portalPublishBlockers; de står här för typens skull.
    if (reasons.length > 0 || price === null || !article.unit) {
      skip(reasons);
      continue;
    }

    articles.push({
      articleNumber: f.article_number,
      name,
      customerName: f.customer_name,
      note: f.note,
      category: f.category,
      unit: article.unit.trim().toLowerCase(),
      unitCost: roundToOre(price),
      laborShare: f.labor_share,
      sortOrder: f.sort_order,
    });
  }

  const bySortThenNumber = (a: { sortOrder: number; articleNumber: string }, b: { sortOrder: number; articleNumber: string }) =>
    a.sortOrder - b.sortOrder || compareText(a.articleNumber, b.articleNumber);
  articles.sort(bySortThenNumber);
  skipped.sort(bySortThenNumber);

  const marked = new Set(input.fields.filter((f) => f.publish).map((f) => f.article_number));
  const unmarked: UnmarkedArticle[] = [];
  for (const [articleNumber, price] of base) {
    if (marked.has(articleNumber)) continue;
    const article = register.get(articleNumber);
    // Bara aktiva artiklar i registret: en inaktiv med pris kvar på listan är inget att ta ställning till.
    if (!article?.active) continue;
    unmarked.push({ articleNumber, name: article.description?.trim() ?? '', unitCost: roundToOre(price) });
  }
  unmarked.sort((a, b) => compareText(a.articleNumber, b.articleNumber));

  return {
    articles,
    skipped: skipped.map(({ sortOrder: _sortOrder, ...rest }) => rest),
    unmarked,
    hash: pricelistContentHash(articles),
  };
}

// ---------------------------------------------------------------------------------------------------- giltig från

/** `YYYY-MM-DD` som är ett riktigt datum (inte 2026-02-30). */
export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/**
 * Giltig från: i dag eller senare (William 2026-09-28). `today` är den svenska dagen (`stockholmTodayISO`), inte
 * UTC: mellan midnatt och två på natten är UTC-dagen fortfarande i går.
 */
export function isAllowedValidFrom(validFrom: string, today: string): boolean {
  return isIsoDate(validFrom) && validFrom >= today;
}
