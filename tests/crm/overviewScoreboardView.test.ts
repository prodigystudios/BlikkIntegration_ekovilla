import { describe, it, expect } from 'vitest';
import type { MetricProgress, ScoreboardMetric, ScoreboardMetrics, ScoreboardSeller } from '@/lib/domains/crm/weeklyScoreboard';
import {
  achievementSentence,
  achievementSignature,
  competitionRanks,
  countGoals,
  firstName,
  formatProgress,
  goalsCaption,
  initials,
  leads,
  listAchievements,
  moreAchievementsSentence,
  progressPercent,
  rankSellers,
  weekLabel,
} from '@/app/crm/components/overview/scoreboardView';

// Veckotavlans visningslogik på CRM-översikten: ordningen i topplistan, vilka stjärnor bannern
// berättar om, och orden runt dem. Siffrorna räknas i weeklyScoreboard.ts och prövas där.

const NONE: MetricProgress = { done: 0, target: null, reached: false };

function metrics(patch: Partial<Record<ScoreboardMetric, Partial<MetricProgress>>> = {}): ScoreboardMetrics {
  const base: ScoreboardMetrics = { calls: NONE, quotes: NONE, quoteValue: NONE, orderCount: NONE, orderValue: NONE, invoicedValue: NONE };
  for (const [metric, value] of Object.entries(patch)) {
    base[metric as ScoreboardMetric] = { ...NONE, ...value };
  }
  return base;
}

function seller(userId: string, name: string, patch: Parameters<typeof metrics>[0] = {}): ScoreboardSeller {
  return { userId, name, metrics: metrics(patch), progressScore: 0 };
}

describe('formatProgress och progressPercent', () => {
  it('visar utfall mot mål, i kronor för värdena', () => {
    expect(formatProgress('calls', { done: 5, target: 20, reached: false })).toBe('5 / 20');
    // sv-SE sätter hårda mellanslag i tusental och före "kr" — jämför på vanliga.
    expect(formatProgress('orderValue', { done: 0, target: 400_000, reached: false }).replace(/ /g, ' ')).toBe('0 kr / 400 000 kr');
  });

  it('visar bara utfallet när måttet saknar mål — och ritar ingen stapel', () => {
    expect(formatProgress('calls', { done: 7, target: null, reached: false })).toBe('7');
    expect(progressPercent({ done: 7, target: null, reached: false })).toBeNull();
  });

  it('stapeln slår i taket vid målet och börjar på noll', () => {
    expect(progressPercent({ done: 30, target: 20, reached: true })).toBe(100);
    expect(progressPercent({ done: 5, target: 20, reached: false })).toBe(25);
    expect(progressPercent({ done: -3, target: 20, reached: false })).toBe(0);
  });
});

describe('countGoals och goalsCaption', () => {
  it('räknar bara mått som har ett mål', () => {
    const team = metrics({ calls: { done: 5, target: 4, reached: true }, quotes: { done: 1, target: 6 }, invoicedValue: { done: 9 } });
    expect(countGoals(team)).toEqual({ reached: 1, set: 2 });
  });

  it('säger hur långt det är kvar, inte vad laget är värt', () => {
    expect(goalsCaption({ reached: 0, set: 0 })).toBe('Inga veckomål satta');
    expect(goalsCaption({ reached: 6, set: 6 })).toBe('Alla veckomål nådda');
    expect(goalsCaption({ reached: 5, set: 6 })).toBe('Ett mål kvar');
    expect(goalsCaption({ reached: 2, set: 6 })).toBe('4 mål kvar');
  });
});

describe('rankSellers', () => {
  it('störst först på det valda måttet', () => {
    const sellers = [
      seller('a', 'Anna', { calls: { done: 3 }, quoteValue: { done: 90_000 } }),
      seller('b', 'Bosse', { calls: { done: 8 }, quoteValue: { done: 10_000 } }),
    ];
    expect(rankSellers(sellers, 'calls').map((row) => row.name)).toEqual(['Bosse', 'Anna']);
    expect(rankSellers(sellers, 'quoteValue').map((row) => row.name)).toEqual(['Anna', 'Bosse']);
  });

  it('lika värden i svensk namnordning, och listan in rörs inte', () => {
    const sellers = [seller('o', 'Örjan'), seller('a', 'Åsa'), seller('z', 'Zara')];
    expect(rankSellers(sellers, 'calls').map((row) => row.name)).toEqual(['Zara', 'Åsa', 'Örjan']);
    expect(sellers.map((row) => row.name)).toEqual(['Örjan', 'Åsa', 'Zara']);
  });
});

describe('competitionRanks och leads', () => {
  it('lika värden delar placering, nästa hoppar över', () => {
    const ranked = rankSellers([
      seller('a', 'Anna', { calls: { done: 5 } }),
      seller('b', 'Bosse', { calls: { done: 5 } }),
      seller('c', 'Cilla', { calls: { done: 2 } }),
    ], 'calls');
    expect(competitionRanks(ranked, 'calls')).toEqual([1, 1, 3]);
  });

  it('ingen leder när alla står på noll', () => {
    expect(leads(1, { done: 0, target: 10, reached: false })).toBe(false);
    expect(leads(1, { done: 1, target: 10, reached: false })).toBe(true);
    expect(leads(2, { done: 9, target: 10, reached: false })).toBe(false);
  });
});

describe('listAchievements och bannerns meningar', () => {
  const sellers = [
    seller('anna', 'Anna Ek', { calls: { done: 10, target: 10, reached: true }, orderValue: { done: 1, target: 9, reached: false } }),
    seller('bosse', 'Bosse Berg', { quotes: { done: 3, target: 3, reached: true }, invoicedValue: { done: 9, target: 5, reached: true } }),
  ];

  it('tar bara nådda mål, i tavlans ordning', () => {
    expect(listAchievements(sellers, null)).toEqual([
      { userId: 'anna', name: 'Anna Ek', metric: 'calls' },
      { userId: 'bosse', name: 'Bosse Berg', metric: 'quotes' },
      { userId: 'bosse', name: 'Bosse Berg', metric: 'invoicedValue' },
    ]);
  });

  it('läsarens egna stjärnor kommer först', () => {
    expect(listAchievements(sellers, 'bosse').map((item) => item.userId)).toEqual(['bosse', 'bosse', 'anna']);
  });

  it('säger "Du" till läsaren och förnamnet till andra', () => {
    expect(achievementSentence({ userId: 'anna', name: 'Anna Ek', metric: 'quotes' }, 'bosse')).toBe('Anna nådde offertmålet');
    expect(achievementSentence({ userId: 'bosse', name: 'Bosse Berg', metric: 'invoicedValue' }, 'bosse')).toBe('Du nådde faktureringsmålet');
  });

  it('böjer "ytterligare" efter antalet', () => {
    expect(moreAchievementsSentence(0)).toBeNull();
    expect(moreAchievementsSentence(1)).toBe('Ytterligare ett veckomål är nått.');
    expect(moreAchievementsSentence(3)).toBe('Ytterligare 3 veckomål är nådda.');
  });

  it('signaturen ändras när ett nytt mål nås eller veckan byts — men inte av ordningen', () => {
    const items = listAchievements(sellers, null);
    const base = achievementSignature('2026-10-05', items);
    expect(achievementSignature('2026-10-05', [...items].reverse())).toBe(base);
    expect(achievementSignature('2026-10-05', items.slice(0, 2))).not.toBe(base);
    expect(achievementSignature('2026-10-12', items)).not.toBe(base);
  });
});

describe('namn', () => {
  it('förnamn och initialer', () => {
    expect(firstName('Andreas Östlund')).toBe('Andreas');
    expect(initials('Andreas Östlund')).toBe('AÖ');
    expect(initials('Anna Maria Ek')).toBe('AE');
    expect(initials('cher')).toBe('C');
    expect(initials('  ')).toBe('?');
  });
});

describe('weekLabel', () => {
  it('veckonummer och dagarna, med exklusivt slut', () => {
    expect(weekLabel('2026-10-05', '2026-10-12')).toBe('Vecka 41, 5–11 okt');
  });

  it('över ett månadsskifte står båda månaderna', () => {
    expect(weekLabel('2026-09-28', '2026-10-05')).toBe('Vecka 40, 28 sep–4 okt');
  });

  // ⚠️ Zonberoende: isoWeek läser LOKALA fält, och weekLabel bygger därför datumet ur strängens
  // delar. Byggs det i stället som UTC-midnatt hamnar dagen på söndagen innan väster om Greenwich
  // — men bara där. Under TZ=UTC (CI) är det här testet grönt även med felet; mutationsprövat rött
  // under TZ=America/Los_Angeles 2026-10-05.
  it('över ett årsskifte följer veckonumret ISO', () => {
    expect(weekLabel('2026-12-28', '2027-01-04')).toBe('Vecka 53, 28 dec–3 jan');
  });
});
