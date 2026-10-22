import { describe, it, expect } from 'vitest';
import {
  addressLines,
  contactInitials,
  deliveryAddressDisplay,
  invoiceAddressDisplay,
  resolveCustomerTab,
  tabCountLabel,
} from '@/app/crm/kunder/customerCard';

const visit = { street: 'Industrivägen 12', postal_code: '903 61', city: 'Umeå' };

describe('contactInitials', () => {
  it('de två första orden', () => {
    expect(contactInitials('Lars Nordin')).toBe('LN');
    expect(contactInitials('Anna-Karin von Platen')).toBe('AV');
  });

  it('svenska tecken', () => {
    expect(contactInitials('Örjan Åberg')).toBe('ÖÅ');
  });

  it('tomt namn ger ett frågetecken, aldrig en tom avatar', () => {
    expect(contactInitials('  ')).toBe('?');
  });
});

describe('addressLines', () => {
  it('gata på första raden, postnr och ort på andra', () => {
    expect(addressLines(visit)).toEqual(['Industrivägen 12', '903 61 Umeå']);
    expect(addressLines({ street: null, postal_code: null, city: 'Umeå' })).toEqual(['Umeå']);
    expect(addressLines(null)).toEqual([]);
  });
});

describe('deliveryAddressDisplay', () => {
  it('tom leveransadress = samma som besöksadressen', () => {
    expect(deliveryAddressDisplay({ visit_address: visit, delivery_address: null })).toEqual({ kind: 'same-as-visit' });
  });

  it('säger aldrig "samma" när det inte finns någon besöksadress', () => {
    expect(deliveryAddressDisplay({ visit_address: null, delivery_address: null })).toEqual({ kind: 'empty' });
  });

  it('en egen leveransadress visas', () => {
    const delivery = { street: 'Byggvägen 1', postal_code: '90330', city: 'Umeå' };
    expect(deliveryAddressDisplay({ visit_address: visit, delivery_address: delivery }))
      .toEqual({ kind: 'address', lines: ['Byggvägen 1', '90330 Umeå'] });
  });
});

describe('invoiceAddressDisplay', () => {
  it('lika värden (också med annan formatering av postnumret) = samma', () => {
    const invoice = { street: ' industrivägen  12', postal_code: '90361', city: 'UMEÅ' };
    expect(invoiceAddressDisplay({ visit_address: visit, invoice_address: invoice })).toEqual({ kind: 'same-as-visit' });
  });

  it('en TOM fakturaadress är okänd, inte "samma"', () => {
    expect(invoiceAddressDisplay({ visit_address: visit, invoice_address: null })).toEqual({ kind: 'empty' });
    expect(invoiceAddressDisplay({ visit_address: visit, invoice_address: { street: '', postal_code: null, city: '  ' } }))
      .toEqual({ kind: 'empty' });
  });

  it('en annan fakturaadress visas', () => {
    const invoice = { street: 'Box 12', postal_code: '90101', city: 'Umeå' };
    expect(invoiceAddressDisplay({ visit_address: visit, invoice_address: invoice }))
      .toEqual({ kind: 'address', lines: ['Box 12', '90101 Umeå'] });
  });
});

describe('resolveCustomerTab', () => {
  it('känd flik', () => {
    expect(resolveCustomerTab('offerter')).toBe('offerter');
  });

  it('okänt eller saknat värde = Översikt', () => {
    expect(resolveCustomerTab('nope')).toBe('oversikt');
    expect(resolveCustomerTab(null)).toBe('oversikt');
  });
});

describe('tabCountLabel', () => {
  it('serverns räkning vinner', () => {
    expect(tabCountLabel(100, Infinity, 143)).toBe('143');
  });

  it('når listan taket står det "+"', () => {
    expect(tabCountLabel(200, 200)).toBe('200+');
    expect(tabCountLabel(37, 200)).toBe('37');
  });
});
