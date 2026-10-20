import { describe, it, expect, vi } from 'vitest';
import { swapWorkOrderCustomer, type SwapWorkOrderCustomerDeps } from '@/lib/domains/crm/swapWorkOrderCustomer';
import { FortnoxApiError } from '@/lib/domains/fortnox/client';
import { memoryAdmin } from '../portal/helpers/memoryAdmin';

/**
 * Byta kund på arbetsordern (William, 2026-10-20). Det som skyddas:
 *   - ingenting sparas när bytet nekas: fakturering (status, rundor, helfakturerad), portalorder, annan kundtyp
 *     eller moms, ett ofullständigt kort, en Fortnox-kund som inte gick att lägga upp;
 *   - den som inte får ändra ordern (RLS) får nej, och en order som sparats under tiden skrivs inte över;
 *   - finns Fortnox-ordern pushas bytet, och ett Fortnox-fel ändrar inte bytet — det sägs;
 *   - den nya kunden läggs upp i Fortnox när ordern finns där, eller ska skapas ur en Fortnox-offert.
 */

const WO = '22222222-2222-4222-8222-222222222222';
const OLD = '11111111-1111-4111-8111-111111111111';
const NEW = '33333333-3333-4333-8333-333333333333';

const newCard = {
  id: NEW,
  customer_type: 'private',
  company_name: null,
  organization_number: null,
  first_name: 'Per',
  last_name: 'Seppä',
  personal_number: '19930512-3235',
  email: 'info@persappa.se',
  phone: '0723239123',
  mobile: null,
  visit_address: { street: 'Testvägen 1', postal_code: '15232', city: 'Söder' },
  contacts: [],
  reverse_vat: false,
  fortnox_customer_id: '4',
};

const order = {
  id: WO,
  status: 'scheduled',
  quote_id: 'quote-1',
  customer_id: OLD,
  prospect_id: null,
  quote_type: 'private',
  customer_snapshot: { customer_name: 'Erik Johansson', personal_number: '19860801-7557', street_address: 'Sergutt 23', postal_code: '14232', city: 'Svante', reverse_vat: false },
  work_address: { street_address: 'Sergutt 23', postal_code: '14232', city: 'Svante' },
  rot_details: {},
  line_items: [],
  internal_handoff: {},
  fortnox_order_number: '109',
  fortnox_invoice_number: null,
  partial_invoicing_started_at: null,
  updated_at: '2026-10-20T08:00:00.000Z',
};

function setup(options: {
  order?: Record<string, unknown>;
  card?: Record<string, unknown>;
  oldCard?: Record<string, unknown>;
  quote?: Record<string, unknown> | null;
  invoiceRounds?: number;
  portal?: boolean;
  canUpdate?: boolean;
  savedMeanwhile?: boolean;
  push?: SwapWorkOrderCustomerDeps['push'];
  createFortnoxCustomer?: SwapWorkOrderCustomerDeps['createFortnoxCustomer'];
} = {}) {
  const row = { ...order, ...options.order };
  const session = memoryAdmin(
    { crm_work_orders: [row], crm_customers: [{ ...newCard, ...options.card }] },
    {
      canUpdate: () => options.canUpdate ?? true,
      // Någon annan sparar ordern precis innan bytet skrivs.
      beforeExecute: (call, tables) => {
        if (options.savedMeanwhile && call.table === 'crm_work_orders' && call.op === 'update') {
          tables.crm_work_orders[0].updated_at = '2026-10-20T08:00:05.000Z';
        }
      },
    },
  );
  const admin = memoryAdmin({
    crm_work_order_invoices: Array.from({ length: options.invoiceRounds ?? 0 }, (_, i) => ({ id: `inv-${i}`, work_order_id: WO })),
    crm_portal_jobs: options.portal ? [{ quote_id: 'q-1', work_order_id: WO }] : [],
    crm_customers: [{ id: OLD, reverse_vat: false, ...options.oldCard }],
    crm_quotes: options.quote === null ? [] : [{ id: 'quote-1', fortnox_offer_number: null, rot_details: null, ...options.quote }],
  });
  const deps: SwapWorkOrderCustomerDeps = {
    push: options.push ?? vi.fn(async () => ({ fortnox_order_number: '109' })),
    createFortnoxCustomer: options.createFortnoxCustomer ?? vi.fn(async () => ({ fortnoxCustomerNumber: '23' })),
  };
  const swap = (workAddress: 'keep' | 'customer' = 'customer', customerId = NEW) =>
    swapWorkOrderCustomer(session.admin, admin.admin, { workOrderId: WO, customerId, workAddress }, deps);
  return { session, admin, deps, swap, saved: () => session.tables.crm_work_orders[0] };
}

describe('swapWorkOrderCustomer', () => {
  it('byter kunden och pushar Fortnox-ordern', async () => {
    const t = setup();
    expect(await t.swap()).toEqual({ kind: 'swapped', inFortnox: true, fortnoxError: null });
    expect(t.saved()).toMatchObject({ customer_id: NEW, client_name: 'Per Seppä' });
    expect(t.saved().customer_snapshot).toMatchObject({ personal_number: '19930512-3235', fortnox_customer_number: '4' });
    expect(t.deps.push).toHaveBeenCalledWith(WO);
    expect(t.deps.createFortnoxCustomer).not.toHaveBeenCalled();
  });

  it('arbetsplatsen följer valet', async () => {
    const keep = setup({ order: { work_address: { street_address: 'Byggplatsen 9', postal_code: '11122', city: 'Stockholm' } } });
    await keep.swap('keep');
    expect(keep.saved().work_address).toMatchObject({ street_address: 'Byggplatsen 9', city: 'Stockholm' });

    const take = setup();
    await take.swap('customer');
    expect(take.saved().work_address).toMatchObject({ street_address: 'Testvägen 1', city: 'Söder' });
  });

  it('inte i Fortnox än: bara CRM, ingen push', async () => {
    const t = setup({ order: { fortnox_order_number: null } });
    expect(await t.swap()).toEqual({ kind: 'swapped', inFortnox: false, fortnoxError: null });
    expect(t.saved().customer_id).toBe(NEW);
    expect(t.deps.push).not.toHaveBeenCalled();
  });

  // 🧨 Tomma ROT-uppgifter på ordern läser OFFERTENS, och offerten står kvar på den gamla kunden.
  it('offertens ROT-uppgifter kopieras till ordern med den nya sökanden', async () => {
    const t = setup({ quote: { rot_details: { enabled: true, applicant_name: 'Erik Johansson', personal_number: '19860801-7557', property_designation: 'Svante 1:2' } } });
    await t.swap();
    expect(t.saved().rot_details).toMatchObject({ enabled: true, applicant_name: 'Per Seppä', personal_number: '19930512-3235', property_designation: 'Svante 1:2' });
  });

  describe('nekas, och ingenting sparas', () => {
    const unchanged = (t: ReturnType<typeof setup>) => {
      expect(t.saved().customer_id).toBe(OLD);
      expect(t.deps.push).not.toHaveBeenCalled();
    };

    it('en fakturarunda finns', async () => {
      const t = setup({ invoiceRounds: 1 });
      expect(await t.swap()).toMatchObject({ kind: 'blocked', reason: 'invoiced' });
      unchanged(t);
    });

    it('delfakturerad enligt statusen eller kolumnen', async () => {
      expect(await setup({ order: { status: 'partially_invoiced' } }).swap()).toMatchObject({ reason: 'invoiced' });
      expect(await setup({ order: { partial_invoicing_started_at: '2026-10-01T10:00:00Z' } }).swap()).toMatchObject({ reason: 'invoiced' });
    });

    it('helfakturerad', async () => {
      expect(await setup({ order: { status: 'invoiced' } }).swap()).toMatchObject({ reason: 'invoiced' });
      expect(await setup({ order: { fortnox_invoice_number: '48' } }).swap()).toMatchObject({ reason: 'invoiced' });
    });

    it('portalorder', async () => {
      const t = setup({ portal: true });
      expect(await t.swap()).toMatchObject({ kind: 'blocked', reason: 'portal' });
      unchanged(t);
    });

    // Snapshoten saknar flaggan: då gäller det nuvarande kortets moms, som i Fortnox-pushen.
    it('annan moms än det nuvarande kortets', async () => {
      const t = setup({
        order: { quote_type: 'business', customer_snapshot: { customer_name: 'Bygg AB' }, rot_details: {} },
        oldCard: { reverse_vat: true },
        card: { customer_type: 'business', company_name: 'Johansons Bygg AB', organization_number: '556103-4249', personal_number: null, reverse_vat: false },
      });
      expect(await t.swap('keep')).toMatchObject({ kind: 'blocked', reason: 'reverse_vat' });
      unchanged(t);
    });

    it('ett kort utan giltigt personnummer', async () => {
      const t = setup({ card: { personal_number: '930512-3235' } });
      const result = await t.swap();
      expect(result.kind).toBe('incomplete');
      expect(result.kind === 'incomplete' && result.blockers.map((b) => b.field)).toEqual(['personal_number']);
      unchanged(t);
    });

    it('den nya kunden går inte att lägga upp i Fortnox', async () => {
      const t = setup({
        card: { fortnox_customer_id: null },
        createFortnoxCustomer: vi.fn(async () => { throw new FortnoxApiError(400, 'Ogiltigt org.nr'); }),
      });
      expect(await t.swap()).toMatchObject({ kind: 'fortnox_customer_failed' });
      unchanged(t);
    });

    it('sessionen får inte ändra ordern', async () => {
      const t = setup({ canUpdate: false });
      expect(await t.swap()).toEqual({ kind: 'forbidden' });
      unchanged(t);
    });

    it('ordern sparades av någon annan under tiden', async () => {
      const t = setup({ savedMeanwhile: true });
      expect(await t.swap()).toEqual({ kind: 'changed' });
      unchanged(t);
    });

    it('ordern eller kortet syns inte', async () => {
      expect(await setup().swap('customer', '44444444-4444-4444-8444-444444444444')).toEqual({ kind: 'customer_not_found' });
      expect(await setup({ order: { id: 'annan' } }).swap()).toEqual({ kind: 'not_found' });
    });
  });

  describe('den nya kunden i Fortnox', () => {
    it('läggs upp när ordern finns i Fortnox, och numret är det pushen byter till', async () => {
      const t = setup({ card: { fortnox_customer_id: null } });
      await t.swap();
      expect(t.deps.createFortnoxCustomer).toHaveBeenCalledWith(NEW);
      expect(t.saved().customer_snapshot).toMatchObject({ fortnox_customer_number: '23' });
    });

    // createorder ur offerten ger den GAMLA kunden — pushen måste ha ett nummer att byta till.
    it('läggs upp när ordern ska skapas ur en Fortnox-offert', async () => {
      const t = setup({ order: { fortnox_order_number: null }, quote: { fortnox_offer_number: '31' }, card: { fortnox_customer_id: null } });
      await t.swap();
      expect(t.deps.createFortnoxCustomer).toHaveBeenCalledWith(NEW);
      expect(t.saved().customer_snapshot).toMatchObject({ fortnox_customer_number: '23' });
    });

    it('läggs inte upp för en fristående order som inte finns i Fortnox', async () => {
      const t = setup({ order: { fortnox_order_number: null, quote_id: null }, quote: null, card: { fortnox_customer_id: null } });
      await t.swap();
      expect(t.deps.createFortnoxCustomer).not.toHaveBeenCalled();
    });
  });

  // Kunden är bytt i CRM ändå; "Synka om" byter den i Fortnox.
  it('ett Fortnox-fel ändrar inte bytet, det sägs', async () => {
    const t = setup({ push: vi.fn(async () => { throw new FortnoxApiError(500, 'Fortnox svarar inte'); }) });
    const result = await t.swap();
    expect(result).toMatchObject({ kind: 'swapped', inFortnox: true });
    expect(result.kind === 'swapped' && result.fortnoxError).toMatch(/fortfarande den gamla kunden.*Synka om/);
    expect(t.saved().customer_id).toBe(NEW);
  });
});
