import { describe, expect, it } from 'vitest';
import { daysSince, formatRelativeTime } from '@/lib/shared/relativeTime';

// Fast referenspunkt så testerna inte beror på när de körs. Funktionerna tar `now` just för det.
const NOW = new Date('2026-08-22T12:00:00Z').getTime();
const agoMs = (ms: number) => new Date(NOW - ms).toISOString();

const SEK = 1000;
const MIN = 60 * SEK;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe('formatRelativeTime', () => {
  it('ger tom sträng för saknat datum', () => {
    expect(formatRelativeTime(null, NOW)).toBe('');
  });

  it('faller tillbaka på råsträngen när datumet inte går att tolka', () => {
    expect(formatRelativeTime('inte-ett-datum', NOW)).toBe('inte-ett-datum');
    expect(formatRelativeTime('2026-08-22T12:00', NOW)).not.toBe('');
  });

  it('behandlar framtida datum som nyss', () => {
    expect(formatRelativeTime(new Date(NOW + HOUR).toISOString(), NOW)).toBe('nyss');
  });

  it.each([
    [30 * SEK, 'nyss'],
    [90 * SEK, '1 min sedan'],
    [5 * MIN, '5 min sedan'],
    [90 * MIN, '1 h sedan'],
    [5 * HOUR, '5 h sedan'],
    [30 * HOUR, '1 dag sedan'],
    [3 * DAY, '3 dagar sedan'],
    [8 * DAY, '1 v sedan'],
    [21 * DAY, '3 v sedan'],
    [45 * DAY, '1 mån sedan'],
    [75 * DAY, '2 mån sedan'],
    [400 * DAY, '1 år sedan'],
    [800 * DAY, '2 år sedan'],
  ])('%d ms sedan → %s', (ms, expected) => {
    expect(formatRelativeTime(agoMs(ms), NOW)).toBe(expected);
  });

  // Regressionsvakt för själva anledningen till att CRM-översiktens samtalskort ändrades: två
  // rader daterade i juni såg ut som färsk aktivitet så länge de bara visade sitt absoluta datum.
  it('läser ut månader för samtalskortets faktiska data', () => {
    expect(formatRelativeTime('2026-06-08T14:27:00Z', NOW)).toBe('2 mån sedan');
  });
});

describe('daysSince', () => {
  it('ger null för saknat, ogiltigt och framtida datum', () => {
    expect(daysSince(null, NOW)).toBeNull();
    expect(daysSince(undefined, NOW)).toBeNull();
    expect(daysSince('inte-ett-datum', NOW)).toBeNull();
    expect(daysSince(new Date(NOW + DAY).toISOString(), NOW)).toBeNull();
  });

  it('räknar hela dygn och rundar nedåt', () => {
    expect(daysSince(agoMs(0), NOW)).toBe(0);
    expect(daysSince(agoMs(23 * HOUR), NOW)).toBe(0);
    expect(daysSince(agoMs(DAY), NOW)).toBe(1);
    expect(daysSince(agoMs(9 * DAY + 3 * HOUR), NOW)).toBe(9);
  });

  it('räknar varaktighet, inte kalenderdygn — 75 dygn är 75 oavsett sommartidsskiftet', () => {
    // NOW ligger i sommartid, NOW − 75 dygn också, men fönstret spänner inte över skiftet. Poängen
    // med testet är att svaret kommer ur ms-differensen och därför inte rör sig med TZ:n testet
    // råkar köras i — se kommentaren i daysSince om varför den inte duger till kalenderräkning.
    expect(daysSince(agoMs(75 * DAY), NOW)).toBe(75);
  });
});
