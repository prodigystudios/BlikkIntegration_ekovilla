import { describe, it, expect, vi } from 'vitest';
import {
  storeOrderManageAccess,
  confirmStoreOrder,
  linkStoreOrderCustomer,
  pushStoreOrderToFortnox,
  retryStoreOrderFortnox,
  setStoreOrderFreight,
  type StoreOrderFortnoxDeps,
} from '@/lib/domains/portal/storeOrderActions';
import { FortnoxApiError, FortnoxNotConnectedError } from '@/lib/domains/fortnox/client';
import { CONTRACT_STORE_ORDER } from './helpers/contractFixtures';
import { memoryAdmin } from './helpers/memoryAdmin';

/**
 * Ekovillas steg på en butiksbeställning mot databasen (fas 8b). Det som skyddas:
 *   - frakten och kunden bara medan beställningen är mottagen, och bara ett företagskort med kundnummer i Fortnox;
 *   - bekräftelsen låser VERSIONEN säljaren såg, med samma kund och en beslutad frakt; en ändring, tillbakadragning
 *     eller ett kundbyte som hann före låser ingenting, och svaret säger varför;
 *   - Fortnox-ordern skapas EN gång: claimen, numret läst om efter claimen och sparat direkt efter POST:en;
 *   - omförsöken (skyddsnätet, 5/15/60 min i 24 h) och att en beställning utan något att göra lämnar cron.
 */

const ID = '55555555-5555-4555-8555-555555555555';
const CARD_ID = '11111111-1111-4111-8111-111111111111';
const SELLER = '33333333-3333-4333-8333-333333333333';
const NOW = new Date('2026-09-29T10:00:00.000Z');
const FREIGHT_AT = '2026-09-29T09:30:00.000000+00:00';

const CARD = { id: CARD_ID, customer_type: 'business', fortnox_customer_id: '1043', organization_number: '556677-8899', personal_number: null };

function storeOrder(extra: Record<string, unknown> = {}) {
  return {
    id: ID,
    order_id: CONTRACT_STORE_ORDER.orderId,
    order_number: CONTRACT_STORE_ORDER.orderNumber,
    reseller_id: 'res-norrbygg',
    store_name: 'Norrbygg AB',
    customer_id: CARD_ID,
    assigned_to: SELLER,
    assigned_to_name: 'Anna Berg',
    status: 'received',
    payload: structuredClone(CONTRACT_STORE_ORDER),
    store_version: 2,
    freight_mode: 'charged',
    freight_price: '950.00',
    freight_set_at: FREIGHT_AT,
    fortnox_order_number: null,
    fortnox_order_sync_status: 'not_synced',
    fortnox_order_claimed_at: null,
    fortnox_error: null,
    fortnox_attempts: 0,
    fortnox_next_attempt_at: null,
    fortnox_retry_until: null,
    ...extra,
  };
}

function db(order: Record<string, unknown> = storeOrder(), extra: Record<string, Record<string, unknown>[]> = {}, options: Parameters<typeof memoryAdmin>[1] = {}) {
  return memoryAdmin(
    {
      crm_store_orders: [order],
      crm_customers: [CARD],
      profiles: [{ id: SELLER, full_name: 'Anna Berg' }],
      crm_portal_resellers: [{ reseller_id: 'res-norrbygg', name: 'Norrbygg AB', customer_id: null, customer_linked_at: null }],
      ...extra,
    },
    options,
  );
}

function fortnoxDeps(
  post: StoreOrderFortnoxDeps['post'] = vi.fn(async () => ({ Order: { DocumentNumber: '801' } })),
  findExisting: StoreOrderFortnoxDeps['findExisting'] = async () => null,
) {
  return {
    post: vi.fn(post),
    cancel: vi.fn(async () => {}),
    findExisting: vi.fn(findExisting),
    articles: vi.fn(async () => [{ article_number: '1050', description: 'FRAKT', unit: 'st' }]),
    now: () => NOW,
  };
}

const row = (m: ReturnType<typeof memoryAdmin>) => m.tables.crm_store_orders[0];
const minutes = (n: number) => new Date(NOW.getTime() + n * 60_000).toISOString();

describe('storeOrderManageAccess', () => {
  it('en beställning sessionen inte ser: not_found; regeln säger nej: forbidden; annars allowed', async () => {
    const rule = { value: true as unknown };
    const m = db(storeOrder(), {}, { rpc: (name, args) => (name === 'crm_store_order_can_manage' && args.p_id === ID ? rule.value : null) });
    expect(await storeOrderManageAccess(m.admin, ID)).toBe('allowed');
    rule.value = false;
    expect(await storeOrderManageAccess(m.admin, ID)).toBe('forbidden');
    // Bara true släpper igenom.
    rule.value = null;
    expect(await storeOrderManageAccess(m.admin, ID)).toBe('forbidden');
    expect(await storeOrderManageAccess(m.admin, '66666666-6666-4666-8666-666666666666')).toBe('not_found');
  });
});

describe('setStoreOrderFreight', () => {
  it('frakten eller Ingen frakt, med vem och när', async () => {
    const m = db(storeOrder({ freight_mode: null, freight_price: null, freight_set_at: null }));
    expect(await setStoreOrderFreight(m.admin, ID, { mode: 'charged', price: 1200 }, { id: SELLER }, null, () => NOW)).toEqual({ kind: 'saved' });
    expect(row(m)).toMatchObject({ freight_mode: 'charged', freight_price: 1200, freight_set_by: SELLER, freight_set_by_name: 'Anna Berg', freight_set_at: NOW.toISOString() });
    await setStoreOrderFreight(m.admin, ID, { mode: 'none' }, { id: SELLER }, NOW.toISOString(), () => NOW);
    expect(row(m)).toMatchObject({ freight_mode: 'none', freight_price: null });
  });

  it('🧨 någon annan sparade frakten sedan sidan lästes: ingenting skrivs över, "freight_changed"', async () => {
    const m = db();
    // Sidan visade ingen frakt; nu står 950 kr sparad (FREIGHT_AT).
    expect(await setStoreOrderFreight(m.admin, ID, { mode: 'none' }, { id: SELLER }, null)).toEqual({ kind: 'freight_changed' });
    expect(await setStoreOrderFreight(m.admin, ID, { mode: 'none' }, { id: SELLER }, '2026-09-29T08:00:00.000000+00:00')).toEqual({ kind: 'freight_changed' });
    expect(row(m)).toMatchObject({ freight_mode: 'charged', freight_price: '950.00' });
  });

  it('bara på en mottagen: bekräftad svarar not_received och ändrar ingenting; okänd not_found', async () => {
    const m = db(storeOrder({ status: 'confirmed' }));
    expect(await setStoreOrderFreight(m.admin, ID, { mode: 'none' }, { id: SELLER }, FREIGHT_AT)).toEqual({ kind: 'not_received' });
    expect(row(m).freight_mode).toBe('charged');
    expect(await setStoreOrderFreight(db().admin, '66666666-6666-4666-8666-666666666666', { mode: 'none' }, { id: SELLER }, null)).toEqual({ kind: 'not_found' });
  });
});

describe('linkStoreOrderCustomer', () => {
  const link = (m: ReturnType<typeof memoryAdmin>, customerId = CARD_ID, expectedCustomerId: string | null = null) =>
    linkStoreOrderCustomer(m.admin, m.admin, { id: ID, customerId, expectedCustomerId, actor: { id: SELLER } }, () => NOW);

  it('kopplar kortet på beställningen och butiken (som fas 3c)', async () => {
    const m = db(storeOrder({ customer_id: null }));
    expect(await link(m)).toEqual({ kind: 'linked', storeLink: 'linked' });
    expect(row(m).customer_id).toBe(CARD_ID);
    expect(m.tables.crm_portal_resellers[0]).toMatchObject({ customer_id: CARD_ID, customer_linked_by: SELLER, customer_linked_at: NOW.toISOString() });
  });

  it('🧨 ett byte på en beställning som redan hade kund gäller bara beställningen: butiken rörs inte', async () => {
    const other = '77777777-7777-4777-8777-777777777777';
    const m = db(storeOrder(), { crm_customers: [CARD, { ...CARD, id: other, fortnox_customer_id: '2000' }] });
    expect(await link(m, other, CARD_ID)).toEqual({ kind: 'linked', storeLink: 'not_applicable' });
    expect(row(m).customer_id).toBe(other);
    expect(m.tables.crm_portal_resellers[0].customer_id).toBeNull();
  });

  it('nekar ett kort som inte finns, en privatkund och ett kort utan kundnummer i Fortnox; ingenting sparas', async () => {
    const other = '77777777-7777-4777-8777-777777777777';
    const m = db(storeOrder({ customer_id: null }), {
      crm_customers: [
        { ...CARD, id: other, customer_type: 'private' },
        { ...CARD, id: '88888888-8888-4888-8888-888888888888', fortnox_customer_id: null },
      ],
    });
    expect(await link(m, CARD_ID)).toEqual({ kind: 'customer_not_found' });
    expect(await link(m, other)).toEqual({ kind: 'not_business' });
    expect(await link(m, '88888888-8888-4888-8888-888888888888')).toEqual({ kind: 'customer_not_in_fortnox' });
    expect(row(m).customer_id).toBeNull();
    expect(m.tables.crm_portal_resellers[0].customer_id).toBeNull();
  });

  it('🧨 ett felval rättas med Byt: butikens koppling för hand, som pekade på felvalet, följer med', async () => {
    const right = '77777777-7777-4777-8777-777777777777';
    const m = db(storeOrder(), {
      crm_customers: [CARD, { ...CARD, id: right, fortnox_customer_id: '2000' }],
      crm_portal_resellers: [{ reseller_id: 'res-norrbygg', name: 'Norrbygg AB', customer_id: CARD_ID, customer_linked_at: '2026-09-29T09:00:00Z' }],
    });
    expect(await link(m, right, CARD_ID)).toEqual({ kind: 'linked', storeLink: 'linked' });
    expect(m.tables.crm_portal_resellers[0]).toMatchObject({ customer_id: right, customer_linked_by: SELLER });
  });

  it('ett byte när butiken är kopplad till ett tredje kort: bara beställningen byts', async () => {
    const right = '77777777-7777-4777-8777-777777777777';
    const third = '99999999-9999-4999-8999-999999999999';
    const m = db(storeOrder(), {
      crm_customers: [CARD, { ...CARD, id: right, fortnox_customer_id: '2000' }],
      crm_portal_resellers: [{ reseller_id: 'res-norrbygg', name: 'Norrbygg AB', customer_id: third, customer_linked_at: '2026-09-29T09:00:00Z' }],
    });
    expect(await link(m, right, CARD_ID)).toEqual({ kind: 'linked', storeLink: 'not_applicable' });
    expect(m.tables.crm_portal_resellers[0].customer_id).toBe(third);
  });

  it('🧨 en annan hos Ekovilla bytte kund sedan sidan lästes: mitt byte skriver inte över, "customer_changed"', async () => {
    const other = '77777777-7777-4777-8777-777777777777';
    const third = '99999999-9999-4999-8999-999999999999';
    const m = db(storeOrder({ customer_id: other }), { crm_customers: [CARD, { ...CARD, id: third, fortnox_customer_id: '3000' }] });
    // Sidan visade CARD_ID; nu står `other` där.
    expect(await link(m, third, CARD_ID)).toEqual({ kind: 'customer_changed' });
    expect(row(m).customer_id).toBe(other);
  });

  it('🧨 butikens ändring kopplade ett kort under tiden: ingenting skrivs över, "customer_changed"', async () => {
    const other = '77777777-7777-4777-8777-777777777777';
    const m = db(storeOrder({ customer_id: null }), { crm_customers: [CARD, { ...CARD, id: other, fortnox_customer_id: '2000' }] }, {
      beforeExecute: (call, tables) => {
        if (call.table === 'crm_store_orders' && call.op === 'update' && 'customer_id' in (call.values as object)) {
          tables.crm_store_orders[0].customer_id = other;
        }
      },
    });
    expect(await link(m)).toEqual({ kind: 'customer_changed' });
    expect(row(m).customer_id).toBe(other);
    expect(m.tables.crm_portal_resellers[0].customer_id).toBeNull();
  });

  it('bara på en mottagen, och butiken rörs då inte', async () => {
    const m = db(storeOrder({ customer_id: null, status: 'confirmed' }));
    expect(await link(m)).toEqual({ kind: 'not_received' });
    expect(m.tables.crm_portal_resellers[0].customer_id).toBeNull();
  });

  it('🧨 butiken hade redan en koppling (ett jobb, 3c): den står kvar, och det är inget fel', async () => {
    const other = '77777777-7777-4777-8777-777777777777';
    const m = db(storeOrder({ customer_id: null }), {
      crm_portal_resellers: [{ reseller_id: 'res-norrbygg', name: 'Norrbygg AB', customer_id: other, customer_linked_at: '2026-09-28T10:00:00Z' }],
    });
    expect(await link(m)).toEqual({ kind: 'linked', storeLink: 'kept' });
    expect(row(m).customer_id).toBe(CARD_ID);
    expect(m.tables.crm_portal_resellers[0].customer_id).toBe(other);
  });

  it('🧨 butiken var kopplad bara via kundnumret: kopplingen för hand sparas (intaget läser bara den när numret saknas)', async () => {
    const other = '77777777-7777-4777-8777-777777777777';
    const m = db(storeOrder({ customer_id: null }), {
      crm_portal_resellers: [{ reseller_id: 'res-norrbygg', name: 'Norrbygg AB', customer_id: other, customer_linked_at: null }],
    });
    expect(await link(m)).toEqual({ kind: 'linked', storeLink: 'linked' });
    expect(m.tables.crm_portal_resellers[0]).toMatchObject({ customer_id: CARD_ID, customer_linked_by: SELLER });
  });

  it('butikens koppling föll: beställningen är ändå kopplad, och det sägs', async () => {
    const m = db(storeOrder({ customer_id: null }));
    m.failOn((c) => c.table === 'crm_portal_resellers', { message: 'nere' });
    expect(await link(m)).toEqual({ kind: 'linked', storeLink: 'failed' });
    expect(row(m).customer_id).toBe(CARD_ID);
  });
});

describe('confirmStoreOrder', () => {
  const SEEN = { version: 2, freightSetAt: FREIGHT_AT, customerId: CARD_ID };
  const confirm = (m: ReturnType<typeof memoryAdmin>, deps = fortnoxDeps(), expected: Partial<typeof SEEN> = {}) =>
    confirmStoreOrder(m.admin, { id: ID, expected: { ...SEEN, ...expected }, actor: { id: SELLER } }, deps);

  it('låser versionen, skapar Fortnox-ordern med 25 % och frakten, sparar numret och stänger planen', async () => {
    const m = db();
    const deps = fortnoxDeps();
    const result = await confirm(m, deps);
    expect(result).toEqual({ kind: 'confirmed', push: { outcome: 'created', fortnoxOrderNumber: '801', error: null } });
    expect(row(m)).toMatchObject({
      status: 'confirmed',
      confirmed_at: NOW.toISOString(),
      confirmed_by: SELLER,
      confirmed_by_name: 'Anna Berg',
      confirmed_version: 2,
      fortnox_order_number: '801',
      fortnox_order_sync_status: 'synced',
      fortnox_order_claimed_at: null,
      fortnox_error: null,
      fortnox_next_attempt_at: null,
    });
    expect(deps.post).toHaveBeenCalledTimes(1);
    const [path, body] = deps.post.mock.calls[0] as [string, { Order: Record<string, any> }];
    expect(path).toBe('/orders');
    expect(body.Order).toMatchObject({
      CustomerNumber: '1043',
      OrganisationNumber: '556677-8899',
      OurReference: 'Anna Berg',
      OrderDate: '2026-09-29',
      ExternalInvoiceReference1: `crm-store-order:${ID}`,
    });
    // Märkningen söktes före POST:en.
    expect(deps.findExisting).toHaveBeenCalledWith(`crm-store-order:${ID}`);
    expect(body.Order.OrderRows.map((r: any) => [r.ArticleNumber, r.Price, r.VAT, r.AccountNumber])).toEqual([
      ['13003', 335.3, 25, 3001],
      ['13102', 195.3, 25, 3001],
      ['1050', 950, 25, 3001],
      [null, 0, 25, 3001],
    ]);
    // Registret för raderna och frakten.
    expect(deps.articles).toHaveBeenCalledWith(['13003', '13102', '1050']);
  });

  it('skälet när något saknas, och då ändras ingenting och Fortnox anropas aldrig', async () => {
    const cases: [Record<string, unknown>, number, string][] = [
      [{ freight_mode: null, freight_price: null }, 2, 'freight_missing'],
      [{ customer_id: null }, 2, 'customer_missing'],
      [{ status: 'withdrawn', withdrawn_at: NOW.toISOString() }, 2, 'not_received'],
      [{}, 1, 'changed'],
      [{ freight_set_at: '2026-09-29T09:45:00.000000+00:00' }, 2, 'changed_here'],
    ];
    for (const [extra, version, reason] of cases) {
      const m = db(storeOrder(extra));
      const deps = fortnoxDeps();
      expect(await confirm(m, deps, { version })).toEqual({ kind: 'blocked', reason });
      expect(row(m).status).toBe(extra.status ?? 'received');
      expect(deps.post).not.toHaveBeenCalled();
    }
    const noNumber = db(storeOrder(), { crm_customers: [{ ...CARD, fortnox_customer_id: null }] });
    expect(await confirm(noNumber)).toEqual({ kind: 'blocked', reason: 'customer_not_in_fortnox' });
  });

  it('🧨 en annan hos Ekovilla ändrade frakten mellan läsningen och låset: ingenting låst, "changed_here"', async () => {
    const m = db(storeOrder(), {}, {
      beforeExecute: (call, tables) => {
        if (call.table === 'crm_store_orders' && call.op === 'update' && (call.values as Record<string, unknown>).status === 'confirmed') {
          Object.assign(tables.crm_store_orders[0], { freight_price: '5000.00', freight_set_at: '2026-09-29T09:59:00.000000+00:00' });
        }
      },
    });
    const deps = fortnoxDeps();
    expect(await confirm(m, deps)).toEqual({ kind: 'blocked', reason: 'changed_here' });
    expect(row(m).status).toBe('received');
    expect(deps.post).not.toHaveBeenCalled();
  });

  it('🧨 butiken ändrade mellan läsningen och låset: ingenting låst, "changed", och ingen Fortnox-order', async () => {
    const m = db(storeOrder(), {}, {
      beforeExecute: (call, tables) => {
        if (call.table === 'crm_store_orders' && call.op === 'update' && (call.values as Record<string, unknown>).status === 'confirmed') {
          tables.crm_store_orders[0].store_version = 3;
        }
      },
    });
    const deps = fortnoxDeps();
    expect(await confirm(m, deps)).toEqual({ kind: 'blocked', reason: 'changed' });
    expect(row(m).status).toBe('received');
    expect(deps.post).not.toHaveBeenCalled();
  });

  it('🧨 butiken drog tillbaka i samma stund: "not_received"; en annan bytte kund: ingenting låst', async () => {
    const withdrawn = db(storeOrder(), {}, {
      beforeExecute: (call, tables) => {
        if (call.table === 'crm_store_orders' && call.op === 'update' && (call.values as Record<string, unknown>).status === 'confirmed') {
          Object.assign(tables.crm_store_orders[0], { status: 'withdrawn' });
        }
      },
    });
    expect(await confirm(withdrawn)).toEqual({ kind: 'blocked', reason: 'not_received' });

    const other = '77777777-7777-4777-8777-777777777777';
    const swapped = db(storeOrder(), { crm_customers: [CARD, { ...CARD, id: other, fortnox_customer_id: '2000' }] }, {
      beforeExecute: (call, tables) => {
        if (call.table === 'crm_store_orders' && call.op === 'update' && (call.values as Record<string, unknown>).status === 'confirmed') {
          tables.crm_store_orders[0].customer_id = other;
        }
      },
    });
    const deps = fortnoxDeps();
    expect((await confirm(swapped, deps)).kind).toBe('blocked');
    expect(row(swapped).status).toBe('received');
    expect(deps.post).not.toHaveBeenCalled();
  });

  it('🧨 Fortnox-försöket kastar efter låset: bekräftad ändå (svaret säger det), och skyddsnätet står på raden', async () => {
    const m = db();
    // Claimen faller: allt efter låset uteblir, som när processen dör.
    m.failOn((c) => c.table === 'crm_store_orders' && c.op === 'update' && (c.values as Record<string, unknown>).fortnox_order_sync_status === 'pending', { message: 'borta' });
    const result = await confirm(m);
    expect(result).toMatchObject({ kind: 'confirmed', push: { outcome: 'failed', fortnoxOrderNumber: null } });
    expect(row(m)).toMatchObject({ status: 'confirmed', fortnox_attempts: 0, fortnox_next_attempt_at: minutes(5), fortnox_retry_until: minutes(24 * 60) });
  });

  it('Fortnox nere (5xx): bekräftad ändå, felet sparat, nytt försök om 5 min i ett fönster på 24 h', async () => {
    const m = db();
    const deps = fortnoxDeps(async () => {
      throw new FortnoxApiError(503, 'Fortnox POST /orders misslyckades (503)');
    });
    const result = await confirm(m, deps);
    expect(result).toMatchObject({ kind: 'confirmed', push: { outcome: 'failed', fortnoxOrderNumber: null } });
    expect(row(m)).toMatchObject({
      status: 'confirmed',
      fortnox_order_number: null,
      fortnox_order_sync_status: 'failed',
      fortnox_order_claimed_at: null,
      fortnox_attempts: 1,
      fortnox_next_attempt_at: minutes(5),
      fortnox_retry_until: minutes(24 * 60),
    });
    expect(row(m).fortnox_error).toMatch(/^Fortnox svarade: /);
  });

  it('🧨 Fortnox besked om ordern (4xx, t.ex. en artikel som saknas): stopp utan omförsök, med Fortnox text', async () => {
    const m = db();
    const deps = fortnoxDeps(async () => {
      throw new FortnoxApiError(400, 'Fortnox POST /orders misslyckades (400)', 2000428, 'Kan inte hitta artikeln.');
    });
    const result = await confirm(m, deps);
    expect(result).toMatchObject({ kind: 'confirmed', push: { outcome: 'blocked', fortnoxOrderNumber: null } });
    expect(row(m)).toMatchObject({ status: 'confirmed', fortnox_order_sync_status: 'failed', fortnox_next_attempt_at: null });
    expect(row(m).fortnox_error).toMatch(/^Fortnox svarade: /);
  });

  it('en tidsgräns hos Fortnox (429) är tekniskt: nytt försök', async () => {
    const m = db();
    await confirm(m, fortnoxDeps(async () => {
      throw new FortnoxApiError(429, 'Fortnox POST /orders misslyckades (429)');
    }));
    expect(row(m)).toMatchObject({ fortnox_attempts: 1, fortnox_next_attempt_at: minutes(5) });
  });
});

describe('pushStoreOrderToFortnox', () => {
  const confirmed = (extra: Record<string, unknown> = {}) =>
    storeOrder({ status: 'confirmed', fortnox_next_attempt_at: minutes(5), fortnox_retry_until: minutes(24 * 60), ...extra });

  it('en push pågår redan (färsk claim): ingen POST, och den andras plan och räknare rörs inte', async () => {
    const held = { fortnox_order_sync_status: 'pending', fortnox_order_claimed_at: new Date().toISOString() };
    const m = db(confirmed({ ...held, fortnox_attempts: 2, fortnox_next_attempt_at: minutes(15) }));
    const deps = fortnoxDeps();
    expect(await pushStoreOrderToFortnox(m.admin, ID, deps)).toMatchObject({ outcome: 'in_progress' });
    expect(deps.post).not.toHaveBeenCalled();
    expect(row(m)).toMatchObject({ fortnox_attempts: 2, fortnox_next_attempt_at: minutes(15) });

    // Inget planerat och ingen order: en ny titt om 5 min, så att den inte blir hängande.
    const idle = db(confirmed({ ...held, fortnox_next_attempt_at: null }));
    await pushStoreOrderToFortnox(idle.admin, ID, fortnoxDeps());
    expect(row(idle).fortnox_next_attempt_at).toBe(minutes(5));
  });

  it('🧨 ordern fanns redan i Fortnox (ett försök som dog efter POST:en): den tas över, ingen andra order', async () => {
    const m = db(confirmed());
    const deps = fortnoxDeps(undefined, async () => '790');
    expect(await pushStoreOrderToFortnox(m.admin, ID, deps)).toEqual({ outcome: 'exists', fortnoxOrderNumber: '790', error: null });
    expect(deps.post).not.toHaveBeenCalled();
    expect(row(m)).toMatchObject({ fortnox_order_number: '790', fortnox_order_sync_status: 'synced', fortnox_next_attempt_at: null });
  });

  it('🧨 sökningen går inte: ingen POST (utan den vet vi inte om ordern redan finns), nytt försök', async () => {
    const m = db(confirmed());
    const deps = fortnoxDeps(undefined, async () => {
      throw new Error('Fortnox svarar inte');
    });
    expect((await pushStoreOrderToFortnox(m.admin, ID, deps)).outcome).toBe('failed');
    expect(deps.post).not.toHaveBeenCalled();
    expect(row(m)).toMatchObject({ fortnox_order_number: null, fortnox_attempts: 1, fortnox_next_attempt_at: minutes(5) });

    // Fortnox inte anslutet vid sökningen: den egna klassen och texten, inte ett allmänt fel.
    const mc = db(confirmed());
    const result = await pushStoreOrderToFortnox(mc.admin, ID, fortnoxDeps(undefined, async () => {
      throw new FortnoxNotConnectedError();
    }));
    expect(result).toMatchObject({ outcome: 'failed', error: 'Fortnox är inte kopplat. Be en administratör ansluta Fortnox i CRM-inställningarna.' });
    expect(row(mc).fortnox_order_sync_status).toBe('not_synced');

    // Också när sökningen svarar 4xx: det är ingen människas sak att rätta, och utan svaret vet vi inget.
    const m4 = db(confirmed());
    const deps4 = fortnoxDeps(undefined, async () => {
      throw new FortnoxApiError(400, 'Fortnox GET /orders misslyckades (400)');
    });
    expect((await pushStoreOrderToFortnox(m4.admin, ID, deps4)).outcome).toBe('failed');
    expect(row(m4)).toMatchObject({ fortnox_attempts: 1, fortnox_next_attempt_at: minutes(5) });
  });

  it('🧨 numret kom medan claimen togs: ingen andra order', async () => {
    const m = db(confirmed(), {}, {
      beforeExecute: (call, tables) => {
        // Precis efter claimen sparar ett annat försök sitt nummer.
        if (call.table === 'crm_store_orders' && call.op === 'select' && tables.crm_store_orders[0].fortnox_order_sync_status === 'pending') {
          tables.crm_store_orders[0].fortnox_order_number = '799';
        }
      },
    });
    const deps = fortnoxDeps();
    expect(await pushStoreOrderToFortnox(m.admin, ID, deps)).toEqual({ outcome: 'exists', fortnoxOrderNumber: '799', error: null });
    expect(deps.post).not.toHaveBeenCalled();
    expect(row(m)).toMatchObject({ fortnox_order_sync_status: 'synced', fortnox_order_claimed_at: null, fortnox_next_attempt_at: null });
  });

  it('redan i Fortnox, eller inte bekräftad (makulerad): ingen claim, ingen POST, och planen stängs så att cron släpper den', async () => {
    for (const extra of [{ fortnox_order_number: '801' }, { status: 'cancelled' }]) {
      const m = db(confirmed(extra));
      const deps = fortnoxDeps();
      await pushStoreOrderToFortnox(m.admin, ID, deps);
      expect(deps.post).not.toHaveBeenCalled();
      expect(row(m).fortnox_next_attempt_at).toBeNull();
      const claimed = m.calls.some((c) => c.op === 'update' && (c.values as Record<string, unknown>).fortnox_order_sync_status === 'pending');
      expect(claimed).toBe(false);
    }
  });

  it('🧨 en bekräftelse i samma stund som en push läste "mottagen": skyddsnätet nollas inte', async () => {
    const m = db(storeOrder({ status: 'received' }), {}, {
      beforeExecute: (call, tables) => {
        // Pushen läste raden som mottagen; bekräftelsen hinner före dess stängning av planen.
        if (call.table === 'crm_store_orders' && call.op === 'update' && 'fortnox_next_attempt_at' in (call.values as object)) {
          Object.assign(tables.crm_store_orders[0], { status: 'confirmed', fortnox_next_attempt_at: minutes(5) });
        }
      },
    });
    expect((await pushStoreOrderToFortnox(m.admin, ID, fortnoxDeps())).outcome).toBe('skipped');
    expect(row(m).fortnox_next_attempt_at).toBe(minutes(5));
  });

  it('vårt eget fel (registret går inte att läsa): nytt försök, och databasens text når aldrig säljaren', async () => {
    const m = db(confirmed());
    const deps = { ...fortnoxDeps(), articles: vi.fn(async () => { throw new Error('relation "hemlig" does not exist'); }) };
    const result = await pushStoreOrderToFortnox(m.admin, ID, deps);
    expect(result.outcome).toBe('failed');
    expect(result.error).not.toContain('hemlig');
    expect(row(m).fortnox_error).not.toContain('hemlig');
    expect(deps.post).not.toHaveBeenCalled();
  });

  it('kortet tappade kundnumret efter bekräftelsen: stopp utan omförsök, med skälet', async () => {
    const m = db(confirmed(), { crm_customers: [{ ...CARD, fortnox_customer_id: null }] });
    const deps = fortnoxDeps();
    expect(await pushStoreOrderToFortnox(m.admin, ID, deps)).toEqual({ outcome: 'blocked', fortnoxOrderNumber: null, error: 'Kundkortet saknar kundnummer i Fortnox.' });
    expect(deps.post).not.toHaveBeenCalled();
    expect(row(m)).toMatchObject({ fortnox_order_sync_status: 'failed', fortnox_next_attempt_at: null, fortnox_error: 'Kundkortet saknar kundnummer i Fortnox.' });
  });

  it('behörigheten (403) är tekniskt, inte ett besked om ordern: nya försök', async () => {
    const m = db(confirmed());
    const deps = fortnoxDeps(async () => {
      throw new FortnoxApiError(403, 'Fortnox POST /orders misslyckades (403)');
    });
    expect((await pushStoreOrderToFortnox(m.admin, ID, deps)).outcome).toBe('failed');
    expect(row(m)).toMatchObject({ fortnox_attempts: 1, fortnox_next_attempt_at: minutes(5) });
  });

  it('🧨 "Skicka till Fortnox" efter att fönstret gått ut: skyddsnätet får ett nytt fönster, så att cron inte ger upp det', async () => {
    // Omförsöken gav upp efter ett dygn: 27 försök.
    const m = db(confirmed({ fortnox_next_attempt_at: null, fortnox_retry_until: minutes(-60), fortnox_attempts: 27 }));
    const deps = fortnoxDeps(async () => {
      throw new Error('processen dog');
    });
    let during: Record<string, unknown> = {};
    deps.findExisting.mockImplementation(async () => {
      during = { next: row(m).fortnox_next_attempt_at, until: row(m).fortnox_retry_until };
      return null;
    });
    await pushStoreOrderToFortnox(m.admin, ID, deps);
    // Ett nytt fönster räknar från noll: nästa försök om 5 min, inte en timme.
    expect(during).toEqual({ next: minutes(5), until: minutes(24 * 60) });
    expect(row(m)).toMatchObject({ fortnox_attempts: 1, fortnox_next_attempt_at: minutes(5) });
  });

  it('🧨 "Skicka till Fortnox" utan planerat försök: skyddsnätet sätts före POST:en (dör processen tar cron över)', async () => {
    const m = db(confirmed({ fortnox_next_attempt_at: null, fortnox_retry_until: null }));
    const deps = fortnoxDeps();
    let during: unknown = 'inte satt';
    deps.post.mockImplementation(async () => {
      during = row(m).fortnox_next_attempt_at;
      return { Order: { DocumentNumber: '801' } };
    });
    await pushStoreOrderToFortnox(m.admin, ID, deps);
    expect(during).toBe(minutes(5));
    expect(row(m).fortnox_next_attempt_at).toBeNull();
  });

  it('🧨 databasen svarar inte efter claimen: claimen släpps (knappen svarar inte "skapas redan" i två minuter)', async () => {
    const m = db(confirmed());
    m.failOn((c) => c.table === 'crm_customers', { message: 'nere' });
    await expect(pushStoreOrderToFortnox(m.admin, ID, fortnoxDeps())).rejects.toThrow();
    expect(row(m)).toMatchObject({ fortnox_order_sync_status: 'failed', fortnox_order_claimed_at: null });
  });

  it('numret gick inte att spara, men ett annat försök hann koppla just vår order: klart, inget fel', async () => {
    const m = db(confirmed());
    m.failOn((c) => c.table === 'crm_store_orders' && c.op === 'update' && (c.values as Record<string, unknown>).fortnox_order_number === '801', { message: 'nere' });
    const deps = fortnoxDeps();
    deps.post.mockImplementation(async () => {
      row(m).fortnox_order_number = '801';
      return { Order: { DocumentNumber: '801' } };
    });
    expect(await pushStoreOrderToFortnox(m.admin, ID, deps)).toEqual({ outcome: 'created', fortnoxOrderNumber: '801', error: null });
    expect(deps.cancel).not.toHaveBeenCalled();
  });

  it('Fortnox inte anslutet: not_synced, och nya försök', async () => {
    const m = db(confirmed());
    const deps = fortnoxDeps(async () => {
      throw new FortnoxNotConnectedError();
    });
    expect((await pushStoreOrderToFortnox(m.admin, ID, deps)).outcome).toBe('failed');
    expect(row(m)).toMatchObject({ fortnox_order_sync_status: 'not_synced', fortnox_attempts: 1, fortnox_next_attempt_at: minutes(5) });
  });

  it('omförsöken glesnar: 5 min, 15 min, sedan en timme', async () => {
    const m = db(confirmed({ fortnox_attempts: 2 }));
    await pushStoreOrderToFortnox(m.admin, ID, fortnoxDeps(async () => {
      throw new Error('nätet');
    }));
    expect(row(m)).toMatchObject({ fortnox_attempts: 3, fortnox_next_attempt_at: minutes(60) });
  });

  it('🧨 numret gick inte att spara: svaret säger numret, ett försök planeras, och det tar över ordern i stället för att skapa en till', async () => {
    // Inget planerat sedan förut (t.ex. "Skicka till Fortnox" efter att omförsöken gett upp).
    const m = db(confirmed({ fortnox_next_attempt_at: null }));
    m.failOn((c) => c.table === 'crm_store_orders' && c.op === 'update' && (c.values as Record<string, unknown>).fortnox_order_number === '801', { message: 'nere' });
    const result = await pushStoreOrderToFortnox(m.admin, ID, fortnoxDeps());
    // `failed`, inte `blocked`: ett försök är planerat och tar över ordern, ingen människa behövs.
    expect(result).toMatchObject({ outcome: 'failed', fortnoxOrderNumber: '801' });
    expect(result.error).toContain('ingen ny order skapas');
    expect(row(m).fortnox_next_attempt_at).toBe(minutes(5));
    // Claimen släpptes, så att knappen inte svarar "skapas redan" i två minuter, och numret står i felet på raden.
    expect(row(m)).toMatchObject({ fortnox_order_sync_status: 'failed', fortnox_order_claimed_at: null });
    expect(row(m).fortnox_error).toContain('Fortnox-order 801 skapades');

    // Claimen blev gammal; nästa försök söker och hittar ordern.
    Object.assign(row(m), { fortnox_order_claimed_at: new Date(Date.now() - 10 * 60_000).toISOString() });
    const again = fortnoxDeps(undefined, async () => '801');
    expect(await pushStoreOrderToFortnox(m.admin, ID, again)).toEqual({ outcome: 'exists', fortnoxOrderNumber: '801', error: null });
    expect(again.post).not.toHaveBeenCalled();
    expect(row(m).fortnox_order_number).toBe('801');
  });

  it('🧨 två försök skickade samtidigt (claimen blev gammal): den som inte fick spara sitt nummer makulerar sin order', async () => {
    const m = db(confirmed());
    // Precis när vi sparar har ett annat försök sparat 799; vakten nekar ett andra nummer.
    m.failOn((c) => c.table === 'crm_store_orders' && c.op === 'update' && (c.values as Record<string, unknown>).fortnox_order_number === '801', { message: 'ett Fortnox-nummer skrivs en gång' });
    const deps = fortnoxDeps();
    deps.post.mockImplementation(async () => {
      row(m).fortnox_order_number = '799';
      return { Order: { DocumentNumber: '801' } };
    });
    expect(await pushStoreOrderToFortnox(m.admin, ID, deps)).toEqual({ outcome: 'exists', fortnoxOrderNumber: '799', error: null });
    expect(deps.cancel).toHaveBeenCalledWith('801');
    expect(row(m).fortnox_order_number).toBe('799');
  });

  it('🧨 ett långsamt försök som faller skriver inte över en order som ett annat försök hann skapa', async () => {
    const m = db(confirmed());
    const deps = fortnoxDeps(async () => {
      // Medan det här försöket väntade (claimen blev gammal) skapade ett annat ordern och sparade numret.
      Object.assign(row(m), { fortnox_order_number: '799', fortnox_order_sync_status: 'synced', fortnox_next_attempt_at: null, fortnox_error: null });
      throw new FortnoxApiError(503, 'Fortnox POST /orders misslyckades (503)');
    });
    // Svaret säger att ordern finns, inte att den inte kunde skapas.
    expect(await pushStoreOrderToFortnox(m.admin, ID, deps)).toEqual({ outcome: 'exists', fortnoxOrderNumber: '799', error: null });
    expect(row(m)).toMatchObject({ fortnox_order_number: '799', fortnox_order_sync_status: 'synced', fortnox_next_attempt_at: null, fortnox_error: null });
  });

  it('🧨 makulerad medan ordern skapades (8b2, claimen blev gammal): numret skrivs inte, och vår order makuleras', async () => {
    const m = db(confirmed());
    const deps = fortnoxDeps();
    deps.post.mockImplementation(async () => {
      // Makulera tog över claimen och sökte innan vår POST kom fram.
      Object.assign(row(m), { status: 'cancelled', cancel_reason: 'Fel artikel', fortnox_order_sync_status: 'not_synced', fortnox_order_claimed_at: null });
      return { Order: { DocumentNumber: '801' } };
    });
    expect(await pushStoreOrderToFortnox(m.admin, ID, deps)).toEqual({ outcome: 'skipped', fortnoxOrderNumber: null, error: null });
    expect(deps.cancel).toHaveBeenCalledWith('801');
    expect(row(m)).toMatchObject({ status: 'cancelled', fortnox_order_number: null });
  });

  it('ingen rad skrevs men beställningen är fortfarande bekräftad: som ett nummer som inte gick att spara, ordern står kvar', async () => {
    let blocked = false;
    const m = db(confirmed(), {}, { canUpdate: () => !blocked });
    const deps = fortnoxDeps();
    deps.post.mockImplementation(async () => ((blocked = true), { Order: { DocumentNumber: '801' } }));
    expect(await pushStoreOrderToFortnox(m.admin, ID, deps)).toMatchObject({ outcome: 'failed', fortnoxOrderNumber: '801' });
    expect(deps.cancel).not.toHaveBeenCalled();
  });

  it('makuleringen hittade redan vår order och skrev den på beställningen: den makuleras inte en gång till', async () => {
    const m = db(confirmed());
    const deps = fortnoxDeps();
    deps.post.mockImplementation(async () => {
      Object.assign(row(m), { status: 'cancelled', fortnox_order_number: '801' });
      return { Order: { DocumentNumber: '801' } };
    });
    expect(await pushStoreOrderToFortnox(m.admin, ID, deps)).toEqual({ outcome: 'skipped', fortnoxOrderNumber: null, error: null });
    expect(deps.cancel).not.toHaveBeenCalled();
  });

  it('🧨 ett försök som faller medan beställningen makulerades (med en order från sökningen): "skipped", inte "exists"', async () => {
    const m = db(confirmed());
    const deps = fortnoxDeps(async () => {
      Object.assign(row(m), { status: 'cancelled', fortnox_order_number: '57' });
      throw new FortnoxApiError(503, 'Fortnox POST /orders misslyckades (503)');
    });
    expect(await pushStoreOrderToFortnox(m.admin, ID, deps)).toEqual({ outcome: 'skipped', fortnoxOrderNumber: null, error: null });
  });

  it('🧨 Fortnox nekar medan beställningen makulerades (ingen order): inget fel och inga nya försök på den makulerade', async () => {
    const m = db(confirmed({ fortnox_next_attempt_at: null }));
    const deps = fortnoxDeps(async () => {
      Object.assign(row(m), { status: 'cancelled', fortnox_next_attempt_at: null, fortnox_order_sync_status: 'not_synced', fortnox_order_claimed_at: null });
      throw new FortnoxApiError(503, 'Fortnox POST /orders misslyckades (503)');
    });
    expect(await pushStoreOrderToFortnox(m.admin, ID, deps)).toEqual({ outcome: 'skipped', fortnoxOrderNumber: null, error: null });
    expect(row(m)).toMatchObject({ status: 'cancelled', fortnox_error: null, fortnox_next_attempt_at: null, fortnox_order_sync_status: 'not_synced' });
  });

  it('🧨 POST:en föll (svaret kom aldrig) medan beställningen makulerades, men Fortnox skapade ordern: den makuleras', async () => {
    const m = db(confirmed({ fortnox_next_attempt_at: null }));
    let searches = 0;
    // Före POST:en finns ingen order; efter den finns 801 (skapad fast svaret aldrig kom), och sedan ingen öppen.
    const deps = fortnoxDeps(
      async () => {
        Object.assign(row(m), { status: 'cancelled', fortnox_next_attempt_at: null, fortnox_order_claimed_at: null });
        throw new FortnoxApiError(504, 'Fortnox POST /orders misslyckades (504)');
      },
      async () => (++searches === 2 ? '801' : null),
    );
    expect(await pushStoreOrderToFortnox(m.admin, ID, deps)).toEqual({ outcome: 'skipped', fortnoxOrderNumber: null, error: null });
    expect(deps.cancel).toHaveBeenCalledWith('801');
    expect(deps.cancel).toHaveBeenCalledTimes(1);
    expect(row(m)).toMatchObject({ status: 'cancelled', fortnox_order_number: null, fortnox_error: null });
  });

  it('🧨 POST:en föll medan beställningen makulerades, och sökningen efteråt går inte: ett svep planeras', async () => {
    const m = db(confirmed({ fortnox_next_attempt_at: null }));
    let searches = 0;
    const deps = fortnoxDeps(
      async () => {
        Object.assign(row(m), { status: 'cancelled', fortnox_next_attempt_at: null, fortnox_order_claimed_at: null });
        throw new FortnoxApiError(504, 'Fortnox POST /orders misslyckades (504)');
      },
      async () => {
        if (++searches === 1) return null;
        throw new FortnoxApiError(503, 'Fortnox GET /orders misslyckades (503)');
      },
    );
    expect(await pushStoreOrderToFortnox(m.admin, ID, deps)).toMatchObject({ outcome: 'skipped' });
    expect(row(m)).toMatchObject({ status: 'cancelled', fortnox_next_attempt_at: minutes(5) });
  });

  it('🧨 vår order kunde inte makuleras (Fortnox nere): ett svep planeras på den makulerade, om 5 min', async () => {
    const m = db(confirmed({ fortnox_next_attempt_at: null }));
    const deps = fortnoxDeps();
    deps.post.mockImplementation(async () => {
      Object.assign(row(m), { status: 'cancelled', fortnox_next_attempt_at: null, fortnox_order_claimed_at: null });
      return { Order: { DocumentNumber: '801' } };
    });
    deps.cancel.mockImplementation(async () => {
      throw new FortnoxApiError(503, 'Fortnox PUT misslyckades (503)');
    });
    expect(await pushStoreOrderToFortnox(m.admin, ID, deps)).toMatchObject({ outcome: 'skipped' });
    expect(row(m)).toMatchObject({ status: 'cancelled', fortnox_order_number: null, fortnox_next_attempt_at: minutes(5), fortnox_attempts: 1 });
  });

  it('🧨 svepet: ett planerat försök på en makulerad makulerar ordrarna med märkningen och stänger planen', async () => {
    // Makuleringen skrev numret på en order den själv makulerade; en annan (801) blev kvar.
    const m = db(storeOrder({ status: 'cancelled', fortnox_order_number: '57', fortnox_next_attempt_at: minutes(-1), fortnox_attempts: 1, fortnox_retry_until: minutes(60) }));
    let searches = 0;
    const deps = fortnoxDeps(undefined, async () => (++searches === 1 ? '801' : null));
    expect(await pushStoreOrderToFortnox(m.admin, ID, deps)).toEqual({ outcome: 'skipped', fortnoxOrderNumber: null, error: null });
    expect(deps.cancel).toHaveBeenCalledWith('801');
    expect(deps.findExisting).toHaveBeenCalledWith(`crm-store-order:${ID}`);
    expect(deps.post).not.toHaveBeenCalled();
    expect(row(m)).toMatchObject({ status: 'cancelled', fortnox_order_number: '57', fortnox_next_attempt_at: null });
  });

  it('svepet går inte (Fortnox nere): nytt försök enligt schemat', async () => {
    const m = db(storeOrder({ status: 'cancelled', fortnox_order_number: null, fortnox_next_attempt_at: minutes(-1), fortnox_attempts: 1, fortnox_retry_until: minutes(60) }));
    const deps = fortnoxDeps(undefined, async () => {
      throw new FortnoxApiError(503, 'Fortnox GET /orders misslyckades (503)');
    });
    expect(await pushStoreOrderToFortnox(m.admin, ID, deps)).toMatchObject({ outcome: 'failed', fortnoxOrderNumber: null });
    expect(row(m)).toMatchObject({ status: 'cancelled', fortnox_attempts: 2, fortnox_next_attempt_at: minutes(15) });
  });

  it('🧨 svepet: Fortnox listar ordern som öppen också efter makuleringen: den makuleras en gång, och nästa svep avgör', async () => {
    const m = db(storeOrder({ status: 'cancelled', fortnox_order_number: null, fortnox_next_attempt_at: minutes(-1), fortnox_attempts: 1, fortnox_retry_until: minutes(60) }));
    const deps = fortnoxDeps(undefined, async () => '801');
    expect(await pushStoreOrderToFortnox(m.admin, ID, deps)).toMatchObject({ outcome: 'failed' });
    expect(deps.cancel).toHaveBeenCalledTimes(1);
    expect(row(m).fortnox_next_attempt_at).toBe(minutes(15));
  });

  it('en makulerad utan planerat försök söks aldrig i Fortnox', async () => {
    const m = db(storeOrder({ status: 'cancelled', fortnox_order_number: null, fortnox_next_attempt_at: null }));
    const deps = fortnoxDeps();
    expect(await pushStoreOrderToFortnox(m.admin, ID, deps)).toMatchObject({ outcome: 'skipped' });
    expect(deps.findExisting).not.toHaveBeenCalled();
  });

  it('🧨 kortet tappade numret medan beställningen makulerades: stoppet skrivs inte på den makulerade', async () => {
    const m = db(confirmed({ fortnox_next_attempt_at: null }), { crm_customers: [{ ...CARD, fortnox_customer_id: null }] }, {
      beforeExecute: (call, tables) => {
        if (call.op === 'update' && typeof (call.values as Record<string, unknown>).fortnox_error === 'string') tables.crm_store_orders[0].status = 'cancelled';
      },
    });
    expect(await pushStoreOrderToFortnox(m.admin, ID, fortnoxDeps())).toEqual({ outcome: 'skipped', fortnoxOrderNumber: null, error: null });
    expect(row(m)).toMatchObject({ status: 'cancelled', fortnox_error: null });
  });

  it('🧨 numret gick inte att spara och beställningen makulerades under tiden: vår order makuleras, inga nya försök', async () => {
    const m = db(confirmed({ fortnox_next_attempt_at: null }));
    m.failOn((c) => c.table === 'crm_store_orders' && c.op === 'update' && (c.values as Record<string, unknown>).fortnox_order_number === '801', { message: 'nere' });
    const deps = fortnoxDeps();
    deps.post.mockImplementation(async () => {
      // Makuleringen stänger omförsöken (skyddsnätet som pushen satte före POST:en).
      Object.assign(row(m), { status: 'cancelled', fortnox_order_sync_status: 'not_synced', fortnox_order_claimed_at: null, fortnox_next_attempt_at: null });
      return { Order: { DocumentNumber: '801' } };
    });
    expect(await pushStoreOrderToFortnox(m.admin, ID, deps)).toEqual({ outcome: 'skipped', fortnoxOrderNumber: null, error: null });
    expect(deps.cancel).toHaveBeenCalledWith('801');
    // Inget nytt försök planeras och inget "skapades men sparades inte" skrivs på den makulerade.
    expect(row(m)).toMatchObject({ status: 'cancelled', fortnox_order_number: null, fortnox_next_attempt_at: null, fortnox_error: null });
  });

  it('🧨 numret gick inte att spara, och beställningen makulerades just innan det nya försöket skrevs: vår order makuleras', async () => {
    const m = db(confirmed({ fortnox_next_attempt_at: null }), {}, {
      beforeExecute: (call, tables) => {
        const values = call.values as Record<string, unknown> | undefined;
        if (call.op === 'update' && typeof values?.fortnox_error === 'string' && values.fortnox_error.includes('skapades')) {
          Object.assign(tables.crm_store_orders[0], { status: 'cancelled', fortnox_order_claimed_at: null, fortnox_next_attempt_at: null });
        }
      },
    });
    m.failOn((c) => c.table === 'crm_store_orders' && c.op === 'update' && (c.values as Record<string, unknown>).fortnox_order_number === '801', { message: 'nere' });
    const deps = fortnoxDeps();
    expect(await pushStoreOrderToFortnox(m.admin, ID, deps)).toEqual({ outcome: 'skipped', fortnoxOrderNumber: null, error: null });
    expect(deps.cancel).toHaveBeenCalledWith('801');
    expect(row(m)).toMatchObject({ status: 'cancelled', fortnox_next_attempt_at: null, fortnox_error: null });
  });

  it('Fortnox svarade utan nummer: ett fel, inte en order', async () => {
    const m = db(confirmed());
    expect((await pushStoreOrderToFortnox(m.admin, ID, fortnoxDeps(async () => ({ Order: {} })))).outcome).toBe('failed');
    expect(row(m).fortnox_order_number).toBeNull();
  });
});

describe('retryStoreOrderFortnox', () => {
  it('tar det som är dags, med ett lån, och skapar ordern', async () => {
    const m = db(storeOrder({ status: 'confirmed', fortnox_next_attempt_at: minutes(-1), fortnox_retry_until: minutes(60) }));
    const deps = fortnoxDeps();
    expect(await retryStoreOrderFortnox(m.admin, { deps })).toEqual({ due: 1, attempted: 1, gaveUp: 0, skipped: 0, errors: 0 });
    expect(row(m)).toMatchObject({ fortnox_order_number: '801', fortnox_next_attempt_at: null });
  });

  it('inte dags än: ingenting; fönstret har gått ut: ges upp utan försök', async () => {
    const later = db(storeOrder({ status: 'confirmed', fortnox_next_attempt_at: minutes(1), fortnox_retry_until: minutes(60) }));
    expect((await retryStoreOrderFortnox(later.admin, { deps: fortnoxDeps() })).due).toBe(0);

    // Planerat långt efter fönstret: ges upp utan försök.
    const expired = db(storeOrder({ status: 'confirmed', fortnox_next_attempt_at: minutes(-1), fortnox_retry_until: minutes(-20) }));
    const deps = fortnoxDeps();
    expect(await retryStoreOrderFortnox(expired.admin, { deps })).toMatchObject({ due: 1, gaveUp: 1, attempted: 0 });
    expect(deps.post).not.toHaveBeenCalled();
    expect(row(expired).fortnox_next_attempt_at).toBeNull();
  });

  it('🧨 ett lån som togs nära fönstrets slut (lånet ligger efter slutet): försöket görs ändå', async () => {
    const lease = db(storeOrder({ status: 'confirmed', fortnox_next_attempt_at: minutes(-1), fortnox_retry_until: minutes(-6) }));
    expect(await retryStoreOrderFortnox(lease.admin, { deps: fortnoxDeps() })).toMatchObject({ gaveUp: 0, attempted: 1 });
  });

  it('🧨 ett sent försök (efter fönstret) som faller: omförsöken tar slut, inget nytt fönster på 24 h', async () => {
    const m = db(storeOrder({ status: 'confirmed', fortnox_next_attempt_at: minutes(-1), fortnox_retry_until: minutes(-6), fortnox_attempts: 8 }));
    const deps = fortnoxDeps(async () => {
      throw new Error('Fortnox nere');
    });
    expect(await retryStoreOrderFortnox(m.admin, { deps })).toMatchObject({ attempted: 1, gaveUp: 1 });
    expect(row(m)).toMatchObject({ fortnox_next_attempt_at: null, fortnox_retry_until: minutes(-6) });
  });

  it('🧨 ett sent försök som skapade ordern men inte fick spara numret: ger inte upp, nästa tar över ordern', async () => {
    const m = db(storeOrder({ status: 'confirmed', fortnox_next_attempt_at: minutes(-1), fortnox_retry_until: minutes(-6) }));
    m.failOn((c) => c.table === 'crm_store_orders' && c.op === 'update' && (c.values as Record<string, unknown>).fortnox_order_number === '801', { message: 'nere' });
    expect(await retryStoreOrderFortnox(m.admin, { deps: fortnoxDeps() })).toMatchObject({ attempted: 1, gaveUp: 0 });
    expect(row(m).fortnox_next_attempt_at).toBe(minutes(5));
  });

  it('🧨 planerat inom fönstret men upplockat sent (ett per varv, andra före i kön): görs ändå', async () => {
    const late = db(storeOrder({ status: 'confirmed', fortnox_next_attempt_at: minutes(-10), fortnox_retry_until: minutes(-5) }));
    const deps = fortnoxDeps();
    expect(await retryStoreOrderFortnox(late.admin, { deps })).toMatchObject({ due: 1, gaveUp: 0, attempted: 1 });
    expect(row(late).fortnox_order_number).toBe('801');
  });

  it('en makulerad som stod på tur: räknas som överhoppad, inte som ett försök', async () => {
    const m = db(storeOrder({ status: 'cancelled', fortnox_next_attempt_at: minutes(-1), fortnox_retry_until: minutes(60) }));
    const deps = fortnoxDeps();
    expect(await retryStoreOrderFortnox(m.admin, { deps })).toMatchObject({ due: 1, attempted: 0, skipped: 1 });
    expect(deps.post).not.toHaveBeenCalled();
  });

  it('en annan körning tog lånet först: hoppas över', async () => {
    const m = db(storeOrder({ status: 'confirmed', fortnox_next_attempt_at: minutes(-1), fortnox_retry_until: minutes(60) }), {}, {
      beforeExecute: (call, tables) => {
        if (call.table === 'crm_store_orders' && call.op === 'update' && 'fortnox_next_attempt_at' in (call.values as object)) {
          tables.crm_store_orders[0].fortnox_next_attempt_at = minutes(10);
        }
      },
    });
    const deps = fortnoxDeps();
    expect(await retryStoreOrderFortnox(m.admin, { deps })).toMatchObject({ skipped: 1, attempted: 0 });
    expect(deps.post).not.toHaveBeenCalled();
  });
});
