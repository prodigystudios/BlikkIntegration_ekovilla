import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeSupabaseMock } from './helpers/supabase';
import {
  listCrmCustomers,
  createCrmCustomer,
  getCrmCustomer,
  updateCrmCustomer,
  convertProspectToCustomer,
  setAccountManagerIfUnset,
  getCrmCustomerDisplayName,
  privateCustomerContactName,
  createCrmCustomerContact,
  updateCrmCustomerContact,
} from '@/lib/domains/crm/customers';
import { resolveCrmContact } from '@/lib/domains/crm/contacts';

beforeEach(() => vi.clearAllMocks());

// ---------------------------------------------------------------------------
// getCrmCustomerDisplayName — ren funktion, inga mockar
// ---------------------------------------------------------------------------

describe('getCrmCustomerDisplayName', () => {
  it('returnerar company_name för business', () => {
    expect(
      getCrmCustomerDisplayName({ customer_type: 'business', company_name: 'Acme AB' })
    ).toBe('Acme AB');
  });

  it('returnerar fallback för business utan company_name', () => {
    expect(getCrmCustomerDisplayName({ customer_type: 'business', company_name: null })).toBe(
      'Okänt företag'
    );
  });

  it('returnerar för- och efternamn för private', () => {
    expect(
      getCrmCustomerDisplayName({
        customer_type: 'private',
        first_name: 'Anna',
        last_name: 'Svensson',
      })
    ).toBe('Anna Svensson');
  });

  it('returnerar fallback för private utan namn', () => {
    expect(
      getCrmCustomerDisplayName({
        customer_type: 'private',
        first_name: null,
        last_name: null,
      })
    ).toBe('Okänd kund');
  });
});

// ---------------------------------------------------------------------------
// listCrmCustomers
// ---------------------------------------------------------------------------

describe('listCrmCustomers', () => {
  it('anropar rätt tabell', async () => {
    const mockData = [{ id: 'c1', company_name: 'Test AB' }];
    const sb = makeSupabaseMock({ data: mockData, error: null });

    await listCrmCustomers(sb as any, {});

    expect(sb.from).toHaveBeenCalledWith('crm_customers');
  });

  it('returnerar data vid framgång', async () => {
    const mockData = [{ id: 'c1', company_name: 'Test AB' }];
    const sb = makeSupabaseMock({ data: mockData, error: null });

    const result = await listCrmCustomers(sb as any, {});

    expect((result as any).data).toEqual(mockData);
    expect((result as any).error).toBeNull();
  });

  it('tillämpar sökfilter via .or()', async () => {
    const sb = makeSupabaseMock({ data: [], error: null });
    const query = sb._query;

    await listCrmCustomers(sb as any, { search: 'Acme' });

    expect(query.or).toHaveBeenCalledWith(expect.stringContaining('Acme'));
  });

  it('tillämpar status-filter via .eq()', async () => {
    const sb = makeSupabaseMock({ data: [], error: null });
    const query = sb._query;

    await listCrmCustomers(sb as any, { status: 'active' });

    expect(query.eq).toHaveBeenCalledWith('status', 'active');
  });

  it('tillämpar stage-filter via .eq()', async () => {
    const sb = makeSupabaseMock({ data: [], error: null });
    const query = sb._query;

    await listCrmCustomers(sb as any, { stage: 'prospect' });

    expect(query.eq).toHaveBeenCalledWith('customer_stage', 'prospect');
  });

  it('tillämpar assignedTo-filter via .eq()', async () => {
    const sb = makeSupabaseMock({ data: [], error: null });
    const query = sb._query;

    await listCrmCustomers(sb as any, { assignedTo: 'user-1' });

    expect(query.eq).toHaveBeenCalledWith('assigned_to', 'user-1');
  });

  it('tillämpar inga filter när options är tomma', async () => {
    const sb = makeSupabaseMock({ data: [], error: null });
    const query = sb._query;

    await listCrmCustomers(sb as any, {});

    expect(query.or).not.toHaveBeenCalled();
    expect(query.eq).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// createCrmCustomer
// ---------------------------------------------------------------------------

describe('createCrmCustomer', () => {
  const validInput = {
    customer_type: 'business' as const,
    company_name: 'Nytt AB',
    assigned_to: 'user-1',
    created_by: 'user-1',
  };

  it('anropar rätt tabell med insert', async () => {
    const sb = makeSupabaseMock({ data: { id: 'new-1', ...validInput }, error: null });

    await createCrmCustomer(sb as any, validInput);

    expect(sb.from).toHaveBeenCalledWith('crm_customers');
    expect(sb._query.insert).toHaveBeenCalledWith(validInput);
  });

  it('returnerar skapad kund vid framgång', async () => {
    const created = { id: 'new-1', ...validInput };
    const sb = makeSupabaseMock({ data: created, error: null });

    const result = await createCrmCustomer(sb as any, validInput);

    expect((result as any).data).toEqual(created);
    expect((result as any).error).toBeNull();
  });

  it('returnerar error vid databasfel', async () => {
    const sb = makeSupabaseMock({ data: null, error: { message: 'unique violation' } });

    const result = await createCrmCustomer(sb as any, validInput);

    expect((result as any).error).toBeTruthy();
  });

  it('skapar INGEN kontaktperson för företagskund', async () => {
    const sb = makeSupabaseMock({ data: { id: 'new-1', ...validInput }, error: null });

    await createCrmCustomer(sb as any, validInput);

    expect(sb.from).not.toHaveBeenCalledWith('crm_customer_contacts');
  });

  it('skapar en primär kontaktperson med BARA namnet för privatkund', async () => {
    const privateInput = {
      customer_type: 'private' as const,
      first_name: 'Anna',
      last_name: 'Svensson',
      phone: '070-123 45 67',
      email: 'anna@example.se',
      assigned_to: 'user-1',
      created_by: 'user-1',
    };
    const sb = makeSupabaseMock({ data: { id: 'new-1', ...privateInput }, error: null });

    await createCrmCustomer(sb as any, privateInput);

    expect(sb.from).toHaveBeenCalledWith('crm_customer_contacts');
    // Telefon och e-post lämnas MED FLIT utanför raden: kontakten vinner över kortet i
    // resolveCrmContact, så en kopia här skulle frysa en adress som senare rättas på kortet.
    expect(sb._query.insert).toHaveBeenCalledWith({
      customer_id: 'new-1',
      name: 'Anna Svensson',
      is_primary: true,
    });
  });

  it('skapar ingen kontaktperson för privatkund utan namn', async () => {
    const sb = makeSupabaseMock({ data: { id: 'new-1' }, error: null });

    await createCrmCustomer(sb as any, {
      customer_type: 'private',
      first_name: null,
      last_name: null,
      assigned_to: 'user-1',
      created_by: 'user-1',
    });

    expect(sb.from).not.toHaveBeenCalledWith('crm_customer_contacts');
  });
});

// ---------------------------------------------------------------------------
// Primärkontakt-invarianten: bara EN per kund.
//
// `is_primary` saknar unikt index och trigger i databasen, och primaryCrmContact gör
// .find() över en oordnad embed. Två primärrader = godtyckligt utfall, och kontakten
// säljaren pekade ut kan tyst förlora mot privatkundens automatiska rad.
// ---------------------------------------------------------------------------

describe('createCrmCustomerContact', () => {
  it('degraderar tidigare primärkontakter innan en ny primär skrivs', async () => {
    const sb = makeSupabaseMock({ data: { id: 'ct-2' }, error: null });

    await createCrmCustomerContact(sb as any, { customer_id: 'c1', name: 'Erik', is_primary: true });

    expect(sb._query.update).toHaveBeenCalledWith({ is_primary: false });
    expect(sb._query.eq).toHaveBeenCalledWith('customer_id', 'c1');
    // Degraderingen måste ske FÖRE insert, annars städar den nya raden bort sig själv.
    const updateOrder = (sb._query.update as any).mock.invocationCallOrder[0];
    const insertOrder = (sb._query.insert as any).mock.invocationCallOrder[0];
    expect(updateOrder).toBeLessThan(insertOrder);
  });

  it('rör inga andra rader när kontakten inte är primär', async () => {
    const sb = makeSupabaseMock({ data: { id: 'ct-2' }, error: null });

    await createCrmCustomerContact(sb as any, { customer_id: 'c1', name: 'Erik', is_primary: false });

    expect(sb._query.update).not.toHaveBeenCalled();
  });
});

describe('updateCrmCustomerContact', () => {
  it('degraderar syskonen men inte raden som görs primär', async () => {
    const sb = makeSupabaseMock({ data: { customer_id: 'c1' }, error: null });

    await updateCrmCustomerContact(sb as any, 'ct-2', { is_primary: true });

    expect(sb._query.update).toHaveBeenCalledWith({ is_primary: false });
    expect(sb._query.neq).toHaveBeenCalledWith('id', 'ct-2');
  });

  it('degraderar ingen när is_primary inte sätts', async () => {
    const sb = makeSupabaseMock({ data: { id: 'ct-2' }, error: null });

    await updateCrmCustomerContact(sb as any, 'ct-2', { phone: '070-1' });

    expect(sb._query.neq).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// privateCustomerContactName — ren funktion
// ---------------------------------------------------------------------------

describe('privateCustomerContactName', () => {
  it('sätter ihop för- och efternamn för privatkund', () => {
    expect(
      privateCustomerContactName({ customer_type: 'private', first_name: 'Anna', last_name: 'Svensson' })
    ).toBe('Anna Svensson');
  });

  it('klarar att bara ett av namnen är ifyllt', () => {
    expect(privateCustomerContactName({ customer_type: 'private', first_name: 'Anna', last_name: null })).toBe('Anna');
    expect(privateCustomerContactName({ customer_type: 'private', first_name: '  ', last_name: 'Svensson' })).toBe('Svensson');
  });

  it('returnerar null för företag — kontaktpersonen heter inte samma sak som bolaget', () => {
    expect(
      privateCustomerContactName({ customer_type: 'business', first_name: 'Anna', last_name: 'Svensson' })
    ).toBeNull();
  });

  it('returnerar null när privatkunden saknar namn', () => {
    expect(privateCustomerContactName({ customer_type: 'private', first_name: '', last_name: '   ' })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Namn-bara-kontakten mot den delade resolveCrmContact-regeln.
//
// Hela poängen med att bara skriva namnet är att telefon och e-post ska fortsätta komma
// från kundkortet. Går den fältvisa fallbacken sönder får ordern en kontaktperson utan
// nummer — och installatören står utan sätt att nå kunden.
// ---------------------------------------------------------------------------

describe('privatkundens automatiska kontakt + resolveCrmContact', () => {
  const card = {
    email: 'anna@example.se',
    phone: '070-123 45 67',
    mobile: null,
    contacts: [{ name: 'Anna Svensson', phone: null, email: null, is_primary: true }],
  };

  it('ger namnet från kontakten och telefon/e-post från kortet', () => {
    expect(resolveCrmContact(card)).toEqual({
      name: 'Anna Svensson',
      email: 'anna@example.se',
      phone: '070-123 45 67',
    });
  });

  it('faller vidare till mobil när kortet saknar fast telefon', () => {
    expect(resolveCrmContact({ ...card, phone: null, mobile: '070-999 88 77' }).phone).toBe('070-999 88 77');
  });

  it('ger samma resultat när raden väljs uttryckligen i en väljare (preferContact)', () => {
    expect(resolveCrmContact(card, card.contacts[0])).toEqual({
      name: 'Anna Svensson',
      email: 'anna@example.se',
      phone: '070-123 45 67',
    });
  });
});

// ---------------------------------------------------------------------------
// getCrmCustomer
// ---------------------------------------------------------------------------

describe('getCrmCustomer', () => {
  it('anropar eq med rätt id', async () => {
    const sb = makeSupabaseMock({ data: { id: 'c1' }, error: null });

    await getCrmCustomer(sb as any, 'c1');

    expect(sb._query.eq).toHaveBeenCalledWith('id', 'c1');
    expect(sb._query.single).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// updateCrmCustomer
// ---------------------------------------------------------------------------

describe('updateCrmCustomer', () => {
  it('anropar update + eq med rätt id och data', async () => {
    const sb = makeSupabaseMock({ data: { id: 'c1', status: 'inactive' }, error: null });

    await updateCrmCustomer(sb as any, 'c1', { status: 'inactive' });

    expect(sb._query.update).toHaveBeenCalledWith({ status: 'inactive' });
    expect(sb._query.eq).toHaveBeenCalledWith('id', 'c1');
  });
});

// ---------------------------------------------------------------------------
// convertProspectToCustomer
// ---------------------------------------------------------------------------

describe('convertProspectToCustomer', () => {
  it('returnerar error när prospekt inte hittas', async () => {
    const sb = makeSupabaseMock({ data: null, error: null });

    const result = await convertProspectToCustomer(sb as any, 'missing-id', 'u1', 'u1');

    expect(result.error).toBe('Prospekt hittades inte');
    expect(result.customerId).toBeNull();
  });

  it('returnerar customerId direkt om stage redan är customer', async () => {
    const sb = makeSupabaseMock({ data: { id: 'c1', customer_stage: 'customer' }, error: null });

    const result = await convertProspectToCustomer(sb as any, 'c1', 'u1', 'u1');

    expect(result.customerId).toBe('c1');
    expect(result.error).toBeNull();
  });

  it('returnerar error vid databasfel i initial läsning', async () => {
    const sb = makeSupabaseMock({ data: null, error: { message: 'db error' } });

    const result = await convertProspectToCustomer(sb as any, 'c1', 'u1', 'u1');

    expect(result.error).toBe('db error');
  });
});

// ---------------------------------------------------------------------------
// setAccountManagerIfUnset
//
// Anropas när en offert vinns, så att offertens ansvariga säljare också blir kundansvarig.
// makeSupabaseMock duger inte här: kedjan använder .is() för is-null-villkoret, och den
// metoden finns inte i hjälparen.
// ---------------------------------------------------------------------------

function makeAccountManagerMock(
  customer: Record<string, unknown> | null,
  updateError: { message: string } | null = null,
  updatedRows: { id: string }[] = [{ id: 'c1' }],
) {
  const captured: { update: Record<string, unknown> | null; isFilter: [string, unknown] | null } = {
    update: null,
    isFilter: null,
  };

  const supabase: any = {
    from: vi.fn(() => {
      const builder: any = {
        select: vi.fn(() => builder),
        eq: vi.fn(() => builder),
        maybeSingle: vi.fn(() => Promise.resolve({ data: customer, error: null })),
        update: vi.fn((payload: Record<string, unknown>) => { captured.update = payload; return builder; }),
        is: vi.fn((column: string, value: unknown) => {
          captured.isFilter = [column, value];
          // .select('id') efter is-filtret: skrivningen räknar rader, eftersom en UPDATE som
          // träffar noll rader svarar error: null och annars ser lyckad ut.
          return { select: vi.fn(() => Promise.resolve({ data: updatedRows, error: updateError })) };
        }),
      };
      return builder;
    }),
  };

  return { supabase, captured };
}

describe('setAccountManagerIfUnset', () => {
  it('sätter kundansvarig när fältet är tomt', async () => {
    const { supabase, captured } = makeAccountManagerMock({ id: 'c1', account_manager_id: null });

    const result = await setAccountManagerIfUnset(supabase, 'c1', 'saljare-1');

    expect(result).toEqual({ changed: true, error: null });
    expect(captured.update).toEqual({ account_manager_id: 'saljare-1' });
  });

  // Kärnregeln: en säljare som vinner EN offert hos någon annans etablerade kund ska inte
  // tyst ta över kundrelationen. Ett medvetet byte görs i kundformuläret.
  it('rör inte en kund som redan har en kundansvarig', async () => {
    const { supabase, captured } = makeAccountManagerMock({ id: 'c1', account_manager_id: 'nagon-annan' });

    const result = await setAccountManagerIfUnset(supabase, 'c1', 'saljare-1');

    expect(result).toEqual({ changed: false, error: null });
    expect(captured.update).toBeNull();
  });

  // is-null-villkoret måste ligga i SKRIVNINGEN och inte bara i läsningen ovan: två offerter
  // som vinns samtidigt på samma kund skulle annars låta den sista skriva över den första.
  it('bär is-null-villkoret i själva uppdateringen', async () => {
    const { supabase, captured } = makeAccountManagerMock({ id: 'c1', account_manager_id: null });

    await setAccountManagerIfUnset(supabase, 'c1', 'saljare-1');

    expect(captured.isFilter).toEqual(['account_manager_id', null]);
  });

  it('rapporterar fel från skrivningen', async () => {
    const { supabase } = makeAccountManagerMock({ id: 'c1', account_manager_id: null }, { message: 'RLS' });

    expect(await setAccountManagerIfUnset(supabase, 'c1', 'saljare-1')).toEqual({ changed: false, error: 'RLS' });
  });

  // En UPDATE som träffar noll rader svarar `error: null` — en RLS-nekad skrivning ser exakt
  // ut som en lyckad. Utan radräkningen rapporteras "satt" fast ingenting skrevs, och
  // anroparens felloggning går aldrig igång. Samma felklass som planeringen tappade segment på.
  it('rapporterar noll skrivna rader som ett fel, inte som en lyckad skrivning', async () => {
    const { supabase } = makeAccountManagerMock({ id: 'c1', account_manager_id: null }, null, []);

    const result = await setAccountManagerIfUnset(supabase, 'c1', 'saljare-1');

    expect(result.changed).toBe(false);
    expect(result.error).toMatch(/noll rader/);
  });

  it('rapporterar när kunden inte finns', async () => {
    const { supabase } = makeAccountManagerMock(null);

    expect(await setAccountManagerIfUnset(supabase, 'saknas', 'saljare-1')).toEqual({
      changed: false,
      error: 'Kunden hittades inte',
    });
  });
});
