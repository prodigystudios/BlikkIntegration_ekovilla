import { describe, it, expect, vi } from 'vitest';
import { emptyPortalArticleFields, type PortalArticleFields } from '@/lib/domains/portal/articleFields';
import {
  groupStoresByList,
  overlayListPrices,
  partnerListCode,
  partnerPriceDifferences,
  type CardListLookup,
  type PortalStoreCard,
} from '@/lib/domains/portal/partnerPricelists';
import {
  listPortalStoreCards,
  loadPartnerPricelists,
  readPartnerPricelists,
  type PartnerPricelistSources,
} from '@/lib/domains/portal/partnerPricelistSources';
import { buildPricelistDraft, pricelistContentHash, type ListPrice, type PricelistArticle } from '@/lib/domains/portal/pricelist';
import type { PricelistInputs } from '@/lib/domains/portal/pricelistPublish';
import { FortnoxApiError } from '@/lib/domains/fortnox/client';
import { memoryAdmin } from './helpers/memoryAdmin';

/**
 * Egna prislistor per partner (RESELLER_PORTAL_CRM_PLAN.md 10b1). Det som skyddas:
 *   - kortets lista A, 160 eller ingen = den gemensamma listan (Williams beslut 2026-10-01);
 *   - en partnerlista har bara de avvikande priserna: övriga artiklar får 160:s pris;
 *   - varje kort och varje lista läses en gång, och ett fel stoppar bara sitt kort eller sin lista, synligt;
 *   - partnerlistan räknas på samma portalfält och register som den gemensamma.
 */

const price = (articleNumber: string, value: number, fromQuantity = 0): ListPrice => ({ articleNumber, fromQuantity, price: value });

describe('partnerListCode', () => {
  it('A, 160 och inget betyder den gemensamma listan', () => {
    for (const raw of [null, undefined, '', '  ', 'A', 'a', ' A ', '160', ' 160 ']) expect(partnerListCode(raw)).toBeNull();
  });

  it('alla andra koder är en egen lista, trimmad', () => {
    expect(partnerListCode('161')).toBe('161');
    expect(partnerListCode(' B ')).toBe('B');
    expect(partnerListCode('1600')).toBe('1600');
  });
});

describe('overlayListPrices: bara de avvikande priserna', () => {
  it('partnerns grundpris vinner; övriga artiklar har 160:s', () => {
    const merged = overlayListPrices([price('1', 100), price('2', 200), price('2', 150, 10)], [price('2', 180)]);
    expect(new Map(merged.map((p) => [p.articleNumber, p.price]))).toEqual(new Map([['1', 100], ['2', 180]]));
    expect(merged.every((p) => p.fromQuantity === 0)).toBe(true);
  });

  it('en artikel som bara finns på partnerlistan kommer med', () => {
    expect(overlayListPrices([price('1', 100)], [price('9', 90)]).map((p) => p.articleNumber).sort()).toEqual(['1', '9']);
  });

  it('bara mängdrabatt, eller ett ogiltigt pris, på partnerlistan: 160:s pris står kvar', () => {
    expect(overlayListPrices([price('1', 100)], [price('1', 80, 10)])).toEqual([price('1', 100)]);
    expect(overlayListPrices([price('1', 100)], [price('1', -5)])).toEqual([price('1', 100)]);
    expect(overlayListPrices([price('1', 100)], [price('1', Number.NaN)])).toEqual([price('1', 100)]);
  });

  it('ett pris på 0 kr på partnerlistan är ett pris', () => {
    expect(overlayListPrices([price('1', 100)], [price('1', 0)])).toEqual([price('1', 0)]);
  });
});

function article(articleNumber: string, unitCost: number): PricelistArticle {
  return { articleNumber, name: `Art ${articleNumber}`, customerName: `Kund ${articleNumber}`, note: '', category: 'losull', unit: 'st', unitCost, laborShare: 0, sortOrder: 0 };
}

describe('partnerPriceDifferences', () => {
  it('bara artiklarna som skiljer sig, också de som bara finns i den ena', () => {
    const shared = [article('1', 100), article('2', 200), article('3', 300)];
    const partner = [article('1', 100), article('2', 180), article('4', 400)];
    expect(partnerPriceDifferences(shared, partner)).toEqual([
      { articleNumber: '2', customerName: 'Kund 2', sharedUnitCost: 200, partnerUnitCost: 180 },
      { articleNumber: '3', customerName: 'Kund 3', sharedUnitCost: 300, partnerUnitCost: null },
      { articleNumber: '4', customerName: 'Kund 4', sharedUnitCost: null, partnerUnitCost: 400 },
    ]);
    expect(partnerPriceDifferences(shared, shared)).toEqual([]);
  });
});

function store(resellerId: string, customerId: string, customerNumber: string | null = `nr-${customerId}`, cardVisible = true): PortalStoreCard {
  return { resellerId, storeName: `Butik ${resellerId}`, customerId, customerName: `Kort ${customerId}`, customerNumber, cardVisible };
}

describe('groupStoresByList', () => {
  it('gemensam, egen per kod (i nummerordning) och kort som inte gick att läsa', () => {
    const stores = [store('a', 'k1'), store('b', 'k2'), store('c', 'k2'), store('d', 'k3'), store('e', 'k4'), store('f', 'k5', null)];
    const lookups = new Map<string, CardListLookup>([
      ['k1', { ok: true, code: null }],
      ['k2', { ok: true, code: '10' }],
      ['k3', { ok: true, code: '9' }],
      ['k4', { ok: false, message: 'nere' }],
    ]);
    const grouped = groupStoresByList(stores, lookups);
    expect(grouped.shared.map((s) => s.resellerId)).toEqual(['a', 'f']);
    expect(grouped.own.map((l) => [l.code, l.stores.map((s) => s.resellerId)])).toEqual([
      ['9', ['d']],
      ['10', ['b', 'c']],
    ]);
    expect(grouped.failed).toEqual([{ customerId: 'k4', customerName: 'Kort k4', stores: [stores[4]], message: 'nere' }]);
  });

  it('ett kort med kundnummer utan svar är ett programmeringsfel, inte den gemensamma listan', () => {
    expect(() => groupStoresByList([store('a', 'k1')], new Map())).toThrow();
  });
});

// ----------------------------------------------------------------------------------------------------- läsningen

function field(articleNumber: string): PortalArticleFields {
  return { ...emptyPortalArticleFields(articleNumber), customer_name: `Kund ${articleNumber}`, category: 'losull', publish: true };
}

const INPUTS: PricelistInputs = {
  fields: [field('1'), field('2'), field('9')],
  register: ['1', '2', '9'].map((n) => ({ article_number: n, description: `Art ${n}`, unit: 'ST', active: true })),
  // Artikel 9 är markerad men saknar pris på 160: den kommer bara med hos en partner som har ett.
  prices: [price('1', 100), price('2', 200)],
};
const SHARED = buildPricelistDraft(INPUTS);

function sources(cards: Record<string, string | null | Error>, lists: Record<string, ListPrice[] | Error>, stores: PortalStoreCard[]) {
  const cardCalls: string[] = [];
  const listCalls: string[] = [];
  const s: PartnerPricelistSources = {
    stores: async () => stores,
    cardListCode: async (n) => {
      cardCalls.push(n);
      const v = cards[n];
      if (v instanceof Error) throw v;
      return v ?? null;
    },
    listPrices: async (code) => {
      listCalls.push(code);
      const v = lists[code];
      if (v instanceof Error) throw v;
      return v ?? [];
    },
  };
  return { s, cardCalls, listCalls };
}

describe('loadPartnerPricelists', () => {
  it('varje kort och varje lista läses en gång; butikerna på samma kort delar listan', async () => {
    const stores = [store('a', 'k1'), store('b', 'k1'), store('c', 'k2'), store('d', 'k3')];
    const { s, cardCalls, listCalls } = sources({ 'nr-k1': '161', 'nr-k2': 'A', 'nr-k3': '161' }, { '161': [price('2', 180), price('9', 90)] }, stores);
    const preview = await loadPartnerPricelists(s, INPUTS, SHARED);

    expect(cardCalls).toEqual(['nr-k1', 'nr-k2', 'nr-k3']);
    expect(listCalls).toEqual(['161']);
    expect(preview.sharedStores.map((x) => x.resellerId)).toEqual(['c']);
    expect(preview.problems).toEqual([]);
    expect(preview.lists).toHaveLength(1);
    const [list] = preview.lists;
    expect(list.code).toBe('161');
    expect(list.stores.map((x) => x.resellerId)).toEqual(['a', 'b', 'd']);
    expect(list.articles.map((a) => [a.articleNumber, a.unitCost])).toEqual([
      ['1', 100],
      ['2', 180],
      ['9', 90],
    ]);
    expect(list.hash).toBe(pricelistContentHash(list.articles));
    expect(list.differences).toEqual([
      { articleNumber: '2', customerName: 'Kund 2', sharedUnitCost: 200, partnerUnitCost: 180 },
      { articleNumber: '9', customerName: 'Kund 9', sharedUnitCost: null, partnerUnitCost: 90 },
    ]);
  });

  it('ett kort eller en lista som inte går att läsa blir ett synligt problem, och resten räknas ändå', async () => {
    const stores = [store('a', 'k1'), store('b', 'k2'), store('c', 'k3')];
    const { s } = sources(
      { 'nr-k1': new FortnoxApiError(404, 'Kunden hittades inte', 2000433, 'Kunden hittades inte'), 'nr-k2': '170', 'nr-k3': '161' },
      { '170': new Error('Listan finns inte'), '161': [] },
      stores,
    );
    const preview = await loadPartnerPricelists(s, INPUTS, SHARED);
    expect(preview.problems.map((p) => [p.key, p.what, p.stores.map((x) => x.resellerId)])).toEqual([
      ['card:k1', 'Kundkortet Kort k1', ['a']],
      ['list:170', 'Lista 170', ['b']],
    ]);
    expect(preview.problems[1].message).toBe('Listan finns inte');
    // En tom partnerlista är 160:s priser.
    expect(preview.lists.map((l) => [l.code, l.differences])).toEqual([['161', []]]);
  });

  it('🧨 ett kort som sessionen inte ser: ett problem, aldrig lista 160, och inget läses från Fortnox', async () => {
    const { s, cardCalls } = sources({}, {}, [store('a', 'k1', null, false), store('b', 'k2', null)]);
    const preview = await loadPartnerPricelists(s, INPUTS, SHARED);
    expect(preview.problems.map((p) => [p.key, p.stores.map((x) => x.resellerId)])).toEqual([['card:k1', ['a']]]);
    expect(preview.problems[0].message).toMatch(/syns inte/);
    // Ett synligt kort utan kundnummer finns inte i Fortnox och har den gemensamma listan.
    expect(preview.sharedStores.map((x) => x.resellerId)).toEqual(['b']);
    expect(cardCalls).toEqual([]);
  });

  it('högst fyra anrop till Fortnox åt gången, och alla blir gjorda', async () => {
    const stores = Array.from({ length: 10 }, (_, i) => store(`s${i}`, `k${i}`));
    let inFlight = 0;
    let peak = 0;
    const s: PartnerPricelistSources = {
      stores: async () => stores,
      cardListCode: async (n) => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight -= 1;
        return n === 'nr-k3' ? '161' : null;
      },
      listPrices: async () => [],
    };
    const reads = await readPartnerPricelists(s);
    expect(peak).toBe(4);
    expect(reads.lookups.size).toBe(10);
    expect([...reads.lists.keys()]).toEqual(['161']);
  });

  it('inga butiker med kort: inget läses från Fortnox', async () => {
    const { s, cardCalls, listCalls } = sources({}, {}, []);
    expect(await loadPartnerPricelists(s, INPUTS, SHARED)).toEqual({ sharedStores: [], lists: [], problems: [] });
    expect(cardCalls).toEqual([]);
    expect(listCalls).toEqual([]);
  });
});

describe('listPortalStoreCards', () => {
  it('bara butiker med kort, med kortets namn och kundnummer trimmat', async () => {
    const db = memoryAdmin({
      crm_portal_resellers: [
        { reseller_id: 'b', name: 'Beta', customer_id: 'k1', customer: { customer_type: 'business', company_name: 'Bygg AB', first_name: null, last_name: null, fortnox_customer_id: ' 13 ' } },
        { reseller_id: 'a', name: 'Alfa', customer_id: 'k2', customer: null },
        { reseller_id: 'c', name: 'Gamma', customer_id: null, customer: null },
      ],
    });
    expect(await listPortalStoreCards(db.admin)).toEqual([
      { resellerId: 'a', storeName: 'Alfa', customerId: 'k2', customerName: 'Okänt kundkort', customerNumber: null, cardVisible: false },
      { resellerId: 'b', storeName: 'Beta', customerId: 'k1', customerName: 'Bygg AB', customerNumber: '13', cardVisible: true },
    ]);
  });
});

describe('getFortnoxCustomerPriceList', () => {
  it('läser kortet direkt, med numret kodat, och ett tomt fält blir null', async () => {
    vi.resetModules();
    const calls: string[] = [];
    let priceList: string | null = ' 161 ';
    vi.doMock('@/lib/domains/fortnox/client', async (importOriginal) => ({
      ...(await importOriginal<typeof import('@/lib/domains/fortnox/client')>()),
      fortnoxGet: vi.fn(async (path: string) => (calls.push(path), { Customer: { CustomerNumber: '13', PriceList: priceList } })),
    }));
    try {
      const { getFortnoxCustomerPriceList } = await import('@/lib/domains/fortnox/customers');
      expect(await getFortnoxCustomerPriceList('13')).toBe('161');
      priceList = '';
      expect(await getFortnoxCustomerPriceList('A/1')).toBeNull();
      expect(calls).toEqual(['/customers/13', '/customers/A%2F1']);
    } finally {
      vi.doUnmock('@/lib/domains/fortnox/client');
    }
  });
});
