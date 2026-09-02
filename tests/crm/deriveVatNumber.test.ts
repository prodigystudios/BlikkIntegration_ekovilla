import { describe, it, expect } from 'vitest';
import { deriveVatNumberForWrite } from '@/lib/domains/crm/orgNumber';

// 5560000001 är kontrollsiffre-giltigt (Luhn-10); 5560000000 är det inte.
const VALID_ORG = '556000-0001';
const VALID_VAT = 'SE556000000101';
const OTHER_ORG = '556894-5512';
const INVALID_ORG = '556000-0000';

const business = { customer_type: 'business' as const };

// Explicit drafttyp: utan den snävar generiken till literalen och `out.vat_number` finns
// inte på returtypen när fältet saknas i indatat.
type Draft = {
  customer_type?: 'business' | 'private' | null;
  organization_number?: string | null;
  vat_number?: string | null;
  company_name?: string;
};

const derive = (input: Draft, before: Draft | null): Draft => deriveVatNumberForWrite(input, before);

describe('deriveVatNumberForWrite — vid skapande (before = null)', () => {
  it('härleder momsnumret ur ett nytt org.nr', () => {
    const out = derive({ ...business, organization_number: VALID_ORG }, null);
    expect(out.vat_number).toBe(VALID_VAT);
  });

  it('accepterar org.nr utan bindestreck', () => {
    const out = derive({ ...business, organization_number: '5560000001' }, null);
    expect(out.vat_number).toBe(VALID_VAT);
  });

  it('rör inte ett momsnummer som redan är ifyllt', () => {
    const out = derive(
      { ...business, organization_number: VALID_ORG, vat_number: 'SE556000000102' },
      null,
    );
    expect(out.vat_number).toBe('SE556000000102');
  });

  it('härleder inget ur ett org.nr med fel kontrollsiffra', () => {
    const out = derive({ ...business, organization_number: INVALID_ORG }, null);
    expect(out.vat_number).toBeUndefined();
  });

  it('härleder inget för en privatkund', () => {
    const out = derive(
      { customer_type: 'private' as const, organization_number: VALID_ORG },
      null,
    );
    expect(out.vat_number).toBeUndefined();
  });

  it('härleder inget utan org.nr', () => {
    expect(derive({ ...business, organization_number: null }, null).vat_number).toBeUndefined();
    expect(derive({ ...business, organization_number: '   ' }, null).vat_number).toBeUndefined();
  });
});

describe('deriveVatNumberForWrite — vid uppdatering', () => {
  it('härleder när org.numret ÄNDRAS och momsnumret är tomt', () => {
    const out = derive(
      { organization_number: VALID_ORG, vat_number: null },
      { customer_type: 'business', organization_number: OTHER_ORG, vat_number: null },
    );
    expect(out.vat_number).toBe(VALID_VAT);
  });

  it('härleder när org.numret SÄTTS på en kund som saknade det', () => {
    const out = derive(
      { organization_number: VALID_ORG, vat_number: null },
      { customer_type: 'business', organization_number: null, vat_number: null },
    );
    expect(out.vat_number).toBe(VALID_VAT);
  });

  // 🧨 Spärren som gör det möjligt att tömma momsnumret. Editorn skickar med org.numret i
  // VARJE PATCH, så utan den här regeln hade ett tömt fält fyllts i igen direkt och en kund
  // som inte är momsregistrerad aldrig kunnat sparas utan momsnummer.
  it('härleder INTE när org.numret står stilla — även om momsnumret töms', () => {
    const out = derive(
      { organization_number: VALID_ORG, vat_number: null },
      { customer_type: 'business', organization_number: VALID_ORG, vat_number: VALID_VAT },
    );
    expect(out.vat_number).toBeNull();
  });

  it('räknar bindestreck som samma nummer — formatering är ingen ändring', () => {
    const out = derive(
      { organization_number: '5560000001', vat_number: null },
      { customer_type: 'business', organization_number: VALID_ORG, vat_number: null },
    );
    expect(out.vat_number).toBeNull();
  });

  // Ett utelämnat fält betyder "rör inte" i en partiell PATCH — då är det gamla värdet kvar,
  // och det får inte skrivas över.
  it('rör inte ett befintligt momsnummer när fältet utelämnas ur PATCHen', () => {
    const out = derive(
      { organization_number: OTHER_ORG },
      { customer_type: 'business', organization_number: VALID_ORG, vat_number: VALID_VAT },
    );
    expect(out.vat_number).toBeUndefined();
  });

  it('härleder när momsfältet utelämnas men raden saknar momsnummer', () => {
    const out = derive(
      { organization_number: OTHER_ORG },
      { customer_type: 'business', organization_number: VALID_ORG, vat_number: null },
    );
    expect(out.vat_number).toBe('SE556894551201');
  });

  it('härleder inget när bara andra fält ändras', () => {
    const out = derive(
      { vat_number: null },
      { customer_type: 'business', organization_number: VALID_ORG, vat_number: null },
    );
    expect(out.vat_number).toBeNull();
  });

  // Typen tas från raden när PATCHen inte skickar med den.
  it('härleder inget för en privatkund vars typ bara finns på raden', () => {
    const out = derive(
      { organization_number: VALID_ORG, vat_number: null },
      { customer_type: 'private', organization_number: null, vat_number: null },
    );
    expect(out.vat_number).toBeNull();
  });

  it('lämnar övriga fält orörda', () => {
    const out = derive(
      { ...business, organization_number: VALID_ORG, vat_number: null, company_name: 'AB Test' },
      { customer_type: 'business', organization_number: null, vat_number: null },
    );
    expect(out.company_name).toBe('AB Test');
    expect(out.organization_number).toBe(VALID_ORG);
  });
});
