import { describe, it, expect } from 'vitest';
import {
  buildPortalJobCustomerSnapshot,
  buildPortalWorkOrderInsert,
  mapPortalJobLines,
  portalFortnoxBlockerReasons,
  portalJobHandoffNotes,
  portalJobProjectName,
  workOrderLinesNeedDensity,
  portalJobSchema,
  type JobCustomerCard,
  type PortalJob,
  type RegisterArticleForJob,
} from '@/lib/domains/portal/jobIntake';
import { buildOrderRows, buildOrderDeliveryFields, orderReferenceNumberField } from '@/lib/domains/fortnox/orders';
import { buildOrderProjectNote, resolveRotReference } from '@/lib/domains/fortnox/helpers';
import { evaluateWorkOrderReadiness } from '@/lib/domains/crm/workOrderReadiness';
import { hasMeasurementBlock } from '@/lib/domains/crm/measurementBlock';
import { lineItemRowTotal } from '@/lib/domains/crm/pricing';
import { CONTRACT_JOB } from './helpers/contractFixtures';

/**
 * Jobbet från portalen blir en arbetsorder (fas 3b). Det som skyddas:
 *   - kontraktets kropp tas emot, och det som inte följer kontraktet nekas med sökvägen till fältet;
 *   - priset är unitCost, mängden är portalens (lösull = yta × tjocklek), ingen rabatt, ingen ROT, ingen densitet;
 *   - namn och enhet ur artikelregistret när artikeln finns där (säckberäkningen, Fortnox enhetskod);
 *   - Fortnox får offertnumret som "Ert referensnummer", arbetsplatsen som leveransadress och priserna rakt av;
 *   - samma fullständighetskontroll som våra egna ordrar prövar arbetsplatsen, inte butikens adress;
 *   - utan kundkort skrivs ingen moms i snapshoten (den hade vunnit över kortet för alltid).
 */

const job = (): PortalJob => portalJobSchema.parse(structuredClone(CONTRACT_JOB));

const REGISTER = new Map<string, RegisterArticleForJob>([
  [
    '2410509',
    {
      article_number: '2410509',
      description: 'Ekovilla Cellulosa Lösull CE ETA-09/0081',
      unit: 'M3',
      note: 'Blåses med maskin 2',
      include_in_work_description: false,
    },
  ],
  ['1010', { article_number: '1010', description: 'Etablering', unit: 'st', include_in_work_description: true }],
]);

let seq = 0;
const newId = () => `rad-${++seq}`;

const CARD: JobCustomerCard = {
  id: '11111111-1111-4111-8111-111111111111',
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

function insert(customer: JobCustomerCard | null = CARD, register = REGISTER) {
  return buildPortalWorkOrderInsert({
    job: job(),
    customer,
    register,
    workOrderId: '22222222-2222-4222-8222-222222222222',
    orderNumber: 'AO-20260928-222222',
    assigneeId: '33333333-3333-4333-8333-333333333333',
    newId,
  });
}

describe('schemat: kontraktets kropp', () => {
  it('tar emot kontraktets exempel', () => {
    expect(portalJobSchema.safeParse(CONTRACT_JOB).success).toBe(true);
  });

  it('ett tomt kundnummer betyder inte kopplad, som null', () => {
    const body = structuredClone(CONTRACT_JOB) as Record<string, any>;
    body.store.ekovillaCustomerNumber = '  ';
    expect(portalJobSchema.parse(body).store.ekovillaCustomerNumber).toBeNull();
    body.store.ekovillaCustomerNumber = null;
    expect(portalJobSchema.parse(body).store.ekovillaCustomerNumber).toBeNull();
  });

  it.each<[string, (b: Record<string, any>) => void, string]>([
    ['kundnumret saknas helt (avsändaren ska lägga till det)', (b) => delete b.store.ekovillaCustomerNumber, 'store.ekovillaCustomerNumber'],
    ['quoteId av bara punkter (webbläsaren skriver om det i en adress)', (b) => (b.quoteId = '..'), 'quoteId'],
    ['quoteId med snedstreck', (b) => (b.quoteId = 'q/1'), 'quoteId'],
    ['butikens id med blanksteg', (b) => (b.store.resellerId = 'res 1'), 'store.resellerId'],
    ['arbetsplatsen saknar ort', (b) => (b.workplace.address.city = ' '), 'workplace.address.city'],
    ['vindsluckan är varken inne eller ute', (b) => (b.workplace.atticHatch = 'roof'), 'workplace.atticHatch'],
    ['en okänd konstruktion', (b) => (b.lines[0].construction = 'golv'), 'lines.0.construction'],
    ['ett negativt pris', (b) => (b.lines[1].unitCost = -1), 'lines.1.unitCost'],
    ['ett pris som inte är ett tal', (b) => (b.lines[1].unitCost = '2490'), 'lines.1.unitCost'],
    ['en yta på noll', (b) => (b.lines[0].quantity.areaM2 = 0), 'lines.0.quantity.areaM2'],
    ['en okänd mängdtyp', (b) => (b.lines[1].quantity = { kind: 'weight', value: 1 }), 'lines.1.quantity.kind'],
    ['inga rader', (b) => (b.lines = []), 'lines'],
    ['för många rader', (b) => (b.lines = Array.from({ length: 201 }, () => b.lines[1])), 'lines'],
    ['ett artikelnummer som saknas', (b) => (b.lines[1].articleNumber = ''), 'lines.1.articleNumber'],
    ['en volymrad i en annan enhet än m³ (hade blivit "38 st" i Fortnox)', (b) => (b.lines[0].unit = 'st'), 'lines.0.unit'],
  ])('nekar: %s', (_name, mutate, path) => {
    const body = structuredClone(CONTRACT_JOB) as Record<string, any>;
    mutate(body);
    const parsed = portalJobSchema.safeParse(body);
    expect(parsed.success).toBe(false);
    expect(parsed.error!.issues.map((i) => i.path.join('.'))).toContain(path);
  });

  it('lineCost och costTotal är bara information: CRM:et räknar själv, också när de inte stämmer', () => {
    const body = structuredClone(CONTRACT_JOB) as Record<string, any>;
    body.lines[0].lineCost = 1;
    body.costTotal = 2;
    const row = buildPortalWorkOrderInsert({ ...insertInput(), job: portalJobSchema.parse(body) });
    expect((row.pricing_summary as { subtotal: number }).subtotal).toBe(14270);
  });
});

function insertInput() {
  return {
    job: job(),
    customer: CARD,
    register: REGISTER,
    workOrderId: '22222222-2222-4222-8222-222222222222',
    orderNumber: 'AO-20260928-222222',
    assigneeId: '33333333-3333-4333-8333-333333333333',
    newId,
  };
}

describe('raderna', () => {
  it('lösull blir en m³-rad med yta och tjocklek, antal blir en styckrad; priset är unitCost', () => {
    const [losull, etablering] = mapPortalJobLines(job().lines, REGISTER, newId);
    expect(losull).toMatchObject({
      pricing_mode: 'm3',
      m2: '95',
      thickness_mm: '400',
      quantity: '',
      unit_price: '310',
      article_price: 310,
      construction: 'vind',
      article_number: '2410509',
    });
    expect(etablering).toMatchObject({
      pricing_mode: 'item',
      m2: '',
      thickness_mm: '',
      quantity: '1',
      unit_price: '2490',
      article_price: 2490,
      // CRM:et har inget "övrigt": ingen konstruktion.
      construction: '',
    });
    // 95 m² × 400 mm = 38 m³ × 310 kr = kontraktets lineCost.
    expect(lineItemRowTotal(losull)).toBe(11780);
    expect(lineItemRowTotal(etablering)).toBe(2490);
  });

  it('ingen rabatt, ingen ROT, ingen densitet, ingen avskrivning', () => {
    for (const row of mapPortalJobLines(job().lines, REGISTER, newId)) {
      expect(row).toMatchObject({ discount_percent: '', is_rot_work: false, labor_cost: '', density: '', written_off: false, auto_price: false });
    }
  });

  it('namn, enhet och anteckning ur artikelregistret när artikeln finns där', () => {
    const [losull, etablering] = mapPortalJobLines(job().lines, REGISTER, newId);
    expect(losull).toMatchObject({ article_name: 'Ekovilla Cellulosa Lösull CE ETA-09/0081', article_unit_name: 'M3', article_note: 'Blåses med maskin 2' });
    // Registrets standard för arbetsbeskrivningen följer med, som när raden skapas i offerten.
    expect(losull.include_in_description).toBe(false);
    expect(etablering.include_in_description).toBe(true);
  });

  it('utan artikeln i registret: portalens namn och enhet', () => {
    const [losull] = mapPortalJobLines(job().lines, new Map(), newId);
    expect(losull).toMatchObject({ article_name: 'EKOVILLA cellulosa lösull 0,038 – vind', article_unit_name: 'm3', article_note: null, include_in_description: false });
  });

  it('varje rad får ett eget id', () => {
    const ids = mapPortalJobLines(job().lines, REGISTER, newId).map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('arbetsordern', () => {
  it('status Ej planerad, ingen offert i CRM:et, den som fick jobbet är både skapare och ansvarig', () => {
    expect(insert()).toMatchObject({
      id: '22222222-2222-4222-8222-222222222222',
      order_number: 'AO-20260928-222222',
      status: 'draft',
      quote_id: null,
      prospect_id: null,
      customer_id: CARD.id,
      quote_type: 'business',
      created_by: '33333333-3333-4333-8333-333333333333',
      assigned_to: '33333333-3333-4333-8333-333333333333',
      desired_installation_date: null,
      rot_details: {},
      currency_code: 'SEK',
    });
  });

  it('titeln är arbetsplatsens adress (William 2026-09-28)', () => {
    expect(portalJobProjectName(job())).toBe('Rönnvägen 18, Gävle');
    expect(insert().project_name).toBe('Rönnvägen 18, Gävle');
  });

  it('beloppet: omvänd byggmoms, 0 % på hela ordern, med eller utan kundkort (William 2026-09-29)', () => {
    expect(insert()).toMatchObject({ vat_percent: 0, amount: 14270, pricing_summary: { subtotal: 14270, vat: 0, total: 14270 } });
    expect(insert(null)).toMatchObject({ vat_percent: 0, amount: 14270, customer_id: null });
  });

  it('🧨 omvänd moms står på DOKUMENTET, med eller utan kort: den vinner över kortet i Fortnox-pushen och ger kontot 3231', () => {
    expect(insert().customer_snapshot).toMatchObject({ reverse_vat: true });
    expect(insert(null).customer_snapshot).toMatchObject({ reverse_vat: true });
  });

  it('kortets egen moms läses inte: ett kort med vanlig moms ger ändå 0 % och omvänd moms på dokumentet', () => {
    const card = { ...CARD, reverse_vat: false } as JobCustomerCard;
    expect(insert(card)).toMatchObject({ vat_percent: 0, amount: 14270 });
    expect(insert(card).customer_snapshot).toMatchObject({ reverse_vat: true });
  });

  it('arbetsadressen är arbetsplatsen', () => {
    expect(insert().work_address).toEqual({
      street_address: 'Rönnvägen 18',
      postal_code: '806 28',
      city: 'Gävle',
      delivery_address: null,
      invoice_address: null,
    });
  });

  it('det praktiska som text i arbetsbeskrivningen, aldrig som egna nycklar i internal_handoff', () => {
    const handoff = insert().internal_handoff as Record<string, unknown>;
    expect(Object.keys(handoff).sort()).toEqual(['desired_installation_date', 'handoff_notes']);
    expect(handoff.desired_installation_date).toBeNull();
    expect(handoff.handoff_notes).toBe(
      [
        'Jobb från återförsäljarportalen: Norrbygg AB, offert 2026-015.',
        'Fastighetsbeteckning: Gävle Rönnen 3:2',
        'Vindslucka: inne',
        'Önskad period: Vecka 42',
      ].join('\n'),
    );
  });

  it('meddelandet från butiken följer med; tomma uppgifter hoppas över', () => {
    const j = job();
    j.workplace.notes = 'Hunden är lös, ring först.';
    j.workplace.propertyDesignation = '';
    j.workplace.atticHatch = 'outside';
    expect(portalJobHandoffNotes(j)).toBe(
      [
        'Jobb från återförsäljarportalen: Norrbygg AB, offert 2026-015.',
        'Vindslucka: ute',
        'Önskad period: Vecka 42',
        'Meddelande från butiken: Hunden är lös, ring först.',
      ].join('\n'),
    );
  });

  it('🧨 texten läses inte som ett måttblock (det hade låst automatiken i arbetsbeskrivningen)', () => {
    expect(hasMeasurementBlock(portalJobHandoffNotes(job()))).toBe(false);
  });
});

describe('snapshoten', () => {
  it('med kundkort: kortets uppgifter, kontakten som Er referens, offertnumret som märkning, momsen från kortet', () => {
    expect(buildPortalJobCustomerSnapshot(job(), CARD)).toEqual({
      customer_name: 'Norrbygg AB',
      company_name: 'Norrbygg AB',
      organization_number: '556677-8899',
      personal_number: null,
      contact_name: 'Per Inköp',
      email: 'per@norrbygg.se',
      phone: '070-111 22 33',
      your_reference: 'Per Inköp',
      street_address: 'Verkstadsgatan 8',
      postal_code: '802 91',
      city: 'Gävle',
      delivery_address: 'Rönnvägen 18',
      delivery_postal_code: '806 28',
      delivery_city: 'Gävle',
      invoice_address: null,
      label: '2026-015',
      end_contact_name: 'Ingrid Palm',
      end_contact_phone: '070-555 12 34',
      reverse_vat: true,
    });
  });

  it('utan kundkort: butikens uppgifter', () => {
    const snapshot = buildPortalJobCustomerSnapshot(job(), null);
    expect(snapshot).toMatchObject({
      customer_name: 'Norrbygg AB',
      company_name: 'Norrbygg AB',
      organization_number: null,
      your_reference: null,
      street_address: 'Verkstadsgatan 8',
      postal_code: '802 91',
      city: 'Gävle',
      label: '2026-015',
      end_contact_name: 'Ingrid Palm',
    });
  });
});

describe('Fortnox-ordern ur arbetsordern', () => {
  it('raderna: artikelnummer, mängd, unitCost som pris, registrets enhet, ingen rabatt, inget husarbete', () => {
    const row = insert();
    const rows = buildOrderRows(row.line_items as never, 25, false, false) as unknown as Record<string, unknown>[];
    expect(rows[0]).toMatchObject({ ArticleNumber: '2410509', OrderedQuantity: 38, DeliveredQuantity: 38, Price: 310, VAT: 25, Unit: 'M3', Discount: 0, DiscountType: 'PERCENT' });
    expect(rows[1]).toMatchObject({ ArticleNumber: '1010', OrderedQuantity: 1, Price: 2490, Unit: 'st' });
    for (const r of rows) {
      expect(r).not.toHaveProperty('HouseWork');
      expect(r).not.toHaveProperty('HouseWorkType');
    }
  });

  it('🧨 portalens tankstreck i namnet fäller inte pushen (utan artikeln i registret)', () => {
    const row = insert(CARD, new Map());
    const rows = buildOrderRows(row.line_items as never, 25, false, false) as unknown as { Description: string }[];
    expect(rows[0].Description).toBe('EKOVILLA cellulosa lösull 0,038 - vind');
  });

  it('offertnumret blir "Ert referensnummer" (YourOrderNumber), titeln och märkningen en textrad', () => {
    const row = insert();
    const snapshot = row.customer_snapshot as { label: string };
    const { referenceNumber } = resolveRotReference(null, snapshot.label, false);
    // Skapandevägen får aldrig rensa (buildOrderHeader skickar null i stället för snapshoten).
    expect(orderReferenceNumberField(referenceNumber, null)).toEqual({ YourOrderNumber: '2026-015' });
    expect(buildOrderProjectNote(row.project_name as string, snapshot.label)).toBe('Projekt: Rönnvägen 18, Gävle  Märkning: 2026-015');
  });

  it('arbetsplatsen blir leveransadress (den skiljer sig från butikens)', () => {
    const row = insert();
    expect(buildOrderDeliveryFields(row.work_address as never, row.customer_snapshot as never)).toEqual({
      DeliveryAddress1: 'Rönnvägen 18',
      DeliveryZipCode: '806 28',
      DeliveryCity: 'Gävle',
    });
  });
});

describe('fullständighetskontrollen före Fortnox-ordern', () => {
  const readinessCard = { ...CARD };

  it('en kopplad butik med komplett kort: klar', () => {
    const readiness = evaluateWorkOrderReadiness(insert() as never, readinessCard);
    expect(readiness.blockers).toEqual([]);
    expect(readiness.ready).toBe(true);
  });

  it('prövar arbetsplatsen, inte butikens adress', () => {
    const readiness = evaluateWorkOrderReadiness(insert() as never, readinessCard);
    expect(readiness.resolved.workAddress).toMatchObject({ street_address: 'Rönnvägen 18', postal_code: '806 28', city: 'Gävle' });
  });

  it('kontaktpersonen på plats räcker som telefon, när kortet saknar nummer', () => {
    const noPhone = { ...CARD, phone: null, contacts: [{ name: 'Per Inköp', phone: null, email: null, is_primary: true }] };
    expect(evaluateWorkOrderReadiness(insert(noPhone) as never, noPhone).ready).toBe(true);
  });

  it('utan kundkort: stoppar på kundkopplingen', () => {
    const readiness = evaluateWorkOrderReadiness(insert(null) as never, null);
    expect(readiness.blockers.map((b) => b.field)).toEqual(['customer_link']);
  });

  it('utan org.nr på kortet: stoppar', () => {
    const noOrg = { ...CARD, organization_number: null };
    expect(evaluateWorkOrderReadiness(insert(noOrg) as never, noOrg).blockers.map((b) => b.field)).toEqual(['organization_number']);
  });
});

describe('notisens orsaker', () => {
  it('kundkopplingen och org.nr med butikens ord; resten som kontrollen säger det', () => {
    const blockers = [
      { field: 'customer_link', label: '', message: 'offertens text', fixAt: 'quote' },
      { field: 'organization_number', label: '', message: 'offertens text', fixAt: 'customer_card' },
      { field: 'work_address', label: '', message: 'Arbetsadressen saknar ort.', fixAt: 'quote' },
    ] as const;
    expect(portalFortnoxBlockerReasons([...blockers], '1043')).toEqual([
      'Butikens kundnummer 1043 finns inte som företagskund i kundregistret.',
      'Organisationsnummer saknas på butikens kundkort.',
      'Arbetsadressen saknar ort.',
    ]);
    expect(portalFortnoxBlockerReasons([blockers[0]], null)).toEqual([
      'Butiken har inget kundnummer i portalen, så jobbet är inte kopplat till någon kund.',
    ]);
  });

  it('påminnelsen om densiteten: en lösullsrad (m³) utan densitet, inte en antalsrad eller en avskriven rad', () => {
    const [losull, etablering] = mapPortalJobLines(job().lines, REGISTER, newId);
    expect(workOrderLinesNeedDensity([losull, etablering])).toBe(true);
    expect(workOrderLinesNeedDensity([etablering])).toBe(false);
    expect(workOrderLinesNeedDensity([{ ...losull, density: '45' }, etablering])).toBe(false);
    expect(workOrderLinesNeedDensity([{ ...losull, density: '0' }])).toBe(true);
    expect(workOrderLinesNeedDensity([{ ...losull, written_off: true }])).toBe(false);
    expect(workOrderLinesNeedDensity(null)).toBe(false);
  });

  it('volymrader i m³ med eller utan upphöjd trea tas emot', () => {
    const body = structuredClone(CONTRACT_JOB) as Record<string, any>;
    body.lines[0].unit = 'm³';
    expect(portalJobSchema.safeParse(body).success).toBe(true);
  });
});
