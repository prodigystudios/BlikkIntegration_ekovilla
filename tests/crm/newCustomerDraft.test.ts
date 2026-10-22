import { describe, it, expect } from 'vitest';
import {
  applyTicLookup,
  clearTicLookup,
  EMPTY_TIC_FILL,
  INITIAL_NEW_CUSTOMER_DRAFT,
  isTicFilled,
  newCustomerChecklist,
  resolveInvoiceEmail,
  type NewCustomerDraft,
} from '@/app/crm/kunder/newCustomerDraft';
import type { TicLookupResult } from '@/lib/domains/tic/types';

function draft(overrides: Partial<NewCustomerDraft> = {}): NewCustomerDraft {
  return { ...INITIAL_NEW_CUSTOMER_DRAFT, ...overrides };
}

const hit: TicLookupResult = {
  kind: 'company',
  label: 'Norrbygg Entreprenad AB',
  sublabel: '5560125790 · Umeå',
  company_name: 'Norrbygg Entreprenad AB',
  organization_number: '5560125790',
  phone: '090-12 34 50',
  address: { street: 'Industrivägen 12', postal_code: '903 61', city: 'Umeå' },
  annual_revenue: 48_200_000,
  number_of_employees: 34,
  sni_name: 'Byggentreprenad',
  financial_year: 2025,
  risk_indicators: [{ type: 'X' }],
};

describe('applyTicLookup', () => {
  it('fyller tomma fält, formaterar org.nr och härleder momsnumret', () => {
    const { draft: next, fill } = applyTicLookup(draft(), hit);
    expect(next.company_name).toBe('Norrbygg Entreprenad AB');
    expect(next.organization_number).toBe('556012-5790');
    expect(next.vat_number).toBe('SE556012579001');
    expect(next.visit_street).toBe('Industrivägen 12');
    expect(next.annual_revenue).toBe('48200000');
    expect(next.financial_year).toBe('2025');
    expect(next.risk_indicators).toEqual([{ type: 'X' }]);
    expect(fill.fields.vat_number).toBe('SE556012579001');
    expect(fill.riskIndicators).toBe(true);
  });

  it('skriver aldrig över det säljaren redan skrivit', () => {
    const { draft: next, fill } = applyTicLookup(draft({ company_name: 'Eget namn', phone: '070-1' }), hit);
    expect(next.company_name).toBe('Eget namn');
    expect(next.phone).toBe('070-1');
    expect(fill.fields.company_name).toBeUndefined();
    expect(fill.fields.phone).toBeUndefined();
  });

  it('rör inte ett ifyllt momsnummer (koncernsuffix 02)', () => {
    const { draft: next, fill } = applyTicLookup(draft({ vat_number: 'SE556012579002' }), hit);
    expect(next.vat_number).toBe('SE556012579002');
    expect(fill.fields.vat_number).toBeUndefined();
  });

  it('härleder inget momsnummer ur ett org.nr som säljaren skrev', () => {
    const { draft: next } = applyTicLookup(draft({ organization_number: '556000-0000' }), hit);
    expect(next.organization_number).toBe('556000-0000');
    expect(next.vat_number).toBe('');
  });

  it('räknar 0 anställda som ett värde, inte som tomt', () => {
    const { draft: next } = applyTicLookup(draft(), { ...hit, number_of_employees: 0 });
    expect(next.number_of_employees).toBe('0');
  });
});

describe('clearTicLookup ("Byt företag")', () => {
  it('tömmer det uppslaget fyllde och som står orört', () => {
    const { draft: filled, fill } = applyTicLookup(draft({ email: 'egen@kund.se' }), hit);
    const cleared = clearTicLookup(filled, fill);
    expect(cleared.company_name).toBe('');
    expect(cleared.organization_number).toBe('');
    expect(cleared.vat_number).toBe('');
    expect(cleared.visit_city).toBe('');
    expect(cleared.risk_indicators).toEqual([]);
    expect(cleared.email).toBe('egen@kund.se');
  });

  it('behåller ett fält som säljaren skrivit om efter uppslaget', () => {
    const { draft: filled, fill } = applyTicLookup(draft(), hit);
    const cleared = clearTicLookup({ ...filled, phone: '070-999' }, fill);
    expect(cleared.phone).toBe('070-999');
    expect(cleared.company_name).toBe('');
  });

  it('rör inte riskindikatorer som fanns före uppslaget', () => {
    const before = draft({ risk_indicators: [{ type: 'Y' }] });
    const { draft: filled, fill } = applyTicLookup(before, hit);
    expect(fill.riskIndicators).toBe(false);
    expect(clearTicLookup(filled, fill).risk_indicators).toEqual([{ type: 'Y' }]);
  });
});

describe('isTicFilled', () => {
  it('gäller bara så länge fältet bär uppslagets värde', () => {
    const { draft: filled, fill } = applyTicLookup(draft(), hit);
    expect(isTicFilled(filled, fill, 'company_name')).toBe(true);
    expect(isTicFilled({ ...filled, company_name: 'Norrbygg AB' }, fill, 'company_name')).toBe(false);
    expect(isTicFilled(filled, fill, 'mobile')).toBe(false);
    expect(isTicFilled(filled, EMPTY_TIC_FILL, 'company_name')).toBe(false);
  });
});

describe('resolveInvoiceEmail', () => {
  it('tomt fält = kundens e-post', () => {
    expect(resolveInvoiceEmail({ invoice_email: '  ', email: 'info@kund.se' })).toBe('info@kund.se');
  });

  it('ett eget värde vinner', () => {
    expect(resolveInvoiceEmail({ invoice_email: 'faktura@kund.se', email: 'info@kund.se' })).toBe('faktura@kund.se');
  });

  it('null när båda är tomma', () => {
    expect(resolveInvoiceEmail({ invoice_email: '', email: '' })).toBeNull();
  });
});

describe('newCustomerChecklist', () => {
  it('företag: namn, kontaktväg, adress', () => {
    const items = newCustomerChecklist(draft({ company_name: 'X', phone: '08-1', visit_street: 'Gatan 1' }));
    expect(items).toEqual([
      { label: 'Företagsnamn', done: true },
      { label: 'E-post eller telefon', done: true },
      { label: 'Adress', done: false },
    ]);
  });

  it('privatperson kräver både för- och efternamn', () => {
    const [name] = newCustomerChecklist(draft({ customer_type: 'private', first_name: 'Anna' }));
    expect(name).toEqual({ label: 'Namn', done: false });
  });
});
