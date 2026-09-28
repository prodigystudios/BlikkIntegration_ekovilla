import { describe, it, expect, vi } from 'vitest';
import { followUpPortalJob, receivePortalJob, type FollowUpDeps, type JobIntakeDeps } from '@/lib/domains/portal/jobIntakeStore';
import { portalJobSchema, type PortalJob } from '@/lib/domains/portal/jobIntake';
import type { PortalAssignment } from '@/lib/domains/portal/assignment';
import { FortnoxApiError, FortnoxNotConnectedError, FortnoxPushInProgressError } from '@/lib/domains/fortnox/client';
import { CONTRACT_JOB } from './helpers/contractFixtures';
import { memoryAdmin } from './helpers/memoryAdmin';

/**
 * Jobbets intag mot databasen (fas 3b). Det som skyddas:
 *   - ett jobb blir EN arbetsorder, också när anropet görs om, avbryts halvvägs eller körs två gånger samtidigt;
 *   - samma quoteId med ett annat innehåll nekas, och en borttagen arbetsorder skapas inte igen;
 *   - butiken läggs till eller uppdateras, men säljaren på butiken rörs aldrig;
 *   - ingen i fördelningen = inget jobb (portalen försöker igen), och ingen arbetsorder;
 *   - efter svaret: "Nytt jobb" en gång till den som har ordern, Fortnox-ordern bara när kontrollerna går igenom,
 *     och en andra notis med orsaken när den inte kan skapas.
 */

const QUOTE = CONTRACT_JOB.quoteId;
const SELLER = '33333333-3333-4333-8333-333333333333';
const CUSTOMER_ID = '11111111-1111-4111-8111-111111111111';

const CARD = {
  id: CUSTOMER_ID,
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
  reverse_vat: false,
  contacts: [{ name: 'Per Inköp', phone: '070-111 22 33', email: 'per@norrbygg.se', is_primary: true }],
};

const job = (): PortalJob => portalJobSchema.parse(structuredClone(CONTRACT_JOB));
const payload = () => structuredClone(CONTRACT_JOB) as unknown;

// Räknaren delas av alla anrop i en fil: två samtidiga anrop får olika id:n, som i drift.
let idCounter = 0;

function intakeDeps(assignment: PortalAssignment = { kind: 'assigned', userId: SELLER, source: 'reseller_seller', county: null, skipped: [] }) {
  const deps: JobIntakeDeps = {
    assign: vi.fn(async () => assignment),
    registerArticles: vi.fn(async () => []),
    newId: () => `00000000-0000-4000-8000-${String(++idCounter).padStart(12, '0')}`,
    now: () => new Date('2026-09-28T10:00:00Z'),
  };
  return deps;
}

function db(extra: Record<string, Record<string, unknown>[]> = {}) {
  return memoryAdmin({ crm_customers: [CARD], ...extra });
}

describe('receivePortalJob', () => {
  it('nytt jobb: butiken, jobbets rad och arbetsordern, med det reserverade id:t och den som fick jobbet', async () => {
    const m = db();
    const deps = intakeDeps();
    const result = await receivePortalJob(m.admin, job(), payload(), deps);

    expect(result.kind).toBe('created');
    const [jobRow] = m.tables.crm_portal_jobs;
    expect(jobRow).toMatchObject({
      quote_id: QUOTE,
      quote_number: '2026-015',
      reseller_id: 'res-norrbygg',
      store_name: 'Norrbygg AB',
      customer_id: CUSTOMER_ID,
      assigned_to: SELLER,
      assignment_source: 'reseller_seller',
      work_order_created_at: '2026-09-28T10:00:00.000Z',
    });
    expect(jobRow.work_order_id).toBe(jobRow.reserved_work_order_id);
    expect(result).toEqual({ kind: 'created', workOrderId: jobRow.reserved_work_order_id });

    const [workOrder] = m.tables.crm_work_orders;
    expect(workOrder).toMatchObject({
      id: jobRow.reserved_work_order_id,
      // Ordernumret ur det reserverade id:t (de sex första tecknen utan bindestreck) och den svenska dagen.
      order_number: `AO-20260928-${String(jobRow.reserved_work_order_id).replace(/-/g, '').slice(0, 6).toUpperCase()}`,
      customer_id: CUSTOMER_ID,
      created_by: SELLER,
      assigned_to: SELLER,
      status: 'draft',
    });
    // Fördelningen fick butiken, kunden och arbetsplatsen.
    expect(deps.assign).toHaveBeenCalledWith({ resellerId: 'res-norrbygg', customerId: CUSTOMER_ID, workplace: { postalCode: '806 28', city: 'Gävle' } });
    expect(deps.registerArticles).toHaveBeenCalledWith(['2410509', '1010']);
  });

  it('butiken läggs till med portalens uppgifter och kortet numret pekar på, men säljaren rörs aldrig', async () => {
    const m = db({
      crm_portal_resellers: [{ reseller_id: 'res-norrbygg', name: 'Gammalt namn', seller_user_id: 'vald-saljare', customer_id: null }],
    });
    await receivePortalJob(m.admin, job(), payload(), intakeDeps());
    const upsert = m.calls.find((c) => c.table === 'crm_portal_resellers' && c.op === 'upsert')!;
    expect(upsert.values).not.toHaveProperty('seller_user_id');
    expect(m.tables.crm_portal_resellers[0]).toMatchObject({
      name: 'Norrbygg AB',
      street: 'Verkstadsgatan 8',
      customer_number: '1043',
      customer_id: CUSTOMER_ID,
      seller_user_id: 'vald-saljare',
      last_seen_at: '2026-09-28T10:00:00.000Z',
    });
  });

  it('🧨 en upprepning, ett nekat jobb eller ett sent omförsök rör inte butiken', async () => {
    const m = db();
    await receivePortalJob(m.admin, job(), payload(), intakeDeps());
    // Butiken har bytt namn i portalen sedan dess; ett gammalt anrop kommer igen, med det gamla namnet och ett
    // kundnummer som inte längre stämmer.
    m.tables.crm_portal_resellers[0].name = 'Norrbygg AB (nytt namn)';
    const stale = structuredClone(CONTRACT_JOB) as Record<string, any>;
    stale.store.ekovillaCustomerNumber = '9999';
    const before = structuredClone(m.tables.crm_portal_resellers[0]);

    expect((await receivePortalJob(m.admin, job(), payload(), intakeDeps())).kind).toBe('existing');
    expect((await receivePortalJob(m.admin, portalJobSchema.parse(stale), stale, intakeDeps())).kind).toBe('conflict');
    expect(m.tables.crm_portal_resellers[0]).toEqual(before);
    expect(m.calls.filter((c) => c.table === 'crm_portal_resellers' && c.op === 'upsert')).toHaveLength(1);
  });

  it('ett omförsök efter midnatt får samma ordernummer: dagen är den då jobbet kom', async () => {
    const m = db();
    m.failOn((c) => c.table === 'crm_work_orders' && c.op === 'insert', { message: 'nere' });
    const evening = { ...intakeDeps(), now: () => new Date('2026-09-28T21:59:00Z') }; // 23:59 i Sverige
    await expect(receivePortalJob(m.admin, job(), payload(), evening)).rejects.toThrow();
    const morning = { ...intakeDeps(), now: () => new Date('2026-09-28T22:30:00Z') }; // 00:30 dagen efter
    await receivePortalJob(m.admin, job(), payload(), morning);
    expect(m.tables.crm_work_orders[0].order_number).toMatch(/^AO-20260928-/);
  });

  it('två samtidiga omförsök som båda fördelar om: ordern och jobbet får samma person', async () => {
    const m = db();
    m.failOn((c) => c.table === 'crm_work_orders' && c.op === 'insert', { message: 'nere' });
    await expect(receivePortalJob(m.admin, job(), payload(), intakeDeps())).rejects.toThrow();
    m.tables.crm_portal_jobs[0].assigned_to = null;

    const a = intakeDeps({ kind: 'assigned', userId: 'forst', source: 'fallback', county: null, skipped: [] });
    const b = intakeDeps({ kind: 'assigned', userId: 'sedan', source: 'county', county: 'Gävleborg', skipped: [] });
    await Promise.all([receivePortalJob(m.admin, job(), payload(), a), receivePortalJob(m.admin, job(), payload(), b)]);
    expect(a.assign).toHaveBeenCalled();
    expect(b.assign).toHaveBeenCalled();
    const assignee = m.tables.crm_portal_jobs[0].assigned_to;
    expect(m.tables.crm_work_orders).toHaveLength(1);
    expect(m.tables.crm_work_orders[0]).toMatchObject({ assigned_to: assignee, created_by: assignee });
  });

  it('ett okänt kundnummer: ingen kund på jobbet eller ordern, men butiken sparas med numret', async () => {
    const m = memoryAdmin({ crm_customers: [] });
    const deps = intakeDeps();
    await receivePortalJob(m.admin, job(), payload(), deps);
    expect(m.tables.crm_portal_resellers[0]).toMatchObject({ customer_number: '1043', customer_id: null });
    expect(m.tables.crm_portal_jobs[0].customer_id).toBeNull();
    expect(m.tables.crm_work_orders[0].customer_id).toBeNull();
    expect(deps.assign).toHaveBeenCalledWith(expect.objectContaining({ customerId: null }));
  });

  it('ingen kan ta jobbet: inget jobb, ingen arbetsorder (portalen försöker igen), men butiken finns', async () => {
    const m = db();
    const result = await receivePortalJob(m.admin, job(), payload(), intakeDeps({ kind: 'none', county: null, skipped: [] }));
    expect(result.kind).toBe('no_assignee');
    expect(m.tables.crm_portal_jobs ?? []).toHaveLength(0);
    expect(m.tables.crm_work_orders ?? []).toHaveLength(0);
    expect(m.tables.crm_portal_resellers).toHaveLength(1);
  });

  it('samma jobb igen: den befintliga arbetsordern, ingen ny fördelning och ingen ny order', async () => {
    const m = db();
    const first = await receivePortalJob(m.admin, job(), payload(), intakeDeps());
    const deps = intakeDeps();
    const second = await receivePortalJob(m.admin, job(), payload(), deps);
    expect(second).toEqual({ kind: 'existing', workOrderId: (first as { workOrderId: string }).workOrderId });
    expect(deps.assign).not.toHaveBeenCalled();
    expect(m.tables.crm_work_orders).toHaveLength(1);
  });

  it('samma jobb med nycklarna i en annan ordning är samma innehåll', async () => {
    const m = db();
    await receivePortalJob(m.admin, job(), payload(), intakeDeps());
    const { lines, costTotal, workplace, store, quoteNumber, quoteId } = structuredClone(CONTRACT_JOB);
    const reordered = { costTotal, lines, workplace, store, quoteNumber, quoteId };
    expect((await receivePortalJob(m.admin, job(), reordered, intakeDeps())).kind).toBe('existing');
  });

  it('samma quoteId med ett annat innehåll: 409-fallet, ingenting ändras', async () => {
    const m = db();
    await receivePortalJob(m.admin, job(), payload(), intakeDeps());
    const changed = structuredClone(CONTRACT_JOB) as Record<string, any>;
    changed.lines[1].unitCost = 1990;
    expect(await receivePortalJob(m.admin, portalJobSchema.parse(changed), changed, intakeDeps())).toEqual({ kind: 'conflict' });
    expect(m.tables.crm_work_orders).toHaveLength(1);
    expect((m.tables.crm_work_orders[0].line_items as { unit_price: string }[])[1].unit_price).toBe('2490');
  });

  it('en borttagen arbetsorder skapas inte igen', async () => {
    const m = db();
    await receivePortalJob(m.admin, job(), payload(), intakeDeps());
    // Som `on delete set null`: ordern borta, raden kvar med tiden den skapades.
    m.tables.crm_work_orders.length = 0;
    m.tables.crm_portal_jobs[0].work_order_id = null;
    expect(await receivePortalJob(m.admin, job(), payload(), intakeDeps())).toEqual({ kind: 'work_order_removed' });
    expect(m.tables.crm_work_orders).toHaveLength(0);
  });

  it('avbrott efter jobbets rad: omförsöket skapar ordern med samma id och den första fördelningen', async () => {
    const m = db();
    m.failOn((c) => c.table === 'crm_work_orders' && c.op === 'insert', { message: 'anslutningen bröts' });
    await expect(receivePortalJob(m.admin, job(), payload(), intakeDeps())).rejects.toThrow(/anslutningen bröts/);
    const reserved = m.tables.crm_portal_jobs[0].reserved_work_order_id;
    expect(m.tables.crm_work_orders ?? []).toHaveLength(0);

    const deps = intakeDeps({ kind: 'assigned', userId: 'nagon-annan', source: 'fallback', county: null, skipped: [] });
    expect(await receivePortalJob(m.admin, job(), payload(), deps)).toEqual({ kind: 'created', workOrderId: reserved });
    expect(deps.assign).not.toHaveBeenCalled();
    expect(m.tables.crm_work_orders[0]).toMatchObject({ id: reserved, assigned_to: SELLER });
  });

  it('avbrott efter arbetsordern men före kopplingen: omförsöket kopplar den, ingen andra order', async () => {
    const m = db();
    m.failOn((c) => c.table === 'crm_portal_jobs' && c.op === 'update', { message: 'timeout' });
    await expect(receivePortalJob(m.admin, job(), payload(), intakeDeps())).rejects.toThrow(/timeout/);
    expect(m.tables.crm_work_orders).toHaveLength(1);
    expect(m.tables.crm_portal_jobs[0].work_order_id ?? null).toBeNull();

    const result = await receivePortalJob(m.admin, job(), payload(), intakeDeps());
    expect(result.kind).toBe('created');
    expect(m.tables.crm_work_orders).toHaveLength(1);
    expect(m.tables.crm_portal_jobs[0].work_order_id).toBe(m.tables.crm_work_orders[0].id);
  });

  it('en annan krock på arbetsordern än dess eget id kastar i stället för att låtsas att den finns', async () => {
    const m = db({ crm_work_orders: [{ id: 'annan', order_number: 'AO-20260928-000000' }] });
    await expect(receivePortalJob(m.admin, job(), payload(), intakeDeps())).rejects.toThrow(/order_number/);
  });

  it('två samtidiga anrop: det andra tar det förstas rad och reservation, en order', async () => {
    const m = db();
    // Det andra anropet läser innan det första hunnit lägga in raden, och får sedan krocken.
    const deps = intakeDeps();
    const first = receivePortalJob(m.admin, job(), payload(), deps);
    const second = receivePortalJob(m.admin, job(), payload(), intakeDeps());
    const results = await Promise.all([first, second]);
    // Racet uppstod: båda hann försöka lägga in jobbets rad.
    expect(m.calls.filter((c) => c.table === 'crm_portal_jobs' && c.op === 'upsert')).toHaveLength(2);
    expect(m.tables.crm_portal_jobs).toHaveLength(1);
    expect(m.tables.crm_work_orders).toHaveLength(1);
    const ids = results.map((r) => (r as { workOrderId: string }).workOrderId);
    expect(new Set(ids).size).toBe(1);
    // Det andra skrev inte över reservationen (tabellens check hade stoppat det i databasen).
    const [row] = m.tables.crm_portal_jobs;
    expect(row.reserved_work_order_id).toBe(row.work_order_id);
    expect(ids[0]).toBe(row.reserved_work_order_id);
  });

  it('den som fick jobbet togs bort innan ordern fanns: fördelas om, i stället för att stå still för alltid', async () => {
    const m = db();
    m.failOn((c) => c.table === 'crm_work_orders' && c.op === 'insert', { message: 'nere' });
    await expect(receivePortalJob(m.admin, job(), payload(), intakeDeps())).rejects.toThrow();
    m.tables.crm_portal_jobs[0].assigned_to = null;

    const deps = intakeDeps({ kind: 'assigned', userId: 'reserven', source: 'fallback', county: null, skipped: [] });
    expect((await receivePortalJob(m.admin, job(), payload(), deps)).kind).toBe('created');
    expect(m.tables.crm_portal_jobs[0]).toMatchObject({ assigned_to: 'reserven', assignment_source: 'fallback' });
    expect(m.tables.crm_work_orders[0]).toMatchObject({ assigned_to: 'reserven', created_by: 'reserven' });
  });

  it('ett databasfel på kundkortet kastar (portalen får 5xx och försöker igen), inget sparas', async () => {
    const m = db();
    m.failOn((c) => c.table === 'crm_customers', { message: 'nere' });
    await expect(receivePortalJob(m.admin, job(), payload(), intakeDeps())).rejects.toThrow(/kundkort/);
    expect(m.tables.crm_portal_jobs ?? []).toHaveLength(0);
  });
});

// ------------------------------------------------------------------------------------------------ efter svaret

function followDeps(push: FollowUpDeps['push'] = vi.fn(async () => ({ fortnox_order_number: '1234' }))) {
  const sent: { type: string; recipient_user_id: string; title: string; body: string | null; href: string | null }[] = [];
  const deps: FollowUpDeps = {
    push: vi.fn(push),
    notify: vi.fn(async (rows) => void sent.push(...(rows as typeof sent))),
    now: () => new Date('2026-09-28T10:00:05Z'),
  };
  return { deps, sent };
}

async function received(customers: Record<string, unknown>[] = [CARD]) {
  const m = memoryAdmin({ crm_customers: customers });
  const result = await receivePortalJob(m.admin, job(), payload(), intakeDeps());
  return { m, workOrderId: (result as { workOrderId: string }).workOrderId };
}

describe('followUpPortalJob', () => {
  it('"Nytt jobb" till den som har ordern, sedan Fortnox-ordern; ingen andra notis när den skapas', async () => {
    const { m, workOrderId } = await received();
    const { deps, sent } = followDeps();
    const outcome = await followUpPortalJob(m.admin, QUOTE, deps);

    expect(outcome).toEqual({ received: 'sent', fortnox: 'created', reasons: [] });
    expect(deps.push).toHaveBeenCalledWith(workOrderId);
    expect(sent).toEqual([
      expect.objectContaining({
        type: 'portal_job.received',
        recipient_user_id: SELLER,
        title: 'Nytt jobb från Norrbygg AB',
        body: 'Rönnvägen 18, Gävle · Vecka 42 · Fyll i densiteten',
        href: `/crm/arbetsorder/${workOrderId}`,
      }),
    ]);
  });

  it('"Nytt jobb" skickas en gång, också när steget körs igen', async () => {
    const { m } = await received();
    const { deps, sent } = followDeps();
    await followUpPortalJob(m.admin, QUOTE, deps);
    const again = await followUpPortalJob(m.admin, QUOTE, deps);
    expect(again.received).toBe('already_sent');
    expect(sent.filter((n) => n.type === 'portal_job.received')).toHaveLength(1);
  });

  it('en order som redan finns i Fortnox pushas inte igen', async () => {
    const { m } = await received();
    m.tables.crm_work_orders[0].fortnox_order_number = '1234';
    const { deps } = followDeps();
    expect((await followUpPortalJob(m.admin, QUOTE, deps)).fortnox).toBe('exists');
    expect(deps.push).not.toHaveBeenCalled();
  });

  it('butiken utan kundkoppling: ingen push, en andra notis med orsaken (till reserven eller den som fick jobbet)', async () => {
    const { m, workOrderId } = await received([]);
    const { deps, sent } = followDeps();
    const outcome = await followUpPortalJob(m.admin, QUOTE, deps);
    expect(outcome.fortnox).toBe('blocked');
    expect(deps.push).not.toHaveBeenCalled();
    expect(sent[1]).toEqual(
      expect.objectContaining({
        type: 'portal_job.fortnox_issue',
        recipient_user_id: SELLER,
        title: 'Fortnox-ordern kunde inte skapas · Norrbygg AB',
        href: `/crm/arbetsorder/${workOrderId}`,
      }),
    );
    expect(sent[1].body).toContain('Butikens kundnummer 1043 finns inte i kundregistret.');
  });

  it('kundkortet läses om: org.nr saknas när jobbet kommer och stoppar; ifyllt på kortet efteråt släpper det igenom', async () => {
    const { m } = await received([{ ...CARD, organization_number: null }]);
    const blocked = followDeps();
    expect((await followUpPortalJob(m.admin, QUOTE, blocked.deps)).reasons).toEqual(['Organisationsnummer saknas på butikens kundkort.']);
    expect(blocked.deps.push).not.toHaveBeenCalled();

    m.tables.crm_customers[0].organization_number = '556677-8899';
    const ok = followDeps();
    expect((await followUpPortalJob(m.admin, QUOTE, ok.deps)).fortnox).toBe('created');
  });

  it('Fortnox svarar fel: en andra notis med Fortnox svar', async () => {
    const { m } = await received();
    const { deps, sent } = followDeps(async () => {
      throw new FortnoxApiError(400, 'Fortnox 400', 2000423, 'Artikeln finns inte');
    });
    const outcome = await followUpPortalJob(m.admin, QUOTE, deps);
    expect(outcome.fortnox).toBe('failed');
    expect(sent.map((n) => n.type)).toEqual(['portal_job.received', 'portal_job.fortnox_issue']);
    expect(sent[1].body).toMatch(/^Fortnox svarade: /);
  });

  it('Fortnox inte anslutet: sägs rakt ut', async () => {
    const { m } = await received();
    const { deps } = followDeps(async () => {
      throw new FortnoxNotConnectedError();
    });
    expect((await followUpPortalJob(m.admin, QUOTE, deps)).reasons).toEqual(['Fortnox är inte anslutet.']);
  });

  it('en push som redan pågår: ingen notis, den får sitt eget utfall', async () => {
    const { m } = await received();
    const { deps, sent } = followDeps(async () => {
      throw new FortnoxPushInProgressError();
    });
    expect((await followUpPortalJob(m.admin, QUOTE, deps)).fortnox).toBe('in_progress');
    expect(sent.map((n) => n.type)).toEqual(['portal_job.received']);
  });

  it('orsaksnotisen skickas en gång', async () => {
    const { m } = await received([]);
    const { deps, sent } = followDeps();
    await followUpPortalJob(m.admin, QUOTE, deps);
    await followUpPortalJob(m.admin, QUOTE, deps);
    expect(sent.filter((n) => n.type === 'portal_job.fortnox_issue')).toHaveLength(1);
  });

  it('ett misslyckat utskick släpper notisen, så att nästa försök skickar den', async () => {
    const { m } = await received();
    const { deps, sent } = followDeps();
    (deps.notify as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('nere'));
    expect((await followUpPortalJob(m.admin, QUOTE, deps)).received).toBe('failed');
    expect(m.tables.crm_portal_jobs[0].received_notified_at).toBeNull();
    expect((await followUpPortalJob(m.admin, QUOTE, deps)).received).toBe('sent');
    expect(sent.filter((n) => n.type === 'portal_job.received')).toHaveLength(1);
  });

  it('ett jobb utan arbetsorder gör ingenting', async () => {
    const m = memoryAdmin({ crm_portal_jobs: [{ quote_id: QUOTE, work_order_id: null }] });
    const { deps } = followDeps();
    expect(await followUpPortalJob(m.admin, QUOTE, deps)).toEqual({ received: 'skipped', fortnox: 'skipped', reasons: [] });
    expect(deps.notify).not.toHaveBeenCalled();
  });
});
