import type { SupabaseClient } from '@supabase/supabase-js';
import { getCrmCustomerDisplayName, type CrmCustomerType } from '@/lib/domains/crm/customers';
import { FortnoxApiError, FortnoxNotConnectedError, friendlyFortnoxMessage } from '@/lib/domains/fortnox/client';
import { getFortnoxCustomerPriceList } from '@/lib/domains/fortnox/customers';
import { listFortnoxPriceListPrices } from '@/lib/domains/fortnox/priceLists';
import {
  groupStoresByList,
  overlayListPrices,
  partnerListCode,
  partnerPriceDifferences,
  type CardListLookup,
  type PartnerPriceDifference,
  type PortalStoreCard,
} from './partnerPricelists';
import { buildPricelistDraft, type ListPrice, type PricelistArticle, type PricelistDraft } from './pricelist';
import type { PricelistInputs } from './pricelistPublish';

/**
 * Partnerlistorna mot databasen och Fortnox (RESELLER_PORTAL_CRM_PLAN.md 10b): vilka butiker som har ett kundkort,
 * kortets lista i Fortnox och partnerlistans priser. Reglerna bor i partnerPricelists.ts.
 *
 * Sessionsklienten läser butikerna (RLS: crm.portal.manage) och korten. Fortnox läses en gång per kort och en gång per
 * lista, i tur och ordning: några tiotal anrop som mest, och klienten väntar ut Fortnox gräns (429) själv.
 */

export type PartnerPricelistSources = {
  stores: () => Promise<PortalStoreCard[]>;
  cardListCode: (customerNumber: string) => Promise<string | null>;
  listPrices: (code: string) => Promise<ListPrice[]>;
};

type StoreRow = {
  reseller_id: string;
  name: string;
  customer_id: string;
  customer: {
    customer_type: CrmCustomerType;
    company_name: string | null;
    first_name: string | null;
    last_name: string | null;
    fortnox_customer_id: string | null;
  } | null;
};

/** Butikerna som är kopplade till ett kundkort. En butik utan kort får den gemensamma listan och behöver inget här. */
export async function listPortalStoreCards(session: SupabaseClient): Promise<PortalStoreCard[]> {
  const { data, error } = await session
    .from('crm_portal_resellers')
    .select('reseller_id, name, customer_id, customer:crm_customers(customer_type, company_name, first_name, last_name, fortnox_customer_id)')
    .not('customer_id', 'is', null)
    .order('name')
    .order('reseller_id');
  if (error) throw new Error(`Butikerna gick inte att läsa: ${error.message}`);
  return ((data ?? []) as unknown as StoreRow[]).map((row) => ({
    resellerId: row.reseller_id,
    storeName: row.name,
    customerId: row.customer_id,
    // Kortet kan vara dolt för sessionen fast kopplingen finns; då finns inget nummer att läsa listan på.
    customerName: row.customer ? getCrmCustomerDisplayName(row.customer) : 'Okänt kundkort',
    customerNumber: row.customer?.fortnox_customer_id?.trim() || null,
    cardVisible: row.customer !== null,
  }));
}

export function partnerPricelistSources(session: SupabaseClient): PartnerPricelistSources {
  return {
    stores: () => listPortalStoreCards(session),
    cardListCode: (customerNumber) => getFortnoxCustomerPriceList(customerNumber),
    listPrices: (code) => listFortnoxPriceListPrices(code),
  };
}

function describeFortnoxError(e: unknown): string {
  if (e instanceof FortnoxNotConnectedError || e instanceof FortnoxApiError) return friendlyFortnoxMessage(e);
  return e instanceof Error ? e.message : 'Fortnox gick inte att läsa.';
}

export type PartnerListPreview = {
  /** Listans kod i Fortnox. */
  code: string;
  stores: PortalStoreCard[];
  articles: PricelistArticle[];
  hash: string;
  differences: PartnerPriceDifference[];
};

export type PartnerPricelistsPreview = {
  /** Butiker med kundkort som får den gemensamma listan. */
  sharedStores: PortalStoreCard[];
  lists: PartnerListPreview[];
  /**
   * Det som inte gick att läsa: ett kort eller en lista, med butikerna det gäller. `key` är unik (kortets id eller
   * listans kod). Publiceringen stoppas av varje sådant.
   */
  problems: { key: string; what: string; stores: PortalStoreCard[]; message: string }[];
};

/** Allt partnerlistorna läser, före sammanställningen. Beror inte på lista 160, och kan läsas samtidigt som den. */
export type PartnerPricelistReads = {
  stores: PortalStoreCard[];
  /** Kortets lista, per kort som har ett kundnummer eller är dolt för sessionen. */
  lookups: Map<string, CardListLookup>;
  /** Priserna per egen lista. */
  lists: Map<string, { ok: true; prices: ListPrice[] } | { ok: false; message: string }>;
};

/** Fortnox tillåter några anrop i sekunden; fyra åt gången räcker för att sidan inte ska vänta i onödan. */
const FORTNOX_PARALLEL = 4;

async function eachLimited<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await fn(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

/**
 * Butikerna, varje korts lista och varje egen listas priser. Ett kort eller en lista som inte går att läsa sparas som
 * ett fel och stoppar inte resten. Ett kort som sessionen inte ser är ett fel, inte lista 160: dess lista går inte att
 * läsa, och butiken hade annars fått fel priser utan att någon märkt det.
 */
export async function readPartnerPricelists(sources: PartnerPricelistSources): Promise<PartnerPricelistReads> {
  const stores = await sources.stores();

  const lookups = new Map<string, CardListLookup>();
  const toRead = new Map<string, string>();
  for (const store of stores) {
    if (!store.cardVisible) {
      lookups.set(store.customerId, { ok: false, message: 'Kundkortet syns inte för dig, så dess prislista går inte att läsa.' });
    } else if (store.customerNumber) {
      toRead.set(store.customerId, store.customerNumber);
    }
  }
  await eachLimited([...toRead], FORTNOX_PARALLEL, async ([customerId, customerNumber]) => {
    try {
      lookups.set(customerId, { ok: true, code: partnerListCode(await sources.cardListCode(customerNumber)) });
    } catch (e) {
      lookups.set(customerId, { ok: false, message: describeFortnoxError(e) });
    }
  });

  const codes = [...new Set([...lookups.values()].flatMap((l) => (l.ok && l.code !== null ? [l.code] : [])))];
  const lists: PartnerPricelistReads['lists'] = new Map();
  await eachLimited(codes, FORTNOX_PARALLEL, async (code) => {
    try {
      lists.set(code, { ok: true, prices: await sources.listPrices(code) });
    } catch (e) {
      lists.set(code, { ok: false, message: describeFortnoxError(e) });
    }
  });
  return { stores, lookups, lists };
}

/**
 * Varje butiks lista som den ser ut nu. Ren. Bygger på samma källor som den gemensamma listan (`inputs`, `shared`), så
 * att en partnerlista bara skiljer sig där kortets lista har ett annat pris.
 */
export function buildPartnerPricelists(reads: PartnerPricelistReads, inputs: PricelistInputs, shared: PricelistDraft): PartnerPricelistsPreview {
  const grouped = groupStoresByList(reads.stores, reads.lookups);
  const problems: PartnerPricelistsPreview['problems'] = grouped.failed.map((f) => ({
    key: `card:${f.customerId}`,
    what: `Kundkortet ${f.customerName}`,
    stores: f.stores,
    message: f.message,
  }));
  const lists: PartnerListPreview[] = [];
  for (const { code, stores } of grouped.own) {
    const read = reads.lists.get(code);
    if (!read?.ok) {
      problems.push({ key: `list:${code}`, what: `Lista ${code}`, stores, message: read?.message ?? 'Listan lästes inte.' });
      continue;
    }
    const draft = buildPricelistDraft({ ...inputs, prices: overlayListPrices(inputs.prices, read.prices) });
    lists.push({ code, stores, articles: draft.articles, hash: draft.hash, differences: partnerPriceDifferences(shared.articles, draft.articles) });
  }
  return { sharedStores: grouped.shared, lists, problems };
}

export async function loadPartnerPricelists(
  sources: PartnerPricelistSources,
  inputs: PricelistInputs,
  shared: PricelistDraft,
): Promise<PartnerPricelistsPreview> {
  return buildPartnerPricelists(await readPartnerPricelists(sources), inputs, shared);
}
