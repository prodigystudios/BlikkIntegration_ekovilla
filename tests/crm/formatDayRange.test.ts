import { describe, it, expect } from 'vitest';
import { formatDate, formatDayRange, formatDayRangeParts } from '@/app/crm/lib/format';

// Arbetsorderns planerade period (planned_start_day, planned_end_day) på faktakortet.

describe('formatDayRange', () => {
  it('en dag skrivs som formatDate', () => {
    expect(formatDayRange('2026-10-12', '2026-10-12')).toBe(formatDate('2026-10-12'));
    expect(formatDayRange('2026-10-12', '2026-10-12')).toBe('12 okt. 2026');
  });

  it('samma månad: tankstreck utan mellanslag mellan dagarna', () => {
    expect(formatDayRange('2026-10-12', '2026-10-14')).toBe('12–14 okt. 2026');
  });

  it('över ett månadsskifte: tankstreck med mellanslag, året en gång', () => {
    expect(formatDayRange('2026-09-30', '2026-10-02')).toBe('30 sep. – 2 okt. 2026');
  });

  it('över ett årsskifte: båda åren', () => {
    expect(formatDayRange('2026-12-30', '2027-01-02')).toBe('30 dec. 2026 – 2 jan. 2027');
  });

  it('samma månad ett annat år är inte samma månad', () => {
    expect(formatDayRange('2026-10-12', '2027-10-14')).toBe('12 okt. 2026 – 14 okt. 2027');
  });

  it('ingen startdag ger null, så att anroparen väljer texten', () => {
    expect(formatDayRange(null, null)).toBeNull();
    expect(formatDayRange(undefined, '2026-10-12')).toBeNull();
    expect(formatDayRange('', '')).toBeNull();
  });

  it('en saknad slutdag, eller en före starten, ger startdagen', () => {
    expect(formatDayRange('2026-10-12', null)).toBe('12 okt. 2026');
    expect(formatDayRange('2026-10-14', '2026-10-12')).toBe('14 okt. 2026');
  });

  it('en ogiltig startdag ger null, inte "Invalid Date"', () => {
    expect(formatDayRange('x', 'y')).toBeNull();
    expect(formatDayRange('x', '2026-10-12')).toBeNull();
  });

  it('en ogiltig slutdag ger startdagen, som en saknad', () => {
    expect(formatDayRange('2026-10-12', 'x')).toBe('12 okt. 2026');
  });
});

// Leden, för orderlistans kolumn Planerad som bara bryter vid tankstrecket.
describe('formatDayRangeParts', () => {
  it('en dag och samma månad är ett led — inget att bryta vid', () => {
    expect(formatDayRangeParts('2026-10-12', '2026-10-12')).toEqual({ from: '12 okt. 2026', to: null });
    expect(formatDayRangeParts('2026-10-12', '2026-10-21')).toEqual({ from: '12–21 okt. 2026', to: null });
  });

  it('över ett månads- eller årsskifte: två led, ett per sida om tankstrecket', () => {
    expect(formatDayRangeParts('2026-09-30', '2026-10-02')).toEqual({ from: '30 sep.', to: '2 okt. 2026' });
    expect(formatDayRangeParts('2026-12-30', '2027-01-02')).toEqual({ from: '30 dec. 2026', to: '2 jan. 2027' });
  });

  it('ingen eller ogiltig startdag ger null', () => {
    expect(formatDayRangeParts(null, null)).toBeNull();
    expect(formatDayRangeParts('x', '2026-10-12')).toBeNull();
  });

  it('leden ihopsatta är alltid formatDayRange', () => {
    for (const [start, end] of [['2026-10-12', '2026-10-12'], ['2026-10-12', '2026-10-14'], ['2026-09-30', '2026-10-02'], ['2026-12-30', '2027-01-02'], ['2026-10-14', '2026-10-12']]) {
      const parts = formatDayRangeParts(start, end);
      expect(parts && (parts.to ? `${parts.from} – ${parts.to}` : parts.from)).toBe(formatDayRange(start, end));
    }
  });
});
