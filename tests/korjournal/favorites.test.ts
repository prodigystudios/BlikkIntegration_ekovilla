import { describe, it, expect } from 'vitest';
import { bumpUsage, topAddresses, bestFavoriteForPrefix, EMPTY_USAGE } from '@/lib/domains/korjournal/favorites';

describe('bumpUsage', () => {
  it('ökar start, slut och par; trimmar; ignorerar tomma', () => {
    const next = bumpUsage(EMPTY_USAGE, { startAddress: '  Hem ', endAddress: 'Jobb' });
    expect(next.startCounts.Hem).toBe(1);
    expect(next.endCounts.Jobb).toBe(1);
    expect(next.pairCounts['Hem||Jobb']).toBe(1);
  });

  it('ackumulerar och muterar inte föregående', () => {
    const a = bumpUsage(EMPTY_USAGE, { startAddress: 'Hem', endAddress: 'Jobb' });
    const b = bumpUsage(a, { startAddress: 'Hem', endAddress: 'Jobb' });
    expect(b.startCounts.Hem).toBe(2);
    expect(a.startCounts.Hem).toBe(1); // oförändrad
  });

  it('hoppar över tom adress', () => {
    const next = bumpUsage(EMPTY_USAGE, { startAddress: '   ', endAddress: 'Jobb' });
    expect(next.startCounts).toEqual({});
    expect(next.endCounts.Jobb).toBe(1);
    expect(next.pairCounts).toEqual({});
  });
});

describe('topAddresses', () => {
  it('sorterar fallande, exkluderar tomma, kapar', () => {
    const counts = { A: 1, B: 5, C: 3, '   ': 9 };
    expect(topAddresses(counts, 2)).toEqual(['B', 'C']);
  });
});

describe('bestFavoriteForPrefix', () => {
  const counts = { Storgatan: 3, Stortorget: 5, Lillgatan: 2 };

  it('returnerar null under 2 tecken', () => {
    expect(bestFavoriteForPrefix('s', counts)).toBeNull();
  });

  it('föredrar prefix-träff med högst frekvens', () => {
    expect(bestFavoriteForPrefix('stor', counts)).toBe('Stortorget');
  });

  it('faller tillbaka på substring när inget prefix matchar', () => {
    expect(bestFavoriteForPrefix('gata', counts)).toBe('Storgatan');
  });

  it('ignorerar exakt lika med prefix', () => {
    expect(bestFavoriteForPrefix('storgatan', { Storgatan: 3, Storgatansverkstad: 1 })).toBe('Storgatansverkstad');
  });
});
