import { RESELLER_PRICE_LIST_CODE } from '@/lib/domains/fortnox/priceLists';
import { basePrices, type ListPrice, type PricelistArticle } from './pricelist';

/**
 * Egna prislistor per partner (RESELLER_PORTAL_CRM_PLAN.md 10b). Rent: reglerna; Fortnox och databasen läses av
 * partnerPricelistSources.ts.
 *
 * Williams beslut 2026-10-01:
 *   - Partnerns lista är den som står på kundkortet i Fortnox (`PriceList`). Står standardlistan A, 160 eller inget där
 *     gäller den gemensamma lista 160.
 *   - En partnerlista har bara de avvikande priserna. Övriga artiklar får sitt pris från 160.
 *   - Alla listor publiceras samtidigt, med samma datum (10b2).
 *
 * En butik hör till ett kundkort (crm_portal_resellers.customer_id). Butiker på samma kort får samma lista.
 */

/** Kortets lista som betyder "den gemensamma": Fortnox standardlista A, och lista 160 själv. */
const SHARED_LIST_CODES = new Set(['A', RESELLER_PRICE_LIST_CODE]);

/** Kortets egen lista, eller null när kortet har den gemensamma (A, 160 eller ingen). */
export function partnerListCode(raw: string | null | undefined): string | null {
  const code = raw?.trim() ?? '';
  if (!code || SHARED_LIST_CODES.has(code.toUpperCase())) return null;
  return code;
}

/**
 * Grundpriserna för en partner: 160:s grundpris per artikel, och partnerlistans där den har ett. Bara grundpriset
 * (FromQuantity 0) räknas, som för 160 (`basePrices`). En artikel med bara mängdrabatt på partnerlistan har alltså 160:s
 * pris.
 */
export function overlayListPrices(shared: ListPrice[], partner: ListPrice[]): ListPrice[] {
  const merged = new Map(basePrices(shared));
  for (const [articleNumber, price] of basePrices(partner)) merged.set(articleNumber, price);
  return [...merged].map(([articleNumber, price]) => ({ articleNumber, fromQuantity: 0, price }));
}

export type PartnerPriceDifference = {
  articleNumber: string;
  customerName: string;
  /** null = artikeln kommer inte med i den gemensamma listan (inget pris på 160). */
  sharedUnitCost: number | null;
  /** null = artikeln kommer inte med i partnerns lista. */
  partnerUnitCost: number | null;
};

/** Artiklarna där partnerns lista skiljer sig från den gemensamma, i den gemensamma listans ordning. */
export function partnerPriceDifferences(shared: PricelistArticle[], partner: PricelistArticle[]): PartnerPriceDifference[] {
  const sharedBy = new Map(shared.map((a) => [a.articleNumber, a]));
  const partnerBy = new Map(partner.map((a) => [a.articleNumber, a]));
  const out: PartnerPriceDifference[] = [];
  for (const a of shared) {
    const p = partnerBy.get(a.articleNumber);
    if (p?.unitCost === a.unitCost) continue;
    out.push({ articleNumber: a.articleNumber, customerName: a.customerName, sharedUnitCost: a.unitCost, partnerUnitCost: p?.unitCost ?? null });
  }
  for (const p of partner) {
    if (sharedBy.has(p.articleNumber)) continue;
    out.push({ articleNumber: p.articleNumber, customerName: p.customerName, sharedUnitCost: null, partnerUnitCost: p.unitCost });
  }
  return out;
}

// --------------------------------------------------------------------------------------------- butikerna per lista

export type PortalStoreCard = {
  resellerId: string;
  storeName: string;
  customerId: string;
  customerName: string;
  /** Kortets kundnummer i Fortnox. null = kortet finns inte i Fortnox, och har alltså ingen egen lista. */
  customerNumber: string | null;
};

export type CardListLookup =
  | { ok: true; code: string | null }
  | { ok: false; message: string };

export type StoresByList = {
  /** Butiker som får den gemensamma listan. */
  shared: PortalStoreCard[];
  /** Butiker med en egen lista, per listkod, i kodordning. */
  own: { code: string; stores: PortalStoreCard[] }[];
  /** Kort vars lista inte gick att läsa. Deras butiker står varken som gemensamma eller egna. */
  failed: { customerId: string; customerName: string; stores: PortalStoreCard[]; message: string }[];
};

/** Delar butikerna efter kortets lista. `lookups` har ett svar per kort med kundnummer. */
export function groupStoresByList(stores: PortalStoreCard[], lookups: Map<string, CardListLookup>): StoresByList {
  const shared: PortalStoreCard[] = [];
  const own = new Map<string, PortalStoreCard[]>();
  const failed = new Map<string, StoresByList['failed'][number]>();
  for (const store of stores) {
    const lookup = store.customerNumber ? lookups.get(store.customerId) : { ok: true as const, code: null };
    if (!lookup) throw new Error(`Kortets lista saknas för ${store.customerId}.`);
    if (!lookup.ok) {
      const entry = failed.get(store.customerId) ?? { customerId: store.customerId, customerName: store.customerName, stores: [], message: lookup.message };
      entry.stores.push(store);
      failed.set(store.customerId, entry);
    } else if (lookup.code === null) {
      shared.push(store);
    } else {
      own.set(lookup.code, [...(own.get(lookup.code) ?? []), store]);
    }
  }
  return {
    shared,
    own: [...own].sort(([a], [b]) => a.localeCompare(b, 'sv', { numeric: true })).map(([code, list]) => ({ code, stores: list })),
    failed: [...failed.values()],
  };
}
