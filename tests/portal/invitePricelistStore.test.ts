import { describe, expect, it, vi } from 'vitest';
import { emptyPortalArticleFields } from '@/lib/domains/portal/articleFields';
import { listFromPublished } from '@/lib/domains/portal/invitePricelist';
import {
  INVITE_PRICELIST_CANDIDATE_LIMIT,
  INVITE_PRICELIST_RETRY_MS,
  sweepInvitePricelists,
  type InvitePricelistSources,
} from '@/lib/domains/portal/invitePricelistStore';
import { PRICELIST_PATH, buildPricelistDraft, pricelistIdempotencyKey, type ListPrice } from '@/lib/domains/portal/pricelist';
import { RESELLERS_PATH } from '@/lib/domains/portal/partners';
import { memoryAdmin, type Call } from './helpers/memoryAdmin';

/**
 * Den nya butikens egen lista när inbjudan gått fram (RESELLER_PORTAL_CRM_PLAN.md 10b3). Det som skyddas:
 *   - bara efter att inbjudan gått fram, och en gång per butik: kortet läses i Fortnox en gång;
 *   - listan läggs i den SENASTE publiceringen (samma löpnummer och datum) och köas i butikens ordning;
 *   - inget att göra (ingen publicering, redan med, den gemensamma listan) läser inte listan och markerar butiken klar;
 *   - en butik som haft en egen lista får 160 som egen lista, också utan kort;
 *   - ett avbrott mellan raden och köandet köar raden nästa varv; en nyare publicering eller ett annat varv i samma stund
 *     ger aldrig en lista efter en nyare eller två rader, och en nyare som saknar butiken får butikens lista;
 *   - leveranserna läses i portioner, och de nyaste inbjudningarna först;
 *   - ett fel görs om först efter 15 minuter; avstängd integration köar ingenting.
 */

const ENV = {
  NODE_ENV: 'development',
  SUPABASE_URL: 'http://127.0.0.1:55321',
  PORTAL_CRM_SHARED_SECRET: 'c'.repeat(64),
  RESELLER_PORTAL_URL: 'http://localhost:3001',
};
const NOW = new Date('2026-10-01T12:00:00.000Z');
const STORE = '6f1c2a9e-4b7d-4f0e-9a51-0c3d2e8b7a64';
const VALID_FROM = '2026-10-05';

const price = (articleNumber: string, value: number): ListPrice => ({ articleNumber, fromQuantity: 0, price: value });
const field = (n: string, sortOrder: number) => ({ ...emptyPortalArticleFields(n), customer_name: `Kund ${n}`, category: 'losull' as const, publish: true, sort_order: sortOrder });
const SHARED = buildPricelistDraft({
  fields: [field('100', 10), field('200', 20)],
  register: [100, 200].map((n) => ({ article_number: String(n), description: `Artikel ${n}`, unit: 'st', active: true })),
  prices: [price('100', 560), price('200', 99.5)],
});
const PARTNER_PRICES = [price('100', 650)];
const OWN = listFromPublished(SHARED.articles, PARTNER_PRICES);

type Row = Record<string, unknown>;

function publicationRow(sequence: number, resellerId: string | null, hash: string, articles = SHARED.articles): Row {
  const key = pricelistIdempotencyKey(VALID_FROM, hash, sequence, resellerId);
  return {
    id: `pub-${sequence}-${resellerId ?? 'shared'}`,
    sequence,
    valid_from: VALID_FROM,
    reseller_id: resellerId,
    content_hash: hash,
    idempotency_key: key,
    payload: { validFrom: VALID_FROM, resellerId, articles },
    price_list_code: resellerId ? 'B' : '160',
  };
}
function event(key: string, status: string, path = PRICELIST_PATH): Row {
  return { idempotency_key: key, path, payload: {}, ordering_key: 'x', status };
}
function invite(resellerId: string, attempt: number, extra: Row = {}): Row {
  return {
    id: `inv-${resellerId}-${attempt}`,
    reseller_id: resellerId,
    attempt,
    idempotency_key: `reseller-invite-${resellerId}-${attempt}`,
    invited_by: 'user-1',
    invited_by_name: 'Test Admin',
    created_at: `2026-10-01T08:0${attempt}:00.000Z`,
    pricelist_settled_at: null,
    pricelist_attempted_at: null,
    pricelist_error: null,
    ...extra,
  };
}
function store(resellerId: string, customerNumber: string | null = '13'): Row {
  return { reseller_id: resellerId, customer_id: 'card-1', customer: { fortnox_customer_id: customerNumber } };
}

function setup(
  options: {
    publications?: Row[];
    invites?: Row[];
    events?: Row[];
    stores?: Row[];
    beforeExecute?: (call: Call, tables: Record<string, Row[]>) => void;
    cardList?: string | null | Error;
  } = {},
) {
  const m = memoryAdmin(
    {
      crm_portal_pricelist_publications: options.publications ?? [publicationRow(3, null, SHARED.hash)],
      crm_portal_reseller_invites: options.invites ?? [invite(STORE, 1)],
      crm_portal_resellers: options.stores ?? [store(STORE)],
      portal_outbound_events: options.events ?? [event(`reseller-invite-${STORE}-1`, 'sent', RESELLERS_PATH)],
    },
    { beforeExecute: options.beforeExecute },
  );
  const cardList = options.cardList === undefined ? 'B' : options.cardList;
  const sources: InvitePricelistSources = {
    cardPriceList: vi.fn(async () => {
      if (cardList instanceof Error) throw cardList;
      return cardList;
    }),
    listPrices: vi.fn(async () => PARTNER_PRICES),
  };
  const sweep = (at: Date = NOW, extra: { env?: Record<string, string | undefined>; limit?: number } = {}) =>
    sweepInvitePricelists(m.admin as never, { now: () => at, env: extra.env ?? ENV, sources, limit: extra.limit });
  return { ...m, sources, sweep };
}

const rowsOf = (tables: Record<string, Row[]>, name: string) => tables[name] ?? [];
const storeRows = (tables: Record<string, Row[]>) => rowsOf(tables, 'crm_portal_pricelist_publications').filter((r) => r.reseller_id === STORE);
const listEvents = (tables: Record<string, Row[]>) => rowsOf(tables, 'portal_outbound_events').filter((r) => r.path === PRICELIST_PATH);

describe('sweepInvitePricelists', () => {
  it('lägger kortets lista i den senaste publiceringen och köar den i butikens ordning', async () => {
    const t = setup();
    const summary = await t.sweep();

    expect(summary).toEqual({ candidates: 1, queued: 1, settled: 0, failed: 0, deferred: 0 });
    const key = pricelistIdempotencyKey(VALID_FROM, OWN.hash, 3, STORE);
    expect(storeRows(t.tables)).toEqual([
      expect.objectContaining({
        sequence: 3,
        valid_from: VALID_FROM,
        content_hash: OWN.hash,
        idempotency_key: key,
        payload: { validFrom: VALID_FROM, resellerId: STORE, articles: OWN.articles },
        article_count: 2,
        published_by: 'user-1',
        published_by_name: 'Test Admin',
        price_list_code: 'B',
      }),
    ]);
    expect(listEvents(t.tables)).toEqual([
      expect.objectContaining({ idempotency_key: key, ordering_key: `pricelist:${STORE}`, payload: { validFrom: VALID_FROM, resellerId: STORE, articles: OWN.articles } }),
    ]);
    expect(rowsOf(t.tables, 'crm_portal_reseller_invites')[0]).toMatchObject({ pricelist_settled_at: NOW.toISOString(), pricelist_error: null });
    expect(t.sources.cardPriceList).toHaveBeenCalledWith('13');
    expect(t.sources.listPrices).toHaveBeenCalledWith('B');

    // En gång per butik: nästa varv läser inte kortet igen.
    expect(await t.sweep()).toEqual({ candidates: 0, queued: 0, settled: 0, failed: 0, deferred: 0 });
    expect(t.sources.cardPriceList).toHaveBeenCalledTimes(1);
  });

  it('väntar tills inbjudan gått fram', async () => {
    const t = setup({ events: [event(`reseller-invite-${STORE}-1`, 'pending', RESELLERS_PATH)] });
    expect(await t.sweep()).toMatchObject({ candidates: 0, queued: 0 });
    expect(t.sources.cardPriceList).not.toHaveBeenCalled();
    expect(rowsOf(t.tables, 'crm_portal_reseller_invites')[0].pricelist_settled_at).toBeNull();
  });

  it('ingen publicering än: klar, utan Fortnox (den första publiceringen tar med butiken)', async () => {
    const t = setup({ publications: [] });
    expect(await t.sweep()).toMatchObject({ settled: 1, queued: 0 });
    expect(t.sources.cardPriceList).not.toHaveBeenCalled();
    expect(rowsOf(t.tables, 'crm_portal_reseller_invites')[0].pricelist_settled_at).toBe(NOW.toISOString());
  });

  it('redan med i den senaste publiceringen: klar, utan Fortnox och utan en händelse till', async () => {
    const own = publicationRow(3, STORE, OWN.hash, OWN.articles);
    const t = setup({
      publications: [publicationRow(3, null, SHARED.hash), own],
      events: [event(`reseller-invite-${STORE}-1`, 'sent', RESELLERS_PATH), event(own.idempotency_key as string, 'sent')],
    });
    expect(await t.sweep()).toMatchObject({ settled: 1, queued: 0 });
    expect(t.sources.cardPriceList).not.toHaveBeenCalled();
    expect(listEvents(t.tables)).toHaveLength(1);
  });

  it('köar butikens rad om ett tidigare varv dog efter raden men före köandet', async () => {
    const own = publicationRow(3, STORE, OWN.hash, OWN.articles);
    const t = setup({ publications: [publicationRow(3, null, SHARED.hash), own] });
    expect(await t.sweep()).toMatchObject({ queued: 1 });
    expect(listEvents(t.tables)).toEqual([expect.objectContaining({ idempotency_key: own.idempotency_key, ordering_key: `pricelist:${STORE}` })]);
    expect(t.sources.cardPriceList).not.toHaveBeenCalled();
  });

  it('kortet på den gemensamma listan: klar utan lista, och listan läses inte', async () => {
    for (const cardList of ['A', '160', null]) {
      const t = setup({ cardList });
      expect(await t.sweep()).toMatchObject({ settled: 1, queued: 0 });
      expect(storeRows(t.tables)).toEqual([]);
      expect(t.sources.listPrices).not.toHaveBeenCalled();
    }
  });

  it('en butik utan kort som haft en egen lista får 160 som egen lista, som i publiceringen', async () => {
    const t = setup({ stores: [store(STORE, null)], publications: [publicationRow(1, STORE, 'f'.repeat(64)), publicationRow(3, null, SHARED.hash)] });
    expect(await t.sweep()).toMatchObject({ queued: 1 });
    expect(storeRows(t.tables).find((r) => r.sequence === 3)).toMatchObject({ content_hash: SHARED.hash, price_list_code: '160' });
    expect(t.sources.cardPriceList).not.toHaveBeenCalled();
  });

  it('en butik utan kundnummer i Fortnox får den gemensamma listan', async () => {
    const t = setup({ stores: [store(STORE, null)] });
    expect(await t.sweep()).toMatchObject({ settled: 1 });
    expect(t.sources.cardPriceList).not.toHaveBeenCalled();
  });

  it('en butik som haft en egen lista får 160 som egen lista när kortet gått tillbaka', async () => {
    const t = setup({
      cardList: 'A',
      publications: [publicationRow(1, STORE, 'f'.repeat(64)), publicationRow(3, null, SHARED.hash)],
    });
    expect(await t.sweep()).toMatchObject({ queued: 1 });
    expect(storeRows(t.tables).find((r) => r.sequence === 3)).toMatchObject({
      content_hash: SHARED.hash,
      price_list_code: '160',
      payload: { validFrom: VALID_FROM, resellerId: STORE, articles: SHARED.articles },
    });
  });

  it('ett fel görs om först efter 15 minuter, och är synligt på inbjudan under tiden', async () => {
    const t = setup({ cardList: new Error('Något gick fel mot Fortnox') });
    expect(await t.sweep()).toMatchObject({ failed: 1 });
    expect(rowsOf(t.tables, 'crm_portal_reseller_invites')[0]).toMatchObject({
      pricelist_settled_at: null,
      pricelist_attempted_at: NOW.toISOString(),
      pricelist_error: 'Något gick fel mot Fortnox',
    });

    expect(await t.sweep(new Date(NOW.getTime() + 5 * 60_000))).toMatchObject({ deferred: 1, failed: 0 });
    expect(t.sources.cardPriceList).toHaveBeenCalledTimes(1);

    (t.sources.cardPriceList as ReturnType<typeof vi.fn>).mockResolvedValue('B');
    const later = new Date(NOW.getTime() + INVITE_PRICELIST_RETRY_MS + 1000);
    expect(await t.sweep(later)).toMatchObject({ queued: 1 });
    expect(rowsOf(t.tables, 'crm_portal_reseller_invites')[0]).toMatchObject({ pricelist_settled_at: later.toISOString(), pricelist_error: null });
  });

  // En publicering N+1 kom medan vi köade i N. Testet lägger in den när vår lista just köats, före kontrollen efter köandet.
  function newerAfterOurEnqueue(newer: (tables: Record<string, Row[]>) => void, onOurs?: (ours: Row) => void) {
    let enqueued = false;
    return (call: Call, tables: Record<string, Row[]>) => {
      if (call.table === 'portal_outbound_events' && call.op === 'upsert' && !enqueued) enqueued = true;
      else if (enqueued && call.table === 'crm_portal_pricelist_publications' && call.op === 'select' && !tables.crm_portal_pricelist_publications.some((r) => r.sequence === 4)) {
        newer(tables);
        const ours = tables.portal_outbound_events.find((e) => e.path === PRICELIST_PATH);
        if (ours) onOurs?.(ours);
      }
    };
  }
  const newerShared = (tables: Record<string, Row[]>) => tables.crm_portal_pricelist_publications.push(publicationRow(4, null, SHARED.hash));

  it('en nyare publicering med butiken: vår lista stoppas och raden tas bort, den nyares lista gäller', async () => {
    const theirs = publicationRow(4, STORE, OWN.hash, OWN.articles);
    const t = setup({
      beforeExecute: newerAfterOurEnqueue((tables) => {
        newerShared(tables);
        tables.crm_portal_pricelist_publications.push(theirs);
        tables.portal_outbound_events.push({ ...event(theirs.idempotency_key as string, 'pending'), seq: 1 });
      }),
    });
    expect(await t.sweep()).toMatchObject({ settled: 1, queued: 0 });
    expect(storeRows(t.tables).map((r) => r.sequence)).toEqual([4]);
    expect(listEvents(t.tables).map((e) => [e.idempotency_key, e.status])).toEqual([
      [pricelistIdempotencyKey(VALID_FROM, OWN.hash, 3, STORE), 'superseded'],
      [theirs.idempotency_key, 'pending'],
    ]);
  });

  // Den nyare publiceringens förhandsvisning lästes innan inbjudan gick fram: butiken saknas där och ska få sin lista.
  it('en nyare publicering utan butiken: vår lista stoppas, och listan läggs i den nyare', async () => {
    const t = setup({ beforeExecute: newerAfterOurEnqueue(newerShared) });
    expect(await t.sweep()).toMatchObject({ queued: 1, failed: 0 });
    expect(storeRows(t.tables).map((r) => r.sequence)).toEqual([4]);
    expect(listEvents(t.tables).map((e) => [e.idempotency_key, e.status])).toEqual([
      [pricelistIdempotencyKey(VALID_FROM, OWN.hash, 3, STORE), 'superseded'],
      [pricelistIdempotencyKey(VALID_FROM, OWN.hash, 4, STORE), 'pending'],
    ]);
  });

  it('vår lista hann börja gå före den nyare: den får gå, och den nyare får butikens lista efter den', async () => {
    const t = setup({ beforeExecute: newerAfterOurEnqueue(newerShared, (ours) => (ours.status = 'sending')) });
    expect(await t.sweep()).toMatchObject({ queued: 1 });
    expect(storeRows(t.tables).map((r) => r.sequence)).toEqual([3, 4]);
    expect(listEvents(t.tables).map((e) => e.status)).toEqual(['sending', 'pending']);
  });

  // Ett annat varv lade in butiken i samma stund (löpnummer och butik är unika): dess rad gäller och köas en gång.
  it('köar den andras rad när ett annat varv hann lägga in butiken', async () => {
    const theirs: Row = { ...publicationRow(3, STORE, 'e'.repeat(64)), id: 'theirs' };
    const t = setup({
      beforeExecute: (call, tables) => {
        if (call.table === 'crm_portal_pricelist_publications' && call.op === 'upsert' && !tables.crm_portal_pricelist_publications.includes(theirs)) {
          tables.crm_portal_pricelist_publications.push(theirs);
        }
      },
    });
    expect(await t.sweep()).toMatchObject({ queued: 1 });
    expect(storeRows(t.tables)).toHaveLength(1);
    expect(listEvents(t.tables)).toEqual([expect.objectContaining({ idempotency_key: theirs.idempotency_key })]);
  });

  it('markerar alla butikens inbjudningar som inte är klara, också ett försök som inte gått fram', async () => {
    const t = setup({ invites: [invite(STORE, 1), invite(STORE, 2)] });
    await t.sweep();
    expect(rowsOf(t.tables, 'crm_portal_reseller_invites').map((r) => r.pricelist_settled_at)).toEqual([NOW.toISOString(), NOW.toISOString()]);
  });

  it('högst så många butiker per varv som gränsen säger; resten väntar', async () => {
    const ids = ['a', 'b', 'c'].map((c) => `6f1c2a9e-4b7d-4f0e-9a51-0c3d2e8b7a6${c}`);
    const t = setup({
      invites: ids.map((id) => invite(id, 1)),
      stores: ids.map((id) => store(id)),
      events: ids.map((id) => event(`reseller-invite-${id}-1`, 'sent', RESELLERS_PATH)),
    });
    expect(await t.sweep(NOW, { limit: 2 })).toMatchObject({ candidates: 3, queued: 2, deferred: 1 });
    expect(await t.sweep(NOW, { limit: 2 })).toMatchObject({ candidates: 1, queued: 1, deferred: 0 });
  });

  // Nycklarna står i adressen (`in.(…)`): hundratals i en fråga hade gjort adressen för lång.
  it('läser leveranserna i portioner', async () => {
    const ids = Array.from({ length: 250 }, (_, i) => `6f1c2a9e-4b7d-4f0e-9a51-${String(i).padStart(12, '0')}`);
    const t = setup({ invites: ids.map((id) => invite(id, 1)), events: [] });
    await t.sweep();
    const reads = t.calls.filter((c) => c.table === 'portal_outbound_events' && c.op === 'select');
    expect(reads.map((c) => (c.filters.find((f) => f[0] === 'in')?.[2] as unknown[]).length)).toEqual([100, 100, 50]);
  });

  // En inbjudan som aldrig går fram blir aldrig klar. De äldsta först hade låtit dem tränga ut en ny.
  it('tar de nyaste inbjudningarna först, så att gamla som aldrig gick fram inte tränger ut en ny', async () => {
    const old = Array.from({ length: INVITE_PRICELIST_CANDIDATE_LIMIT }, (_, i) => ({
      ...invite(`gammal-${i}`, 1),
      created_at: `2026-09-01T00:00:${String(i % 60).padStart(2, '0')}.${String(i).padStart(3, '0')}Z`,
    }));
    const t = setup({ invites: [...old, invite(STORE, 1)] });
    expect(await t.sweep()).toMatchObject({ candidates: 1, queued: 1 });
  });

  it('avstängd integration: ingenting läses eller köas', async () => {
    const t = setup();
    expect(await t.sweep(NOW, { env: { ...ENV, RESELLER_PORTAL_URL: '' } })).toEqual({ candidates: 0, queued: 0, settled: 0, failed: 0, deferred: 0 });
    expect(t.calls).toEqual([]);
  });
});
