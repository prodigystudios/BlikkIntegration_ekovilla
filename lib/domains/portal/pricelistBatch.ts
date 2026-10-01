import { createHash } from 'node:crypto';
import { RESELLER_PRICE_LIST_CODE } from '@/lib/domains/fortnox/priceLists';
import { canonicalJson } from './canonicalJson';
import type { PortalStoreCard } from './partnerPricelists';
import type { PartnerPricelistsPreview } from './partnerPricelistSources';
import type { PricelistArticle, PricelistDraft } from './pricelist';

/**
 * Vad en publicering består av (RESELLER_PORTAL_CRM_PLAN.md 10b2). Rent.
 *
 * Williams beslut 2026-10-01: alla listor publiceras samtidigt, med samma giltighetsdatum. En publicering är därför
 * den gemensamma listan och en egen lista per butik som ska ha en:
 *   - butiker vars kundkort har en egen lista i Fortnox: 160 med kortets avvikande priser;
 *   - butiker som en gång haft en egen lista men inte har det nu: 160, som egen lista. Portalen väljer i dag alltid en
 *     butiks egen lista före den gemensamma, och en sådan butik hade annars räknat på sin gamla lista för alltid. Det blir
 *     rätt också om portalen byter till "senaste datum vinner".
 * En butik vars inbjudan inte gått fram finns inte i portalen än, och kan inte få någon lista. Den väntar (10b3 skickar
 * listan när inbjudan gått fram). Ett kort eller en lista som inte gick att läsa stoppar hela publiceringen.
 */

export type PricelistBatchItem = {
  /** null = den gemensamma listan. */
  resellerId: string | null;
  /** Listan i Fortnox som priserna kommer från. */
  code: string;
  articles: PricelistArticle[];
  hash: string;
};

export type PricelistBatchDraft = {
  /** Den gemensamma listan först, sedan butikerna i id-ordning. */
  items: PricelistBatchItem[];
  /** Förhandsvisningens hash: publiceringen görs bara om allt fortfarande ser ut så. */
  hash: string;
  /** Butiker med en egen lista vars inbjudan inte gått fram. */
  waiting: PortalStoreCard[];
  problems: PartnerPricelistsPreview['problems'];
};

/**
 * Hashen över hela publiceringen. Med bara den gemensamma listan är den listans egen hash: då är publiceringen exakt som
 * före 10b2 (samma förhandsvisning, samma nyckel), som i prod så länge ingen butik har en egen lista.
 */
export function pricelistBatchHash(items: Pick<PricelistBatchItem, 'resellerId' | 'hash'>[]): string {
  if (items.length === 1 && items[0].resellerId === null) return items[0].hash;
  const content = items.map((i) => ({ resellerId: i.resellerId, hash: i.hash }));
  return createHash('sha256').update(canonicalJson(content), 'utf8').digest('hex');
}

export function buildPricelistBatch(input: {
  shared: PricelistDraft;
  partner: PartnerPricelistsPreview;
  /** Butiker som har haft en egen lista och finns kvar i crm_portal_resellers. */
  everOwn: ReadonlySet<string>;
  /** Butiker vars inbjudan inte gått fram. */
  notInPortal: ReadonlySet<string>;
}): PricelistBatchDraft {
  const own: PricelistBatchItem[] = [];
  const waiting: PortalStoreCard[] = [];
  const handled = new Set<string>();

  for (const list of input.partner.lists) {
    for (const store of list.stores) {
      handled.add(store.resellerId);
      if (input.notInPortal.has(store.resellerId)) waiting.push(store);
      else own.push({ resellerId: store.resellerId, code: list.code, articles: list.articles, hash: list.hash });
    }
  }
  // Ett kort som inte gick att läsa stoppar publiceringen; dess butiker får ingen kopia av 160 under tiden.
  for (const problem of input.partner.problems) for (const store of problem.stores) handled.add(store.resellerId);

  for (const resellerId of input.everOwn) {
    if (handled.has(resellerId) || input.notInPortal.has(resellerId)) continue;
    own.push({ resellerId, code: RESELLER_PRICE_LIST_CODE, articles: input.shared.articles, hash: input.shared.hash });
  }

  own.sort((a, b) => (a.resellerId! < b.resellerId! ? -1 : a.resellerId! > b.resellerId! ? 1 : 0));
  const items: PricelistBatchItem[] = [
    { resellerId: null, code: RESELLER_PRICE_LIST_CODE, articles: input.shared.articles, hash: input.shared.hash },
    ...own,
  ];
  return { items, hash: pricelistBatchHash(items), waiting, problems: input.partner.problems };
}
