import { describe, it, expect } from 'vitest';
import {
  evaluateWorkOrderReadiness,
  workOrderReadinessErrorCode,
  type ReadinessCustomerSource,
  type ReadinessQuoteSource,
} from '@/lib/domains/crm/workOrderReadiness';

// Spärren mellan offert och arbetsorder. Orderskapandet auto-pushar till Fortnox, så det här är
// sista stället en glömd uppgift är ett formulärfel i stället för ett bokföringsärende.
//
// Det som gör testerna värda något är FALLBACKEN till kundkortet: adress, telefon och org.nr går
// inte att redigera i offertformuläret, så en spärr som bara läste offertens snapshot hade
// blockerat säljaren även efter att hen gjort precis det spärren bad om.

const fullSnapshot = {
  customer_name: 'Anna Andersson',
  contact_name: 'Anna Andersson',
  personal_number: '198501011236',
  phone: '070-123 45 67',
  street_address: 'Storgatan 1',
  postal_code: '12345',
  city: 'Stockholm',
};

function quote(overrides: Partial<ReadinessQuoteSource> = {}): ReadinessQuoteSource {
  return {
    quote_type: 'private',
    customer_id: '11111111-1111-1111-1111-111111111111',
    customer_snapshot: { ...fullSnapshot },
    rot_details: { enabled: false },
    line_items: [{ article_name: 'Ekovilla', quantity: '10' }],
    internal_handoff: { desired_installation_date: '2026-09-01', handoff_notes: 'Vind, 400 mm' },
    ...overrides,
  };
}

const emptyCustomer: ReadinessCustomerSource = { email: null, phone: null, mobile: null, contacts: [] };

function fields(issues: Array<{ field: string }>) {
  return issues.map((i) => i.field);
}

describe('fullständighetskontroll offert → arbetsorder', () => {
  it('komplett privatoffert passerar utan fynd', () => {
    const result = evaluateWorkOrderReadiness(quote(), emptyCustomer);
    expect(result.ready).toBe(true);
    expect(result.blockers).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('okopplad offert spärras — och kortsluter, för resten går inte att åtgärda ändå', () => {
    // Adress, telefon och org.nr bor på kundkortet. Utan koppling finns inget kort att rätta dem
    // i, så en full lista hade gett fyra fynd med tre knappar som pekar på en sida som inte finns.
    const result = evaluateWorkOrderReadiness(
      quote({ customer_id: null, customer_snapshot: { customer_name: 'Anna' } }),
      null,
    );
    expect(fields(result.blockers)).toEqual(['customer_link']);
    expect(result.blockers[0].fixAt).toBe('quote');
    expect(result.ready).toBe(false);
  });

  it('kortslutningen tar inte varningarna med sig — de rör bara offerten', () => {
    const result = evaluateWorkOrderReadiness(
      quote({ customer_id: null, line_items: [], internal_handoff: {} }),
      null,
    );
    expect(fields(result.warnings)).toEqual(['line_items', 'installation_date', 'handoff_notes']);
  });

  it('personnummer hämtas från kundkortet när offertens snapshot saknar det', () => {
    const result = evaluateWorkOrderReadiness(
      quote({ customer_snapshot: { ...fullSnapshot, personal_number: null } }),
      { ...emptyCustomer, personal_number: '198501011236' },
    );
    expect(fields(result.blockers)).not.toContain('personal_number');
    expect(result.resolved.personalNumber).toBe('198501011236');
  });

  it('tio siffror spärrar — ROT dör tyst i Fortnox på ett ofullständigt nummer', () => {
    const result = evaluateWorkOrderReadiness(
      quote({ customer_snapshot: { ...fullSnapshot, personal_number: '8501011236' } }),
      emptyCustomer,
    );
    expect(fields(result.blockers)).toContain('personal_number');
  });

  // ⚠️ REGRESSION: spärren gick inte att ta sig förbi. Snapshoten vann över kundkortet, så en
  // säljare som gjorde precis det felmeddelandet bad om — fyllde i det fulla numret på kortet —
  // fälldes ändå av offertens gamla kopia. Prompten i offertformuläret sparar också på KORTET,
  // vilket gjorde återförsöket till en rundgång utan utväg.
  it('kundkortets rättade nummer vinner över offertens gamla tiosiffriga', () => {
    const result = evaluateWorkOrderReadiness(
      quote({ customer_snapshot: { ...fullSnapshot, personal_number: '8501011236' } }),
      { ...emptyCustomer, personal_number: '198501011236' },
    );
    expect(fields(result.blockers)).not.toContain('personal_number');
    // Ordern ska bära numret som faktiskt gäller — det är det Fortnox får som OrganisationNumber.
    expect(result.resolved.personalNumber).toBe('198501011236');
    expect(result.ready).toBe(true);
  });

  it('kundkortet vinner också över en platshållare i snapshoten', () => {
    const result = evaluateWorkOrderReadiness(
      quote({ customer_snapshot: { ...fullSnapshot, personal_number: '111111' } }),
      { ...emptyCustomer, personal_number: '198501011236' },
    );
    expect(fields(result.blockers)).not.toContain('personal_number');
    expect(result.resolved.personalNumber).toBe('198501011236');
  });

  it('utan kundrad att läsa faller kontrollen tillbaka på snapshoten', () => {
    // customer_id finns (annars kortsluter kontrollen), men raden gick inte att hämta. Då är
    // snapshoten det enda som finns — den ska fortfarande prövas, inte hoppas över.
    expect(evaluateWorkOrderReadiness(quote(), null).ready).toBe(true);
    expect(
      fields(evaluateWorkOrderReadiness(
        quote({ customer_snapshot: { ...fullSnapshot, personal_number: '8501011236' } }),
        null,
      ).blockers),
    ).toContain('personal_number');
  });

  // ── E-posten: kundkortet vinner, och en TOM upplösning måste få vinna också ──
  //
  // Rapporterat i drift: ordern visade Roberts e-post under Jonas namn. `resolveCrmContact` lånar
  // inte längre ut ett företags adress åt en kontakt utan egen — men lånet låg redan fruset i
  // offertens snapshot, så fyllde vi luckan därifrån hade det kommit tillbaka.
  it('företagskontakt utan egen adress ger ingen e-post — snapshotens gamla lån fyller inte luckan', () => {
    const result = evaluateWorkOrderReadiness(
      quote({ quote_type: 'business', customer_snapshot: { ...fullSnapshot, organization_number: '556677-8899', email: 'robert@acme.se' } }),
      {
        ...emptyCustomer,
        customer_type: 'business',
        organization_number: '556677-8899',
        email: 'robert@acme.se',
        contacts: [{ name: 'Jonas', email: null, phone: null, is_primary: true }],
      },
    );
    expect(result.resolved.email).toBeNull();
    // Spärrar inte — e-post är inget krav för att skapa order.
    expect(result.ready).toBe(true);
  });

  // ⚠️ REGRESSION (fångad i granskningen): e-posten löstes upp mot kortets PRIMÄRA kontakt, medan
  // namnet kom ur snapshoten. Valde säljaren Björn i offertens kontaktväljare fick ordern Björns
  // namn med Annas adress — samma fel som hela ändringen finns för, fast på skrivvägen.
  it('offertens valda kontaktperson avgör adressen, inte kortets primära', () => {
    const result = evaluateWorkOrderReadiness(
      quote({ quote_type: 'business', customer_snapshot: { ...fullSnapshot, contact_name: 'Björn', organization_number: '556677-8899' } }),
      {
        ...emptyCustomer,
        customer_type: 'business',
        organization_number: '556677-8899',
        email: 'info@acme.se',
        contacts: [
          { name: 'Anna', email: 'anna@acme.se', is_primary: true },
          { name: 'Björn', email: 'bjorn@acme.se' },
        ],
      },
    );
    expect(result.resolved.email).toBe('bjorn@acme.se');
  });

  it('en vald kontakt som inte står på kortet ärver ingen annans adress', () => {
    const result = evaluateWorkOrderReadiness(
      quote({ quote_type: 'business', customer_snapshot: { ...fullSnapshot, contact_name: 'Jonas', organization_number: '556677-8899' } }),
      {
        ...emptyCustomer,
        customer_type: 'business',
        organization_number: '556677-8899',
        email: 'robert@acme.se',
        contacts: [{ name: 'Anna', email: 'anna@acme.se', is_primary: true }],
      },
    );
    // Varken Annas eller bolagets. Jonas finns inte på kortet — då har raden ingen adress.
    expect(result.resolved.email).toBeNull();
  });

  it('utan valt kontaktnamn gäller kortets primärkontakt, som förut', () => {
    const result = evaluateWorkOrderReadiness(
      quote({ customer_snapshot: { ...fullSnapshot, contact_name: null } }),
      {
        ...emptyCustomer,
        customer_type: 'private',
        email: 'kortet@example.se',
        contacts: [{ name: 'Anna Andersson', email: 'anna@example.se', is_primary: true }],
      },
    );
    expect(result.resolved.email).toBe('anna@example.se');
  });

  it('en rättad adress på kundkortet vinner över offertens frusna', () => {
    const result = evaluateWorkOrderReadiness(
      quote({ customer_snapshot: { ...fullSnapshot, email: 'gammal@example.se' } }),
      { ...emptyCustomer, customer_type: 'private', email: 'ny@example.se' },
    );
    expect(result.resolved.email).toBe('ny@example.se');
  });

  it('utan kundrad att läsa är snapshoten det enda som finns', () => {
    const result = evaluateWorkOrderReadiness(
      quote({ customer_snapshot: { ...fullSnapshot, email: 'fran.offerten@example.se' } }),
      null,
    );
    expect(result.resolved.email).toBe('fran.offerten@example.se');
  });

  it('företagskund utan org.nr spärras, privatkund berörs inte', () => {
    const business = evaluateWorkOrderReadiness(
      quote({ quote_type: 'business', customer_snapshot: { ...fullSnapshot, personal_number: null, organization_number: null } }),
      emptyCustomer,
    );
    expect(fields(business.blockers)).toContain('organization_number');

    const withOrgNr = evaluateWorkOrderReadiness(
      quote({ quote_type: 'business', customer_snapshot: { ...fullSnapshot, personal_number: null } }),
      { ...emptyCustomer, organization_number: '556677-8899' },
    );
    expect(fields(withOrgNr.blockers)).not.toContain('organization_number');
    expect(withOrgNr.resolved.organizationNumber).toBe('556677-8899');
  });

  it('halv adress spärras och meddelandet namnger de delar som saknas', () => {
    const result = evaluateWorkOrderReadiness(
      quote({ customer_snapshot: { ...fullSnapshot, postal_code: null, city: null } }),
      emptyCustomer,
    );
    const address = result.blockers.find((b) => b.field === 'work_address');
    expect(address?.message).toContain('postnummer och ort');
  });

  it('adressen faller tillbaka på kundkortets besöksadress när snapshoten är tom', () => {
    const result = evaluateWorkOrderReadiness(
      quote({ customer_snapshot: { ...fullSnapshot, street_address: null, postal_code: null, city: null } }),
      { ...emptyCustomer, visit_address: { street: 'Storgatan 1', postal_code: '12345', city: 'Stockholm' } },
    );
    expect(fields(result.blockers)).not.toContain('work_address');
    expect(result.resolved.workAddress.city).toBe('Stockholm');
  });

  // ⚠️ REGRESSION, rapporterad i drift 2026-08-24: adressen rättades på kundkortet, men offerten
  // bar kvar den gamla ofullständiga och spärren fällde igen. Ankaret var bara GATAN, så en
  // snapshot med gata men utan ort svarade "ort saknas" utan att någonsin titta på kortet där
  // orten stod. Ingen väg förbi — samma rundgång som personnumret och e-posten.
  it('kundkortets adress vinner när offerten inte har någon egen arbetsadress', () => {
    const result = evaluateWorkOrderReadiness(
      quote({ customer_snapshot: { ...fullSnapshot, street_address: 'Gamla vägen 9', postal_code: null, city: null } }),
      { ...emptyCustomer, visit_address: { street: 'Storgatan 1', postal_code: '12345', city: 'Stockholm' } },
    );
    expect(fields(result.blockers)).not.toContain('work_address');
    expect(result.resolved.workAddress).toMatchObject({
      street_address: 'Storgatan 1',
      postal_code: '12345',
      city: 'Stockholm',
    });
  });

  // Som en ENHET, aldrig fält för fält: en gata från kortet med en ort ur snapshoten pekar ut fel
  // plats, och det är installatörerna som kör dit.
  it('kortets adress tas hel — ingen ort lånas ur snapshoten', () => {
    const result = evaluateWorkOrderReadiness(
      quote({ customer_snapshot: { ...fullSnapshot, city: 'Göteborg' } }),
      { ...emptyCustomer, visit_address: { street: 'Storgatan 1', postal_code: '12345', city: null } },
    );
    expect(result.resolved.workAddress.city).toBeNull();
    // Och spärren pekar på kundkortet, där luckan faktiskt sitter.
    expect(result.blockers.find((b) => b.field === 'work_address')?.fixAt).toBe('customer_card');
  });

  it('utan gata på kortet är snapshoten sista utvägen', () => {
    const result = evaluateWorkOrderReadiness(
      quote(),
      { ...emptyCustomer, visit_address: { street: null, postal_code: null, city: null } },
    );
    expect(fields(result.blockers)).not.toContain('work_address');
    expect(result.resolved.workAddress.street_address).toBe('Storgatan 1');
  });

  // Företagsfallet: fakturaadressen är bolagets, arbetet sker någon annanstans. Den separata
  // arbetsadressen är ett medvetet val i offerten och måste stå emot ett ifyllt kundkort.
  it('en separat arbetsadress vinner över kundadressen och lånar inte dess ort', () => {
    const result = evaluateWorkOrderReadiness(
      quote({
        customer_snapshot: {
          ...fullSnapshot,
          delivery_address: 'Industrivägen 4',
          delivery_postal_code: '43210',
          delivery_city: 'Göteborg',
        },
      }),
      { ...emptyCustomer, visit_address: { street: 'Storgatan 1', postal_code: '12345', city: 'Stockholm' } },
    );
    expect(result.resolved.workAddress).toMatchObject({
      street_address: 'Industrivägen 4',
      postal_code: '43210',
      city: 'Göteborg',
    });
  });

  it('arbetsadress utan ort rättas i OFFERTEN, kundadress utan ort på KUNDKORTET', () => {
    const onQuote = evaluateWorkOrderReadiness(
      quote({ customer_snapshot: { ...fullSnapshot, delivery_address: 'Industrivägen 4' } }),
      emptyCustomer,
    );
    expect(onQuote.blockers.find((b) => b.field === 'work_address')?.fixAt).toBe('quote');

    const onCard = evaluateWorkOrderReadiness(
      quote({ customer_snapshot: { ...fullSnapshot, city: null } }),
      emptyCustomer,
    );
    expect(onCard.blockers.find((b) => b.field === 'work_address')?.fixAt).toBe('customer_card');
  });

  it('telefon: snapshot först, sedan slutkundens nummer, sedan kundkortet', () => {
    const noPhone = { ...fullSnapshot, phone: null };

    const blocked = evaluateWorkOrderReadiness(quote({ customer_snapshot: noPhone }), emptyCustomer);
    expect(fields(blocked.blockers)).toContain('contact_phone');

    // Slutkundens nummer räcker för att NÅGON går att nå på plats — men det är en annan person
    // än kunden, och får därför aldrig skrivas in som kundens telefon på ordern. Ordervyn visar
    // det fältet bredvid kundens kontaktnamn och seedar redigeringsfältet ur det.
    const endContact = evaluateWorkOrderReadiness(
      quote({ customer_snapshot: { ...noPhone, end_contact_phone: '070-999 88 77' } }),
      emptyCustomer,
    );
    expect(fields(endContact.blockers)).not.toContain('contact_phone');
    expect(endContact.resolved.phone).toBeNull();

    // Kontaktraden vinner över kortets nummer — samma regel som resolveCrmContact, så
    // arbetsordern och Fortnox-dokumenten pekar på samma person.
    const fromCard = evaluateWorkOrderReadiness(quote({ customer_snapshot: noPhone }), {
      ...emptyCustomer,
      phone: '08-111 222',
      contacts: [{ name: 'Anna', phone: '070-555 44 33', is_primary: true }],
    });
    expect(fromCard.resolved.phone).toBe('070-555 44 33');
  });

  it('ROT utan fastighetsbeteckning spärras — BRF org.nr räcker som alternativ', () => {
    const missing = evaluateWorkOrderReadiness(
      quote({ rot_details: { enabled: true, property_designation: null, brf_org_number: null } }),
      emptyCustomer,
    );
    expect(fields(missing.blockers)).toContain('rot_property');

    const brf = evaluateWorkOrderReadiness(
      quote({ rot_details: { enabled: true, brf_org_number: '769600-1234' } }),
      emptyCustomer,
    );
    expect(fields(brf.blockers)).not.toContain('rot_property');
  });

  it('tomma rader, saknat datum och saknad arbetsbeskrivning VARNAR men spärrar inte', () => {
    const result = evaluateWorkOrderReadiness(
      quote({ line_items: [], internal_handoff: {} }),
      emptyCustomer,
    );
    expect(result.ready).toBe(true);
    expect(fields(result.warnings)).toEqual(['line_items', 'installation_date', 'handoff_notes']);
  });

  it('en rad utan innehåll räknas inte som en rad', () => {
    const result = evaluateWorkOrderReadiness(
      quote({ line_items: [{ id: 'row-1', article_name: null, quantity: '', m2: '', unit_price: '' }] }),
      emptyCustomer,
    );
    expect(fields(result.warnings)).toContain('line_items');
  });
});

describe('felkoden som routen svarar med', () => {
  it('ensamt personnummer- eller ROT-fynd behåller sin kod så prompten fyrar', () => {
    expect(workOrderReadinessErrorCode([{ field: 'personal_number', label: '', message: '', fixAt: 'customer_card' }]))
      .toBe('crm_work_order_missing_personal_number');
    expect(workOrderReadinessErrorCode([{ field: 'rot_property', label: '', message: '', fixAt: 'quote' }]))
      .toBe('crm_work_order_missing_rot_property');
  });

  it('flera fynd ger listkoden — annars lagar prompten en sak och nästa fel dyker upp', () => {
    expect(
      workOrderReadinessErrorCode([
        { field: 'personal_number', label: '', message: '', fixAt: 'customer_card' },
        { field: 'contact_phone', label: '', message: '', fixAt: 'customer_card' },
      ]),
    ).toBe('crm_work_order_incomplete');
  });
});

// ⚠️ Ordersnapshoten måste bära samma kundadress som spärren prövade. `buildOrderDeliveryFields`
// (fortnox/orders.ts) avgör om ett leveransadressblock ska med till Fortnox genom att jämföra
// arbetsadressens gata med snapshotens kundadress. Glider de isär får varje order som skapats
// efter en rättad adress en Leveransadress på orderbekräftelsen, för ett jobb på kundens egen
// adress.
describe('kundadressen som ordern ska bära', () => {
  const card = { street: 'Storgatan 1', postal_code: '12345', city: 'Stockholm' };

  it('utan egen arbetsadress är kundadress och arbetsadress samma sträng', () => {
    const result = evaluateWorkOrderReadiness(
      quote({ customer_snapshot: { ...fullSnapshot, street_address: 'Gamla vägen 9', city: 'Göteborg' } }),
      { ...emptyCustomer, visit_address: card },
    );
    expect(result.resolved.customerAddress.street_address).toBe('Storgatan 1');
    expect(result.resolved.workAddress.street_address).toBe(result.resolved.customerAddress.street_address);
  });

  it('med egen arbetsadress skiljer de sig — och ska göra det', () => {
    const result = evaluateWorkOrderReadiness(
      quote({
        customer_snapshot: {
          ...fullSnapshot,
          delivery_address: 'Industrivägen 4',
          delivery_postal_code: '54321',
          delivery_city: 'Malmö',
        },
      }),
      { ...emptyCustomer, visit_address: card },
    );
    expect(result.resolved.workAddress.street_address).toBe('Industrivägen 4');
    expect(result.resolved.customerAddress.street_address).toBe('Storgatan 1');
  });

  it('utan kundrad faller kundadressen tillbaka på snapshoten', () => {
    const result = evaluateWorkOrderReadiness(quote(), null);
    expect(result.resolved.customerAddress.street_address).toBe('Storgatan 1');
  });
});
