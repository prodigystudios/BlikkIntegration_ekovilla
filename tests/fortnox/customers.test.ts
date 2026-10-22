import { describe, it, expect } from 'vitest';
import {
  buildFortnoxCustomerPayload,
  buildFortnoxCustomerPutPayload,
  fortnoxCustomerClears,
  fortnoxCustomerFieldsChanged,
  buildFortnoxCustomerUpdateRow,
  buildFortnoxListCustomerRow,
  fortnoxLastModifiedParam,
  customersChangedSince,
  splitSwedishName,
  buildFortnoxAddress,
  inferCustomerType,
  type FortnoxCustomerSource,
} from '@/lib/domains/fortnox/customers';

function source(overrides: Partial<FortnoxCustomerSource> = {}): FortnoxCustomerSource {
  return {
    customer_type: 'business',
    company_name: 'Acme AB',
    first_name: null,
    last_name: null,
    organization_number: '556000-0000',
    personal_number: null,
    email: 'info@acme.se',
    phone: '08-123',
    mobile: '070-123',
    visit_address: { street: 'Besöksgatan 3', postal_code: '33344', city: 'Uppsala' },
    invoice_address: { street: 'Gatan 1', postal_code: '11122', city: 'Stockholm' },
    delivery_address: { street: 'Lagervägen 2', postal_code: '22233', city: 'Solna' },
    invoice_email: 'faktura@acme.se',
    payment_terms: '30',
    price_list: 'A',
    discount: 10,
    vat_number: 'SE556000000001',
    reverse_vat: false,
    fortnox_customer_id: '42',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// buildFortnoxCustomerPayload — exact Fortnox field-name mapping (regression
// guard for the VatType/VATType bug that broke every customer push).
// ---------------------------------------------------------------------------

describe('buildFortnoxCustomerPayload', () => {
  it('använder de exakta Fortnox-fältnamnen (VATType/VATNumber/TermsOfPayment)', () => {
    const payload = buildFortnoxCustomerPayload(source());
    expect(payload).toHaveProperty('VATType');
    expect(payload).toHaveProperty('VATNumber');
    expect(payload).toHaveProperty('TermsOfPayment');
    // The buggy spellings must never reappear.
    expect(payload).not.toHaveProperty('VatType');
    expect(payload).not.toHaveProperty('VatNumber');
    expect(payload).not.toHaveProperty('PaymentTerms');
  });

  it('mappar företagskund till COMPANY med company_name som Name', () => {
    const payload = buildFortnoxCustomerPayload(source({ customer_type: 'business', company_name: 'Acme AB' }));
    expect(payload.Type).toBe('COMPANY');
    expect(payload.Name).toBe('Acme AB');
  });

  it('mappar privatkund till PRIVATE med sammansatt för- och efternamn', () => {
    const payload = buildFortnoxCustomerPayload(
      source({ customer_type: 'private', company_name: null, first_name: 'Anna', last_name: 'Svensson' }),
    );
    expect(payload.Type).toBe('PRIVATE');
    expect(payload.Name).toBe('Anna Svensson');
  });

  it('skickar org.nr i OrganisationNumber för företag', () => {
    const payload = buildFortnoxCustomerPayload(
      source({ customer_type: 'business', organization_number: '556000-0000', personal_number: '900101-1234' }),
    );
    expect(payload.OrganisationNumber).toBe('556000-0000');
  });

  it('skickar personnummer i OrganisationNumber för privatkund', () => {
    const payload = buildFortnoxCustomerPayload(
      source({ customer_type: 'private', company_name: null, first_name: 'Anna', last_name: 'Svensson',
        organization_number: null, personal_number: '900101-1234' }),
    );
    expect(payload.OrganisationNumber).toBe('900101-1234');
  });

  // Fortnox Customer saknar Mobile-fält (POST/PUT → 400 kod 2001399). Mobil ska in i Phone2,
  // symmetriskt med importen (mapFortnoxCustomerToRow läser c.Phone2 → mobile).
  it('skickar mobil i Phone2 (Fortnox har inget Mobile-fält)', () => {
    const payload = buildFortnoxCustomerPayload(source({ mobile: '070-123' }));
    expect(payload.Phone2).toBe('070-123');
    expect(payload).not.toHaveProperty('Mobile');
  });

  it('mappar besöksadress till Visiting* utan att röra Address1 (fakturaadress)', () => {
    const payload = buildFortnoxCustomerPayload(source());
    expect(payload.VisitingAddress).toBe('Besöksgatan 3');
    expect(payload.VisitingZipCode).toBe('33344');
    expect(payload.VisitingCity).toBe('Uppsala');
    // Visiting and Address1 are separate registers – must not bleed into each other.
    expect(payload.Address1).toBe('Gatan 1');
  });

  it('sätter VATType=SEREVERSEDVAT vid omvänd moms, annars SEVAT', () => {
    expect(buildFortnoxCustomerPayload(source({ reverse_vat: true })).VATType).toBe('SEREVERSEDVAT');
    expect(buildFortnoxCustomerPayload(source({ reverse_vat: false })).VATType).toBe('SEVAT');
  });

  it('mappar fakturaadress till Address1/ZipCode/City och leveransadress till Delivery*', () => {
    const payload = buildFortnoxCustomerPayload(source());
    expect(payload.Address1).toBe('Gatan 1');
    expect(payload.ZipCode).toBe('11122');
    expect(payload.City).toBe('Stockholm');
    expect(payload.DeliveryAddress1).toBe('Lagervägen 2');
    expect(payload.DeliveryZipCode).toBe('22233');
    expect(payload.DeliveryCity).toBe('Solna');
  });

  it('mappar betalningsvillkor, prislista, moms och rabatt', () => {
    const payload = buildFortnoxCustomerPayload(source());
    expect(payload.TermsOfPayment).toBe('30');
    expect(payload.PriceList).toBe('A');
    expect(payload.VATNumber).toBe('SE556000000001');
    expect(payload.InvoiceDiscount).toBe(10);
  });

  it('utelämnar tomma fält (undefined) så de inte nollar Fortnox-data vid uppdatering', () => {
    const payload = buildFortnoxCustomerPayload(
      source({ email: null, vat_number: null, visit_address: null, invoice_address: null, delivery_address: null }),
    );
    expect(payload.Email).toBeUndefined();
    expect(payload.VATNumber).toBeUndefined();
    expect(payload.Address1).toBeUndefined();
    expect(payload.VisitingAddress).toBeUndefined();
    expect(payload.DeliveryCity).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// fortnoxCustomerFieldsChanged — gate that decides whether an update needs a push
// ---------------------------------------------------------------------------

describe('fortnoxCustomerFieldsChanged', () => {
  it('returnerar false när inga Fortnox-relevanta fält ändrats', () => {
    expect(fortnoxCustomerFieldsChanged(source(), source())).toBe(false);
  });

  it('ignorerar fält som inte pushas (t.ex. status/notes)', () => {
    const before = { ...source(), status: 'active', notes: 'a' } as any;
    const after = { ...source(), status: 'inactive', notes: 'b' } as any;
    expect(fortnoxCustomerFieldsChanged(before, after)).toBe(false);
  });

  it('returnerar true när ett skalärt Fortnox-fält ändras', () => {
    expect(fortnoxCustomerFieldsChanged(source(), source({ payment_terms: '10' }))).toBe(true);
    expect(fortnoxCustomerFieldsChanged(source(), source({ reverse_vat: true }))).toBe(true);
    expect(fortnoxCustomerFieldsChanged(source(), source({ personal_number: '900101-1234' }))).toBe(true);
  });

  it('returnerar true när en adress ändras (djupjämförelse)', () => {
    const after = source({ invoice_address: { street: 'Gatan 2', postal_code: '11122', city: 'Stockholm' } });
    expect(fortnoxCustomerFieldsChanged(source(), after)).toBe(true);
  });

  it('returnerar true när besöksadressen ändras (pushas nu till Visiting*)', () => {
    const after = source({ visit_address: { street: 'Besöksgatan 9', postal_code: '33344', city: 'Uppsala' } });
    expect(fortnoxCustomerFieldsChanged(source(), after)).toBe(true);
  });

  it('behandlar null/undefined som ändrat (säker default → pusha)', () => {
    expect(fortnoxCustomerFieldsChanged(null, source())).toBe(true);
    expect(fortnoxCustomerFieldsChanged(source(), undefined)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// fortnoxCustomerClears / buildFortnoxCustomerPutPayload — ett fält som töms i CRM
// ska tömmas i Fortnox, annars kommer det tillbaka vid nästa kundsynk. Värdena är
// uppmätta mot testbolaget 2026-10-22: "" ignoreras, null tömmer, rabatten kräver 0.
// ---------------------------------------------------------------------------

describe('fortnoxCustomerClears', () => {
  it('tömmer kontaktfälten med null', () => {
    const after = source({ email: null, phone: null, mobile: null, invoice_email: null });
    expect(fortnoxCustomerClears(source(), after)).toEqual({
      Email: null, Phone1: null, Phone2: null, EmailInvoice: null,
    });
  });

  it('tömmer villkor, prislista och momsnummer med null', () => {
    const after = source({ payment_terms: null, price_list: null, vat_number: null });
    expect(fortnoxCustomerClears(source(), after)).toEqual({
      TermsOfPayment: null, PriceList: null, VATNumber: null,
    });
  });

  // Fortnox ignorerar InvoiceDiscount: null — rabatten står kvar. Bara 0 tömmer.
  it('tömmer rabatten med 0, inte null', () => {
    expect(fortnoxCustomerClears(source({ discount: 10 }), source({ discount: null }))).toEqual({ InvoiceDiscount: 0 });
  });

  it('tömmer alla tre delarna när hela fakturaadressen tas bort', () => {
    expect(fortnoxCustomerClears(source(), source({ invoice_address: null }))).toEqual({
      Address1: null, ZipCode: null, City: null,
    });
  });

  it('tömmer bara den del av adressen som togs bort', () => {
    const after = source({ visit_address: { street: null, postal_code: '33344', city: 'Uppsala' } });
    expect(fortnoxCustomerClears(source(), after)).toEqual({ VisitingAddress: null });
  });

  it('tömmer leveransadressen till Delivery*', () => {
    expect(fortnoxCustomerClears(source(), source({ delivery_address: null }))).toEqual({
      DeliveryAddress1: null, DeliveryZipCode: null, DeliveryCity: null,
    });
  });

  // Kärnan i skyddet: en kund vars kort inte hämtats saknar villkor, prislista m.m. hos oss fast Fortnox har dem.
  // Tomt på båda sidor är "vi vet inte", inte "ta bort".
  it('tömmer aldrig ett fält som redan var tomt före redigeringen', () => {
    const unfetched = source({
      payment_terms: null, price_list: null, discount: null, invoice_email: null, mobile: null,
      visit_address: null, delivery_address: null, vat_number: null,
    });
    expect(fortnoxCustomerClears(unfetched, { ...unfetched, phone: '08-999' })).toEqual({});
  });

  it('tömmer ingenting när fältet bara ändras', () => {
    expect(fortnoxCustomerClears(source(), source({ phone: '08-999', payment_terms: '10' }))).toEqual({});
  });

  it('räknar en tom sträng som tömd — Fortnox ignorerar ""', () => {
    expect(fortnoxCustomerClears(source(), source({ phone: '' }))).toEqual({ Phone1: null });
    expect(fortnoxCustomerClears(source(), source({ phone: '   ' }))).toEqual({ Phone1: null });
  });

  it('räknar rabatten 0 som tom — inget att tömma', () => {
    expect(fortnoxCustomerClears(source({ discount: 0 }), source({ discount: null }))).toEqual({});
  });

  it('tömmer aldrig namn, typ, org.nr/personnummer eller momstyp', () => {
    // Företag → privat utan personnummer: OrganisationNumber blir tomt i payloaden men får inte tömmas.
    const after = source({
      customer_type: 'private', company_name: null, first_name: 'Anna', last_name: 'Svensson',
      organization_number: null, personal_number: null,
    });
    const clears = fortnoxCustomerClears(source(), after);
    expect(clears).not.toHaveProperty('Name');
    expect(clears).not.toHaveProperty('Type');
    expect(clears).not.toHaveProperty('OrganisationNumber');
    expect(clears).not.toHaveProperty('VATType');
  });

  it('använder aldrig "" som tömningsvärde', () => {
    const empty = source({
      email: null, phone: null, mobile: null, invoice_email: null, payment_terms: null, price_list: null,
      discount: null, vat_number: null, visit_address: null, invoice_address: null, delivery_address: null,
    });
    const clears = fortnoxCustomerClears(source(), empty);
    expect(Object.keys(clears)).toHaveLength(17);
    for (const value of Object.values(clears)) expect(value).not.toBe('');
  });
});

describe('buildFortnoxCustomerPutPayload', () => {
  it('skickar null för det tömda fältet och resten av kortet som vanligt', () => {
    const payload = buildFortnoxCustomerPutPayload(source({ phone: null }), source());
    expect(payload.Phone1).toBeNull();
    expect(payload.Email).toBe('info@acme.se');
    expect(payload.VATType).toBe('SEVAT');
    // Utelämnat och null är olika saker för Fortnox — null måste överleva serialiseringen.
    expect(JSON.stringify({ Customer: payload })).toContain('"Phone1":null');
  });

  it('serialiserar rabattens 0 och prislistans null', () => {
    const json = JSON.stringify(buildFortnoxCustomerPutPayload(source({ discount: null, price_list: null }), source()));
    expect(json).toContain('"InvoiceDiscount":0');
    expect(json).toContain('"PriceList":null');
  });

  it('skickar inga tömningar utan före-rad (ny push efter ett misslyckande)', () => {
    const customer = source({ phone: null, discount: null });
    expect(buildFortnoxCustomerPutPayload(customer)).toEqual(buildFortnoxCustomerPayload(customer));
    expect(buildFortnoxCustomerPutPayload(customer, null)).toEqual(buildFortnoxCustomerPayload(customer));
  });
});

describe('splitSwedishName', () => {
  it('splits first token vs the rest', () => {
    expect(splitSwedishName('Anna Svensson')).toEqual({ first: 'Anna', last: 'Svensson' });
    expect(splitSwedishName('Anna Maria Svensson')).toEqual({ first: 'Anna', last: 'Maria Svensson' });
  });

  it('returns null parts for single name / empty / nullish', () => {
    expect(splitSwedishName('Anna')).toEqual({ first: 'Anna', last: null });
    expect(splitSwedishName('  ')).toEqual({ first: null, last: null });
    expect(splitSwedishName(null)).toEqual({ first: null, last: null });
    expect(splitSwedishName(undefined)).toEqual({ first: null, last: null });
  });
});

describe('buildFortnoxAddress', () => {
  it('builds an address object when any part is present', () => {
    expect(buildFortnoxAddress('Gatan 1', '11122', 'Stockholm')).toEqual({ street: 'Gatan 1', postal_code: '11122', city: 'Stockholm' });
    expect(buildFortnoxAddress('Gatan 1', null, null)).toEqual({ street: 'Gatan 1', postal_code: null, city: null });
  });

  it('returns null when all parts are empty/nullish', () => {
    expect(buildFortnoxAddress(null, null, null)).toBeNull();
    expect(buildFortnoxAddress('', '', '')).toBeNull();
    expect(buildFortnoxAddress(undefined, undefined, undefined)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// inferCustomerType — heuristic company-vs-private used on import (the list
// endpoint omits Type). Org.nr 3rd digit >= 2 → company; personnummer 3rd digit
// (tens-of-month) is 0/1 → private.
// ---------------------------------------------------------------------------

describe('inferCustomerType', () => {
  it('classifies a Swedish organisationsnummer as business (3rd digit >= 2)', () => {
    expect(inferCustomerType('556677-8899', null)).toBe('business');
    expect(inferCustomerType('5566778899', null)).toBe('business');
    // 16-prefixed / 12-digit org.nr normalises to the last 10.
    expect(inferCustomerType('165566778899', null)).toBe('business');
  });

  it('classifies a personnummer as private (month tens digit 0/1)', () => {
    expect(inferCustomerType('900101-1234', null)).toBe('private'); // 3rd digit 0
    expect(inferCustomerType('8512159876', null)).toBe('private');  // 3rd digit 1
    // 12-digit (century-prefixed) personnummer.
    expect(inferCustomerType('199001011234', null)).toBe('private');
  });

  it('falls back to VAT-number presence, then private, when no usable number', () => {
    expect(inferCustomerType(null, 'SE556677889901')).toBe('business');
    expect(inferCustomerType('', '   ')).toBe('private');
    expect(inferCustomerType(null, null)).toBe('private');
    expect(inferCustomerType('12345', null)).toBe('private'); // too short to discriminate
  });
});

// ---------------------------------------------------------------------------
// buildFortnoxCustomerUpdateRow — regressionsvakt för att en omsynk inte får
// nollställa ett momsnummer vi härlett själva.
// ---------------------------------------------------------------------------

describe('buildFortnoxCustomerUpdateRow', () => {
  const fortnoxCustomer = (overrides: Record<string, unknown> = {}) =>
    ({
      CustomerNumber: '42',
      Name: 'Acme AB',
      OrganisationNumber: '556000-0001',
      ...overrides,
    }) as never;

  // 🧨 Fortnox saknar momsnumret för de allra flesta kunder. Skrevs deras tomhet rakt av
  // nollställdes varje härlett nummer vid nästa rutinsynk — inklusive hela backfillen
  // (587 länkade rader). Att fältet UTELÄMNAS är hela poängen: en utelämnad nyckel rör
  // inte kolumnen, en null skriver över den.
  it('utelämnar vat_number när Fortnox saknar momsnummer', () => {
    const row = buildFortnoxCustomerUpdateRow(fortnoxCustomer({ VATNumber: null }), 'business', true, 'nu');
    expect('vat_number' in row).toBe(false);
  });

  it('utelämnar vat_number även när Fortnox skickar tom sträng eller blanksteg', () => {
    expect('vat_number' in buildFortnoxCustomerUpdateRow(fortnoxCustomer({ VATNumber: '' }), 'business', true, 'nu')).toBe(false);
    expect('vat_number' in buildFortnoxCustomerUpdateRow(fortnoxCustomer({ VATNumber: '   ' }), 'business', true, 'nu')).toBe(false);
  });

  // ⚖️ Fortnox äger fältet — har de ett värde vinner det, även över vårt härledda.
  it('skriver vat_number när Fortnox HAR ett momsnummer', () => {
    const row = buildFortnoxCustomerUpdateRow(fortnoxCustomer({ VATNumber: 'SE556000000102' }), 'business', true, 'nu');
    expect(row.vat_number).toBe('SE556000000102');
  });

  it('rör inte övriga fält', () => {
    const row = buildFortnoxCustomerUpdateRow(fortnoxCustomer({ VATNumber: null, Email: 'ny@acme.se' }), 'business', true, 'nu');
    expect(row.email).toBe('ny@acme.se');
    expect(row.company_name).toBe('Acme AB');
    expect(row.organization_number).toBe('556000-0001');
  });

  // Kortet är den enda källan till fälten listan saknar — det är därför kortpasset finns.
  it('läser omvänd moms, betalningsvillkor, prislista och fakturamejl ur kortet', () => {
    const row = buildFortnoxCustomerUpdateRow(
      fortnoxCustomer({ VATType: 'SEREVERSEDVAT', TermsOfPayment: '30', PriceList: '160', EmailInvoice: 'faktura@acme.se', Phone1: '08-1' }),
      'business', true, 'nu',
    );
    expect(row.reverse_vat).toBe(true);
    expect(row.payment_terms).toBe('30');
    expect(row.price_list).toBe('160');
    expect(row.invoice_email).toBe('faktura@acme.se');
    expect(row.phone).toBe('08-1');
    expect(buildFortnoxCustomerUpdateRow(fortnoxCustomer({ VATType: 'SEVAT' }), 'business', true, 'nu').reverse_vat).toBe(false);
  });

  // Kortet svarar "" för tomma fält; formuläret sparar tomt som null. "" hade sett ut som en ändring.
  it('sparar kortets tomma strängar som null', () => {
    const row = buildFortnoxCustomerUpdateRow(
      fortnoxCustomer({ TermsOfPayment: '', EmailInvoice: '', PriceList: ' ', Phone1: '' }),
      'business', true, 'nu',
    );
    expect(row.payment_terms).toBeNull();
    expect(row.invoice_email).toBeNull();
    expect(row.price_list).toBeNull();
    expect(row.phone).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// buildFortnoxListCustomerRow — massynkens rad ur Fortnox kundlista. Listan har
// bara tio fält (uppmätt mot testbolaget 2026-10-21); allt annat är kortets.
// ---------------------------------------------------------------------------

describe('buildFortnoxListCustomerRow', () => {
  // Listsvaret för testbolagets kund 20 (utan @url, e-posten utbytt), vars KORT har omvänd moms och prislista 160.
  const listed = {
    CustomerNumber: '20',
    Name: 'Testa Inbjudan',
    OrganisationNumber: '556000-0001',
    Email: 'kund@example.test',
    Phone: '0812345233',
    Address1: 'testbutiksvägen 14',
    Address2: null,
    ZipCode: '15123',
    City: 'södertest',
  };

  const CARD_ONLY_COLUMNS = [
    'reverse_vat', 'payment_terms', 'price_list', 'discount', 'vat_number', 'invoice_email',
    'mobile', 'visit_address', 'delivery_address', 'customer_type_verified',
  ];

  // 🧨 Före 2026-10-21 lästes listan som ett kort: varje omsynk skrev reverse_vat=false och null på
  // alla kortfält för samtliga kunder. En utelämnad kolumn rör inte det vi har; en null skriver över.
  it('utelämnar varje kolumn som bara kortet bär', () => {
    const row = buildFortnoxListCustomerRow(listed, 'business', 'nu');
    for (const column of CARD_ONLY_COLUMNS) expect(row, column).not.toHaveProperty(column);
  });

  it('läser telefonen ur listans Phone (kortets Phone1 finns inte i listan)', () => {
    expect(buildFortnoxListCustomerRow(listed, 'business', 'nu').phone).toBe('0812345233');
  });

  it('skriver det listan har: namn, org.nr, e-post och fakturaadress', () => {
    const row = buildFortnoxListCustomerRow(listed, 'business', 'nu');
    expect(row.company_name).toBe('Testa Inbjudan');
    expect(row.organization_number).toBe('556000-0001');
    expect(row.email).toBe('kund@example.test');
    expect(row.invoice_address).toEqual({ street: 'testbutiksvägen 14', postal_code: '15123', city: 'södertest' });
    expect(row.fortnox_customer_id).toBe('20');
  });

  it('lägger nummer och namn i privatkolumnerna för en privatkund', () => {
    const row = buildFortnoxListCustomerRow({ ...listed, Name: 'Tolvan Tolvansson', OrganisationNumber: '19121212-1212' }, 'private', 'nu');
    expect(row.first_name).toBe('Tolvan');
    expect(row.last_name).toBe('Tolvansson');
    expect(row.personal_number).toBe('19121212-1212');
    expect(row.organization_number).toBeNull();
    expect(row.company_name).toBeNull();
  });

  it('sparar listans tomma strängar som null', () => {
    const row = buildFortnoxListCustomerRow({ ...listed, Email: '', Phone: ' ', Address1: '', ZipCode: '', City: '' }, 'business', 'nu');
    expect(row.email).toBeNull();
    expect(row.phone).toBeNull();
    expect(row.invoice_address).toBeNull();
  });

  // Formuläret sparar trimmat och tomt som null — samma värde härifrån, annars ser fortnoxCustomerFieldsChanged en ändring.
  it('trimmar värden och tömmer tomma adressdelar som formuläret gör', () => {
    const row = buildFortnoxListCustomerRow({ ...listed, Email: ' kund@example.test ', Address1: ' ', ZipCode: '', City: 'Stockholm' }, 'business', 'nu');
    expect(row.email).toBe('kund@example.test');
    expect(row.invoice_address).toEqual({ street: null, postal_code: null, city: 'Stockholm' });
  });
});

// ---------------------------------------------------------------------------
// fortnoxLastModifiedParam / customersChangedSince — från när synken köar kunder
// som ändrats i Fortnox. Fortnox läser lastmodified som SVENSK tid (uppmätt).
// ---------------------------------------------------------------------------

// ⚠️ Explicita UTC-ögonblick. Under TZ=Europe/Stockholm hade en formatering utan explicit zon gett samma strängar — det
// är CI (UTC) som fäller den mutationen. Mutationsprövat under TZ=UTC.
describe('fortnoxLastModifiedParam', () => {
  it('skriver ögonblicket i svensk sommartid (det uppmätta fallet: 09:37 UTC = 11:37)', () => {
    expect(fortnoxLastModifiedParam(new Date('2026-10-20T09:37:00Z'))).toBe('2026-10-20 11:37');
  });

  it('skriver vintertid, och midnatt som 00 med datumet efter', () => {
    expect(fortnoxLastModifiedParam(new Date('2026-01-15T23:30:00Z'))).toBe('2026-01-16 00:30');
  });

  // Timmen 02:00–03:00 går två gånger när sommartiden slutar: två ögonblick, en sträng. Fortnox kan inte skilja dem åt
  // — det är en av anledningarna till marginalen i customersChangedSince.
  it('ger samma sträng för båda varven av timmen som upprepas när sommartiden slutar', () => {
    expect(fortnoxLastModifiedParam(new Date('2026-10-25T00:30:00Z'))).toBe('2026-10-25 02:30');
    expect(fortnoxLastModifiedParam(new Date('2026-10-25T01:30:00Z'))).toBe('2026-10-25 02:30');
  });
});

describe('customersChangedSince', () => {
  it('är null — köa alla — när förra synken är okänd', () => {
    expect(customersChangedSince(null)).toBeNull();
    expect(customersChangedSince(undefined)).toBeNull();
    expect(customersChangedSince('')).toBeNull();
    expect(customersChangedSince('inte ett datum')).toBeNull();
  });

  it('ligger två timmar före förra synken', () => {
    const lastSync = '2026-10-20T10:00:00.000Z';
    expect(new Date(lastSync).getTime() - customersChangedSince(lastSync)!.getTime()).toBe(2 * 60 * 60 * 1000);
  });
});
