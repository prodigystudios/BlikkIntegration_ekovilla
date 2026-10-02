import { describe, it, expect, vi } from 'vitest';
import { linkPortalJobCustomer, type LinkPortalCustomerDeps } from '@/lib/domains/portal/linkCustomer';
import { buildPortalCustomerLinkUpdate, buildPortalWorkOrderInsert, portalJobSchema, type JobCustomerCard } from '@/lib/domains/portal/jobIntake';
import { FortnoxApiError, FortnoxNotConnectedError, FortnoxPushInProgressError, WorkOrderCancelledError } from '@/lib/domains/fortnox/client';
import { CONTRACT_JOB } from './helpers/contractFixtures';
import { memoryAdmin } from './helpers/memoryAdmin';

/**
 * Koppla butikens kundkort på en portalorder utan kund (fas 3c). Det som skyddas:
 *   - bara en portalorder som saknar kund och inte finns i Fortnox; bara ett företagskort (butiken är kunden);
 *   - samma kontroll som våra egna ordrar innan något sparas: saknas något nekas kopplingen och ingenting ändras;
 *   - den som inte får ändra ordern (RLS) får nej, och ingenting sparas, inte heller på butiken;
 *   - kortets del av snapshoten byts, momsen och beloppet räknas om, men märkningen, arbetsplatsen, kontakten på plats
 *     och det säljaren redigerat står kvar;
 *   - kopplingen sparas på jobbet och på butiken (vem och när), och Fortnox-ordern skapas i samma steg;
 *   - ett Fortnox-fel ändrar inte kopplingen, det sägs.
 */

const WO = '22222222-2222-4222-8222-222222222222';
const SELLER = '33333333-3333-4333-8333-333333333333';
const CARD_ID = '11111111-1111-4111-8111-111111111111';

const CARD: JobCustomerCard & { fortnox_customer_id: string } = {
  id: CARD_ID,
  fortnox_customer_id: '1043',
  customer_type: 'business',
  company_name: 'Norrbygg AB',
  organization_number: '556677-8899',
  first_name: null,
  last_name: null,
  personal_number: null,
  email: 'info@norrbygg.se',
  phone: '026-10 20 30',
  mobile: null,
  visit_address: { street: 'Verkstadsgatan 8', postal_code: '802 91', city: 'Gävle' },
  contacts: [{ name: 'Per Inköp', phone: '070-111 22 33', email: 'per@norrbygg.se', is_primary: true }],
};

let n = 0;
/** Arbetsordern som intaget skapar för en butik utan kund, med säljarens egna ändringar ovanpå. */
function unlinkedWorkOrder(): Record<string, unknown> {
  const row = buildPortalWorkOrderInsert({
    job: portalJobSchema.parse(structuredClone(CONTRACT_JOB)),
    customer: null,
    register: new Map(),
    workOrderId: WO,
    orderNumber: 'AO-20260928-222222',
    assigneeId: SELLER,
    newId: () => `rad-${++n}`,
  });
  const snapshot = row.customer_snapshot as Record<string, unknown>;
  // Säljaren har rättat kontakten på plats innan kunden kopplades.
  snapshot.end_contact_phone = '070-999 88 77';
  return { ...row, fortnox_order_number: null, updated_at: '2026-09-28T10:00:00.000Z' };
}

function setup(options: { workOrder?: Record<string, unknown> | null; cards?: Record<string, unknown>[]; canUpdate?: boolean } = {}) {
  const workOrder = options.workOrder === undefined ? unlinkedWorkOrder() : options.workOrder;
  const session = memoryAdmin(
    { crm_work_orders: workOrder ? [workOrder] : [], crm_customers: options.cards ?? [CARD] },
    { canUpdate: () => options.canUpdate ?? true },
  );
  const admin = memoryAdmin({
    crm_portal_jobs: [{ quote_id: 'q-2026-015', reseller_id: 'res-norrbygg', work_order_id: WO, customer_id: null }],
    crm_portal_resellers: [{ reseller_id: 'res-norrbygg', customer_number: null, customer_id: null, customer_linked_by: null, customer_linked_at: null }],
  });
  const deps: LinkPortalCustomerDeps = {
    push: vi.fn(async () => ({ fortnox_order_number: '24' })),
    now: () => new Date('2026-09-28T12:00:00Z'),
  };
  const link = (customerId = CARD_ID) => linkPortalJobCustomer(session.admin, admin.admin, { workOrderId: WO, customerId, actorId: SELLER }, deps);
  return { session, admin, deps, link };
}

describe('linkPortalJobCustomer', () => {
  it('kopplar kortet, sparar det på jobbet och butiken, och skapar Fortnox-ordern', async () => {
    const t = setup();
    expect(await t.link()).toEqual({ kind: 'linked', fortnoxOrderNumber: '24', fortnoxError: null, storeLinked: true });

    const wo = t.session.tables.crm_work_orders[0];
    expect(wo).toMatchObject({ customer_id: CARD_ID, client_name: 'Norrbygg AB', quote_type: 'business', vat_percent: 0, amount: 14270 });
    expect(wo.customer_snapshot).toMatchObject({
      // Kortets del.
      customer_name: 'Norrbygg AB',
      organization_number: '556677-8899',
      your_reference: 'Per Inköp',
      street_address: 'Verkstadsgatan 8',
      reverse_vat: true,
      // Jobbets del står kvar, också det säljaren ändrat.
      label: '2026-015',
      delivery_address: 'Rönnvägen 18',
      end_contact_name: 'Ingrid Palm',
      end_contact_phone: '070-999 88 77',
    });
    expect(t.admin.tables.crm_portal_jobs[0].customer_id).toBe(CARD_ID);
    expect(t.admin.tables.crm_portal_resellers[0]).toMatchObject({
      customer_id: CARD_ID,
      customer_linked_by: SELLER,
      customer_linked_at: '2026-09-28T12:00:00.000Z',
      // Portalens nummer är portalens: det rörs inte.
      customer_number: null,
    });
    expect(t.deps.push).toHaveBeenCalledWith(WO);
  });

  it('🧨 kortet saknar org.nr: nekas med listan, och ingenting sparas eller skickas', async () => {
    const t = setup({ cards: [{ ...CARD, organization_number: null }] });
    const before = structuredClone(t.session.tables.crm_work_orders[0]);
    const result = await t.link();
    expect(result.kind).toBe('incomplete');
    expect((result as { blockers: { field: string }[] }).blockers.map((b) => b.field)).toEqual(['organization_number']);
    expect(t.session.tables.crm_work_orders[0]).toEqual(before);
    expect(t.admin.tables.crm_portal_resellers[0].customer_id).toBeNull();
    expect(t.deps.push).not.toHaveBeenCalled();
  });

  it('🧨 den som inte får ändra ordern (RLS): nej, och butiken rörs inte', async () => {
    const t = setup({ canUpdate: false });
    expect(await t.link()).toEqual({ kind: 'forbidden' });
    expect(t.session.tables.crm_work_orders[0].customer_id ?? null).toBeNull();
    expect(t.admin.tables.crm_portal_resellers[0].customer_id).toBeNull();
    expect(t.admin.tables.crm_portal_jobs[0].customer_id).toBeNull();
    expect(t.deps.push).not.toHaveBeenCalled();
  });

  it('🧨 någon hann koppla mellan läsningen och sparandet: redan kopplad, och den andras koppling står kvar', async () => {
    const t = setup();
    const race = memoryAdmin(
      { crm_work_orders: [unlinkedWorkOrder()], crm_customers: [CARD] },
      {
        beforeExecute: (call, tables) => {
          if (call.table === 'crm_work_orders' && call.op === 'update') tables.crm_work_orders[0].customer_id = 'nagon-annans-kund';
        },
      },
    );
    const result = await linkPortalJobCustomer(race.admin, t.admin.admin, { workOrderId: WO, customerId: CARD_ID, actorId: SELLER }, t.deps);
    expect(result).toEqual({ kind: 'already_linked' });
    expect(race.tables.crm_work_orders[0].customer_id).toBe('nagon-annans-kund');
    expect(t.admin.tables.crm_portal_resellers[0].customer_id).toBeNull();
    expect(t.deps.push).not.toHaveBeenCalled();
  });

  it('en Fortnox-order skapades i samma stund: finns i Fortnox, och ordern rörs inte', async () => {
    const t = setup();
    const race = memoryAdmin(
      { crm_work_orders: [unlinkedWorkOrder()], crm_customers: [CARD] },
      {
        beforeExecute: (call, tables) => {
          if (call.table === 'crm_work_orders' && call.op === 'update') tables.crm_work_orders[0].fortnox_order_number = '99';
        },
      },
    );
    const result = await linkPortalJobCustomer(race.admin, t.admin.admin, { workOrderId: WO, customerId: CARD_ID, actorId: SELLER }, t.deps);
    expect(result).toEqual({ kind: 'in_fortnox' });
    expect(race.tables.crm_work_orders[0].customer_id ?? null).toBeNull();
  });

  it('🧨 ordern sparades av någon annan under tiden (märkningen): ändrad, och ingenting skrivs över', async () => {
    const t = setup();
    const race = memoryAdmin(
      { crm_work_orders: [unlinkedWorkOrder()], crm_customers: [CARD] },
      {
        beforeExecute: (call, tables) => {
          if (call.table === 'crm_work_orders' && call.op === 'update') {
            const row = tables.crm_work_orders[0];
            row.customer_snapshot = { ...(row.customer_snapshot as object), label: 'Ny märkning' };
            row.updated_at = '2026-09-28T10:00:05.000Z';
          }
        },
      },
    );
    const result = await linkPortalJobCustomer(race.admin, t.admin.admin, { workOrderId: WO, customerId: CARD_ID, actorId: SELLER }, t.deps);
    expect(result).toEqual({ kind: 'changed' });
    expect((race.tables.crm_work_orders[0].customer_snapshot as { label: string }).label).toBe('Ny märkning');
    expect(race.tables.crm_work_orders[0].customer_id ?? null).toBeNull();
    expect(t.deps.push).not.toHaveBeenCalled();
  });

  it('kontakten som säljaren fyllt i står kvar; kortet fyller bara det som är tomt', async () => {
    const wo = unlinkedWorkOrder();
    wo.customer_snapshot = { ...(wo.customer_snapshot as object), contact_name: 'Kalle på lagret', phone: '026-55 55 55' };
    const t = setup({ workOrder: wo });
    await t.link();
    expect(t.session.tables.crm_work_orders[0].customer_snapshot).toMatchObject({
      contact_name: 'Kalle på lagret',
      phone: '026-55 55 55',
      // Tomma innan: kortets.
      email: 'per@norrbygg.se',
      your_reference: 'Per Inköp',
      // Vem kunden är: alltid kortets.
      customer_name: 'Norrbygg AB',
    });
  });

  it.each([
    ['redan kopplad', { customer_id: 'annan' }, 'already_linked'],
    ['finns i Fortnox', { fortnox_order_number: '12' }, 'in_fortnox'],
  ])('%s svarar det, också när kortet som valdes är ofullständigt', async (_n, patch, kind) => {
    const t = setup({ workOrder: { ...unlinkedWorkOrder(), ...patch }, cards: [{ ...CARD, organization_number: null }] });
    expect((await t.link()).kind).toBe(kind);
  });

  it.each<[string, Parameters<typeof setup>[0], string]>([
    ['ingen arbetsorder som sessionen ser', { workOrder: null }, 'not_found'],
    ['ordern har redan en kund', { workOrder: { ...unlinkedWorkOrder(), customer_id: 'annan' } }, 'already_linked'],
    ['ordern finns redan i Fortnox', { workOrder: { ...unlinkedWorkOrder(), fortnox_order_number: '12' } }, 'in_fortnox'],
    ['kortet finns inte', { cards: [] }, 'customer_not_found'],
    ['ett privatkundskort (butiken är ett företag)', { cards: [{ ...CARD, customer_type: 'private', personal_number: '19800101-1234' }] }, 'not_business'],
  ])('%s: %s, ingenting sparas', async (_name, options, kind) => {
    const t = setup(options);
    expect((await t.link()).kind).toBe(kind);
    expect(t.admin.tables.crm_portal_resellers[0].customer_id).toBeNull();
    expect(t.deps.push).not.toHaveBeenCalled();
  });

  it('en vanlig order (inget portaljobb): hittas inte', async () => {
    const t = setup();
    t.admin.tables.crm_portal_jobs.length = 0;
    expect((await t.link()).kind).toBe('not_found');
    expect(t.session.tables.crm_work_orders[0].customer_id ?? null).toBeNull();
  });

  it('Fortnox svarar fel: kunden är kopplad ändå, och felet sägs', async () => {
    const t = setup();
    (t.deps.push as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new FortnoxApiError(400, 'Fortnox 400', 2000423, 'Artikeln finns inte'));
    const result = await t.link();
    expect(result).toMatchObject({ kind: 'linked', fortnoxOrderNumber: null });
    expect((result as { fortnoxError: string }).fortnoxError).toMatch(/^Fortnox svarade: /);
    expect(t.session.tables.crm_work_orders[0].customer_id).toBe(CARD_ID);
  });

  it('Fortnox inte anslutet: sägs som det är', async () => {
    const t = setup();
    (t.deps.push as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new FortnoxNotConnectedError());
    expect((await t.link()) as { fortnoxError: string }).toMatchObject({ fortnoxError: expect.stringMatching(/^Fortnox är inte kopplat/) });
  });

  it('Fortnox-fel vid kopplingen: nya försök av cron-utskicket om 5 min, i 24 h (fas 4b)', async () => {
    const t = setup();
    (t.deps.push as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new FortnoxApiError(503, 'Fortnox 503', 0, 'nere'));
    await t.link();
    expect(t.admin.tables.crm_portal_jobs[0]).toMatchObject({
      fortnox_attempts: 1,
      fortnox_next_attempt_at: '2026-09-28T12:05:00.000Z',
      fortnox_retry_until: '2026-09-29T12:00:00.000Z',
    });
  });

  it('en push som redan pågår vid kopplingen: titta igen om 5 min, inget försök räknat', async () => {
    const t = setup();
    (t.deps.push as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new FortnoxPushInProgressError());
    await t.link();
    expect(t.admin.tables.crm_portal_jobs[0]).toMatchObject({ fortnox_attempts: 0, fortnox_next_attempt_at: '2026-09-28T12:05:00.000Z' });
  });

  // En avbruten arbetsorder skapas inte i Fortnox (fortnox/workOrderCancel.ts): inget fel från Fortnox, inga omförsök.
  it('avbruten arbetsorder: kopplad, ingen Fortnox-order, inga omförsök, och det sägs som det är', async () => {
    const t = setup();
    t.admin.tables.crm_portal_jobs[0].fortnox_next_attempt_at = '2026-09-28T12:03:00.000Z';
    (t.deps.push as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new WorkOrderCancelledError());
    const result = (await t.link()) as { fortnoxError: string };
    expect(result.fortnoxError).toBe('Arbetsordern är avbruten och skickas inte till Fortnox.');
    expect(t.admin.tables.crm_portal_jobs[0]).toMatchObject({ fortnox_attempts: 0, fortnox_next_attempt_at: null });
  });

  it('Fortnox-ordern skapades vid kopplingen: inga omförsök', async () => {
    const t = setup();
    t.admin.tables.crm_portal_jobs[0].fortnox_next_attempt_at = '2026-09-28T12:03:00.000Z';
    await t.link();
    expect(t.admin.tables.crm_portal_jobs[0].fortnox_next_attempt_at).toBeNull();
  });

  it('butikens koppling gick inte att spara: ordern är kopplad och går till Fortnox, och det sägs', async () => {
    const t = setup();
    t.admin.failOn((c) => c.table === 'crm_portal_resellers', { message: 'nere' });
    expect(await t.link()).toMatchObject({ kind: 'linked', storeLinked: false, fortnoxOrderNumber: '24' });
    expect(t.deps.push).toHaveBeenCalled();
  });
});

describe('buildPortalCustomerLinkUpdate', () => {
  it('momsen är jobbets, 0 %, vad kortet än säger, och avskrivna rader räknas inte', () => {
    const wo = unlinkedWorkOrder();
    const lines = wo.line_items as Record<string, unknown>[];
    lines[1] = { ...lines[1], written_off: true };
    // Kortet säger vanlig moms; det läses inte.
    const update = buildPortalCustomerLinkUpdate(wo as never, { ...CARD, reverse_vat: false } as JobCustomerCard);
    expect(update).toMatchObject({ vat_percent: 0, amount: 11780, pricing_summary: { subtotal: 11780, vat: 0, total: 11780 } });
    expect(update.customer_snapshot).toMatchObject({ reverse_vat: true });
  });

  it('🧨 en order som togs emot före regeln får omvänd moms på dokumentet när kortet kopplas', () => {
    const wo = unlinkedWorkOrder();
    const before = { ...wo, customer_snapshot: { ...(wo.customer_snapshot as Record<string, unknown>), reverse_vat: false } };
    expect(buildPortalCustomerLinkUpdate(before as never, CARD).customer_snapshot).toMatchObject({ reverse_vat: true });
    const { reverse_vat: _dropped, ...withoutFlag } = wo.customer_snapshot as Record<string, unknown>;
    expect(buildPortalCustomerLinkUpdate({ ...wo, customer_snapshot: withoutFlag } as never, CARD).customer_snapshot).toMatchObject({ reverse_vat: true });
  });
});
