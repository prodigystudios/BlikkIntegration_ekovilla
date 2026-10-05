import { describe, it, expect } from 'vitest';
import { formatCurrency, formatQuoteDay } from '@/app/crm/components/overview/overviewFormat';

// Översiktens formatering: Säljcoachens datum och belopp.

// sv-SE sätter hårda och smala mellanslag i tusental och före valutan — jämför på vanliga.
const plain = (text: string) => text.replace(/\s/g, ' ');

describe('formatQuoteDay', () => {
  it('dag och månad i år', () => {
    expect(formatQuoteDay('2026-09-25', '2026-10-05')).toBe('25 september');
  });

  it('med år när offerten är från ett annat år', () => {
    expect(formatQuoteDay('2025-03-03', '2026-10-05')).toBe('3 mars 2025');
  });
});

describe('formatCurrency', () => {
  it('kronor utan decimaler', () => {
    expect(plain(formatCurrency(25900, 'SEK'))).toBe('25 900 kr');
  });

  // Valutakoden valideras bara på längd. En kod Intl inte känner fick hela översikten att krascha.
  it('kraschar inte på en valutakod Intl inte känner', () => {
    expect(plain(formatCurrency(25900, '12A'))).toBe('25 900 12A');
  });
});
