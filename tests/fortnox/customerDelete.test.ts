import { describe, it, expect, vi, beforeEach } from 'vitest';

// Ta bort kund — hos oss och i Fortnox, eller ingenstans (lib/domains/fortnox/customerDelete.ts).
//
// Reglerna (William 2026-10-02): en kund med offerter, arbetsordrar eller portalkoppling tas inte bort, och säger
// Fortnox nej tas ingenting bort. Det som prövas här är ORDNINGEN — spärren, Fortnox, samtalen, raden — att ett nej
// aldrig når vår rad, och att frågorna mot databasen läser rätt kolumner.

vi.mock('@/lib/supabase/server', () => ({ getSupabaseAdmin: vi.fn() }));
vi.mock('@/lib/domains/fortnox/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/domains/fortnox/client')>();
  return { ...actual, fortnoxGet: vi.fn() };
});

import { getSupabaseAdmin } from '@/lib/supabase/server';
import { FortnoxApiError, FortnoxNotConnectedError, fortnoxGet } from '@/lib/domains/fortnox/client';
import {
  CustomerFortnoxDeleteError,
  CustomerLocalDeleteError,
  customerDeleteDeps,
  customerDeletionBlocked,
  deleteCrmCustomerWithFortnox,
  describeCustomerDeletionBlockers,
  fortnoxCustomerAlreadyGone,
  sameFortnoxCustomer,
  type CustomerDeleteDeps,
  type FortnoxCustomerIdentity,
} from '@/lib/domains/fortnox/customerDelete';
import { makeQueryChain } from '../crm/helpers/supabase';

const ID = '11111111-1111-4111-8111-111111111111';
const NONE = { quotes: 0, workOrders: 0, portal: 0 };

beforeEach(() => vi.clearAllMocks());

describe('describeCustomerDeletionBlockers', () => {
  it('ingenting spärrar → null', () => {
    expect(describeCustomerDeletionBlockers(NONE)).toBeNull();
    expect(customerDeletionBlocked(NONE)).toBe(false);
  });

  it('singular och plural', () => {
    expect(describeCustomerDeletionBlockers({ quotes: 1, workOrders: 0, portal: 0 }))
      .toBe('Kunden har 1 offert och kan inte tas bort.');
    expect(describeCustomerDeletionBlockers({ quotes: 0, workOrders: 2, portal: 0 }))
      .toBe('Kunden har 2 arbetsordrar och kan inte tas bort.');
  });

  it('två och tre delar binds med "och", de första med komma', () => {
    expect(describeCustomerDeletionBlockers({ quotes: 3, workOrders: 1, portal: 0 }))
      .toBe('Kunden har 3 offerter och 1 arbetsorder och kan inte tas bort.');
    expect(describeCustomerDeletionBlockers({ quotes: 2, workOrders: 1, portal: 1 }))
      .toBe('Kunden har 2 offerter, 1 arbetsorder och 1 koppling till återförsäljarportalen och kan inte tas bort.');
  });

  it('varje sort spärrar ensam', () => {
    expect(customerDeletionBlocked({ quotes: 1, workOrders: 0, portal: 0 })).toBe(true);
    expect(customerDeletionBlocked({ quotes: 0, workOrders: 1, portal: 0 })).toBe(true);
    expect(customerDeletionBlocked({ quotes: 0, workOrders: 0, portal: 1 })).toBe(true);
  });
});

describe('fortnoxCustomerAlreadyGone', () => {
  it('404 räknas som borttagen — det Fortnox svarar på ett raderat nummer (testbolaget 2026-10-02)', () => {
    expect(fortnoxCustomerAlreadyGone(new FortnoxApiError(404, 'x'))).toBe(true);
  });

  it('ett nej, eller ett fel som inte är Fortnox, räknas inte', () => {
    // Uppmätta nej: kund med faktura/order, och kund med en offert utan order (2003614).
    expect(fortnoxCustomerAlreadyGone(new FortnoxApiError(400, 'x', 2003614, 'Offerter med kund 21 måste ha order skapad'))).toBe(false);
    expect(fortnoxCustomerAlreadyGone(new FortnoxApiError(400, 'x', 2000310, 'Posten används'))).toBe(false);
    expect(fortnoxCustomerAlreadyGone(new FortnoxNotConnectedError())).toBe(false);
    expect(fortnoxCustomerAlreadyGone(new Error('nätverk'))).toBe(false);
  });
});

describe('sameFortnoxCustomer', () => {
  const business = { customer_type: 'business' as const, company_name: 'Dubblett AB', first_name: null, last_name: null, organization_number: '556000-0001', personal_number: null };
  const privatePerson = { customer_type: 'private' as const, company_name: null, first_name: 'Anna', last_name: 'Berg', organization_number: null, personal_number: '19800101-1234' };

  it('org.numret avgör när båda har ett — namnet spelar då ingen roll', () => {
    expect(sameFortnoxCustomer(business, { name: 'Dubblett Aktiebolag', organisationNumber: '5560000001' })).toBe(true);
    expect(sameFortnoxCustomer(business, { name: 'Dubblett AB', organisationNumber: '556999-9999' })).toBe(false);
  });

  it('personnumret jämförs på de tio sista siffrorna (12 mot 10 siffror)', () => {
    expect(sameFortnoxCustomer(privatePerson, { name: 'Någon annan', organisationNumber: '800101-1234' })).toBe(true);
    expect(sameFortnoxCustomer(privatePerson, { name: 'Anna Berg', organisationNumber: '19900101-1234' })).toBe(false);
  });

  it('utan nummer på ena sidan: namnet, utan hänsyn till versaler och mellanslag', () => {
    expect(sameFortnoxCustomer({ ...business, organization_number: null }, { name: '  dubblett   ab ', organisationNumber: '5560000001' })).toBe(true);
    expect(sameFortnoxCustomer(business, { name: 'Dubblett AB', organisationNumber: null })).toBe(true);
    expect(sameFortnoxCustomer({ ...privatePerson, personal_number: null }, { name: 'Anna Berg', organisationNumber: null })).toBe(true);
    expect(sameFortnoxCustomer({ ...business, organization_number: null }, { name: 'Ny Kund AB', organisationNumber: null })).toBe(false);
  });

  it('inget namn hos oss räknas aldrig som samma', () => {
    expect(sameFortnoxCustomer({ ...business, company_name: null, organization_number: null }, { name: '', organisationNumber: null })).toBe(false);
  });
});

/** Fejkade beroenden som skriver varje anrop i en logg, så att ordningen går att pröva. */
function fakeDeps(opts: {
  fortnoxId?: string | null;
  missing?: boolean;
  /** Kunden bakom numret i Fortnox; null = okänt nummer. */
  remote?: FortnoxCustomerIdentity | null;
  readFortnox?: () => Promise<void>;
  blockers?: typeof NONE;
  fortnox?: () => Promise<void>;
  nameCalls?: () => Promise<void>;
  deleted?: boolean;
  detach?: () => Promise<void>;
} = {}) {
  const log: string[] = [];
  const deps: CustomerDeleteDeps = {
    read: async () => {
      log.push('read');
      return opts.missing ? null : {
        id: ID,
        customer_type: 'business',
        company_name: 'Dubblett AB',
        first_name: null,
        last_name: null,
        organization_number: '556000-0001',
        personal_number: null,
        fortnox_customer_id: opts.fortnoxId === undefined ? '1042' : opts.fortnoxId,
      };
    },
    countBlockers: async () => { log.push('count'); return opts.blockers ?? NONE; },
    readFortnoxCustomer: async (nr) => {
      log.push(`fortnox-read:${nr}`);
      await opts.readFortnox?.();
      return opts.remote === undefined ? { name: 'Dubblett AB', organisationNumber: '5560000001' } : opts.remote;
    },
    deleteInFortnox: async (nr) => { log.push(`fortnox:${nr}`); await opts.fortnox?.(); },
    nameUnnamedCalls: async (_id, name) => { log.push(`calls:${name}`); await opts.nameCalls?.(); },
    deleteRow: async () => { log.push('delete'); return opts.deleted ?? true; },
    detachFortnoxNumber: async () => { log.push('detach'); await opts.detach?.(); },
  };
  return { deps, log };
}

describe('deleteCrmCustomerWithFortnox', () => {
  it('Fortnox först, sedan samtalen, sist vår rad', async () => {
    const { deps, log } = fakeDeps();
    await expect(deleteCrmCustomerWithFortnox(ID, deps)).resolves.toEqual({ kind: 'deleted', fortnoxCustomerNumber: '1042' });
    expect(log).toEqual(['read', 'count', 'fortnox-read:1042', 'fortnox:1042', 'calls:Dubblett AB', 'delete']);
  });

  it('🧨 numret tillhör en annan kund i Fortnox (återanvänt): ingenting tas bort', async () => {
    const { deps, log } = fakeDeps({ remote: { name: 'Ny Kund AB', organisationNumber: '5569999999' } });
    await expect(deleteCrmCustomerWithFortnox(ID, deps)).resolves.toEqual({
      kind: 'fortnox_mismatch', fortnoxCustomerNumber: '1042', fortnoxName: 'Ny Kund AB',
    });
    expect(log).toEqual(['read', 'count', 'fortnox-read:1042']);
  });

  it('Fortnox känner inte till numret: ingen borttagning där, vår rad tas bort', async () => {
    const { deps, log } = fakeDeps({ remote: null });
    await expect(deleteCrmCustomerWithFortnox(ID, deps)).resolves.toEqual({ kind: 'deleted', fortnoxCustomerNumber: '1042' });
    expect(log).toEqual(['read', 'count', 'fortnox-read:1042', 'calls:Dubblett AB', 'delete']);
  });

  it('läsningen i Fortnox faller → stage read, ingenting borttaget', async () => {
    const { deps, log } = fakeDeps({ readFortnox: async () => { throw new Error('nätverk'); } });
    const thrown = await deleteCrmCustomerWithFortnox(ID, deps).catch((e) => e);
    expect(thrown).toBeInstanceOf(CustomerFortnoxDeleteError);
    expect(thrown.stage).toBe('read');
    expect(log).toEqual(['read', 'count', 'fortnox-read:1042']);
  });

  it('en kund som inte finns: ingenting mer görs', async () => {
    const { deps, log } = fakeDeps({ missing: true });
    await expect(deleteCrmCustomerWithFortnox(ID, deps)).resolves.toEqual({ kind: 'not_found' });
    expect(log).toEqual(['read']);
  });

  it('spärrad: Fortnox tillfrågas inte och ingenting tas bort', async () => {
    const blockers = { quotes: 2, workOrders: 0, portal: 0 };
    const { deps, log } = fakeDeps({ blockers });
    await expect(deleteCrmCustomerWithFortnox(ID, deps)).resolves.toEqual({ kind: 'blocked', blockers });
    expect(log).toEqual(['read', 'count']);
  });

  it('🧨 Fortnox nej: samtalen och raden rörs inte', async () => {
    const no = new FortnoxApiError(400, 'x', 2000310, 'Posten används');
    const { deps, log } = fakeDeps({ fortnox: async () => { throw no; } });
    const thrown = await deleteCrmCustomerWithFortnox(ID, deps).catch((e) => e);
    expect(thrown).toBeInstanceOf(CustomerFortnoxDeleteError);
    expect(thrown.fortnoxCustomerNumber).toBe('1042');
    expect(thrown.fortnoxError).toBe(no);
    expect(thrown.stage).toBe('delete');
    expect(log).toEqual(['read', 'count', 'fortnox-read:1042', 'fortnox:1042']);
  });

  it('Fortnox inte kopplat räknas som nej, inte som borttagen', async () => {
    const { deps, log } = fakeDeps({ fortnox: async () => { throw new FortnoxNotConnectedError(); } });
    await expect(deleteCrmCustomerWithFortnox(ID, deps)).rejects.toBeInstanceOf(CustomerFortnoxDeleteError);
    expect(log).not.toContain('delete');
  });

  it('Fortnox känner inte till kunden (ett nytt försök): vår rad tas bort ändå', async () => {
    const { deps, log } = fakeDeps({ fortnox: async () => { throw new FortnoxApiError(404, 'x'); } });
    await expect(deleteCrmCustomerWithFortnox(ID, deps)).resolves.toEqual({ kind: 'deleted', fortnoxCustomerNumber: '1042' });
    expect(log).toContain('delete');
  });

  it('utan Fortnox-nummer tillfrågas inte Fortnox', async () => {
    for (const fortnoxId of [null, '', '  ']) {
      const { deps, log } = fakeDeps({ fortnoxId });
      await expect(deleteCrmCustomerWithFortnox(ID, deps)).resolves.toEqual({ kind: 'deleted', fortnoxCustomerNumber: null });
      expect(log).toEqual(['read', 'count', 'calls:Dubblett AB', 'delete']);
      expect(log.some((l) => l.startsWith('fortnox'))).toBe(false);
    }
  });

  it('🧨 ingen rad borttagen efter Fortnox ja → numret kopplas loss (Fortnox återanvänder kundnummer)', async () => {
    const { deps, log } = fakeDeps({ deleted: false });
    const thrown = await deleteCrmCustomerWithFortnox(ID, deps).catch((e) => e);
    expect(thrown).toBeInstanceOf(CustomerLocalDeleteError);
    expect(thrown.fortnoxCustomerNumber).toBe('1042');
    expect(thrown.detached).toBe(true);
    expect(log).toEqual(['read', 'count', 'fortnox-read:1042', 'fortnox:1042', 'calls:Dubblett AB', 'delete', 'detach']);
  });

  it('samtalen faller → raden tas inte bort, numret kopplas loss', async () => {
    const { deps, log } = fakeDeps({ nameCalls: async () => { throw new Error('rls'); } });
    const thrown = await deleteCrmCustomerWithFortnox(ID, deps).catch((e) => e);
    expect(thrown).toBeInstanceOf(CustomerLocalDeleteError);
    expect(thrown.detached).toBe(true);
    expect(log).not.toContain('delete');
    expect(log).toContain('detach');
  });

  it('lösgörandet faller också → detached: false, och felet bär fortfarande numret', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { deps } = fakeDeps({ deleted: false, detach: async () => { throw new Error('nere'); } });
    const thrown = await deleteCrmCustomerWithFortnox(ID, deps).catch((e) => e);
    expect(thrown).toBeInstanceOf(CustomerLocalDeleteError);
    expect(thrown.fortnoxCustomerNumber).toBe('1042');
    expect(thrown.detached).toBe(false);
  });

  it('utan Fortnox-nummer finns inget att koppla loss', async () => {
    const { deps, log } = fakeDeps({ fortnoxId: null, deleted: false });
    const thrown = await deleteCrmCustomerWithFortnox(ID, deps).catch((e) => e);
    expect(thrown).toBeInstanceOf(CustomerLocalDeleteError);
    expect(thrown.fortnoxCustomerNumber).toBeNull();
    expect(log).not.toContain('detach');
  });
});

describe('customerDeleteDeps — frågorna', () => {
  /** En klient där varje from() får en egen kedja, så att filtren per tabell går att läsa efteråt. */
  function recordingClient(result: { data: unknown; error: unknown; count?: number }) {
    const chains: Record<string, ReturnType<typeof makeQueryChain>> = {};
    return {
      chains,
      client: {
        from: vi.fn((table: string) => {
          chains[table] = makeQueryChain(result as { data: unknown; error: unknown });
          return chains[table];
        }),
      },
    };
  }

  it('spärren räknar offerter och arbetsordrar på kund ELLER prospekt, portalen på customer_id — elevated', async () => {
    const admin = recordingClient({ data: null, error: null, count: 1 });
    vi.mocked(getSupabaseAdmin).mockReturnValue(admin.client as never);
    const session = recordingClient({ data: null, error: null });

    const blockers = await customerDeleteDeps(session.client as never).countBlockers(ID);

    expect(blockers).toEqual({ quotes: 1, workOrders: 1, portal: 4 });
    expect(session.client.from).not.toHaveBeenCalled();
    for (const table of ['crm_quotes', 'crm_work_orders']) {
      expect(admin.chains[table].or).toHaveBeenCalledWith(`customer_id.eq.${ID},prospect_id.eq.${ID}`);
    }
    for (const table of ['crm_portal_partners', 'crm_portal_resellers', 'crm_portal_jobs', 'crm_store_orders']) {
      expect(admin.chains[table].eq).toHaveBeenCalledWith('customer_id', ID);
    }
  });

  it('ett läsfel i spärren kastar — det svarar aldrig noll', async () => {
    const admin = recordingClient({ data: null, error: { message: 'permission denied' } });
    vi.mocked(getSupabaseAdmin).mockReturnValue(admin.client as never);
    await expect(customerDeleteDeps(recordingClient({ data: null, error: null }).client as never).countBlockers(ID))
      .rejects.toThrow('permission denied');
  });

  it('samtalen: bara de utan företagsnamn som blir helt utan referens, via sessionen', async () => {
    vi.mocked(getSupabaseAdmin).mockReturnValue(recordingClient({ data: null, error: null }).client as never);
    const session = recordingClient({ data: null, error: null });
    await customerDeleteDeps(session.client as never).nameUnnamedCalls(ID, 'Dubblett AB');
    const calls = session.chains.crm_calls;
    expect(calls.update).toHaveBeenCalledWith({ company_name: 'Dubblett AB' });
    expect(calls.is).toHaveBeenCalledWith('company_name', null);
    // Ett samtal vars andra referens pekar på en kund som står kvar ska INTE få den raderade kundens namn.
    expect(calls.or).toHaveBeenCalledWith(
      `and(customer_id.eq.${ID},prospect_id.is.null),and(customer_id.eq.${ID},prospect_id.eq.${ID}),and(customer_id.is.null,prospect_id.eq.${ID})`);
  });

  it('Fortnox-kunden läses på numret; 404 = okänd, annat fel kastas', async () => {
    vi.mocked(getSupabaseAdmin).mockReturnValue(recordingClient({ data: null, error: null }).client as never);
    const deps = customerDeleteDeps(recordingClient({ data: null, error: null }).client as never);
    vi.mocked(fortnoxGet).mockResolvedValueOnce({ Customer: { Name: 'Dubblett AB', OrganisationNumber: '556000-0001' } });
    await expect(deps.readFortnoxCustomer('1042')).resolves.toEqual({ name: 'Dubblett AB', organisationNumber: '556000-0001' });
    expect(fortnoxGet).toHaveBeenCalledWith('/customers/1042');

    vi.mocked(fortnoxGet).mockRejectedValueOnce(new FortnoxApiError(404, 'x'));
    await expect(deps.readFortnoxCustomer('1042')).resolves.toBeNull();

    vi.mocked(fortnoxGet).mockRejectedValueOnce(new FortnoxApiError(500, 'x'));
    await expect(deps.readFortnoxCustomer('1042')).rejects.toBeInstanceOf(FortnoxApiError);
  });

  it('raderingen går via sessionen och ser om raden försvann', async () => {
    vi.mocked(getSupabaseAdmin).mockReturnValue(recordingClient({ data: null, error: null }).client as never);
    const gone = recordingClient({ data: { id: ID }, error: null });
    await expect(customerDeleteDeps(gone.client as never).deleteRow(ID)).resolves.toBe(true);
    expect(gone.chains.crm_customers.delete).toHaveBeenCalled();
    expect(gone.chains.crm_customers.eq).toHaveBeenCalledWith('id', ID);

    // En DELETE som RLS filtrerar bort svarar error: null och ingen rad.
    const filtered = recordingClient({ data: null, error: null });
    await expect(customerDeleteDeps(filtered.client as never).deleteRow(ID)).resolves.toBe(false);
  });

  it('lösgörandet nollar numret och synkläget, och kastar när ingen rad uppdaterades', async () => {
    vi.mocked(getSupabaseAdmin).mockReturnValue(recordingClient({ data: null, error: null }).client as never);
    const updated = recordingClient({ data: { id: ID }, error: null });
    await customerDeleteDeps(updated.client as never).detachFortnoxNumber(ID);
    expect(updated.chains.crm_customers.update).toHaveBeenCalledWith({ fortnox_customer_id: null, sync_status: 'not_synced' });
    expect(updated.chains.crm_customers.eq).toHaveBeenCalledWith('id', ID);

    const none = recordingClient({ data: null, error: null });
    await expect(customerDeleteDeps(none.client as never).detachFortnoxNumber(ID)).rejects.toThrow('Ingen rad');
  });
});
