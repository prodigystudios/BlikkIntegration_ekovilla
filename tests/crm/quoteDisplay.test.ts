import { describe, it, expect } from 'vitest';
import { formatQuantity } from '@/app/crm/lib/format';
import { quoteCustomerName, isQuoteOverdue } from '@/app/crm/lib/quoteDisplay';

// These helpers used to exist as identical copies in QuotesClient and SaljtavlaClient. Now that the
// offer list, the Säljtavla board and their shared detail panel all call the same code, a change
// here moves three surfaces at once — so the precedence order is worth pinning down.

describe('quoteCustomerName', () => {
  const base = { customer_name: null, customer_snapshot: null, prospect: null };

  it('leads with the prospect company — that is the entity being worked', () => {
    expect(quoteCustomerName({
      ...base,
      prospect: { company_name: 'Prospektbolaget AB' },
      customer_snapshot: { customer_name: 'Snapshot Namn' },
      customer_name: 'Kolumn Namn',
    })).toBe('Prospektbolaget AB');
  });

  it('accepts the prospect as an embedded array (PostgREST returns either shape)', () => {
    expect(quoteCustomerName({ ...base, prospect: [{ company_name: 'Array AB' }] })).toBe('Array AB');
  });

  it('prefers the snapshot over the live column, so an old quote keeps who it was written for', () => {
    expect(quoteCustomerName({
      ...base,
      customer_snapshot: { customer_name: 'Vid offerttillfället' },
      customer_name: 'Omdöpt sedan dess',
    })).toBe('Vid offerttillfället');
  });

  it('falls back through snapshot company name, then the column', () => {
    expect(quoteCustomerName({ ...base, customer_snapshot: { company_name: 'Bolaget AB' } })).toBe('Bolaget AB');
    expect(quoteCustomerName({ ...base, customer_name: 'Bara kolumnen' })).toBe('Bara kolumnen');
  });

  it('never renders an empty name', () => {
    expect(quoteCustomerName(base)).toBe('Okänd kund');
    expect(quoteCustomerName({ ...base, prospect: [] })).toBe('Okänd kund');
  });
});

describe('isQuoteOverdue', () => {
  const today = new Date(2026, 7, 14); // 14 aug 2026, local calendar day

  it('flags a follow-up date that has passed', () => {
    expect(isQuoteOverdue({ follow_up_date: '2026-08-13', status: 'sent' }, today)).toBe(true);
  });

  it('does not flag today or the future', () => {
    expect(isQuoteOverdue({ follow_up_date: '2026-08-14', status: 'sent' }, today)).toBe(false);
    expect(isQuoteOverdue({ follow_up_date: '2026-08-15', status: 'sent' }, today)).toBe(false);
  });

  it('stays quiet on closed deals — the date is history, not a task', () => {
    expect(isQuoteOverdue({ follow_up_date: '2026-01-01', status: 'won' }, today)).toBe(false);
    expect(isQuoteOverdue({ follow_up_date: '2026-01-01', status: 'lost' }, today)).toBe(false);
  });

  it('needs a date at all', () => {
    expect(isQuoteOverdue({ follow_up_date: null, status: 'follow_up' }, today)).toBe(false);
  });

  it('pads single-digit months and days, so string compare stays correct', () => {
    // A naive `${month}` would build "2026-8-14" and compare wrong against "2026-08-13".
    expect(isQuoteOverdue({ follow_up_date: '2026-08-13', status: 'draft' }, new Date(2026, 7, 9))).toBe(false);
    expect(isQuoteOverdue({ follow_up_date: '2026-01-05', status: 'draft' }, new Date(2026, 0, 9))).toBe(true);
  });
});

describe('formatQuantity', () => {
  // ⚠️ Regressionsvakt för en riktig avvikelse: offerten och arbetsordern formaterade radantalet
  // var för sig — offerten på 2 decimaler, ordern på 3 — så samma volym stod som "4,88" på den ena
  // och "4,875" på den andra. Skillnaden syns BARA när ytan har en decimal (19,5 m²), vilket är
  // varför den levde obemärkt tills någon skrev just det.
  it('ger samma sträng oavsett vilken yta som anropar', () => {
    // 19,5 m² × 250 mm = 4,875 m³ — precis fallet som avslöjade skillnaden.
    expect(formatQuantity(4.875)).toBe('4,88');
    expect(formatQuantity(24.3875)).toBe('24,39');
  });

  it('visar hela tal utan decimaler', () => {
    expect(formatQuantity(20)).toBe('20');
    expect(formatQuantity(0)).toBe('0');
  });

  it('använder svenskt decimaltecken', () => {
    expect(formatQuantity(1.5)).toBe('1,5');
  });
});
