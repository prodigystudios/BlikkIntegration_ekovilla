import { describe, it, expect, vi, beforeEach } from 'vitest';

// updateFortnoxCustomer mot en låtsasdatabas: att raden FÖRE redigeringen faktiskt når PUT-payloaden. Själva tömningsreglerna
// har egna tester i customers.test.ts (fortnoxCustomerClears).

const fortnoxPut = vi.fn();
vi.mock('@/lib/domains/fortnox/client', () => ({
  fortnoxGet: vi.fn(),
  fortnoxPost: vi.fn(),
  fortnoxPut: (...args: unknown[]) => fortnoxPut(...args),
}));

let row: Record<string, unknown>;
const supabase = {
  from: () => ({
    select: () => ({ eq: () => ({ single: async () => ({ data: row, error: null }) }) }),
    update: () => ({ eq: async () => ({ error: null }) }),
  }),
};
vi.mock('@/lib/supabase/server', () => ({ getSupabaseAdmin: () => supabase }));

import { updateFortnoxCustomer, type FortnoxCustomerSource } from '@/lib/domains/fortnox/customers';

const BEFORE: FortnoxCustomerSource = {
  customer_type: 'business', company_name: 'Acme AB', first_name: null, last_name: null,
  organization_number: '556000-0000', personal_number: null, email: 'info@acme.se', phone: '08-123', mobile: null,
  visit_address: null, invoice_address: { street: 'Gatan 1', postal_code: '11122', city: 'Stockholm' },
  delivery_address: null, invoice_email: 'faktura@acme.se', payment_terms: '30', price_list: 'B', discount: 5,
  vat_number: 'SE556000000001', reverse_vat: true, fortnox_customer_id: '42',
};

const sentCustomer = () => fortnoxPut.mock.calls[0][1].Customer;

beforeEach(() => {
  fortnoxPut.mockReset();
  fortnoxPut.mockResolvedValue({ Customer: { CustomerNumber: '42' } });
});

describe('updateFortnoxCustomer', () => {
  it('tömmer i Fortnox det redigeringen tömde', async () => {
    row = { ...BEFORE, phone: null, invoice_email: null, discount: null };
    await updateFortnoxCustomer('c1', { before: BEFORE });

    expect(fortnoxPut).toHaveBeenCalledWith('/customers/42', expect.anything());
    expect(sentCustomer()).toMatchObject({ Phone1: null, EmailInvoice: null, InvoiceDiscount: 0, TermsOfPayment: '30' });
  });

  it('skickar inga tömningar utan före-rad', async () => {
    row = { ...BEFORE, phone: null };
    await updateFortnoxCustomer('c1');

    expect(sentCustomer().Phone1).toBeUndefined();
  });

  // Tömningen jämförs mot raden pushen läser, inte mot den routen skrev: har fältet fyllts i igen vinner värdet.
  it('skickar värdet när fältet hunnit fyllas i igen', async () => {
    row = { ...BEFORE, phone: '08-999' };
    await updateFortnoxCustomer('c1', { before: { ...BEFORE, phone: '08-123' } });

    expect(sentCustomer().Phone1).toBe('08-999');
  });
});
