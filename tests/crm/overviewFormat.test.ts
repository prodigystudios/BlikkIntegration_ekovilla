import { describe, it, expect } from 'vitest';
import { formatCurrency, formatQuoteDay, stockholmDay } from '@/app/crm/components/overview/overviewFormat';

// Översiktens formatering: Säljcoachens datum och belopp, tabellernas datum.

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

describe('stockholmDay', () => {
  // Explicita tidpunkter: zonen är Stockholms oavsett vilken zon testet körs i.
  it('ger den svenska dagen strax efter midnatt — inte UTC:s gårdag', () => {
    expect(stockholmDay('2026-10-04T22:30:00Z')).toBe('2026-10-05'); // sommartid, UTC+2
    expect(stockholmDay('2026-12-31T23:30:00Z')).toBe('2027-01-01'); // normaltid, UTC+1
  });

  it('dagen före midnatt stannar på sin dag', () => {
    expect(stockholmDay('2026-10-04T21:30:00Z')).toBe('2026-10-04');
  });

  // Ett ogiltigt datum får Intl att kasta, och ett kast under renderingen släcker hela översikten.
  it('ett datum som inte går att läsa ger ett streck, inget kast', () => {
    expect(stockholmDay('inte ett datum')).toBe('–');
    expect(stockholmDay(null)).toBe('–');
  });
});
