import { describe, it, expect, vi } from 'vitest';
import { createCrmWorkOrderFromQuote } from '@/lib/domains/crm/work-orders';

// Återlänkningen (steg 3 nedan) körs med elevated klient, inte sessionsklienten — se
// kommentaren i work-orders.ts. vi.hoisted: mock-fabriken körs före modulens toppnivå, så
// hållaren måste finnas innan dess.
const elevated = vi.hoisted(() => ({ client: null as any }));
vi.mock('@/lib/supabase/server', () => ({ getSupabaseAdmin: () => elevated.client }));

// ---------------------------------------------------------------------------
// Supabase-mock
//
// createCrmWorkOrderFromQuote gör tre anrop i tur och ordning:
//   1. crm_quotes   .select().eq().single()           → hämtar offerten      (session)
//   2. crm_work_orders .insert(payload).select().single() → skapar ordern    (session)
//   3. crm_quotes   .update().eq().select().single()   → länkar tillbaka     (elevated)
// Mocken är en chainable builder per .from(table); .single() löser olika
// beroende på tabell + operation. insert-payloaden fångas så vi kan asserta
// fält-mappningen.
//
// De två klienterna är SKILDA fakes och `quoteUpdateVia` noterar vilken som fick
// återlänkningen. Går den på sessionsklienten stoppas den av offertens ägarscopade
// UPDATE-policy så fort en annan säljare än offertens skapar ordern — då finns ordern men
// offerten är olänkad, och nästa försök smäller på unikhetsindexet på quote_id.
// ---------------------------------------------------------------------------

function makeSupabase(
  quote: Record<string, unknown>,
  customer: Record<string, unknown> | null = COMPLETE_CUSTOMER,
  customerError: { message: string } | null = null,
) {
  const customerRead = { data: customerError ? null : customer, error: customerError };
  const captured: {
    insert: Record<string, any> | null;
    quoteUpdateVia: 'session' | 'elevated' | null;
  } = { insert: null, quoteUpdateVia: null };

  function makeClient(via: 'session' | 'elevated') {
    return {
      from(table: string) {
        const state: { op: 'select' | 'insert' | 'update' } = { op: 'select' };
        const builder: any = {
          select: vi.fn(() => builder),
          eq: vi.fn(() => builder),
          update: vi.fn(() => {
            state.op = 'update';
            if (table === 'crm_quotes') captured.quoteUpdateVia = via;
            return builder;
          }),
          insert: vi.fn((payload: Record<string, any>) => { state.op = 'insert'; captured.insert = payload; return builder; }),
          // Fullständighetskontrollen läser om kundkortet (adress, telefon, org.nr och
          // personnummer går inte att redigera i offertformuläret) — se workOrderReadiness.ts.
          maybeSingle: vi.fn(() => {
            if (table === 'crm_customers') return Promise.resolve(customerRead);
            return Promise.resolve({ data: null, error: null });
          }),
          single: vi.fn(() => {
            if (table === 'crm_quotes' && state.op === 'select') return Promise.resolve({ data: quote, error: null });
            if (table === 'crm_work_orders' && state.op === 'insert') return Promise.resolve({ data: { id: 'wo1', order_number: 'AO-TEST' }, error: null });
            if (table === 'crm_quotes' && state.op === 'update') return Promise.resolve({ data: { id: quote.id }, error: null });
            return Promise.resolve({ data: null, error: { message: `oväntat anrop: ${table}/${state.op}` } });
          }),
        };
        return builder;
      },
    };
  }

  const supabase = makeClient('session');
  elevated.client = makeClient('elevated');

  return { supabase, captured };
}

describe('createCrmWorkOrderFromQuote — återlänkningen till offerten', () => {
  // Regressionsvakt för en tyst partiell skrivning. Ordern ärver offertens säljare
  // (assigned_to), och sedan RLS öppnades för att vilken säljare som helst ska kunna skapa
  // ordern på en vunnen offert är sessionsklienten inte längre garanterad skrivrätt på just
  // den offerten. Flyttas den här skrivningen tillbaka till sessionsklienten skapas ordern
  // men länkas aldrig — offerten ser okonverterad ut och nästa försök smäller på
  // unikhetsindexet på quote_id.
  it('skriver work_order_id med elevated klient, inte sessionsklienten', async () => {
    const { supabase, captured } = makeSupabase(wonQuote({ assigned_to: 'annan-saljare' }));

    const result = await createCrmWorkOrderFromQuote(supabase as any, 'q1', 'user-1');

    expect(result.error).toBeNull();
    expect(captured.quoteUpdateVia).toBe('elevated');
  });

  // Kedjan offert → order → Fortnox "Vår referens" → topplistan ska peka på samma person.
  // Ordern får INTE hamna på den som råkade trycka på knappen.
  it('lägger ordern på offertens säljare, inte på den som skapar den', async () => {
    const { supabase, captured } = makeSupabase(wonQuote({ assigned_to: 'annan-saljare' }));

    await createCrmWorkOrderFromQuote(supabase as any, 'q1', 'user-1');

    expect(captured.insert!.assigned_to).toBe('annan-saljare');
    expect(captured.insert!.created_by).toBe('user-1');
  });
});

// Kundkortet som fullständighetskontrollen faller tillbaka på. Håll det komplett — testerna nedan
// tar bort EN uppgift i taget, så det som spärrar i ett test är det testet handlar om.
const COMPLETE_CUSTOMER = {
  organization_number: '556677-8899',
  personal_number: null,
  email: 'info@testab.se',
  phone: '08-111 22 33',
  mobile: null,
  visit_address: { street: 'Storgatan 1', postal_code: '12345', city: 'Stockholm' },
  contacts: [],
};

const MEASUREMENT_BLOCK = 'EKOVILLA\nVägg – 100 m² × 195 mm @ 52 kg/m³ – 73 säck\n\nTotalt: 73 säck';

function wonQuote(overrides: Record<string, unknown> = {}) {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    prospect_id: null,
    customer_id: '22222222-2222-2222-2222-222222222222',
    customer_name: 'Test AB',
    quote_type: 'business',
    customer_snapshot: {
      company_name: 'Test AB',
      organization_number: '556677-8899',
      contact_name: 'Kalle Kund',
      phone: '08-111 22 33',
      street_address: 'Storgatan 1',
      postal_code: '12345',
      city: 'Stockholm',
    },
    pricing_summary: {},
    line_items: [],
    rot_details: {},
    internal_handoff: { handoff_notes: MEASUREMENT_BLOCK, work_scope: null, desired_installation_date: null },
    project_name: 'Takisolering',
    description: null,
    amount: 45000,
    currency_code: 'SEK',
    vat_percent: 25,
    status: 'won',
    notes: null,
    created_by: 'user-1',
    assigned_to: 'user-1',
    work_order_id: null,
    work_order_number: null,
    ...overrides,
  };
}

describe('createCrmWorkOrderFromQuote — fält-mappning', () => {
  // Regression: måttblocket (internal_handoff.handoff_notes) får INTE läcka in i orderns
  // notes-kolumn. Annars dubbleras det i både "Överlämningsnotering" och "Interna
  // anteckningar" i ordervyn.
  it('kopierar handoff_notes till internal_handoff men ALDRIG till notes', async () => {
    const { supabase, captured } = makeSupabase(wonQuote());

    const result = await createCrmWorkOrderFromQuote(supabase as any, 'q1', 'user-1');

    expect(result.error).toBeNull();
    expect(captured.insert).not.toBeNull();
    // handoff_notes bevaras i internal_handoff (visas som "Överlämningsnotering")
    expect(captured.insert!.internal_handoff.handoff_notes).toBe(MEASUREMENT_BLOCK);
    // notes ("Interna anteckningar") får inte vara måttblocket
    expect(captured.insert!.notes).not.toBe(MEASUREMENT_BLOCK);
    expect(captured.insert!.notes).toBeNull();
  });

  it('blockerar privatorder utan personnummer (varken snapshot eller kund)', async () => {
    const { supabase, captured } = makeSupabase(
      wonQuote({ quote_type: 'private', customer_snapshot: {
        customer_name: 'Anna',
        contact_name: 'Anna Andersson',
        phone: '070-123 45 67',
        street_address: 'Storgatan 1',
        postal_code: '12345',
        city: 'Stockholm',
      } }),
      { ...COMPLETE_CUSTOMER, personal_number: null },
    );
    const result = await createCrmWorkOrderFromQuote(supabase as any, 'q1', 'user-1');
    expect(result.reason).toBe('incomplete');
    expect(result.error?.message).toContain('Personnummer');
    expect(result.data).toBeNull();
    // Ordern får inte ha hunnit skapas — routen auto-pushar den till Fortnox.
    expect(captured.insert).toBeNull();
  });

  it('tillåter privatorder när snapshot har personnummer, och bevarar det på ordern', async () => {
    const { supabase, captured } = makeSupabase(
      wonQuote({ quote_type: 'private', customer_snapshot: { ...{
        customer_name: 'Anna',
        contact_name: 'Anna Andersson',
        phone: '070-123 45 67',
        street_address: 'Storgatan 1',
        postal_code: '12345',
        city: 'Stockholm',
      }, personal_number: '19850101-1236' } }),
    );
    const result = await createCrmWorkOrderFromQuote(supabase as any, 'q1', 'user-1');
    expect(result.error).toBeNull();
    expect(captured.insert!.customer_snapshot.personal_number).toBe('19850101-1236');
  });

  // V3: ROT-avdraget kan inte begäras utan att fastigheten är identifierad, och Fortnox har inget
  // API-fält för beteckningen — den skrivs för hand i husarbete-dialogen utifrån textraden vi
  // skickar. Kravet ligger därför på ORDERN (kundgodkänd), inte på offerten. Routen auto-pushar
  // till Fortnox i samma andetag som ordern skapas, så det här är sista stället en människa hinner
  // stoppas.
  const rotQuote = (rot: Record<string, unknown>) =>
    wonQuote({
      quote_type: 'private',
      customer_snapshot: { ...{
        customer_name: 'Anna',
        contact_name: 'Anna Andersson',
        phone: '070-123 45 67',
        street_address: 'Storgatan 1',
        postal_code: '12345',
        city: 'Stockholm',
      }, personal_number: '19850101-1236' },
      rot_details: { enabled: true, personal_number: '19850101-1236', ...rot },
    });

  it('blockerar ROT-order utan fastighetsbeteckning och BRF org.nr', async () => {
    const { supabase, captured } = makeSupabase(rotQuote({ property_designation: null, brf_org_number: null }));
    const result = await createCrmWorkOrderFromQuote(supabase as any, 'q1', 'user-1');
    expect(result.reason).toBe('incomplete');
    expect(result.error?.message).toContain('Fastighetsbeteckning');
    expect(result.data).toBeNull();
    // Ordern får inte ha hunnit skapas — annars auto-pushas den till Fortnox.
    expect(captured.insert).toBeNull();
  });

  it('blockerar när beteckningen bara är blanksteg', async () => {
    const { supabase } = makeSupabase(rotQuote({ property_designation: '   ' }));
    const result = await createCrmWorkOrderFromQuote(supabase as any, 'q1', 'user-1');
    expect(result.reason).toBe('incomplete');
    expect(result.error?.message).toContain('Fastighetsbeteckning');
  });

  it('släpper igenom ROT-order med fastighetsbeteckning', async () => {
    const { supabase, captured } = makeSupabase(rotQuote({ property_designation: 'Gläntan 1:14' }));
    const result = await createCrmWorkOrderFromQuote(supabase as any, 'q1', 'user-1');
    expect(result.error).toBeNull();
    expect(captured.insert!.rot_details.property_designation).toBe('Gläntan 1:14');
  });

  // Bostadsrätt: fastigheten identifieras med föreningens org.nr i stället, så BRF-numret räcker.
  it('släpper igenom ROT-order med bara BRF org.nr', async () => {
    const { supabase } = makeSupabase(rotQuote({ property_designation: null, brf_org_number: '769606-1234' }));
    const result = await createCrmWorkOrderFromQuote(supabase as any, 'q1', 'user-1');
    expect(result.error).toBeNull();
    expect(result.reason).toBeNull();
  });

  // Grinden gäller bara ROT. En vanlig order (eller en offert där ROT slagits av) rörs inte.
  it('kräver ingen beteckning när ROT är av', async () => {
    const { supabase } = makeSupabase(wonQuote({ rot_details: { enabled: false, property_designation: null } }));
    const result = await createCrmWorkOrderFromQuote(supabase as any, 'q1', 'user-1');
    expect(result.error).toBeNull();
  });

  it('kräver ingen beteckning för äldre offerter utan rot_details', async () => {
    const { supabase } = makeSupabase(wonQuote({ rot_details: null }));
    const result = await createCrmWorkOrderFromQuote(supabase as any, 'q1', 'user-1');
    expect(result.error).toBeNull();
  });

  it('seedar notes från offertens egna notes när de finns', async () => {
    const { supabase, captured } = makeSupabase(wonQuote({ notes: 'Internt orderunderlag' }));

    await createCrmWorkOrderFromQuote(supabase as any, 'q1', 'user-1');

    expect(captured.insert!.notes).toBe('Internt orderunderlag');
    expect(captured.insert!.internal_handoff.handoff_notes).toBe(MEASUREMENT_BLOCK);
  });

  it('faller tillbaka på description när notes saknas', async () => {
    const { supabase, captured } = makeSupabase(wonQuote({ notes: null, description: 'Offertbeskrivning' }));

    await createCrmWorkOrderFromQuote(supabase as any, 'q1', 'user-1');

    expect(captured.insert!.notes).toBe('Offertbeskrivning');
  });
});

// "Er referens" och kundkontakten delade tidigare fält (customer_snapshot.contact_name). Det
// betydde att en säljare som rättade kontaktpersonen på ordern samtidigt skrev om kundens
// formella referens — den som styr fakturan till rätt attestant hos kunden. Från och med
// orderskapandet är de två skilda: your_reference går till Fortnox, contact_name gör det inte.
describe('createCrmWorkOrderFromQuote — Er referens fryses vid orderskapandet', () => {
  it('seedar your_reference från offertens contact_name', async () => {
    const { supabase, captured } = makeSupabase(wonQuote({
      customer_snapshot: { customer_name: 'Bygg AB', contact_name: 'Emil' },
    }));

    const result = await createCrmWorkOrderFromQuote(supabase as any, 'q1', 'user-1');

    expect(result.error).toBeNull();
    expect(captured.insert!.customer_snapshot.your_reference).toBe('Emil');
    // Kundkontakten finns kvar som egen uppgift — de börjar som samma person.
    expect(captured.insert!.customer_snapshot.contact_name).toBe('Emil');
  });

  it('skriver inte över en your_reference som offerten redan bär', async () => {
    const { supabase, captured } = makeSupabase(wonQuote({
      customer_snapshot: { customer_name: 'Bygg AB', contact_name: 'Emil', your_reference: 'Inköp/Anna' },
    }));

    await createCrmWorkOrderFromQuote(supabase as any, 'q1', 'user-1');

    expect(captured.insert!.customer_snapshot.your_reference).toBe('Inköp/Anna');
  });

  it('sätter your_reference till null när offerten saknar kontaktperson', async () => {
    const { supabase, captured } = makeSupabase(wonQuote({
      customer_snapshot: { customer_name: 'Bygg AB' },
    }));

    await createCrmWorkOrderFromQuote(supabase as any, 'q1', 'user-1');

    expect(captured.insert!.customer_snapshot.your_reference).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Tidraden på arbetsordern
// ---------------------------------------------------------------------------
// Fliken skriver i crm_time_entries — samma tabell som löneunderlaget. Raden byggs av
// buildTimeEntryRow, och domänen ansvarar för att en ändring inte kan flytta den någonstans.

import { updateCrmWorkOrderTimeEntry } from '@/lib/domains/crm/work-orders';
import { makeSupabaseMock } from './helpers/supabase';

describe('updateCrmWorkOrderTimeEntry', () => {
  // Raden byggs med ordern ur URL:en. Gick den vidare till patchen kunde en PATCH mot en ANNAN
  // orders adress flytta någons tidrad dit — och timmarna hade följt med till fel jobb.
  it('skalar bort work_order_id, user_id och time_code_id ur patchen', async () => {
    const supabase = makeSupabaseMock({ data: { id: 'e1' }, error: null });
    await updateCrmWorkOrderTimeEntry(supabase as any, 'e1', 'anna', {
      user_id: 'någon-annan',
      work_order_id: 'en-annan-order',
      // buildTimeEntryRow sätter ALLTID time_code_id, och kontorsfliken har ingen väljare — den
      // skickar alltså null. En rad som skapats i /tid med en tidkod syns i fliken, så en ändrad
      // anteckning hade tyst raderat radens lönesort.
      time_code_id: null,
      work_date: '2026-08-14',
      start_time: '08:00',
      end_time: '18:00',
      break_minutes: 60,
      minutes_worked: 540,
      note: null,
    });

    const patch = (supabase._query.update as any).mock.calls[0][0];
    expect(patch).not.toHaveProperty('work_order_id');
    expect(patch).not.toHaveProperty('user_id');
    expect(patch).not.toHaveProperty('time_code_id');
    expect(patch.minutes_worked).toBe(540);
    expect(patch.start_time).toBe('08:00');
  });

  it('skopar alltid på raden och ägaren', async () => {
    const supabase = makeSupabaseMock({ data: { id: 'e1' }, error: null });
    await updateCrmWorkOrderTimeEntry(supabase as any, 'e1', 'anna', { work_date: '2026-08-14' });
    expect((supabase._query.eq as any).mock.calls).toEqual([['id', 'e1'], ['user_id', 'anna']]);
  });
});

// ---------------------------------------------------------------------------
// listCrmWorkOrdersWithFilters — radordningen
//
// Ordningen måste väljas på servern. Sidtaket (CRM_WORK_ORDERS_PAGE_SIZE) kapar raderna innan
// webbläsaren ser dem, så en klientsortering ordnar bara det som råkade överleva kapningen. Med
// standardsorteringen ligger en nyskapad order SIST i tabellen — installationsdatumet ligger i
// framtiden — så en klientsorterad "senaste ordrar"-lista hade tyst visat de äldsta jobben så
// fort bolaget passerar taket. Testet vaktar att de två sorteringarna inte glider ihop igen.
// ---------------------------------------------------------------------------

import { listCrmWorkOrdersWithFilters } from '@/lib/domains/crm/work-orders';

describe('listCrmWorkOrdersWithFilters — radordningen', () => {
  it('sorterar som arbetskö som standard: tidigast installationsdatum först', async () => {
    const supabase = makeSupabaseMock({ data: [], error: null });
    await listCrmWorkOrdersWithFilters(supabase as any, {});
    expect((supabase._query.order as any).mock.calls).toEqual([
      ['desired_installation_date', { ascending: true, nullsFirst: false }],
      ['created_at', { ascending: false }],
    ]);
  });

  it('sort=created_desc sorterar nyast först och rör inte installationsdatumet', async () => {
    const supabase = makeSupabaseMock({ data: [], error: null });
    await listCrmWorkOrdersWithFilters(supabase as any, { sort: 'created_desc' });
    expect((supabase._query.order as any).mock.calls).toEqual([['created_at', { ascending: false }]]);
  });
});

// ---------------------------------------------------------------------------
// Fullständighetskontrollen, sedd genom skapandet. Fält för fält prövas den i
// workOrderReadiness.test.ts — här gäller det kopplingen: att inget skrivs när något saknas, och
// att de värden kontrollen godkände är exakt de ordern sedan bär. Skiljer de sig åt har spärren
// prövat en uppgift ordern inte har.
// ---------------------------------------------------------------------------
describe('createCrmWorkOrderFromQuote — fullständighetskontrollen', () => {
  it('blockerar okopplad offert — utan kund kan ordern aldrig nå Fortnox', async () => {
    const { supabase, captured } = makeSupabase(wonQuote({ customer_id: null }), null);
    const result = await createCrmWorkOrderFromQuote(supabase as any, 'q1', 'user-1');
    expect(result.reason).toBe('incomplete');
    expect(result.error?.message).toContain('kundregistret');
    expect(captured.insert).toBeNull();
  });

  it('blockerar när arbetsadressen saknas både på offerten och på kundkortet', async () => {
    const { supabase, captured } = makeSupabase(
      wonQuote({ customer_snapshot: { company_name: 'Test AB', organization_number: '556677-8899', contact_name: 'Kalle', phone: '08-111 22 33' } }),
      { ...COMPLETE_CUSTOMER, visit_address: null },
    );
    const result = await createCrmWorkOrderFromQuote(supabase as any, 'q1', 'user-1');
    expect(result.reason).toBe('incomplete');
    expect(result.error?.message).toContain('Arbetsadressen');
    expect(captured.insert).toBeNull();
  });

  // Regression: läsfelet på kundkortet svaldes en gång, och då gick det inte att skilja från
  // "kunden har inga uppgifter" — kontrollen hittade på spärrar för adress, telefon och org.nr och
  // bad säljaren fylla i fält som redan var ifyllda.
  it('avbryter i stället för att hitta på spärrar när kundkortet inte gick att läsa', async () => {
    const { supabase, captured } = makeSupabase(wonQuote(), null, { message: 'timeout' });
    const result = await createCrmWorkOrderFromQuote(supabase as any, 'q1', 'user-1');
    expect(result.reason).toBe('customer_fetch_failed');
    expect(result.error?.message).toBe('timeout');
    expect(captured.insert).toBeNull();
  });

  it('blockerar företagsorder utan org.nr på både offert och kundkort', async () => {
    const { supabase } = makeSupabase(
      wonQuote({ customer_snapshot: { company_name: 'Test AB', contact_name: 'Kalle', phone: '08-111 22 33', street_address: 'Storgatan 1', postal_code: '12345', city: 'Stockholm' } }),
      { ...COMPLETE_CUSTOMER, organization_number: null },
    );
    const result = await createCrmWorkOrderFromQuote(supabase as any, 'q1', 'user-1');
    expect(result.reason).toBe('incomplete');
    expect(result.error?.message).toContain('Organisationsnummer');
  });

  // Kärnan i varför kundkortet läses om: adress, telefon och org.nr går inte att redigera i
  // offertformuläret. Säljaren fyller i dem på kundkortet — och då måste ordern bära dem, annars
  // hade spärren godkänt uppgifter som aldrig nådde installatörerna eller Fortnox.
  it('bakar in kundkortets telefon, org.nr och adress i ordern när offertens snapshot är tom', async () => {
    const { supabase, captured } = makeSupabase(
      wonQuote({ customer_snapshot: { company_name: 'Test AB', contact_name: 'Kalle Kund' } }),
      COMPLETE_CUSTOMER,
    );
    const result = await createCrmWorkOrderFromQuote(supabase as any, 'q1', 'user-1');

    expect(result.error).toBeNull();
    expect(captured.insert!.customer_snapshot.phone).toBe('08-111 22 33');
    expect(captured.insert!.customer_snapshot.organization_number).toBe('556677-8899');
    expect(captured.insert!.work_address).toMatchObject({
      street_address: 'Storgatan 1',
      postal_code: '12345',
      city: 'Stockholm',
    });
  });

  // Regression: offertens egna värden är ett medvetet val för just den affären och får aldrig
  // skrivas över av kundkortet — bara fylla luckor.
  //
  // ⚠️ SMALNAD 2026-08-25: gäller de fält offerten faktiskt kan ändra. KUNDADRESSEN kan den inte —
  // `street_address`/`postal_code`/`city` sätts från kortet och renderas aldrig som fält i
  // formuläret — så där är snapshoten en ren kopia och kortet vinner. Utan den skillnaden gick det
  // inte att ta sig förbi adress-spärren: säljaren rättade adressen på kundkortet och fälldes ändå.
  // En separat ARBETSadress (`delivery_address`) är fortfarande offertens val och står emot kortet.
  it('offertens snapshot vinner över kundkortet — utom för kundadressen', async () => {
    const { supabase, captured } = makeSupabase(
      wonQuote({
        customer_snapshot: {
          company_name: 'Test AB',
          organization_number: '556677-8899',
          contact_name: 'Kalle Kund',
          phone: '070-000 11 22',
          street_address: 'Byggvägen 9',
          postal_code: '43210',
          city: 'Göteborg',
        },
      }),
      COMPLETE_CUSTOMER,
    );
    await createCrmWorkOrderFromQuote(supabase as any, 'q1', 'user-1');

    expect(captured.insert!.customer_snapshot.phone).toBe('070-000 11 22');
    // Kundadressen: kortets, inte snapshotens Göteborg.
    expect(captured.insert!.work_address).toMatchObject({
      street_address: 'Storgatan 1',
      postal_code: '12345',
      city: 'Stockholm',
    });
  });

  it('en separat arbetsadress på offerten står emot kundkortet', async () => {
    const { supabase, captured } = makeSupabase(
      wonQuote({
        customer_snapshot: {
          company_name: 'Test AB',
          organization_number: '556677-8899',
          contact_name: 'Kalle Kund',
          phone: '070-000 11 22',
          street_address: 'Byggvägen 9',
          postal_code: '43210',
          city: 'Göteborg',
          delivery_address: 'Industrivägen 4',
          delivery_postal_code: '54321',
          delivery_city: 'Malmö',
        },
      }),
      COMPLETE_CUSTOMER,
    );
    await createCrmWorkOrderFromQuote(supabase as any, 'q1', 'user-1');

    expect(captured.insert!.work_address).toMatchObject({
      street_address: 'Industrivägen 4',
      postal_code: '54321',
      city: 'Malmö',
    });
  });

  // Varningarna är Williams val 2026-08-19: en offert utan rader, datum eller arbetsbeskrivning
  // ska gå att göra order av — de syns i checklistan, de stoppar inte.
  it('släpper igenom en offert utan rader, installationsdatum och arbetsbeskrivning', async () => {
    const { supabase, captured } = makeSupabase(
      wonQuote({ line_items: [], internal_handoff: { handoff_notes: null, work_scope: null, desired_installation_date: null } }),
    );
    const result = await createCrmWorkOrderFromQuote(supabase as any, 'q1', 'user-1');
    expect(result.error).toBeNull();
    expect(captured.insert).not.toBeNull();
  });
});
