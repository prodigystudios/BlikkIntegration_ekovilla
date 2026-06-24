import { describe, it, expect } from 'vitest';
import {
  diffKm,
  isComplete,
  monthKm,
  groupTripsByMonth,
  tripOverview,
} from '@/lib/domains/korjournal/calculations';
import type { Trip } from '@/lib/domains/korjournal/types';

function trip(partial: Partial<Trip>): Trip {
  return {
    id: partial.id || 't',
    date: partial.date || '2026-04-01',
    startAddress: partial.startAddress ?? 'A',
    endAddress: partial.endAddress ?? 'B',
    startKm: partial.startKm ?? null,
    endKm: partial.endKm ?? null,
    note: partial.note,
  };
}

describe('diffKm', () => {
  it('returnerar slut minus start', () => {
    expect(diffKm({ startKm: 100, endKm: 150 })).toBe(50);
  });
  it('klampar negativa till 0', () => {
    expect(diffKm({ startKm: 200, endKm: 100 })).toBe(0);
  });
  it('hanterar null som 0', () => {
    expect(diffKm({ startKm: null, endKm: 30 })).toBe(30);
    expect(diffKm({ startKm: null, endKm: null })).toBe(0);
  });
});

describe('isComplete', () => {
  it('komplett när båda finns och end >= start', () => {
    expect(isComplete({ startKm: 10, endKm: 10 })).toBe(true);
    expect(isComplete({ startKm: 10, endKm: 20 })).toBe(true);
  });
  it('ej komplett när km saknas', () => {
    expect(isComplete({ startKm: null, endKm: 20 })).toBe(false);
    expect(isComplete({ startKm: 10, endKm: null })).toBe(false);
  });
  it('ej komplett när end < start', () => {
    expect(isComplete({ startKm: 20, endKm: 10 })).toBe(false);
  });
});

describe('monthKm', () => {
  it('summerar distanser', () => {
    const trips = [trip({ startKm: 0, endKm: 10 }), trip({ startKm: 100, endKm: 130 })];
    expect(monthKm(trips)).toBe(40);
  });
});

describe('groupTripsByMonth', () => {
  it('grupperar per YYYY-MM och sorterar fallande', () => {
    const trips = [
      trip({ id: '1', date: '2026-03-15' }),
      trip({ id: '2', date: '2026-04-02' }),
      trip({ id: '3', date: '2026-04-20' }),
    ];
    const groups = groupTripsByMonth(trips);
    expect(groups.map(([ym]) => ym)).toEqual(['2026-04', '2026-03']);
    expect(groups[0][1].map((t) => t.id)).toEqual(['2', '3']);
  });
});

describe('tripOverview', () => {
  it('räknar totaler, ofullständiga, anteckningar och favoriter', () => {
    const trips = [
      trip({ startKm: 0, endKm: 10, note: 'hej' }),
      trip({ startKm: 10, endKm: null }), // ofullständig
    ];
    const ov = tripOverview(trips, { startCounts: { A: 2 }, endCounts: { B: 1, C: 1 } });
    expect(ov.totalTrips).toBe(2);
    expect(ov.totalKm).toBe(10);
    expect(ov.incompleteTrips).toBe(1);
    expect(ov.noteTrips).toBe(1);
    expect(ov.favoriteCount).toBe(3); // 1 start + 2 end
  });
});
