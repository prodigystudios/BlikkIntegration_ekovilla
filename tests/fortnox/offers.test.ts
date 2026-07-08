import { describe, it, expect } from 'vitest';
import { buildOfferRows, snapshotToFortnoxSource } from '@/lib/domains/fortnox/offers';
import { buildFortnoxCustomerPayload } from '@/lib/domains/fortnox/customers';
import { ROT_LABOR_ARTICLE_NUMBER } from '@/lib/domains/fortnox/helpers';

type QuoteArg = Parameters<typeof snapshotToFortnoxSource>[0];

function quote(snapshot: Record<string, unknown>): QuoteArg {
  return { customer_snapshot: snapshot, customer_name: null } as QuoteArg;
}

describe('buildOfferRows', () => {
  it('returns an empty array for no line items', () => {
    expect(buildOfferRows([], 25, false)).toEqual([]);
  });

  it('parses Swedish comma decimals for price and quantity (regression for parseFloat truncation)', () => {
    const [row] = buildOfferRows([{ pricing_mode: 'item', unit_price: '12,50', quantity: '1,5' }], 25, false);
    expect(row.Price).toBe(12.5);
    expect(row.Quantity).toBe(1.5);
  });

  it('sends the computed m³ volume as Quantity, not the empty quantity field (regression)', () => {
    const [row] = buildOfferRows([{ pricing_mode: 'm3', m2: '100', thickness_mm: '200', unit_price: '700' }], 25, false);
    expect(row.Quantity).toBe(20);
    expect(row.Price).toBe(700);
  });

  it('forces 0 % VAT on rows for reverse charge (byggmoms), else the passed vatPercent', () => {
    const [reverse] = buildOfferRows([{ pricing_mode: 'item', unit_price: '100', quantity: '1' }], 25, false, true);
    expect(reverse.VAT).toBe(0);
    const [normal] = buildOfferRows([{ pricing_mode: 'item', unit_price: '100', quantity: '1' }], 25, false, false);
    expect(normal.VAT).toBe(25);
  });

  it('adds a separate text row for measurements (m² + thickness)', () => {
    const rows = buildOfferRows([{ pricing_mode: 'm3', article_name: 'Lösull', m2: '100', thickness_mm: '200', unit_price: '700' }], 25, false);
    expect(rows).toHaveLength(2);
    expect(rows[0].Description).toBe('Lösull');
    expect(rows[1].Description).toBe('Yta: 100 m², Tjocklek: 200 mm');
    // Text-only row carries no amounts.
    expect(rows[1].Quantity).toBeUndefined();
    expect(rows[1].Price).toBeUndefined();
    expect(rows[1].ArticleNumber).toBeUndefined();
  });

  it('omits the measurement row when there are no measurements', () => {
    const rows = buildOfferRows([{ unit_price: '100', quantity: '1' }], 25, false);
    expect(rows).toHaveLength(1);
  });

  it('adds a separate text row for the per-row free text (Radtext) when an article is chosen', () => {
    const rows = buildOfferRows([{ article_name: 'Lösull', unit_price: '100', quantity: '1', line_note: 'Extra tätning vid genomföringar' }], 25, false);
    expect(rows).toHaveLength(2);
    expect(rows[0].Description).toBe('Lösull');
    expect(rows[1].Description).toBe('Extra tätning vid genomföringar');
    expect(rows[1].Price).toBeUndefined();
    expect(rows[1].Quantity).toBeUndefined();
  });

  it('does not duplicate the Radtext as a text row when it is already the row Description (no article name)', () => {
    const rows = buildOfferRows([{ unit_price: '100', quantity: '1', line_note: 'Bara en fritextrad' }], 25, false);
    expect(rows).toHaveLength(1);
    expect(rows[0].Description).toBe('Bara en fritextrad');
  });

  it('combines measurement + Radtext into ONE text row under the article (not two)', () => {
    // Two separate text rows make Fortnox treat the second as a priced product row, so the
    // measurement and Radtext must share a single text row. Fortnox strips newlines and rejects
    // punctuation like em-dashes, so they're separated by a double space on one line.
    const rows = buildOfferRows(
      [{ pricing_mode: 'm3', article_name: 'Lösull', m2: '100', thickness_mm: '200', unit_price: '700', line_note: 'Vindsbjälklag' }],
      25, false,
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].Description).toBe('Lösull');
    expect(rows[1].Description).toBe('Yta: 100 m², Tjocklek: 200 mm  Vindsbjälklag');
    expect(rows[1].Quantity).toBeUndefined();
    expect(rows[1].Price).toBeUndefined();
  });

  it('appends the ROT property note as a trailing text row (after a priced article row)', () => {
    const rows = buildOfferRows(
      [{ pricing_mode: 'item', article_name: 'Lösull', unit_price: '100', quantity: '1' }],
      25, false, false, 'Fastighetsbeteckning: Haggården 6:3',
    );
    expect(rows).toHaveLength(2);
    expect(rows[1]).toEqual({ Description: 'Fastighetsbeteckning: Haggården 6:3' });
  });

  it('MERGES the ROT note into the measurement/Radtext row so there are never two consecutive text rows', () => {
    // The last item already emits a measurement+Radtext text row; the ROT note must join it, not
    // become a second consecutive text row (which Fortnox turns into a bogus priced row).
    const rows = buildOfferRows(
      [{ pricing_mode: 'm3', article_name: 'Lösull', m2: '100', thickness_mm: '200', unit_price: '700', line_note: 'Vindsbjälklag' }],
      25, false, false, 'Fastighetsbeteckning: Haggården 6:3',
    );
    expect(rows).toHaveLength(2);
    expect(rows[1].Description).toBe('Yta: 100 m², Tjocklek: 200 mm  Vindsbjälklag  Fastighetsbeteckning: Haggården 6:3');
    expect(rows[1].Price).toBeUndefined();
  });

  it('falls back to article_price when unit_price is empty', () => {
    const [row] = buildOfferRows([{ pricing_mode: 'item', unit_price: '', article_price: 900, quantity: '5' }], 25, false);
    expect(row.Price).toBe(900);
    expect(row.Quantity).toBe(5);
  });

  it('maps article number, unit, description and VAT', () => {
    const [row] = buildOfferRows(
      [{ article_number: 'A1', article_name: 'Lösull', article_unit_name: 'm³', unit_price: '100', quantity: '2' }],
      25,
      false,
    );
    expect(row.ArticleNumber).toBe('A1');
    expect(row.Description).toBe('Lösull');
    expect(row.Unit).toBe('m³');
    expect(row.VAT).toBe(25);
  });

  it('only sets Discount when greater than zero, parsing comma decimals', () => {
    const [withDiscount] = buildOfferRows([{ unit_price: '100', quantity: '1', discount_percent: '12,5' }], 25, false);
    expect(withDiscount.Discount).toBe(12.5);
    const [noDiscount] = buildOfferRows([{ unit_price: '100', quantity: '1', discount_percent: '0' }], 25, false);
    expect(noDiscount.Discount).toBeUndefined();
  });

  // Regression: discount_percent is a PERCENT. Fortnox defaults DiscountType to AMOUNT (kr),
  // so without DiscountType:'PERCENT' a 25% discount is booked as 25 kr off and the offer
  // total diverges from the quote. A row with no discount must not carry DiscountType.
  it('sends DiscountType PERCENT alongside a discount, and none when there is no discount', () => {
    const [withDiscount] = buildOfferRows([{ unit_price: '100', quantity: '1', discount_percent: '25' }], 25, false);
    expect(withDiscount.Discount).toBe(25);
    expect(withDiscount.DiscountType).toBe('PERCENT');
    const [noDiscount] = buildOfferRows([{ unit_price: '100', quantity: '1', discount_percent: '0' }], 25, false);
    expect(noDiscount.DiscountType).toBeUndefined();
  });

  it('sets HouseWork only for ROT rows, and OMITS it otherwise (never sends false)', () => {
    const [rotRow] = buildOfferRows([{ unit_price: '100', quantity: '1', is_rot_work: true }], 25, true);
    expect(rotRow.HouseWork).toBe(true);
    expect(rotRow.HouseWorkType).toBe('CONSTRUCTION');

    // A non-ROT row must NOT carry HouseWork at all — sending false makes Fortnox stamp an empty
    // husarbete type ('EMPTYHOUSEWORK') that a non-ROT document rejects (2004021).
    const [notRot] = buildOfferRows([{ unit_price: '100', quantity: '1', is_rot_work: false }], 25, true);
    expect(notRot.HouseWork).toBeUndefined();
    expect(notRot.HouseWorkType).toBeUndefined();

    const [rotDisabled] = buildOfferRows([{ unit_price: '100', quantity: '1', is_rot_work: true }], 25, false);
    expect(rotDisabled.HouseWork).toBeUndefined();
  });

  it('uses each row\'s own HouseWorkType, defaulting to CONSTRUCTION', () => {
    const rows = buildOfferRows(
      [
        { unit_price: '100', quantity: '1', is_rot_work: true, house_work_type: 'ELECTRICITY' },
        { unit_price: '100', quantity: '1', is_rot_work: true }, // no type → default
      ],
      25,
      true,
    );
    expect(rows[0].HouseWorkType).toBe('ELECTRICITY');
    expect(rows[1].HouseWorkType).toBe('CONSTRUCTION');
  });

  it('falls back to line_note then "Artikel" for the description', () => {
    expect(buildOfferRows([{ line_note: 'Frakt', unit_price: '50', quantity: '1' }], 25, false)[0].Description).toBe('Frakt');
    expect(buildOfferRows([{ unit_price: '50', quantity: '1' }], 25, false)[0].Description).toBe('Artikel');
  });
});

describe('buildOfferRows – ROT labour carve-out', () => {
  it('carves labor_cost out of a material row into one aggregated Arbetskostnad ROT row (total unchanged)', () => {
    const rows = buildOfferRows(
      [{ pricing_mode: 'item', article_name: 'Lösull', article_number: '1001', unit_price: '200', quantity: '100', labor_cost: '8000' }],
      25, true,
    );
    expect(rows).toHaveLength(2);
    const [material, labor] = rows;
    // Material reduced by the carved labour: 20000 net − 8000 = 12000 over 100 units = 120/unit.
    expect(material.Price).toBeCloseTo(120, 6);
    expect(material.Quantity).toBe(100);
    expect(material.HouseWork).toBeUndefined(); // material is never husarbete
    // Aggregated labour row: the carved sum on article 10058, flagged husarbete Bygg.
    expect(labor.ArticleNumber).toBe(ROT_LABOR_ARTICLE_NUMBER);
    expect(labor.Description).toBe('Arbetskostnad ROT');
    expect(labor.Price).toBe(8000);
    expect(labor.Quantity).toBe(1);
    expect(labor.HouseWork).toBe(true);
    expect(labor.HouseWorkType).toBe('CONSTRUCTION');
    // Document total is preserved: material (12000) + labour (8000) = 20000.
    expect(material.Quantity! * material.Price! + labor.Quantity! * labor.Price!).toBeCloseTo(20000, 6);
  });

  it('sums carved labour across rows into a single aggregated row', () => {
    const rows = buildOfferRows(
      [
        { pricing_mode: 'item', unit_price: '200', quantity: '100', labor_cost: '8000' },
        { pricing_mode: 'item', unit_price: '100', quantity: '50', labor_cost: '2000' },
      ],
      25, true,
    );
    const labor = rows[rows.length - 1];
    expect(labor.ArticleNumber).toBe(ROT_LABOR_ARTICLE_NUMBER);
    expect(labor.Price).toBe(10000);
  });

  it('clamps a labor_cost larger than the row total to the row (material floors at 0)', () => {
    const rows = buildOfferRows(
      [{ pricing_mode: 'item', unit_price: '100', quantity: '10', labor_cost: '99999' }],
      25, true,
    );
    // rowNet = 1000 → labour clamped to 1000, material 0.
    expect(rows[0].Price).toBe(0);
    expect(rows[rows.length - 1].Price).toBe(1000);
  });

  it('ignores labor_cost when the row is flagged as full ROT work (whole row is the labour)', () => {
    const rows = buildOfferRows(
      [{ pricing_mode: 'item', unit_price: '100', quantity: '10', is_rot_work: true, labor_cost: '500' }],
      25, true,
    );
    // No carve → single row, full price, husarbete on the row itself, no aggregated labour row.
    expect(rows).toHaveLength(1);
    expect(rows[0].Price).toBe(100);
    expect(rows[0].HouseWork).toBe(true);
  });

  it('ignores labor_cost when ROT is disabled', () => {
    const rows = buildOfferRows(
      [{ pricing_mode: 'item', unit_price: '100', quantity: '10', labor_cost: '500' }],
      25, false,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].Price).toBe(100);
  });

  it('bakes discount into a carved material row and drops the Discount line', () => {
    const rows = buildOfferRows(
      [{ pricing_mode: 'item', unit_price: '100', quantity: '10', discount_percent: '10', labor_cost: '200' }],
      25, true,
    );
    // rowNet = 10 × 100 × 0.9 = 900; material = 900 − 200 = 700 over 10 = 70/unit; Discount dropped.
    expect(rows[0].Price).toBeCloseTo(70, 6);
    expect(rows[0].Discount).toBeUndefined();
    expect(rows[rows.length - 1].Price).toBe(200);
  });

  it('keeps material + aggregated labour summing EXACTLY to the row total on a non-divisible quantity', () => {
    // rowNet = 300, carve 10 → material 290 / 3 = 96.6667 → Fortnox would round the unit price and
    // drift. The split rounds material to 96.67 and lets the labour absorb the 0.01 residual so the
    // two rows' rounded totals still tie back to 300.00 (regression for the rounding-drift finding).
    const rows = buildOfferRows(
      [{ pricing_mode: 'item', unit_price: '100', quantity: '3', labor_cost: '10' }],
      25, true,
    );
    const material = rows[0];
    const labor = rows.find((r) => r.ArticleNumber === ROT_LABOR_ARTICLE_NUMBER)!;
    expect(material.Price).toBe(96.67);
    const materialTotal = Math.round(material.Quantity! * material.Price! * 100) / 100; // 290.01
    const total = Math.round((materialTotal + labor.Quantity! * labor.Price!) * 100) / 100;
    expect(total).toBe(300);
  });
});

// The quote auto-create path must produce the SAME Fortnox customer payload as the
// customer form – i.e. go through buildFortnoxCustomerPayload via snapshotToFortnoxSource.
describe('snapshotToFortnoxSource → buildFortnoxCustomerPayload', () => {
  it('maps a business snapshot to COMPANY with org number in OrganisationNumber', () => {
    const payload = buildFortnoxCustomerPayload(
      snapshotToFortnoxSource(quote({ company_name: 'Acme AB', organization_number: '556000-0001', email: 'a@acme.se', phone: '08-1' })),
    );
    expect(payload.Type).toBe('COMPANY');
    expect(payload.Name).toBe('Acme AB');
    expect(payload.OrganisationNumber).toBe('556000-0001');
    expect(payload.Email).toBe('a@acme.se');
    expect(payload.Phone1).toBe('08-1');
  });

  it('maps a private snapshot to PRIVATE with personal number in OrganisationNumber (the fix)', () => {
    const payload = buildFortnoxCustomerPayload(
      snapshotToFortnoxSource(quote({ customer_name: 'Anna Svensson', personal_number: '900101-1234' })),
    );
    expect(payload.Type).toBe('PRIVATE');
    expect(payload.Name).toBe('Anna Svensson');
    expect(payload.OrganisationNumber).toBe('900101-1234');
  });

  it('maps the main address to Address1/ZipCode/City; a delivery street with no own postal/city does NOT borrow the main ones', () => {
    const payload = buildFortnoxCustomerPayload(
      snapshotToFortnoxSource(quote({
        company_name: 'Acme AB',
        street_address: 'Gatan 1', postal_code: '11122', city: 'Stockholm',
        delivery_address: 'Lagervägen 2',
      })),
    );
    expect(payload.Address1).toBe('Gatan 1');
    expect(payload.ZipCode).toBe('11122');
    expect(payload.City).toBe('Stockholm');
    expect(payload.DeliveryAddress1).toBe('Lagervägen 2');
    // The job may be in another locality — borrowing the customer's postcode/city would be
    // wrong, so they're omitted (and the work order omits them too, keeping the two in sync).
    expect(payload.DeliveryZipCode).toBeUndefined();
    expect(payload.DeliveryCity).toBeUndefined();
  });

  it('uses the structured work/delivery postal+city when present (company job at a different site)', () => {
    const payload = buildFortnoxCustomerPayload(
      snapshotToFortnoxSource(quote({
        company_name: 'Acme AB',
        street_address: 'Gatan 1', postal_code: '11122', city: 'Stockholm',
        delivery_address: 'Industrivägen 4', delivery_postal_code: '15242', delivery_city: 'Södertälje',
      })),
    );
    // Invoice/main address stays the office; delivery carries the job site, fully structured.
    expect(payload.Address1).toBe('Gatan 1');
    expect(payload.ZipCode).toBe('11122');
    expect(payload.City).toBe('Stockholm');
    expect(payload.DeliveryAddress1).toBe('Industrivägen 4');
    expect(payload.DeliveryZipCode).toBe('15242');
    expect(payload.DeliveryCity).toBe('Södertälje');
  });
});
