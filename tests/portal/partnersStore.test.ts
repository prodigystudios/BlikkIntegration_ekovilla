import { describe, it, expect, vi } from 'vitest';
import { invitePortalReseller, readPortalPartner, setPortalPartnerType, type InviteDeps } from '@/lib/domains/portal/partnersStore';
import { RESELLERS_PATH, resellerInviteIdempotencyKey } from '@/lib/domains/portal/partners';
import { IDEMPOTENCY_KEY_HEADER } from '@/lib/domains/portal/idempotency';
import { PORTAL_SIGNATURE_HEADER, PORTAL_TIMESTAMP_HEADER, verifyPortalSignature } from '@/lib/domains/portal/signature';
import { memoryAdmin } from './helpers/memoryAdmin';

/**
 * Partnern bjuds in från kundkortet, mot databasen (RESELLER_PORTAL_CRM_PLAN.md 10a). Det som skyddas:
 *   - utan påslagen integration, kort, företagskort, kundnummer eller flagga skrivs INGENTING;
 *   - sessionen skriver aldrig butiken, inbjudan eller kön (de tabellerna är service_role:s);
 *   - butikens rad kopplas till kortet som en koppling för hand, så att det första jobbet har kund;
 *   - anropet går signerat till /api/ekovilla/resellers med försökets nyckel och kontraktets kropp;
 *   - ett dubbelklick blir samma inbjudan, och ett id på ett annat kort nekas;
 *   - "Skicka igen" tar förra försökets företagsuppgifter, ersätter ett väntande försök och kräver det försök admin såg.
 */

const SECRET = 'c'.repeat(64);
const ENV = {
  NODE_ENV: 'development',
  SUPABASE_URL: 'http://127.0.0.1:55321',
  PORTAL_CRM_SHARED_SECRET: SECRET,
  RESELLER_PORTAL_URL: 'http://localhost:3001',
};
const NOW = new Date('2026-10-01T08:00:00.000Z');
const CARD_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_CARD = '22222222-2222-4222-8222-222222222222';
const RESELLER_ID = '6f1c2a9e-4b7d-4f0e-9a51-0c3d2e8b7a64';
const ACTOR = { id: 'user-admin-1', name: 'Test Admin' };
const STORE = { name: 'Beijer Gävle', street: 'Industrigatan 4', postalCode: '802 22', city: 'Gävle', phone: '026-1', email: 'gavle@exempel.se' };
const ADMIN = { name: 'Anna Berg', email: 'anna@exempel.se' };

type Row = Record<string, any>;

function cardRow(patch: Row = {}): Row {
  return {
    id: CARD_ID,
    customer_type: 'business',
    company_name: 'Beijer Bygg AB',
    organization_number: '556123-4567',
    fortnox_customer_id: '1234',
    phone: '026-12 34 56',
    email: 'info@exempel.se',
    visit_address: { street: 'Industrigatan 4', postal_code: '802 22', city: 'Gävle' },
    invoice_address: null,
    delivery_address: null,
    ...patch,
  };
}

/** Tabellerna bara service_role skriver. Sessionen som försöker är ett fel i koden, inte ett utfall. */
const SERVICE_ONLY = new Set(['crm_portal_resellers', 'crm_portal_reseller_invites', 'portal_outbound_events']);

function setup(initial: Record<string, Row[]> = {}, statuses: number[] = [201], bodies: string[] = []) {
  const db = memoryAdmin(
    {
      crm_customers: [cardRow()],
      crm_portal_partners: [{ customer_id: CARD_ID, partner_type: 'reseller' }],
      crm_portal_resellers: [],
      crm_portal_reseller_invites: [],
      portal_outbound_events: [],
      ...initial,
    },
    {
      // Det databasen fyller i: händelsens id (utskicket bokför på det) och inbjudans tid.
      defaults: (table) =>
        table === 'portal_outbound_events'
          ? { id: globalThis.crypto.randomUUID() }
          : table === 'crm_portal_reseller_invites'
            ? { created_at: NOW.toISOString() }
            : {},
      rpc: (name, _args, tables) => {
        if (name !== 'claim_portal_outbound_events') return null;
        const due = tables.portal_outbound_events.filter((r) => r.status === 'pending');
        for (const r of due) Object.assign(r, { status: 'sending', claimed_at: NOW.toISOString(), attempts: Number(r.attempts) + 1 });
        return structuredClone(due);
      },
    },
  );
  const session = {
    from(table: string) {
      const chain = db.admin as unknown as { from: (t: string) => Record<string, unknown> };
      const query = chain.from(table);
      if (SERVICE_ONLY.has(table)) {
        for (const op of ['insert', 'upsert', 'update', 'delete']) {
          query[op] = () => {
            throw new Error(`sessionen skriver ${table}`);
          };
        }
      }
      return query;
    },
  };
  const sent: { url: string; body: string; headers: Record<string, string> }[] = [];
  const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
    sent.push({ url, body: String(init.body), headers: init.headers as Record<string, string> });
    return new Response(bodies.shift() ?? '{"ok":true,"data":{}}', { status: statuses.shift() ?? 201 });
  }) as unknown as typeof fetch;
  const deps: InviteDeps = { session: session as never, admin: db.admin, env: ENV, actor: ACTOR, now: () => NOW, fetchImpl };
  return { ...db, deps, sent, fetchImpl };
}

const writes = (calls: { op: string }[]) => calls.filter((c) => c.op !== 'select');

const newInvite = (patch: Row = {}) => ({ mode: 'new' as const, customerId: CARD_ID, resellerId: RESELLER_ID, store: STORE, admin: ADMIN, ...patch });

describe('invitePortalReseller: när ingenting får skrivas', () => {
  it('integrationen är inte påslagen: inget läses eller skrivs', async () => {
    const t = setup();
    const result = await invitePortalReseller({ ...t.deps, env: { ...ENV, PORTAL_CRM_SHARED_SECRET: '' } }, newInvite());
    expect(result.kind).toBe('integration_off');
    expect(t.calls).toHaveLength(0);
    expect(t.fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    ['kortet finns inte för sessionen', { crm_customers: [] }, { kind: 'not_found' }],
    ['ett privatkundskort', { crm_customers: [cardRow({ customer_type: 'private' })] }, { kind: 'ineligible', reason: 'not_business' }],
    ['inget kundnummer i Fortnox', { crm_customers: [cardRow({ fortnox_customer_id: null })] }, { kind: 'ineligible', reason: 'no_fortnox_number' }],
    ['kortet är inte flaggat', { crm_portal_partners: [] }, { kind: 'not_partner' }],
  ])('%s: %o, och ingenting skrivs', async (_label, initial, expected) => {
    const t = setup(initial);
    expect(await invitePortalReseller(t.deps, newInvite())).toEqual(expected);
    expect(writes(t.calls)).toHaveLength(0);
    expect(t.fetchImpl).not.toHaveBeenCalled();
  });

  it('ett id som redan hör till ett annat kort: nekas, och den butiken rörs inte', async () => {
    const other = { reseller_id: RESELLER_ID, name: 'Annan', street: '', postal_code: '', city: '', customer_number: '9', customer_id: OTHER_CARD };
    const t = setup({ crm_portal_resellers: [other] });
    expect(await invitePortalReseller(t.deps, newInvite())).toEqual({ kind: 'reseller_id_taken' });
    expect(writes(t.calls)).toHaveLength(0);
    expect(t.tables.crm_portal_resellers).toEqual([other]);
  });
});

describe('invitePortalReseller: ett nytt företag', () => {
  it('butiken kopplas till kortet för hand, inbjudan sparas och köas, och portalen får kontraktets kropp signerad', async () => {
    const t = setup();
    const result = await invitePortalReseller(t.deps, newInvite());

    expect(result).toMatchObject({ kind: 'invited', created: true, resellerId: RESELLER_ID, attempt: 1, delivery: { status: 'sent' } });
    expect(t.tables.crm_portal_resellers).toEqual([
      expect.objectContaining({
        reseller_id: RESELLER_ID,
        name: 'Beijer Gävle',
        street: 'Industrigatan 4',
        postal_code: '802 22',
        city: 'Gävle',
        customer_number: '1234',
        customer_id: CARD_ID,
        customer_linked_by: ACTOR.id,
        customer_linked_at: NOW.toISOString(),
      }),
    ]);

    const key = resellerInviteIdempotencyKey(RESELLER_ID, 1);
    const payload = {
      resellerId: RESELLER_ID,
      name: 'Beijer Gävle',
      organizationNumber: '556123-4567',
      address: { street: 'Industrigatan 4', postalCode: '802 22', city: 'Gävle' },
      phone: '026-1',
      email: 'gavle@exempel.se',
      ekovillaCustomerNumber: '1234',
      admin: ADMIN,
    };
    expect(t.tables.crm_portal_reseller_invites).toEqual([
      expect.objectContaining({
        reseller_id: RESELLER_ID,
        attempt: 1,
        idempotency_key: key,
        payload,
        admin_name: 'Anna Berg',
        admin_email: 'anna@exempel.se',
        invited_by: ACTOR.id,
        invited_by_name: 'Test Admin',
      }),
    ]);
    expect(t.tables.portal_outbound_events).toEqual([
      expect.objectContaining({
        idempotency_key: key,
        path: RESELLERS_PATH,
        payload,
        ordering_key: `reseller:${RESELLER_ID}`,
        supersede_key: `reseller-invite:${RESELLER_ID}`,
        status: 'sent',
      }),
    ]);

    expect(t.sent).toHaveLength(1);
    const [request] = t.sent;
    expect(request.url).toBe('http://localhost:3001/api/ekovilla/resellers');
    expect(JSON.parse(request.body)).toEqual(payload);
    expect(request.headers[IDEMPOTENCY_KEY_HEADER]).toBe(key);
    expect(
      verifyPortalSignature({
        secret: SECRET,
        method: 'POST',
        path: RESELLERS_PATH,
        rawBody: request.body,
        timestampHeader: request.headers[PORTAL_TIMESTAMP_HEADER],
        signatureHeader: request.headers[PORTAL_SIGNATURE_HEADER],
        nowSeconds: NOW.getTime() / 1000,
      }).ok,
    ).toBe(true);
  });

  it('ett dubbelklick (samma id): samma inbjudan, inget nytt köat eller skickat', async () => {
    const t = setup();
    await invitePortalReseller(t.deps, newInvite());
    const again = await invitePortalReseller(t.deps, newInvite());
    expect(again).toMatchObject({ kind: 'invited', created: false, attempt: 1, delivery: { status: 'sent' } });
    expect(t.tables.crm_portal_reseller_invites).toHaveLength(1);
    expect(t.tables.portal_outbound_events).toHaveLength(1);
    expect(t.sent).toHaveLength(1);
  });

  it('två samtidiga tryck som båda hinner till inbjudan: den andra får den förstas', async () => {
    const t = setup();
    let raced = false;
    t.failOn(
      (call) => {
        if (raced || call.table !== 'crm_portal_reseller_invites' || call.op !== 'insert') return false;
        raced = true;
        t.tables.crm_portal_reseller_invites.push({
          ...(call.values as Row),
          admin_email: 'forst@exempel.se',
          created_at: NOW.toISOString(),
        });
        return true;
      },
      { code: '23505', message: 'duplicate key value violates unique constraint' },
    );
    const result = await invitePortalReseller(t.deps, newInvite());
    expect(result).toMatchObject({ kind: 'invited', created: false, attempt: 1 });
    expect(t.tables.portal_outbound_events).toHaveLength(0);
  });

  it('butiken finns redan på kortet utan inbjudan (förra anropet dog efter steg 1): bara inbjudan läggs till', async () => {
    const row = { reseller_id: RESELLER_ID, name: 'Beijer Gävle', street: '', postal_code: '', city: 'Gävle', customer_number: '1234', customer_id: CARD_ID };
    const t = setup({ crm_portal_resellers: [row] });
    expect(await invitePortalReseller(t.deps, newInvite())).toMatchObject({ kind: 'invited', created: true, attempt: 1 });
    expect(t.tables.crm_portal_resellers).toEqual([row]);
    expect(t.calls.filter((c) => c.table === 'crm_portal_resellers' && c.op !== 'select')).toHaveLength(0);
  });

  it('portalen nekar adressen: händelsen ges upp och kortet visar varför', async () => {
    const body = JSON.stringify({ ok: false, error: 'Används redan', errorDetails: { code: 'admin_email_taken', message: 'Används redan' } });
    const t = setup({}, [409], [body]);
    const result = await invitePortalReseller(t.deps, newInvite());
    expect(result).toMatchObject({ kind: 'invited', created: true, delivery: { status: 'dead', lastHttpStatus: 409 } });

    const view = await readPortalPartner(t.deps.session, CARD_ID);
    expect(view?.stores[0].invite?.failure).toBe('Adressen har redan ett konto i ett annat företag i portalen. Bjud in med en annan adress.');
  });

  it('portalen svarar inte: inbjudan väntar i kön och görs om', async () => {
    const t = setup({}, [503]);
    expect(await invitePortalReseller(t.deps, newInvite())).toMatchObject({ kind: 'invited', delivery: { status: 'pending' } });
  });

  it('kön går inte att skriva: fel, men inbjudan står kvar som inte köad och kan skickas igen', async () => {
    const t = setup();
    t.failOn((call) => call.table === 'portal_outbound_events' && call.op === 'upsert', { message: 'nere' });
    expect(await invitePortalReseller(t.deps, newInvite())).toMatchObject({ kind: 'db_error' });
    const view = await readPortalPartner(t.deps.session, CARD_ID);
    expect(view?.stores[0].invite).toMatchObject({ attempt: 1, delivery: { status: 'not_queued' } });
  });
});

describe('invitePortalReseller: skicka inbjudan igen', () => {
  async function invited(statuses: number[] = [201]) {
    const t = setup({}, statuses);
    await invitePortalReseller(t.deps, newInvite());
    return t;
  }
  const resend = (patch: Row = {}) => ({
    mode: 'resend' as const,
    customerId: CARD_ID,
    resellerId: RESELLER_ID,
    admin: { name: 'Bo Ek', email: 'bo@exempel.se' },
    expectedAttempt: 1,
    ...patch,
  });

  it('nästa försök: förra försökets företagsuppgifter, den nya adminen och en ny nyckel', async () => {
    const t = await invited([201, 200]);
    t.tables.crm_customers[0].fortnox_customer_id = '5678';
    const result = await invitePortalReseller(t.deps, resend());
    expect(result).toMatchObject({ kind: 'invited', created: true, attempt: 2, delivery: { status: 'sent' } });

    const second = JSON.parse(t.sent[1].body);
    expect(second).toEqual({ ...JSON.parse(t.sent[0].body), ekovillaCustomerNumber: '5678', admin: { name: 'Bo Ek', email: 'bo@exempel.se' } });
    expect(t.sent[1].headers[IDEMPOTENCY_KEY_HEADER]).toBe(resellerInviteIdempotencyKey(RESELLER_ID, 2));
    // Butikens rad ändras inte av ett nytt försök.
    expect(t.tables.crm_portal_resellers[0].customer_number).toBe('1234');
  });

  it('ett försök som fortfarande väntar ersätts: bara den senaste adminen behöver fram', async () => {
    const t = await invited([503, 201]);
    expect(t.tables.portal_outbound_events[0].status).toBe('pending');
    await invitePortalReseller(t.deps, resend());
    expect(t.tables.portal_outbound_events.map((e) => [e.idempotency_key, e.status])).toEqual([
      [resellerInviteIdempotencyKey(RESELLER_ID, 1), 'superseded'],
      [resellerInviteIdempotencyKey(RESELLER_ID, 2), 'sent'],
    ]);
  });

  it('ett annat försök än det admin såg (dubbelklick, eller någon annan): changed, och ingenting skrivs', async () => {
    const t = await invited();
    const before = t.calls.length;
    expect(await invitePortalReseller(t.deps, resend({ expectedAttempt: 0 }))).toEqual({ kind: 'changed' });
    expect(writes(t.calls.slice(before))).toHaveLength(0);
  });

  it('ett företag som inte finns på kortet: store_not_found, och ingenting skrivs', async () => {
    const other = { reseller_id: 'res-annan', name: 'Annan', street: '', postal_code: '', city: '', customer_number: '9', customer_id: OTHER_CARD };
    const t = setup({ crm_portal_resellers: [other] });
    expect(await invitePortalReseller(t.deps, resend({ resellerId: 'res-annan', expectedAttempt: 0 }))).toEqual({ kind: 'store_not_found' });
    expect(await invitePortalReseller(t.deps, resend({ resellerId: 'res-finns-inte', expectedAttempt: 0 }))).toEqual({ kind: 'store_not_found' });
    expect(writes(t.calls)).toHaveLength(0);
  });

  it('ett företag som kom till portalen på annat sätt: första inbjudan byggs ur butikens rad och kortet', async () => {
    const row = { reseller_id: 'res-norrbygg', name: 'Norrbygg AB', street: 'Storgatan 1', postal_code: '851 70', city: 'Sundsvall', customer_number: '1234', customer_id: CARD_ID };
    const t = setup({ crm_portal_resellers: [row] });
    const result = await invitePortalReseller(t.deps, resend({ resellerId: 'res-norrbygg', expectedAttempt: 0 }));
    expect(result).toMatchObject({ kind: 'invited', attempt: 1 });
    expect(JSON.parse(t.sent[0].body)).toEqual({
      resellerId: 'res-norrbygg',
      name: 'Norrbygg AB',
      organizationNumber: '556123-4567',
      address: { street: 'Storgatan 1', postalCode: '851 70', city: 'Sundsvall' },
      phone: '026-12 34 56',
      email: 'info@exempel.se',
      ekovillaCustomerNumber: '1234',
      admin: { name: 'Bo Ek', email: 'bo@exempel.se' },
    });
  });
});

describe('readPortalPartner', () => {
  it('flaggan, förvalen ur kortet och kortets företag med den senaste inbjudan', async () => {
    const t = setup({
      crm_portal_resellers: [
        { reseller_id: 'b', name: 'Beijer Sandviken', street: '', postal_code: '', city: 'Sandviken', customer_number: '1234', customer_id: CARD_ID },
        { reseller_id: 'a', name: 'Beijer Gävle', street: '', postal_code: '', city: 'Gävle', customer_number: '1234', customer_id: CARD_ID },
        { reseller_id: 'x', name: 'Annan kund', street: '', postal_code: '', city: '', customer_number: '9', customer_id: OTHER_CARD },
      ],
      crm_portal_reseller_invites: [
        { reseller_id: 'a', attempt: 1, idempotency_key: 'reseller-invite-a-1', payload: {}, admin_name: 'Anna', admin_email: 'anna@x.se', invited_by_name: 'Test Admin', created_at: '2026-10-01T08:00:00Z' },
        { reseller_id: 'a', attempt: 2, idempotency_key: 'reseller-invite-a-2', payload: {}, admin_name: 'Bo', admin_email: 'bo@x.se', invited_by_name: 'Test Admin', created_at: '2026-10-01T09:00:00Z' },
      ],
      portal_outbound_events: [
        { id: 'e1', seq: 1, idempotency_key: 'reseller-invite-a-2', status: 'sent', attempts: 1, sent_at: '2026-10-01T09:00:01Z', last_http_status: 201, last_error: null, next_attempt_at: '2026-10-01T09:00:00Z' },
      ],
    });
    const view = await readPortalPartner(t.deps.session, CARD_ID);
    expect(view).toMatchObject({
      customerId: CARD_ID,
      partnerType: 'reseller',
      eligibility: { ok: true, customerNumber: '1234' },
      defaults: { name: 'Beijer Bygg AB', city: 'Gävle', email: 'info@exempel.se' },
    });
    expect(view?.stores.map((s) => s.name)).toEqual(['Beijer Gävle', 'Beijer Sandviken']);
    expect(view?.stores[0].invite).toMatchObject({ attempt: 2, adminEmail: 'bo@x.se', delivery: { status: 'sent' }, failure: null });
    expect(view?.stores[1].invite).toBeNull();
  });

  it('ett kort sessionen inte ser: null', async () => {
    const t = setup({ crm_customers: [] });
    expect(await readPortalPartner(t.deps.session, CARD_ID)).toBeNull();
  });
});

describe('setPortalPartnerType', () => {
  it('sätter typen i eget namn, byter den och tar bort den', async () => {
    const t = setup({ crm_portal_partners: [] });
    expect(await setPortalPartnerType(t.deps.session, CARD_ID, 'partner', ACTOR.id)).toEqual({ kind: 'saved', partnerType: 'partner' });
    expect(t.tables.crm_portal_partners).toEqual([{ customer_id: CARD_ID, partner_type: 'partner', updated_by: ACTOR.id }]);
    expect(await setPortalPartnerType(t.deps.session, CARD_ID, 'reseller', ACTOR.id)).toEqual({ kind: 'saved', partnerType: 'reseller' });
    expect(t.tables.crm_portal_partners).toHaveLength(1);
    expect(await setPortalPartnerType(t.deps.session, CARD_ID, null, ACTOR.id)).toEqual({ kind: 'saved', partnerType: null });
    expect(t.tables.crm_portal_partners).toHaveLength(0);
  });

  it('ett privatkundskort kan inte flaggas; ett okänt kort är not_found; ingenting skrivs', async () => {
    const t = setup({ crm_customers: [cardRow({ customer_type: 'private' })], crm_portal_partners: [] });
    expect(await setPortalPartnerType(t.deps.session, CARD_ID, 'reseller', ACTOR.id)).toEqual({ kind: 'not_business' });
    expect(await setPortalPartnerType(t.deps.session, OTHER_CARD, 'reseller', ACTOR.id)).toEqual({ kind: 'not_found' });
    expect(writes(t.calls)).toHaveLength(0);
  });

  it('RLS nekar (42501): forbidden', async () => {
    const t = setup({ crm_portal_partners: [] });
    t.failOn((call) => call.table === 'crm_portal_partners' && call.op === 'upsert', { code: '42501', message: 'new row violates row-level security policy' });
    expect(await setPortalPartnerType(t.deps.session, CARD_ID, 'reseller', ACTOR.id)).toEqual({ kind: 'forbidden' });
  });
});
