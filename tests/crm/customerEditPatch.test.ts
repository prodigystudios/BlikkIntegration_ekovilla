import { describe, it, expect } from 'vitest';
import {
  changedCustomerEditFields,
  customerEditBody,
  customerEditDiscountIssue,
  type CustomerEditDraft,
} from '@/app/crm/kunder/customerEditPatch';

const base = {
  customer_type: 'business',
  company_name: 'Acme AB',
  organization_number: '556000-0000',
  phone: '08-123',
  payment_terms: null,
  price_list: null,
  vat_number: null,
  invoice_address: { street: 'Gatan 1', postal_code: '11122', city: 'Stockholm' },
  reverse_vat: false,
};

function draft(overrides: Partial<CustomerEditDraft> = {}): CustomerEditDraft {
  return {
    customer_type: 'business', company_name: 'Acme AB', organization_number: '556000-0000',
    first_name: '', last_name: '', personal_number: '',
    email: 'info@acme.se', phone: '08-123', mobile: '',
    visit_street: '', visit_postal_code: '', visit_city: '',
    delivery_street: '', delivery_postal_code: '', delivery_city: '',
    invoice_street: 'Gatan 1', invoice_postal_code: '11122', invoice_city: 'Stockholm',
    invoice_email: '', payment_terms: '', price_list: '',
    discount: '5', vat_number: 'SE556000000001', reverse_vat: false,
    annual_revenue: '', number_of_employees: '', legal_entity_type: '', sni_code: '', sni_name: '',
    operating_profit: '', profit_after_financial_items: '', total_assets: '',
    operating_margin: '', equity_ratio: '', financial_year: '',
    ...overrides,
  };
}

describe('changedCustomerEditFields', () => {
  it('skickar bara fältet som ändrades', () => {
    expect(changedCustomerEditFields({ ...base, phone: '08-999' }, base)).toEqual({ phone: '08-999' });
  });

  it('skickar ingenting när inget ändrats', () => {
    expect(changedCustomerEditFields({ ...base }, base)).toEqual({});
  });

  // Kärnan: ett fält som var tomt när editorn öppnades och inte rördes skickas inte. Har kortpasset eller en kollega
  // fyllt i det under tiden står deras värde kvar — och ingen tömning når Fortnox.
  it('skickar inte ett orört tomt fält', () => {
    const changes = changedCustomerEditFields({ ...base, phone: '08-999' }, base);
    expect(changes).not.toHaveProperty('payment_terms');
    expect(changes).not.toHaveProperty('price_list');
  });

  it('skickar en uttrycklig tömning som null', () => {
    expect(changedCustomerEditFields({ ...base, phone: null }, base)).toEqual({ phone: null });
  });

  it('jämför adresser på innehåll', () => {
    const same = { ...base, invoice_address: { street: 'Gatan 1', postal_code: '11122', city: 'Stockholm' } };
    expect(changedCustomerEditFields(same, base)).toEqual({});
    const moved = { ...base, invoice_address: { street: 'Gatan 2', postal_code: '11122', city: 'Stockholm' } };
    expect(changedCustomerEditFields(moved, base)).toEqual({ invoice_address: moved.invoice_address });
    expect(changedCustomerEditFields({ ...base, invoice_address: null }, base)).toEqual({ invoice_address: null });
  });

  it('skickar ett ändrat reglage', () => {
    expect(changedCustomerEditFields({ ...base, reverse_vat: true }, base)).toEqual({ reverse_vat: true });
  });

  // 🧨 Användaren byter org.nr, editorn härleder momsnumret, användaren tömmer det igen: momsfältet är lika tomt som
  // när editorn öppnades. Utelämnat hade servern härlett SE…01 på nytt (deriveVatNumberForWrite) mot användarens val.
  it('skickar det tomma momsnumret med ett ändrat org.nr', () => {
    expect(changedCustomerEditFields({ ...base, organization_number: '556000-0001' }, base)).toEqual({
      organization_number: '556000-0001',
      vat_number: null,
    });
  });

  // …men bara då. Ett org.nr som bara fått bindestreck härleder ingenting på servern, och ett ifyllt momsnummer som
  // inte rörts kan vara gammalt — skickat hade det skrivit över ett nyare i CRM och Fortnox.
  it('skickar inte momsnumret när bara org.numrets format ändrats', () => {
    const stored = { ...base, organization_number: '5560000000' };
    expect(changedCustomerEditFields({ ...stored, organization_number: '556000-0000' }, stored)).toEqual({
      organization_number: '556000-0000',
    });
  });

  it('skickar inte ett ifyllt, orört momsnummer med ett ändrat org.nr', () => {
    const filled = { ...base, vat_number: 'SE556000000001' };
    expect(changedCustomerEditFields({ ...filled, organization_number: '556000-0001' }, filled)).toEqual({
      organization_number: '556000-0001',
    });
  });
});

describe('customerEditBody', () => {
  it('gör tomma fält till null och trimmar', () => {
    const body = customerEditBody(draft({ phone: '  08-999 ', mobile: '   ', payment_terms: '' }));
    expect(body.phone).toBe('08-999');
    expect(body.mobile).toBeNull();
    expect(body.payment_terms).toBeNull();
  });

  it('gör en adress utan delar till null och behåller en delvis ifylld', () => {
    expect(customerEditBody(draft()).visit_address).toBeNull();
    expect(customerEditBody(draft({ invoice_street: '' })).invoice_address).toEqual({
      street: null, postal_code: '11122', city: 'Stockholm',
    });
  });

  // Svenskt decimalkomma: "5,5" ska bli 5,5 — inte NaN, som JSON gör till null och PATCH-routen till en tömning.
  it('läser rabatten med decimalkomma', () => {
    expect(customerEditBody(draft({ discount: '5,5' })).discount).toBe(5.5);
    expect(customerEditBody(draft({ discount: '5.5' })).discount).toBe(5.5);
    expect(customerEditBody(draft({ discount: '' })).discount).toBeNull();
  });

  it('ändrar bara telefonen när bara telefonen ändrats i utkastet', () => {
    const opened = customerEditBody(draft());
    expect(changedCustomerEditFields(customerEditBody(draft({ phone: '08-999' })), opened)).toEqual({ phone: '08-999' });
  });

  // Rabatten läses ur PostgREST som tal eller som sträng ("5.00"); utkastet bär strängen. Samma värde är inte en ändring.
  it('ser en oförändrad rabatt som oförändrad oavsett skrivsätt', () => {
    const opened = customerEditBody(draft({ discount: '5.00' }));
    expect(changedCustomerEditFields(customerEditBody(draft({ discount: '5' })), opened)).toEqual({});
  });
});

describe('customerEditDiscountIssue', () => {
  it('godtar tomt och tal med komma eller punkt', () => {
    expect(customerEditDiscountIssue(draft({ discount: '' }))).toBeNull();
    expect(customerEditDiscountIssue(draft({ discount: '5,5' }))).toBeNull();
    expect(customerEditDiscountIssue(draft({ discount: '10' }))).toBeNull();
  });

  // 🧨 Ett oläsbart värde får inte bli null: det hade tömt rabatten i CRM och i Fortnox (InvoiceDiscount 0).
  it('stoppar ett värde som inte går att läsa som tal', () => {
    expect(customerEditDiscountIssue(draft({ discount: 'fem' }))).toMatch(/Rabatten/);
  });
});
