import { describe, it, expect, vi } from 'vitest';
import { createCrmWorkOrderFromQuote } from '@/lib/domains/crm/work-orders';

// ---------------------------------------------------------------------------
// Supabase-mock
//
// createCrmWorkOrderFromQuote gör tre anrop i tur och ordning:
//   1. crm_quotes   .select().eq().single()           → hämtar offerten
//   2. crm_work_orders .insert(payload).select().single() → skapar ordern
//   3. crm_quotes   .update().eq().select().single()   → länkar tillbaka
// Mocken är en chainable builder per .from(table); .single() löser olika
// beroende på tabell + operation. insert-payloaden fångas så vi kan asserta
// fält-mappningen.
// ---------------------------------------------------------------------------

function makeSupabase(quote: Record<string, unknown>) {
  const captured: { insert: Record<string, any> | null } = { insert: null };

  const supabase = {
    from(table: string) {
      const state: { op: 'select' | 'insert' | 'update' } = { op: 'select' };
      const builder: any = {
        select: vi.fn(() => builder),
        eq: vi.fn(() => builder),
        update: vi.fn(() => { state.op = 'update'; return builder; }),
        insert: vi.fn((payload: Record<string, any>) => { state.op = 'insert'; captured.insert = payload; return builder; }),
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

  return { supabase, captured };
}

const MEASUREMENT_BLOCK = 'EKOVILLA\nVägg – 100 m² × 195 mm @ 52 kg/m³ – 73 säck\n\nTotalt: 73 säck';

function wonQuote(overrides: Record<string, unknown> = {}) {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    prospect_id: null,
    customer_id: null,
    customer_name: 'Test AB',
    quote_type: 'business',
    customer_snapshot: { company_name: 'Test AB' },
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
    const { supabase } = makeSupabase(wonQuote({ quote_type: 'private', customer_id: null, customer_snapshot: { customer_name: 'Anna' } }));
    const result = await createCrmWorkOrderFromQuote(supabase as any, 'q1', 'user-1');
    expect(result.reason).toBe('missing_personal_number');
    expect(result.data).toBeNull();
  });

  it('tillåter privatorder när snapshot har personnummer, och bevarar det på ordern', async () => {
    const { supabase, captured } = makeSupabase(
      wonQuote({ quote_type: 'private', customer_id: null, customer_snapshot: { customer_name: 'Anna', personal_number: '19850101-1236' } }),
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
      customer_id: null,
      customer_snapshot: { customer_name: 'Anna', personal_number: '19850101-1236' },
      rot_details: { enabled: true, personal_number: '19850101-1236', ...rot },
    });

  it('blockerar ROT-order utan fastighetsbeteckning och BRF org.nr', async () => {
    const { supabase, captured } = makeSupabase(rotQuote({ property_designation: null, brf_org_number: null }));
    const result = await createCrmWorkOrderFromQuote(supabase as any, 'q1', 'user-1');
    expect(result.reason).toBe('missing_rot_property');
    expect(result.data).toBeNull();
    // Ordern får inte ha hunnit skapas — annars auto-pushas den till Fortnox.
    expect(captured.insert).toBeNull();
  });

  it('blockerar när beteckningen bara är blanksteg', async () => {
    const { supabase } = makeSupabase(rotQuote({ property_designation: '   ' }));
    const result = await createCrmWorkOrderFromQuote(supabase as any, 'q1', 'user-1');
    expect(result.reason).toBe('missing_rot_property');
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
