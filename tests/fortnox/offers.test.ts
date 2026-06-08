import { describe, it, expect } from 'vitest';
import { buildOfferRows, snapshotToFortnoxSource } from '@/lib/domains/fortnox/offers';
import { buildFortnoxCustomerPayload } from '@/lib/domains/fortnox/customers';

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

  it('sets HouseWork only when ROT is enabled and the row is ROT work', () => {
    const [rotRow] = buildOfferRows([{ unit_price: '100', quantity: '1', is_rot_work: true }], 25, true);
    expect(rotRow.HouseWork).toBe(true);
    expect(rotRow.HouseWorkType).toBe('CONSTRUCTION');

    const [notRot] = buildOfferRows([{ unit_price: '100', quantity: '1', is_rot_work: false }], 25, true);
    expect(notRot.HouseWork).toBeUndefined();

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

  it('maps the main address to Address1/ZipCode/City and the delivery string to Delivery*', () => {
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
    // No separate delivery postal/city on the snapshot – reuse the main ones.
    expect(payload.DeliveryZipCode).toBe('11122');
    expect(payload.DeliveryCity).toBe('Stockholm');
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
