// Pure trip calculations: distance, completeness, monthly grouping and overview.

import type { Trip, UsageStats } from './types';

// Trip distance, never negative.
export function diffKm(t: Pick<Trip, 'startKm' | 'endKm'>) {
  return Math.max(0, (t.endKm || 0) - (t.startKm || 0));
}

// Complete only when both km exist, are finite, and end >= start.
export function isComplete(t: Pick<Trip, 'startKm' | 'endKm'>) {
  return (
    t.startKm !== null && t.startKm !== undefined && Number.isFinite(t.startKm) &&
    t.endKm !== null && t.endKm !== undefined && Number.isFinite(t.endKm) &&
    (t.endKm as number) >= (t.startKm as number)
  );
}

// Sum of trip distances.
export function monthKm(arr: Trip[]) {
  return arr.reduce((sum, t) => sum + diffKm(t), 0);
}

// Group trips by YYYY-MM, sorted descending (newest month first).
export function groupTripsByMonth(trips: Trip[]): Array<[string, Trip[]]> {
  const map = new Map<string, Trip[]>();
  for (const t of trips) {
    const key = t.date.slice(0, 7);
    const arr = map.get(key) || [];
    arr.push(t);
    map.set(key, arr);
  }
  return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]));
}

export type TripOverview = {
  totalTrips: number;
  totalKm: number;
  incompleteTrips: number;
  noteTrips: number;
  favoriteCount: number;
};

// Dashboard summary. favoriteCount mirrors the legacy count: number of distinct
// start + end addresses tracked in usage stats.
export function tripOverview(
  trips: Trip[],
  usage: Pick<UsageStats, 'startCounts' | 'endCounts'>,
): TripOverview {
  return {
    totalTrips: trips.length,
    totalKm: trips.reduce((sum, t) => sum + diffKm(t), 0),
    incompleteTrips: trips.filter((t) => !isComplete(t)).length,
    noteTrips: trips.filter((t) => String(t.note || '').trim()).length,
    favoriteCount: Object.keys(usage.startCounts).length + Object.keys(usage.endCounts).length,
  };
}
