import { describe, it, expect } from 'vitest';
import { changedCustomerEditFields } from '@/app/crm/kunder/customerEditPatch';

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
  it('skickar momsnumret med org.numret, även när momsnumret är oförändrat', () => {
    expect(changedCustomerEditFields({ ...base, organization_number: '556000-0001' }, base)).toEqual({
      organization_number: '556000-0001',
      vat_number: null,
    });
  });
});
