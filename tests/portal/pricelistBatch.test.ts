import { describe, it, expect } from 'vitest';
import { buildPricelistBatch, pricelistBatchHash, pricelistBatchKey } from '@/lib/domains/portal/pricelistBatch';
import { readPricelistHistory } from '@/lib/domains/portal/pricelistBatchSources';
import { listPricelistPublications } from '@/lib/domains/portal/pricelistPublish';
import type { PartnerPricelistsPreview } from '@/lib/domains/portal/partnerPricelistSources';
import type { PortalStoreCard } from '@/lib/domains/portal/partnerPricelists';
import type { PricelistArticle, PricelistDraft } from '@/lib/domains/portal/pricelist';
import { memoryAdmin } from './helpers/memoryAdmin';

/**
 * Vad en publicering består av (RESELLER_PORTAL_CRM_PLAN.md 10b2). Det som skyddas:
 *   - med bara lista 160 är hashen listans egen: publiceringen är som före 10b2 (prod före påslaget);
 *   - en butik med egen lista får den; en som haft en men inte har nu får 160 som egen; en som väntar på sin inbjudan
 *     får ingen; en vars kort inte gick att läsa stoppar allt och får ingen kopia;
 *   - historiken läses sida för sida (PostgREST kapar vid 1000), och bara butiker som finns kvar räknas;
 *   - historiken visar en publicering per löpnummer, med varje lista och den sämsta statusen.
 */

const article = (n: string, unitCost: number): PricelistArticle => ({
  articleNumber: n,
  name: n,
  customerName: n,
  note: '',
  category: 'losull',
  unit: 'st',
  unitCost,
  laborShare: 0,
  sortOrder: 0,
});
const SHARED: PricelistDraft = { articles: [article('1', 100)], skipped: [], unmarked: [], hash: 'a'.repeat(64) };
const store = (resellerId: string): PortalStoreCard => ({
  resellerId,
  storeName: `Butik ${resellerId}`,
  customerId: `k-${resellerId}`,
  customerName: 'Kort',
  customerNumber: '1',
  cardVisible: true,
});
const NO_PARTNER: PartnerPricelistsPreview = { sharedStores: [], lists: [], problems: [] };

describe('buildPricelistBatch', () => {
  it('bara lista 160: en lista, och hashen är listans egen', () => {
    const batch = buildPricelistBatch({ shared: SHARED, partner: NO_PARTNER, everOwn: new Set(), notInPortal: new Set() });
    expect(batch.items).toEqual([{ resellerId: null, code: '160', articles: SHARED.articles, hash: SHARED.hash }]);
    expect(batch.hash).toBe(SHARED.hash);
  });

  it('egna listor, kopior av 160 till butiker som haft en egen, och butiker som väntar på inbjudan', () => {
    const partner: PartnerPricelistsPreview = {
      sharedStores: [store('s-shared'), store('s-was-own')],
      lists: [{ code: 'B', stores: [store('s-b2'), store('s-b1'), store('s-wait')], articles: [article('1', 90)], hash: 'b'.repeat(64), differences: [] }],
      problems: [],
    };
    const batch = buildPricelistBatch({
      shared: SHARED,
      partner,
      // s-gone har haft en egen lista men saknar kort nu; s-b1 har en egen nu och får bara den.
      everOwn: new Set(['s-was-own', 's-gone', 's-b1']),
      notInPortal: new Set(['s-wait']),
    });
    expect(batch.items.map((i) => [i.resellerId, i.code, i.hash[0]])).toEqual([
      [null, '160', 'a'],
      ['s-b1', 'B', 'b'],
      ['s-b2', 'B', 'b'],
      ['s-gone', '160', 'a'],
      ['s-was-own', '160', 'a'],
    ]);
    expect(batch.waiting.map((s) => s.resellerId)).toEqual(['s-wait']);
    expect(batch.hash).toBe(pricelistBatchHash(batch.items));
    expect(batch.hash).not.toBe(SHARED.hash);
  });

  it('ett kort som inte gick att läsa: problemet följer med, och dess butiker får ingen kopia av 160', () => {
    const problem = { key: 'card:k-x', what: 'Kundkortet X', stores: [store('s-x')], message: 'nere' };
    const batch = buildPricelistBatch({
      shared: SHARED,
      partner: { ...NO_PARTNER, problems: [problem] },
      everOwn: new Set(['s-x']),
      notInPortal: new Set(),
    });
    expect(batch.problems).toEqual([problem]);
    expect(batch.items.map((i) => i.resellerId)).toEqual([null]);
  });

  it('en butik som väntar på sin inbjudan kan inte stoppa publiceringen: den får ingen lista ändå', () => {
    const waitingProblem = { key: 'card:k-w', what: 'Kundkortet W', stores: [store('s-w')], message: 'nere' };
    const mixed = { key: 'list:X', what: 'Lista X', stores: [store('s-w2'), store('s-in')], message: 'nere' };
    const batch = buildPricelistBatch({
      shared: SHARED,
      partner: { ...NO_PARTNER, problems: [waitingProblem, mixed] },
      everOwn: new Set(),
      notInPortal: new Set(['s-w', 's-w2']),
    });
    // Bara butiken i portalen står kvar i problemet.
    expect(batch.problems).toEqual([{ ...mixed, stores: [store('s-in')] }]);
  });

  it('nyckeln för samma publicering: samma listor till samma butiker, i vilken ordning som helst', () => {
    const a = { resellerId: null, hash: 'a' };
    const b = { resellerId: 's1', hash: 'b' };
    expect(pricelistBatchKey([a, b])).toBe(pricelistBatchKey([b, a]));
    expect(pricelistBatchKey([a, b])).not.toBe(pricelistBatchKey([a, { resellerId: 's2', hash: 'b' }]));
    expect(pricelistBatchKey([a])).not.toBe(pricelistBatchKey([a, a]));
  });

  it('hashen ändras med varje butiks lista och med vilka butiker som får en', () => {
    const base = [{ resellerId: null, hash: 'a'.repeat(64) }, { resellerId: 's1', hash: 'b'.repeat(64) }];
    const h = pricelistBatchHash(base);
    expect(pricelistBatchHash([base[0], { resellerId: 's1', hash: 'c'.repeat(64) }])).not.toBe(h);
    expect(pricelistBatchHash([base[0], { resellerId: 's2', hash: 'b'.repeat(64) }])).not.toBe(h);
    expect(pricelistBatchHash(base)).toBe(h);
  });
});

describe('readPricelistHistory', () => {
  it('butiker som haft en egen lista och finns kvar, sida för sida över 1000 rader', async () => {
    const publications = Array.from({ length: 1001 }, (_, i) => ({
      id: `p-${String(i).padStart(5, '0')}`,
      // Över 1000 rader med butik: s-late står på andra sidan.
      reseller_id: i === 1000 ? 's-late' : 's-a',
    }));
    publications.push({ id: 'p-00000a', reseller_id: null as unknown as string });
    publications.push({ id: 'p-99999', reseller_id: 's-removed' });
    const db = memoryAdmin({
      crm_portal_pricelist_publications: publications,
      crm_portal_resellers: [{ reseller_id: 's-a' }, { reseller_id: 's-late' }, { reseller_id: 's-b' }],
      crm_portal_reseller_invites: [],
      portal_outbound_events: [],
    });
    const history = await readPricelistHistory(db.admin);
    expect([...history.everOwn].sort()).toEqual(['s-a', 's-late']);
  });

  it('en butik vars inbjudan aldrig gått fram finns inte i portalen; ett försök som gått fram räcker', async () => {
    const db = memoryAdmin({
      crm_portal_pricelist_publications: [],
      crm_portal_resellers: [],
      crm_portal_reseller_invites: [
        { id: 'i1', reseller_id: 's-dead', idempotency_key: 'reseller-invite-s-dead-1' },
        { id: 'i2', reseller_id: 's-ok', idempotency_key: 'reseller-invite-s-ok-1' },
        { id: 'i3', reseller_id: 's-ok', idempotency_key: 'reseller-invite-s-ok-2' },
        { id: 'i4', reseller_id: 's-pending', idempotency_key: 'reseller-invite-s-pending-1' },
      ],
      portal_outbound_events: [
        { idempotency_key: 'reseller-invite-s-dead-1', status: 'dead', attempts: 1 },
        { idempotency_key: 'reseller-invite-s-ok-1', status: 'dead', attempts: 1 },
        { idempotency_key: 'reseller-invite-s-ok-2', status: 'sent', attempts: 1 },
        { idempotency_key: 'reseller-invite-s-pending-1', status: 'pending', attempts: 2 },
      ],
    });
    const history = await readPricelistHistory(db.admin);
    expect([...history.notInPortal].sort()).toEqual(['s-dead', 's-pending']);
  });
});

describe('listPricelistPublications', () => {
  it('en publicering per löpnummer, lista 160 först, butikerna efter namn, och den sämsta statusen', async () => {
    const row = (id: string, sequence: number, reseller: string | null, key: string, code: string | null) => ({
      id,
      sequence,
      valid_from: `2026-10-0${sequence}`,
      content_hash: 'a'.repeat(64),
      idempotency_key: key,
      article_count: 3,
      published_by_name: 'Admin',
      created_at: `2026-10-0${sequence}T08:00:00Z`,
      reseller_id: reseller,
      price_list_code: code,
    });
    const db = memoryAdmin({
      crm_portal_pricelist_publications: [
        row('old', 1, null, 'k1', null),
        row('new-shared', 2, null, 'k2', '160'),
        row('new-z', 2, 's-z', 'k2-z', 'B'),
        row('new-a', 2, 's-a', 'k2-a', '160'),
      ],
      crm_portal_resellers: [
        { reseller_id: 's-z', name: 'Örebro Bygg' },
        { reseller_id: 's-a', name: 'Alfa Bygg' },
      ],
      portal_outbound_events: [
        { idempotency_key: 'k1', status: 'sent', attempts: 1 },
        { idempotency_key: 'k2', status: 'sent', attempts: 1 },
        { idempotency_key: 'k2-z', status: 'dead', attempts: 1, last_http_status: 422, last_error: 'HTTP 422: nej' },
        { idempotency_key: 'k2-a', status: 'sent', attempts: 1 },
      ],
    });
    const publications = await listPricelistPublications(db.admin);
    expect(publications.map((p) => [p.id, p.sequence, p.delivery.status])).toEqual([
      ['new-shared', 2, 'dead'],
      ['old', 1, 'sent'],
    ]);
    expect(publications[0].lists.map((l) => [l.resellerId, l.storeName, l.code, l.delivery.status])).toEqual([
      [null, null, '160', 'sent'],
      ['s-a', 'Alfa Bygg', '160', 'sent'],
      ['s-z', 'Örebro Bygg', 'B', 'dead'],
    ]);
    // En publicering före 10b2: en lista, utan kod.
    expect(publications[1].lists.map((l) => [l.resellerId, l.code])).toEqual([[null, null]]);
  });

  it('🧨 en publicering med många butiker klipps aldrig: alla dess rader läses, sida för sida', async () => {
    const rows = [
      ...Array.from({ length: 1200 }, (_, i) => ({
        id: `r-${String(i).padStart(5, '0')}`,
        sequence: 1,
        valid_from: '2026-10-01',
        content_hash: 'a'.repeat(64),
        idempotency_key: `k-1-${i}`,
        article_count: 1,
        published_by_name: null,
        created_at: '2026-10-01T08:00:00Z',
        reseller_id: `s-${i}`,
        price_list_code: 'B',
      })),
      {
        id: 'zz-shared',
        sequence: 1,
        valid_from: '2026-10-01',
        content_hash: 'a'.repeat(64),
        idempotency_key: 'k-1-shared',
        article_count: 7,
        published_by_name: null,
        created_at: '2026-10-01T08:00:00Z',
        reseller_id: null,
        price_list_code: '160',
      },
    ];
    const db = memoryAdmin({ crm_portal_pricelist_publications: rows, crm_portal_resellers: [], portal_outbound_events: [] });
    const [publication] = await listPricelistPublications(db.admin);
    expect(publication.lists).toHaveLength(1201);
    expect(publication.lists[0]).toMatchObject({ resellerId: null, articleCount: 7 });
    expect(publication.articleCount).toBe(7);
  });

  it('taket gäller publiceringar, inte rader', async () => {
    const rows = [1, 2, 3].flatMap((sequence) =>
      [null, 's-a'].map((reseller) => ({
        id: `${sequence}-${reseller ?? 'shared'}`,
        sequence,
        valid_from: '2026-10-01',
        content_hash: 'a'.repeat(64),
        idempotency_key: `k-${sequence}-${reseller ?? 'shared'}`,
        article_count: 1,
        published_by_name: null,
        created_at: `2026-10-01T0${sequence}:00:00Z`,
        reseller_id: reseller,
        price_list_code: '160',
      })),
    );
    const db = memoryAdmin({ crm_portal_pricelist_publications: rows, crm_portal_resellers: [], portal_outbound_events: [] });
    const publications = await listPricelistPublications(db.admin, 2);
    expect(publications.map((p) => [p.sequence, p.lists.length])).toEqual([
      [3, 2],
      [2, 2],
    ]);
  });
});
