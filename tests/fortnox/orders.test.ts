import { describe, it, expect } from 'vitest';
import { buildOrderRows, buildOrderDeliveryFields, resolveYourReference, orderReferenceNumberField } from '@/lib/domains/fortnox/orders';
import { ROT_LABOR_ARTICLE_NUMBER } from '@/lib/domains/fortnox/helpers';

describe('buildOrderRows', () => {
  it('returns an empty array for no line items', () => {
    expect(buildOrderRows([], 25, false)).toEqual([]);
  });

  // Regression: Fortnox order rows require `OrderedQuantity`, not `Quantity` (offer rows
  // use Quantity). Sending Quantity to /orders returns 400 "Felaktigt fältnamn (Quantity)".
  it('uses OrderedQuantity (not Quantity) for order rows', () => {
    const [row] = buildOrderRows([{ pricing_mode: 'item', unit_price: '100', quantity: '3' }], 25, false);
    expect((row as any).OrderedQuantity).toBe(3);
    expect((row as any).Quantity).toBeUndefined();
    expect(row.Price).toBe(100);
  });

  // Fortnox invoices the delivered quantity, so delivered must equal ordered or the row
  // sum stays 0 (new rows) / stale (edited rows).
  it('sets DeliveredQuantity equal to OrderedQuantity', () => {
    const [row] = buildOrderRows([{ pricing_mode: 'item', unit_price: '100', quantity: '3' }], 25, false);
    expect((row as any).DeliveredQuantity).toBe(3);
    expect((row as any).DeliveredQuantity).toBe((row as any).OrderedQuantity);
  });

  it('sends the computed m³ volume as both ordered and delivered quantity', () => {
    const [row] = buildOrderRows([{ pricing_mode: 'm3', m2: '100', thickness_mm: '200', unit_price: '700' }], 25, false);
    expect((row as any).OrderedQuantity).toBe(20);
    expect((row as any).DeliveredQuantity).toBe(20);
  });

  it('clamps discount to [0,100] so the Fortnox row matches the CRM pricing', () => {
    const [over] = buildOrderRows([{ pricing_mode: 'item', unit_price: '100', quantity: '1', discount_percent: '150' }], 25, false);
    expect((over as any).Discount).toBe(100);
    const [normal] = buildOrderRows([{ pricing_mode: 'item', unit_price: '100', quantity: '1', discount_percent: '25' }], 25, false);
    expect((normal as any).Discount).toBe(25);
  });

  // Regression: a CRM percentage discount must be sent with DiscountType:'PERCENT', else
  // Fortnox treats Discount as kronor (its AMOUNT default) and the order/invoice total drifts.
  it('sends DiscountType PERCENT with a discount, and omits it when there is no discount', () => {
    const [withDiscount] = buildOrderRows([{ pricing_mode: 'item', unit_price: '100', quantity: '1', discount_percent: '25' }], 25, false);
    expect((withDiscount as any).Discount).toBe(25);
    expect((withDiscount as any).DiscountType).toBe('PERCENT');
    const [noDiscount] = buildOrderRows([{ pricing_mode: 'item', unit_price: '100', quantity: '1' }], 25, false);
    // ⚠️ Nollan skickas. Ett utelämnat Discount lämnar Fortnox gamla procent orörd på en rad-PUT,
    // så en borttagen rabatt hade aldrig gått fram. Se FORTNOX_TEXT_ROW i helpers.ts.
    expect((noDiscount as any).DiscountType).toBe('PERCENT');
    expect((noDiscount as any).Discount).toBe(0);
  });

  it('marks HouseWork only when ROT is enabled and the row is rot work', () => {
    const [withRot] = buildOrderRows([{ pricing_mode: 'item', unit_price: '100', quantity: '1', is_rot_work: true }], 25, true);
    expect((withRot as any).HouseWork).toBe(true);
    // Non-ROT → HouseWork omitted (never false — that stamps EMPTYHOUSEWORK and 2004021).
    const [withoutRot] = buildOrderRows([{ pricing_mode: 'item', unit_price: '100', quantity: '1', is_rot_work: true }], 25, false);
    expect((withoutRot as any).HouseWork).toBeUndefined();
  });

  // The per-row free text (Radtext) reaches Fortnox as its own text row (no amounts) after
  // the article row — otherwise it is dropped whenever an article is chosen.
  it('adds a text-only row for the Radtext when an article name is present', () => {
    const rows = buildOrderRows([{ article_name: 'Lösull', unit_price: '100', quantity: '1', line_note: 'Extra tätning' }], 25, false);
    expect(rows).toHaveLength(2);
    expect(rows[0].Description).toBe('Lösull');
    expect(rows[1].Description).toBe('Extra tätning');
    // Uttryckliga tomvärden, inte utelämnade fält — annars ärver textraden artikel/pris från raden
    // som låg på positionen förut. Ordern glider garanterat när en rad skrivs av.
    expect((rows[1] as any).OrderedQuantity).toBe(0);
    expect((rows[1] as any).DeliveredQuantity).toBe(0);
    expect((rows[1] as any).Price).toBe(0);
    expect((rows[1] as any).ArticleNumber).toBeNull();
  });

  it('does not duplicate the Radtext when it is already the row Description (no article name)', () => {
    const rows = buildOrderRows([{ unit_price: '100', quantity: '1', line_note: 'Bara fritext' }], 25, false);
    expect(rows).toHaveLength(1);
    expect(rows[0].Description).toBe('Bara fritext');
  });

  // 🧨 Samma vakt som på offertsidan: Fortnox rad-PUT uppdaterar per position och ärver det vi
  // utelämnar. Ordern glider garanterat — en avskriven rad faller bort ur pushen
  // (activeLineItems) och förskjuter varje rad under sig vid nästa omsynk.
  it('varje rad bär varje fält, även tomma — annars ärver den raden som låg på positionen förut', () => {
    const rows = buildOrderRows([
      { pricing_mode: 'm3', article_name: 'Lösull', article_number: '2410509', article_unit_name: 'm3', m2: '100', thickness_mm: '200', unit_price: '700', discount_percent: '10', line_note: 'Vindsbjälklag' },
      { pricing_mode: 'item', unit_price: '100', quantity: '1' },
    ], 25, false);

    expect(rows.length).toBeGreaterThan(2);
    for (const row of rows) {
      // ⚠️ Kontrollen görs på den SERIALISERADE raden, inte på objektet. `toHaveProperty` går
      // igenom för ett fält satt till `undefined` — men `JSON.stringify` slänger det, så payloaden
      // till Fortnox hade saknat fältet med testet grönt. Det är payloaden som är kontraktet.
      const payload = JSON.parse(JSON.stringify(row));
      for (const field of ['ArticleNumber', 'Description', 'OrderedQuantity', 'DeliveredQuantity', 'Price', 'Unit', 'Discount', 'DiscountType', 'VAT'] as const) {
        expect(payload).toHaveProperty(field);
      }
    }
  });

  it('forces 0 % VAT on rows for reverse charge (byggmoms), else the passed vatPercent', () => {
    const [reverse] = buildOrderRows([{ pricing_mode: 'item', unit_price: '100', quantity: '1' }], 25, false, true);
    expect((reverse as any).VAT).toBe(0);
    const [normal] = buildOrderRows([{ pricing_mode: 'item', unit_price: '100', quantity: '1' }], 25, false, false);
    expect((normal as any).VAT).toBe(25);
  });

  it('appends the ROT property note as a trailing text row (standalone-order path)', () => {
    const rows = buildOrderRows(
      [{ article_name: 'Lösull', unit_price: '100', quantity: '1' }],
      25, true, false, 'Fastighetsbeteckning: Haggården 6:3  BRF org.nr: 769600-1234',
    );
    expect(rows).toHaveLength(2);
    expect(rows[1].Description).toBe('Fastighetsbeteckning: Haggården 6:3  BRF org.nr: 769600-1234');
    expect((rows[1] as any).OrderedQuantity).toBe(0);
    expect((rows[1] as any).ArticleNumber).toBeNull();
  });
});

describe('buildOrderRows – ROT labour carve-out', () => {
  it('carves labor_cost out of a material row into one aggregated Arbetskostnad ROT row', () => {
    const rows = buildOrderRows(
      // 80 kr/enhet arbete av A-priset 200 → 8 000 kr över 100 enheter.
      [{ pricing_mode: 'item', article_name: 'Lösull', unit_price: '200', quantity: '100', labor_cost: '80' }],
      25, true,
    );
    expect(rows).toHaveLength(2);
    const [material, labor] = rows as any[];
    expect(material.Price).toBeCloseTo(120, 6); // 12000 material over 100 units
    expect(material.OrderedQuantity).toBe(100);
    expect(material.DeliveredQuantity).toBe(100);
    expect(material.HouseWork).toBeUndefined();      // material är aldrig husarbete
    expect(labor.ArticleNumber).toBe(ROT_LABOR_ARTICLE_NUMBER);
    expect(labor.Price).toBe(8000);
    expect(labor.OrderedQuantity).toBe(1);
    expect(labor.DeliveredQuantity).toBe(1);
    expect(labor.HouseWork).toBe(true);
    expect(labor.HouseWorkType).toBe('CONSTRUCTION');
  });

  it('leaves fully-flagged ROT rows untouched and emits no aggregated row', () => {
    const rows = buildOrderRows(
      [{ pricing_mode: 'item', unit_price: '100', quantity: '10', is_rot_work: true, labor_cost: '500' }],
      25, true,
    );
    expect(rows).toHaveLength(1);
    expect((rows[0] as any).Price).toBe(100);
    expect((rows[0] as any).HouseWork).toBe(true);
  });
});

// Regressionsvakt för buggen som gjorde att en säljares ändrade arbetsadress aldrig nådde
// Fortnox: adressen redigeras i kolumnen `work_address`, men pushen läste
// `customer_snapshot.delivery_*`. Installatören såg den nya adressen, Fortnox den gamla.
describe('buildOrderDeliveryFields', () => {
  const customer = { street_address: 'Storgatan 1', postal_code: '11122', city: 'Stockholm' };

  it('sends nothing when the job is at the customer address', () => {
    expect(buildOrderDeliveryFields({ street_address: 'Storgatan 1', postal_code: '11122', city: 'Stockholm' }, customer)).toEqual({});
  });

  it('ignores case and surrounding whitespace when comparing the street', () => {
    expect(buildOrderDeliveryFields({ street_address: '  storgatan 1 ' }, customer)).toEqual({});
  });

  it('sends the delivery address when the job site differs', () => {
    expect(buildOrderDeliveryFields({ street_address: 'Verkstadsvägen 8', postal_code: '43900', city: 'Onsala' }, customer)).toEqual({
      DeliveryAddress1: 'Verkstadsvägen 8',
      DeliveryZipCode: '43900',
      DeliveryCity: 'Onsala',
    });
  });

  // The bug itself: an edited work_address must win over the snapshot the order was created with.
  it('prefers the edited work_address column over the snapshot delivery address', () => {
    const snapshot = { ...customer, delivery_address: 'Gamla vägen 2', delivery_postal_code: '11111', delivery_city: 'Solna' };
    expect(buildOrderDeliveryFields({ street_address: 'Nya vägen 4', postal_code: '22222', city: 'Lund' }, snapshot)).toEqual({
      DeliveryAddress1: 'Nya vägen 4',
      DeliveryZipCode: '22222',
      DeliveryCity: 'Lund',
    });
  });

  // Legacy rows created before work_address was seeded still have to push their job site. Keyed on
  // the COLUMN being absent — a present-but-blank street means the seller cleared it (see the
  // "rensad adress" block below), not that we should go looking in the snapshot.
  it('falls back to the snapshot delivery address for a row with no work_address at all', () => {
    const snapshot = { ...customer, delivery_address: 'Gamla vägen 2', delivery_postal_code: '11111', delivery_city: 'Solna' };
    expect(buildOrderDeliveryFields(null, snapshot)).toEqual({
      DeliveryAddress1: 'Gamla vägen 2',
      DeliveryZipCode: '11111',
      DeliveryCity: 'Solna',
    });
  });

  // Postal/city are sent as entered — borrowing the customer's would put the job in the wrong ort.
  it('omits postal code and city rather than borrowing the customer address', () => {
    expect(buildOrderDeliveryFields({ street_address: 'Verkstadsvägen 8' }, customer)).toEqual({
      DeliveryAddress1: 'Verkstadsvägen 8',
    });
  });

  it('sends nothing when there is no job site at all', () => {
    expect(buildOrderDeliveryFields(null, customer)).toEqual({});
    expect(buildOrderDeliveryFields({}, null)).toEqual({});
  });
});

// Fynd ur kodgranskningen: fallbacken kunde inte skilja "aldrig satt" från "medvetet tömd", så en
// raderad arbetsadress lämnade snapshotens gamla adress kvar — och pushade den igen.
describe('buildOrderDeliveryFields — rensad adress', () => {
  const snapshot = {
    street_address: 'Storgatan 1', postal_code: '11122', city: 'Stockholm',
    delivery_address: 'Gamla vägen 2', delivery_postal_code: '11111', delivery_city: 'Solna',
  };

  it('does not resurrect the snapshot address when the work address was cleared', () => {
    // Kolumnen FINNS men gatan är tömd → ingen separat arbetsplats, inte "leta i snapshoten".
    expect(buildOrderDeliveryFields({ street_address: '', postal_code: '', city: '' }, snapshot)).toEqual({});
    expect(buildOrderDeliveryFields({ street_address: '   ' }, snapshot)).toEqual({});
    expect(buildOrderDeliveryFields({}, snapshot)).toEqual({});
  });

  // Bakåtkompatibiliteten som fallbacken fanns för: rader som aldrig fick en work_address alls.
  it('still falls back for a legacy row that has no work_address column value', () => {
    expect(buildOrderDeliveryFields(null, snapshot)).toEqual({
      DeliveryAddress1: 'Gamla vägen 2',
      DeliveryZipCode: '11111',
      DeliveryCity: 'Solna',
    });
    expect(buildOrderDeliveryFields(undefined, snapshot)).toEqual({
      DeliveryAddress1: 'Gamla vägen 2',
      DeliveryZipCode: '11111',
      DeliveryCity: 'Solna',
    });
  });
});

// Er referens och kundkontakten delade tidigare ETT fält, så en rättad kontaktperson skrev om
// kundens formella referens i Fortnox — den som styr fakturan till rätt attestant.
describe('resolveYourReference', () => {
  it('uses the dedicated Er referens field when set', () => {
    expect(resolveYourReference({ your_reference: 'Inköp/Anna', contact_name: 'Platschef Emil' })).toBe('Inköp/Anna');
  });

  // De 15 ordrar som fanns när fältet delades saknar your_reference. Utan fallbacken hade deras
  // YourReference nollats i Fortnox vid nästa headersynk.
  it('falls back to contact_name for orders created before the split', () => {
    expect(resolveYourReference({ contact_name: 'Emil' })).toBe('Emil');
    expect(resolveYourReference({ your_reference: null, contact_name: 'Emil' })).toBe('Emil');
  });

  it('treats blanks as absent so a whitespace value never reaches Fortnox', () => {
    expect(resolveYourReference({ your_reference: '   ', contact_name: 'Emil' })).toBe('Emil');
    expect(resolveYourReference({ your_reference: '  ', contact_name: ' ' })).toBeNull();
  });

  it('returns null when there is nothing to send', () => {
    expect(resolveYourReference({})).toBeNull();
    expect(resolveYourReference(null)).toBeNull();
  });
});

// En avskriven rad ska inte längre finnas på Fortnox-dokumentet — kunden faktureras aldrig för
// arbete som inte utfördes, och orderns summa i Fortnox måste följa verkligheten.
describe('buildOrderRows — avskrivna rader', () => {
  it('utelämnar avskrivna rader ur Fortnox-ordern', () => {
    const rows = buildOrderRows([
      { article_name: 'Lösull', pricing_mode: 'item', unit_price: '100', quantity: '2' },
      { article_name: 'Ångbroms', pricing_mode: 'item', unit_price: '500', quantity: '1', written_off: true },
    ], 25, false);
    expect(rows).toHaveLength(1);
    expect(rows[0].Description).toBe('Lösull');
  });

  it('ger en tom radlista när allt är avskrivet', () => {
    const rows = buildOrderRows([
      { article_name: 'Lösull', pricing_mode: 'item', unit_price: '100', quantity: '2', written_off: true },
    ], 25, false);
    expect(rows).toEqual([]);
  });

  // Avskrivningen får inte råka slå av ROT-arbetskostnaden för de rader som ÄR kvar.
  it('räknar fortfarande ut ROT-arbetskostnaden på kvarvarande rader', () => {
    const rows = buildOrderRows([
      { pricing_mode: 'item', article_name: 'Lösull', unit_price: '200', quantity: '100', labor_cost: '80' },
      { pricing_mode: 'item', article_name: 'Struken', unit_price: '500', quantity: '1', written_off: true },
    ], 25, true);
    expect(rows).toHaveLength(2);
    expect((rows[1] as any).ArticleNumber).toBe(ROT_LABOR_ARTICLE_NUMBER);
    expect((rows[1] as any).Price).toBe(8000);
  });
});

// ── "Ert referensnummer" på orderhuvudet ──────────────────────────────────────
//
// Fältet bärs av två olika uppgifter som aldrig gäller samtidigt: företagskundens MÄRKNING och
// privatkundens FASTIGHETSBETECKNING (resolveRotReference väljer).
//
// Tre lägen sedan märkningen blev redigerbar på arbetsordern. Rensningen läses ur `label_cleared`
// — ett TILLSTÅND som mergeWorkOrderSnapshotOverrides skriver när den ser övergången — och aldrig
// ur att märkningen är tom, vilket är normalläget för i stort sett varje order.
describe('orderReferenceNumberField', () => {
  it('skriver referensnumret när det finns', () => {
    expect(orderReferenceNumberField('Projekt 4711', null)).toEqual({ YourOrderNumber: 'Projekt 4711' });
    expect(orderReferenceNumberField('Haggården 6:3', null)).toEqual({ YourOrderNumber: 'Haggården 6:3' });
  });

  // Ingen begäran att rensa → nyckeln UTELÄMNAS. En PUT rör bara fält den bär, så Fortnox behåller
  // sitt värde — rätt för en order vi inte har någon åsikt om, och det som håller headern tom så
  // syncWorkOrderHeaderToFortnox kan hoppa över PUT:en helt.
  it('utelämnar fältet när inget värde finns och ingenting rensats', () => {
    expect(orderReferenceNumberField(null, null)).toEqual({});
    expect(orderReferenceNumberField('', {})).toEqual({});
    expect(orderReferenceNumberField(null, { label_cleared: false })).toEqual({});
    // ⚠️ TOM MÄRKNING RÄCKER INTE. Det är normalläget för i stort sett varje order
    // (buildCustomerSnapshot skriver alltid nyckeln) — bara det uttryckliga minnet av en
    // tömning rensar, annars hade referensnummer satta för hand i Fortnox blankats i klump.
    expect(orderReferenceNumberField(null, { label: null } as any)).toEqual({});
  });

  // 🧨 null, INTE ''. Uppmätt i drift 2026-08-20: '' accepteras men rensar inte, null rensar.
  // Ett '' här hade sett ut att blanka kundens referensnummer utan att göra det.
  it('en registrerad tömning skickar null', () => {
    expect(orderReferenceNumberField(null, { label_cleared: true })).toEqual({ YourOrderNumber: null });
    expect(orderReferenceNumberField('', { label_cleared: true })).toEqual({ YourOrderNumber: null });
  });

  // 🧨 Anroparen stänger av rensningen genom att skicka null i stället för snapshoten. Det är så
  // skapandevägen och radsynken hålls utanför: `null` är uppmätt för RADfält, inte för headerfält,
  // och skulle Fortnox avvisa det hade varje artikelredigering och varje "Synka om" kastat — med
  // ordern kvar på 'failed' och faktureringen spärrad av assertOrderRowsSynced. Kvar blir en enda
  // väg som kan misslyckas, och den är icke-fatal.
  it('rensning stängs av genom att snapshoten inte skickas med', () => {
    expect(orderReferenceNumberField(null, null)).toEqual({});
  });

  // 🧨 På en ROT-order ÄR referensnumret fastighetsbeteckningen. En tömd märkning får aldrig
  // blanka den — de två delar Fortnox-fält, och bara den ena av dem är det säljaren tog bort.
  it('referensnumret vinner alltid över en registrerad tömning', () => {
    expect(orderReferenceNumberField('Haggården 6:3', { label_cleared: true }))
      .toEqual({ YourOrderNumber: 'Haggården 6:3' });
  });
});
