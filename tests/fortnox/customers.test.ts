import { describe, it, expect } from 'vitest';
import {
  buildFortnoxCustomerPayload,
  fortnoxCustomerFieldsChanged,
  splitSwedishName,
  buildFortnoxAddress,
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

  it('skickar mobil i det dedikerade Mobile-fältet (inte Phone2)', () => {
    const payload = buildFortnoxCustomerPayload(source({ mobile: '070-123' }));
    expect(payload.Mobile).toBe('070-123');
    expect(payload).not.toHaveProperty('Phone2');
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
