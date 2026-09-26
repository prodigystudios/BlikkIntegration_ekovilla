import { describe, it, expect, vi } from 'vitest';

// createCrmQuoteSchema drar in rutt-lagrets sessionsklient via _lib. Testet rör aldrig dem — mockas
// bort så schemat kan importeras utan env-beroenden. Samma uppsättning som tests/crm/quotes.test.ts.
vi.mock('@/lib/domains/crm/customers', () => ({ listCrmSellers: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ getSupabaseAdmin: vi.fn(() => ({})) }));

import {
  draftFromQuote,
  copyDraftFromQuote,
  buildCustomerSnapshot,
  buildRotDetails,
  buildInternalHandoff,
  getEffectiveCustomerName,
  COPY_NAME_PREFIX,
  type QuoteItem,
} from '@/app/crm/offerter/quoteSerializers';
import { createCrmQuoteSchema } from '@/app/api/crm/quotes/_lib';

// En påkostad källoffert: låst av en arbetsorder, synkad till Fortnox, med ROT, egen arbetsadress,
// slutkund, märkning och två rader av olika slag. Alltså precis det som ska följa med — och precis
// det som inte får göra det.
function sourceQuote(overrides: Partial<QuoteItem> = {}): QuoteItem {
  return {
    id: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa',
    quote_number: 'OFF-3F2A1B',
    prospect_id: null,
    customer_id: 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb',
    customer_name: 'Lindbergs Bygg AB',
    quote_type: 'business',
    customer_source: {
      kind: 'fortnox',
      sync_intent: 'linked',
      fortnox_customer_id: '1042',
      fortnox_customer_name: 'Lindbergs Bygg AB',
    },
    customer_snapshot: {
      customer_name: 'Lindbergs Bygg AB',
      company_name: 'Lindbergs Bygg AB',
      organization_number: '556123-4567',
      personal_number: null,
      contact_name: 'Karin Lindberg',
      email: 'karin@lindbergsbygg.se',
      phone: '070-1234567',
      street_address: 'Kontorsgatan 4',
      postal_code: '11122',
      city: 'Stockholm',
      visit_address: 'Kontorsgatan 4',
      delivery_address: 'Skogsvägen 12',
      delivery_postal_code: '19234',
      delivery_city: 'Sollentuna',
      invoice_address: 'Box 40',
      end_contact_name: 'Per Ek',
      end_contact_phone: '070-7654321',
      end_contact_email: 'per@example.se',
      label: 'Projekt 4412',
    },
    pricing_summary: { subtotal: 80000, vat: 20000, total: 100000 },
    line_items: [
      {
        id: 'row-1',
        construction: 'vind',
        m2: '162',
        thickness_mm: '190',
        auto_price: false,
        unit_price: '450',
        pricing_mode: 'm3',
        quantity: '',
        article_id: 'art-1',
        article_name: 'EKOVILLA cellulosa',
        article_number: '10001',
        article_note: 'Lösull',
        article_price: 430,
        article_unit_name: 'm³',
        discount_percent: '5',
        line_note: 'Blås från gavel',
        is_rot_work: true,
        house_work_type: 'CONSTRUCTION',
        labor_cost: '120',
        density: '52',
        include_in_description: false,
      },
      {
        id: 'row-2',
        construction: '',
        m2: '',
        thickness_mm: '',
        auto_price: false,
        // Tomt A-pris men ett artikelpris: normaliseringen ska fylla rutan.
        unit_price: '',
        pricing_mode: 'item',
        quantity: '3',
        article_id: 'art-2',
        article_name: 'Brandmatta',
        article_number: '10099',
        article_note: null,
        article_price: 890,
        article_unit_name: 'st',
        discount_percent: '',
        line_note: '',
        is_rot_work: false,
        house_work_type: 'CONSTRUCTION',
        labor_cost: '',
        density: '',
        include_in_description: true,
      },
    ],
    rot_details: {
      enabled: false,
      applicant_name: null,
      personal_number: null,
      property_designation: 'Sollentuna 2:14',
      rot_percent: 30,
      max_deduction: 50000,
      brf_org_number: null,
    },
    internal_handoff: {
      desired_installation_date: '2026-05-04',
      handoff_notes: 'EKOVILLA\n- Vind: 162 m² × 190 mm @ 52 kg/m³ – 115 säck\nTotalt: 115 säck',
      work_scope: 'Lösull vind',
    },
    project_name: 'Vindsisolering Lindberg',
    description: 'Isolering av vind enligt ritning.',
    amount: 100000,
    currency_code: 'SEK',
    vat_percent: 25,
    valid_until: '2026-05-01',
    // Låst: arbetsorder skapad. Kopieringen ska gå ändå, och ingenting av detta får följa med.
    work_order_id: 'cccccccc-3333-4333-8333-cccccccccccc',
    work_order_number: 'AO-1042',
    converted_to_work_order_at: '2026-04-10T08:00:00Z',
    status: 'won',
    quote_date: '2026-04-01',
    follow_up_date: '2026-04-20',
    notes: 'Kunden vill ha besked före påsk.',
    assigned_to: 'dddddddd-4444-4444-8444-dddddddddddd',
    ...overrides,
  };
}

// Svensk sommartid, halv ett på natten den 16 juni: UTC-dygnet är fortfarande den 15:e.
// Ett kalenderdatum taget ur toISOString() hade alltså daterat kopian till GÅRDAGEN.
const AFTER_MIDNIGHT_CEST = new Date('2026-06-15T22:30:00Z');

describe('draftFromQuote', () => {
  it('fyller formuläret ur offertens snapshot', () => {
    const draft = draftFromQuote(sourceQuote());

    expect(draft.company_name).toBe('Lindbergs Bygg AB');
    expect(draft.organization_number).toBe('556123-4567');
    expect(draft.contact_name).toBe('Karin Lindberg');
    expect(draft.street_address).toBe('Kontorsgatan 4');
    expect(draft.delivery_address).toBe('Skogsvägen 12');
    expect(draft.delivery_city).toBe('Sollentuna');
    expect(draft.end_contact_name).toBe('Per Ek');
    expect(draft.label).toBe('Projekt 4412');
    expect(draft.customer_id).toBe('bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb');
  });

  it('normaliserar A-priset ur artikelpriset när raden saknar eget', () => {
    const draft = draftFromQuote(sourceQuote());

    // Raden hade ett eget A-pris → det vinner över artikelpriset.
    expect(draft.items[0].unit_price).toBe('450');
    // Raden hade inget → artikelpriset fyller rutan, annars står den tom medan priset räknas.
    expect(draft.items[1].unit_price).toBe('890');
  });

  it('en offert utan rader öppnas med en tom startrad', () => {
    const draft = draftFromQuote(sourceQuote({ line_items: [] }));

    expect(draft.items).toHaveLength(1);
    expect(draft.items[0].article_name).toBeNull();
    expect(draft.items[0].id).toBeTruthy();
  });

  it('behåller originalets status, datum och ansvariga säljare', () => {
    const draft = draftFromQuote(sourceQuote());

    expect(draft.status).toBe('won');
    expect(draft.quote_date).toBe('2026-04-01');
    expect(draft.valid_until).toBe('2026-05-01');
    expect(draft.follow_up_date).toBe('2026-04-20');
    expect(draft.assigned_to).toBe('dddddddd-4444-4444-8444-dddddddddddd');
    // En redigering får aldrig skapa en ny uppföljningsuppgift — den skapas bara vid POST.
    expect(draft.create_follow_up_task).toBe(false);
  });
});

describe('copyDraftFromQuote', () => {
  it('kopian är ett utkast, oavsett vad originalet var', () => {
    expect(copyDraftFromQuote(sourceQuote(), AFTER_MIDNIGHT_CEST).status).toBe('draft');
    expect(copyDraftFromQuote(sourceQuote({ status: 'sent' }), AFTER_MIDNIGHT_CEST).status).toBe('draft');
    expect(copyDraftFromQuote(sourceQuote({ status: 'lost' }), AFTER_MIDNIGHT_CEST).status).toBe('draft');
  });

  it('kopian dateras dagens SVENSKA dag, inte UTC-dygnet', () => {
    const copy = copyDraftFromQuote(sourceQuote(), AFTER_MIDNIGHT_CEST);

    // 🧨 Mutationsvakt: `new Date().toISOString().slice(0, 10)` ger '2026-06-15' här.
    expect(copy.quote_date).toBe('2026-06-16');
    expect(copy.quote_date).not.toBe(sourceQuote().quote_date);
  });

  it('giltighetstiden räknas från kopians datum, inte originalets', () => {
    const copy = copyDraftFromQuote(sourceQuote(), AFTER_MIDNIGHT_CEST);

    // 30 dagar från den svenska dagen ovan. Ärvdes originalets valid_until vore kopian redan
    // utgången i samma stund den skapades.
    expect(copy.valid_until).toBe('2026-07-16');
  });

  it('originalets uppföljning följer inte med', () => {
    const copy = copyDraftFromQuote(sourceQuote(), AFTER_MIDNIGHT_CEST);

    expect(copy.follow_up_date).toBe('');
    // Som en ny offert: sätter säljaren ett datum skapas uppgiften automatiskt.
    expect(copy.create_follow_up_task).toBe(true);
  });

  it('önskat installationsdatum följer med när det ligger framåt', () => {
    // Samma jobb, kopierat samma vecka: kundens önskemål gäller fortfarande.
    const copy = copyDraftFromQuote(
      sourceQuote({ internal_handoff: { desired_installation_date: '2026-08-20', handoff_notes: null, work_scope: null } }),
      AFTER_MIDNIGHT_CEST,
    );

    expect(copy.desired_installation_date).toBe('2026-08-20');
  });

  it('ett önskat installationsdatum som redan varit släpps', () => {
    // 🧨 Ett passerat datum går rakt igenom arbetsorderspärren (den varnar bara för TOMT fält)
    // och gör den nya ordern försenad i planeringen i samma stund den skapas.
    const copy = copyDraftFromQuote(
      sourceQuote({ internal_handoff: { desired_installation_date: '2026-05-04', handoff_notes: null, work_scope: null } }),
      AFTER_MIDNIGHT_CEST,
    );

    expect(copy.desired_installation_date).toBe('');
  });

  it('dagens datum räknas som framåt — det har inte passerat', () => {
    const copy = copyDraftFromQuote(
      sourceQuote({ internal_handoff: { desired_installation_date: '2026-06-16', handoff_notes: null, work_scope: null } }),
      AFTER_MIDNIGHT_CEST,
    );

    expect(copy.desired_installation_date).toBe('2026-06-16');
  });

  it('gränsen går vid den SVENSKA dagen, inte vid UTC-dygnet', () => {
    // 🧨 Ögonblicket är 00:30 svensk sommartid den 16:e — UTC säger fortfarande den 15:e. Ett
    // önskemål daterat den 15:e är alltså GÅRDAGENS och ska släppas. Jämförs det mot UTC-dygnet
    // räknas det i stället som "idag" och följer med.
    //
    // Skilt från testet ovan med flit: där svarar båda jämförelserna lika, så det prövar inget.
    // Den här dagen är den enda som skiljer dem åt.
    const copy = copyDraftFromQuote(
      sourceQuote({ internal_handoff: { desired_installation_date: '2026-06-15', handoff_notes: null, work_scope: null } }),
      AFTER_MIDNIGHT_CEST,
    );

    expect(copy.desired_installation_date).toBe('');
  });

  it('ansvarig blir den som kopierar — tom sträng låter servern fylla i', () => {
    const copy = copyDraftFromQuote(sourceQuote(), AFTER_MIDNIGHT_CEST);

    expect(copy.assigned_to).toBe('');
    expect(copy.assigned_to).not.toBe(sourceQuote().assigned_to);
  });

  it('namnet förifylls med "Kopia av" — även på en kopia av en kopia', () => {
    const once = copyDraftFromQuote(sourceQuote(), AFTER_MIDNIGHT_CEST);
    expect(once.project_name).toBe('Kopia av Vindsisolering Lindberg');

    // Två rader i listan ska aldrig kunna se likadana ut, så prefixet läggs på varje gång.
    const twice = copyDraftFromQuote(sourceQuote({ project_name: once.project_name }), AFTER_MIDNIGHT_CEST);
    expect(twice.project_name).toBe(`${COPY_NAME_PREFIX}Kopia av Vindsisolering Lindberg`);
    expect(twice.project_name).not.toBe(once.project_name);
  });

  it('artikelraderna följer med oförändrade — mått, priser, rabatt och ROT-utbrytning', () => {
    const item = sourceQuote();
    const copy = copyDraftFromQuote(item, AFTER_MIDNIGHT_CEST);

    // Byte-exakt mot redigeringens mappning: måttblocket i handoff_notes jämförs rad för rad mot
    // raderna (adoptExistingMeasurementBlock), så glider de isär öppnas kopian med blocket LÅST
    // på inaktuella mått.
    expect(copy.items).toEqual(draftFromQuote(item).items);
    expect(copy.handoff_notes).toBe(item.internal_handoff?.handoff_notes);

    const [row] = copy.items;
    expect(row.m2).toBe('162');
    expect(row.thickness_mm).toBe('190');
    expect(row.density).toBe('52');
    expect(row.discount_percent).toBe('5');
    expect(row.labor_cost).toBe('120');
    expect(row.is_rot_work).toBe(true);
    expect(copy.items[1].include_in_description).toBe(true);
  });

  it('kunduppgifterna ärvs som ORIGINALET bar dem', () => {
    const copy = copyDraftFromQuote(sourceQuote(), AFTER_MIDNIGHT_CEST);
    const asEdited = draftFromQuote(sourceQuote());

    for (const key of [
      'customer_id', 'quote_type', 'customer_name', 'company_name', 'organization_number',
      'contact_name', 'email', 'phone', 'street_address', 'postal_code', 'city',
      'delivery_address', 'delivery_postal_code', 'delivery_city', 'invoice_address',
      'end_contact_name', 'end_contact_phone', 'end_contact_email', 'label',
    ] as const) {
      expect(copy[key]).toBe(asEdited[key]);
    }
  });

  it('kundens Fortnox-koppling följer med', () => {
    const copy = copyDraftFromQuote(sourceQuote(), AFTER_MIDNIGHT_CEST);

    // 🧨 Nollställs den tror kopian att kunden är lokal och lägger upp en DUBBLETT i Fortnox när
    // arbetsordern skapas. Kopplingen är kundens, inte offertens.
    expect(copy.customer_source.kind).toBe('fortnox');
    expect(copy.customer_source.fortnox_customer_id).toBe('1042');
    expect(copy.customer_source.sync_intent).toBe('linked');
  });

  it('varken offertnummer, Fortnox-nummer eller arbetsorder följer med', () => {
    const copy = copyDraftFromQuote(sourceQuote(), AFTER_MIDNIGHT_CEST);

    // Draften har inga sådana fält att bära — vakten finns för att ett framtida tillägg i
    // QuoteDraft inte tyst ska kunna släpa med originalets identitet in i kopian.
    const leaked = Object.keys(copy).filter((key) => /quote_number|fortnox_offer|work_order|converted_to/.test(key));
    expect(leaked).toEqual([]);
    expect(JSON.stringify(copy)).not.toContain('AO-1042');
    expect(JSON.stringify(copy)).not.toContain('OFF-3F2A1B');
  });

  it('kopian godkänns av skapa-schemat som en ny offert', () => {
    const copy = copyDraftFromQuote(sourceQuote(), AFTER_MIDNIGHT_CEST);

    // Samma nyttolast som formulärets buildQuotePayload skickar till POST /api/crm/quotes.
    const payload = {
      prospect_id: copy.prospect_id || null,
      customer_id: copy.customer_id || null,
      customer_name: getEffectiveCustomerName(copy),
      quote_type: copy.quote_type,
      customer_source: {
        kind: copy.customer_source.kind,
        sync_intent: copy.customer_source.sync_intent,
        fortnox_customer_id: copy.customer_source.fortnox_customer_id || null,
        fortnox_customer_name: copy.customer_source.fortnox_customer_name || null,
      },
      customer_snapshot: buildCustomerSnapshot(copy, { reverseVat: false }),
      pricing_summary: { subtotal: 80000, vat: 20000, total: 100000 },
      line_items: copy.items,
      rot_details: buildRotDetails(copy),
      internal_handoff: buildInternalHandoff(copy),
      project_name: copy.project_name,
      description: copy.description,
      amount: 100000,
      vat_percent: 25,
      valid_until: copy.valid_until || null,
      status: copy.status,
      quote_date: copy.quote_date,
      follow_up_date: copy.follow_up_date || null,
      notes: copy.notes,
    };

    const parsed = createCrmQuoteSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    expect(parsed.data.status).toBe('draft');
    expect(parsed.data.quote_date).toBe('2026-06-16');
    expect(parsed.data.project_name).toBe('Kopia av Vindsisolering Lindberg');
    // Ansvarig skickas inte med → servern sätter den som skapar offerten.
    expect(parsed.data.assigned_to).toBeUndefined();
    // Raderna når fram hela: ett fält utanför schemat strippas TYST av Zod.
    expect(parsed.data.line_items).toHaveLength(2);
    expect(parsed.data.line_items[0].labor_cost).toBe('120');
    expect(parsed.data.line_items[0].density).toBe('52');
    expect(parsed.data.line_items[1].include_in_description).toBe(true);
    expect(parsed.data.customer_snapshot.label).toBe('Projekt 4412');
    expect(parsed.data.customer_snapshot.delivery_address).toBe('Skogsvägen 12');
  });
});
