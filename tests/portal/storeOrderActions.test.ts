import { describe, it, expect, vi } from 'vitest';
import {
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

function fortnoxDeps(post: StoreOrderFortnoxDeps['post'] = vi.fn(async () => ({ Order: { DocumentNumber: '801' } }))) {
  return {
    post: vi.fn(post),
    articles: vi.fn(async () => [{ article_number: '1050', description: 'FRAKT', unit: 'st' }]),
    now: () => NOW,
  };
}

const row = (m: ReturnType<typeof memoryAdmin>) => m.tables.crm_store_orders[0];
const minutes = (n: number) => new Date(NOW.getTime() + n * 60_000).toISOString();

describe('setStoreOrderFreight', () => {
  it('frakten eller Ingen frakt, med vem och när', async () => {
    const m = db(storeOrder({ freight_mode: null, freight_price: null }));
    expect(await setStoreOrderFreight(m.admin, ID, { mode: 'charged', price: 1200 }, { id: SELLER }, () => NOW)).toEqual({ kind: 'saved' });
    expect(row(m)).toMatchObject({ freight_mode: 'charged', freight_price: 1200, freight_set_by: SELLER, freight_set_by_name: 'Anna Berg', freight_set_at: NOW.toISOString() });
    await setStoreOrderFreight(m.admin, ID, { mode: 'none' }, { id: SELLER }, () => NOW);
    expect(row(m)).toMatchObject({ freight_mode: 'none', freight_price: null });
  });

  it('bara på en mottagen: bekräftad svarar not_received och ändrar ingenting; okänd not_found', async () => {
    const m = db(storeOrder({ status: 'confirmed' }));
    expect(await setStoreOrderFreight(m.admin, ID, { mode: 'none' }, { id: SELLER })).toEqual({ kind: 'not_received' });
    expect(row(m).freight_mode).toBe('charged');
    expect(await setStoreOrderFreight(db().admin, '66666666-6666-4666-8666-666666666666', { mode: 'none' }, { id: SELLER })).toEqual({ kind: 'not_found' });
  });
});

describe('linkStoreOrderCustomer', () => {
  const link = (m: ReturnType<typeof memoryAdmin>, customerId = CARD_ID) =>
    linkStoreOrderCustomer(m.admin, m.admin, { id: ID, customerId, actor: { id: SELLER } }, () => NOW);

  it('kopplar kortet på beställningen och butiken (som fas 3c)', async () => {
    const m = db(storeOrder({ customer_id: null }));
    expect(await link(m)).toEqual({ kind: 'linked', storeLinked: true });
    expect(row(m).customer_id).toBe(CARD_ID);
    expect(m.tables.crm_portal_resellers[0]).toMatchObject({ customer_id: CARD_ID, customer_linked_by: SELLER, customer_linked_at: NOW.toISOString() });
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

  it('bara på en mottagen, och butiken rörs då inte', async () => {
    const m = db(storeOrder({ customer_id: null, status: 'confirmed' }));
    expect(await link(m)).toEqual({ kind: 'not_received' });
    expect(m.tables.crm_portal_resellers[0].customer_id).toBeNull();
  });

  it('butikens koppling föll: beställningen är ändå kopplad, och det sägs', async () => {
    const m = db(storeOrder({ customer_id: null }));
    m.failOn((c) => c.table === 'crm_portal_resellers', { message: 'nere' });
    expect(await link(m)).toEqual({ kind: 'linked', storeLinked: false });
    expect(row(m).customer_id).toBe(CARD_ID);
  });
});

describe('confirmStoreOrder', () => {
  const confirm = (m: ReturnType<typeof memoryAdmin>, deps = fortnoxDeps(), expectedVersion = 2) =>
    confirmStoreOrder(m.admin, { id: ID, expectedVersion, actor: { id: SELLER } }, deps);

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
    expect(body.Order).toMatchObject({ CustomerNumber: '1043', OrganisationNumber: '556677-8899', OurReference: 'Anna Berg', OrderDate: '2026-09-29' });
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
    ];
    for (const [extra, version, reason] of cases) {
      const m = db(storeOrder(extra));
      const deps = fortnoxDeps();
      expect(await confirm(m, deps, version)).toEqual({ kind: 'blocked', reason });
      expect(row(m).status).toBe(extra.status ?? 'received');
      expect(deps.post).not.toHaveBeenCalled();
    }
    const noNumber = db(storeOrder(), { crm_customers: [{ ...CARD, fortnox_customer_id: null }] });
    expect(await confirm(noNumber)).toEqual({ kind: 'blocked', reason: 'customer_not_in_fortnox' });
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

  it('🧨 processen dör mellan låset och Fortnox: skyddsnätet står redan på raden (ett försök om 5 min, i 24 h)', async () => {
    const m = db();
    // Claimen faller: allt efter låset uteblir, som när processen dör.
    m.failOn((c) => c.table === 'crm_store_orders' && c.op === 'update' && (c.values as Record<string, unknown>).fortnox_order_sync_status === 'pending', { message: 'borta' });
    await expect(confirm(m)).rejects.toThrow();
    expect(row(m)).toMatchObject({ status: 'confirmed', fortnox_attempts: 0, fortnox_next_attempt_at: minutes(5), fortnox_retry_until: minutes(24 * 60) });
  });

  it('Fortnox svarar fel: bekräftad ändå, felet sparat, nytt försök om 5 min i ett fönster på 24 h', async () => {
    const m = db();
    const deps = fortnoxDeps(async () => {
      throw new FortnoxApiError(400, 'Fortnox POST /orders misslyckades (400)', 2000428, 'Kan inte hitta artikeln.');
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
});

describe('pushStoreOrderToFortnox', () => {
  const confirmed = (extra: Record<string, unknown> = {}) =>
    storeOrder({ status: 'confirmed', fortnox_next_attempt_at: minutes(5), fortnox_retry_until: minutes(24 * 60), ...extra });

  it('en push pågår redan (färsk claim): ingen POST, titta igen om 5 min', async () => {
    const m = db(confirmed({ fortnox_order_sync_status: 'pending', fortnox_order_claimed_at: new Date().toISOString() }));
    const deps = fortnoxDeps();
    expect(await pushStoreOrderToFortnox(m.admin, ID, deps)).toMatchObject({ outcome: 'in_progress' });
    expect(deps.post).not.toHaveBeenCalled();
    expect(row(m).fortnox_next_attempt_at).toBe(minutes(5));
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

  it('kortet tappade kundnumret efter bekräftelsen: stopp utan omförsök, med skälet', async () => {
    const m = db(confirmed(), { crm_customers: [{ ...CARD, fortnox_customer_id: null }] });
    const deps = fortnoxDeps();
    expect(await pushStoreOrderToFortnox(m.admin, ID, deps)).toEqual({ outcome: 'blocked', fortnoxOrderNumber: null, error: 'Kundkortet saknar kundnummer i Fortnox.' });
    expect(deps.post).not.toHaveBeenCalled();
    expect(row(m)).toMatchObject({ fortnox_order_sync_status: 'failed', fortnox_next_attempt_at: null, fortnox_error: 'Kundkortet saknar kundnummer i Fortnox.' });
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

  it('🧨 numret gick inte att spara: svaret säger numret och att inte skicka igen; inga omförsök', async () => {
    const m = db(confirmed());
    m.failOn((c) => c.table === 'crm_store_orders' && c.op === 'update' && (c.values as Record<string, unknown>).fortnox_order_number === '801', { message: 'nere' });
    const result = await pushStoreOrderToFortnox(m.admin, ID, fortnoxDeps());
    expect(result).toMatchObject({ outcome: 'blocked', fortnoxOrderNumber: '801' });
    expect(result.error).toContain('Skicka inte igen');
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

    const expired = db(storeOrder({ status: 'confirmed', fortnox_next_attempt_at: minutes(-1), fortnox_retry_until: minutes(-1) }));
    const deps = fortnoxDeps();
    expect(await retryStoreOrderFortnox(expired.admin, { deps })).toMatchObject({ due: 1, gaveUp: 1, attempted: 0 });
    expect(deps.post).not.toHaveBeenCalled();
    expect(row(expired).fortnox_next_attempt_at).toBeNull();
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
