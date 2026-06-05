import { describe, it, expect } from 'vitest';
import {
  buildFortnoxCustomerPayload,
  fortnoxCustomerFieldsChanged,
  type FortnoxCustomerSource,
} from '@/lib/domains/fortnox/customers';

function source(overrides: Partial<FortnoxCustomerSource> = {}): FortnoxCustomerSource {
  return {
    customer_type: 'business',
    company_name: 'Acme AB',
    first_name: null,
    last_name: null,
    organization_number: '556000-0000',
    email: 'info@acme.se',
    phone: '08-123',
    mobile: '070-123',
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
      source({ email: null, vat_number: null, invoice_address: null, delivery_address: null }),
    );
    expect(payload.Email).toBeUndefined();
    expect(payload.VATNumber).toBeUndefined();
    expect(payload.Address1).toBeUndefined();
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

  it('ignorerar fält som inte pushas (t.ex. status/notes/visit_address)', () => {
    const before = { ...source(), status: 'active', notes: 'a', visit_address: { street: 'X', postal_code: null, city: null } } as any;
    const after = { ...source(), status: 'inactive', notes: 'b', visit_address: { street: 'Y', postal_code: null, city: null } } as any;
    expect(fortnoxCustomerFieldsChanged(before, after)).toBe(false);
  });

  it('returnerar true när ett skalärt Fortnox-fält ändras', () => {
    expect(fortnoxCustomerFieldsChanged(source(), source({ payment_terms: '10' }))).toBe(true);
    expect(fortnoxCustomerFieldsChanged(source(), source({ reverse_vat: true }))).toBe(true);
  });

  it('returnerar true när en adress ändras (djupjämförelse)', () => {
    const after = source({ invoice_address: { street: 'Gatan 2', postal_code: '11122', city: 'Stockholm' } });
    expect(fortnoxCustomerFieldsChanged(source(), after)).toBe(true);
  });

  it('behandlar null/undefined som ändrat (säker default → pusha)', () => {
    expect(fortnoxCustomerFieldsChanged(null, source())).toBe(true);
    expect(fortnoxCustomerFieldsChanged(source(), undefined)).toBe(true);
  });
});
