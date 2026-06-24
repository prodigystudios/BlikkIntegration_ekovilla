// Pure address-favourite logic backing the autocomplete. The localStorage I/O
// lives in the client; this module only ranks and matches.

import type { Trip, UsageStats } from './types';

export const EMPTY_USAGE: UsageStats = { startCounts: {}, endCounts: {}, pairCounts: {} };

export const MAX_SUGGEST = 6;

// Return a new UsageStats with this trip's start/end (and the pair) incremented.
export function bumpUsage(prev: UsageStats, trip: Pick<Trip, 'startAddress' | 'endAddress'>): UsageStats {
  const next: UsageStats = {
    startCounts: { ...prev.startCounts },
    endCounts: { ...prev.endCounts },
    pairCounts: { ...prev.pairCounts },
  };
  const s = (trip.startAddress || '').trim();
  const e = (trip.endAddress || '').trim();
  if (s) next.startCounts[s] = (next.startCounts[s] || 0) + 1;
  if (e) next.endCounts[e] = (next.endCounts[e] || 0) + 1;
  if (s && e) {
    const key = `${s}||${e}`;
    next.pairCounts[key] = (next.pairCounts[key] || 0) + 1;
  }
  return next;
}

// Top-N addresses by frequency (blanks excluded).
export function topAddresses(counts: Record<string, number>, max = MAX_SUGGEST): string[] {
  return Object.entries(counts)
    .filter(([k]) => k.trim().length > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([k]) => k);
}

function normalizeAddr(s: string) {
  return s.trim().toLowerCase();
}

// Best favourite match for a typed prefix: prefer prefix matches, fall back to
// substring matches; highest frequency wins. Null below 2 chars or no match.
export function bestFavoriteForPrefix(prefixRaw: string, counts: Record<string, number>): string | null {
  const prefix = normalizeAddr(prefixRaw);
  if (prefix.length < 2) return null;

  let bestAddr: string | null = null;
  let bestCount = -1;
  const consider = (addr: string, count: number) => {
    if (count > bestCount) {
      bestAddr = addr;
      bestCount = count;
    }
  };

  // Prefer prefix matches (autocomplete-like).
  for (const [addr, count] of Object.entries(counts)) {
    const n = normalizeAddr(addr);
    if (!n || n === prefix) continue;
    if (n.startsWith(prefix)) consider(addr, count);
  }

  // Fallback: substring matches.
  if (!bestAddr) {
    for (const [addr, count] of Object.entries(counts)) {
      const n = normalizeAddr(addr);
      if (!n || n === prefix) continue;
      if (n.includes(prefix)) consider(addr, count);
    }
  }

  return bestAddr;
}
