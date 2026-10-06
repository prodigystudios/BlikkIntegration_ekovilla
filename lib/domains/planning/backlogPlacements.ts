// Backlogpostens kort (`placements`) och räknare (`segment_count`) när tavlan ändras lokalt.
//
// ⚠️ RÄKNAREN ÄR LISTANS LÄNGD, aldrig ±1. Räknaren styr filtret Oplanerade/Planerade och listan
// visar var kortet ligger; räknades de var för sig kunde "Planerade" stå på en post utan rader, eller
// tvärtom. Servern bygger dem ur samma läsning (listSchedulableWorkOrders), och här sätts räknaren
// om ur listan efter varje ändring.
//
// Samma array tillbaka när inget ändras, så att en oförändrad backlog inte ritar om.

import type { BacklogPlacement } from './types';

type BacklogEntry = { key: string; segment_count: number; placements: BacklogPlacement[] };

/** Ordningen raderna visas i: först startdag, sedan bil och kort så att lika dagar står stilla. */
export function sortPlacements(list: BacklogPlacement[]): BacklogPlacement[] {
  return [...list].sort(
    (a, b) =>
      a.start_day.localeCompare(b.start_day) || a.truck_id.localeCompare(b.truck_id) || a.segment_id.localeCompare(b.segment_id),
  );
}

/**
 * Ett nytt kort på posten `key` (matchar på nyckeln: etapp 1 och etapp 2 delar arbetsorder-id).
 *
 * Idempotent: finns kortet redan — en omladdning av backloggen hann före placeringens egen
 * uppdatering — ändras ingenting. Annars hade det stått två gånger och räknaren legat ett för högt.
 */
export function withPlacementAdded<T extends BacklogEntry>(items: T[], key: string, placement: BacklogPlacement): T[] {
  const target = items.find((b) => b.key === key);
  if (!target || target.placements.some((p) => p.segment_id === placement.segment_id)) return items;
  return items.map((b) => (b.key === key ? withPlacements(b, sortPlacements([...b.placements, placement])) : b));
}

/** Kortet `segmentId` togs bort från posten `key`. Fanns det inte där ändras ingenting. */
export function withPlacementRemoved<T extends BacklogEntry>(items: T[], key: string, segmentId: string): T[] {
  const target = items.find((b) => b.key === key);
  if (!target || !target.placements.some((p) => p.segment_id === segmentId)) return items;
  return items.map((b) => (b.key === key ? withPlacements(b, b.placements.filter((p) => p.segment_id !== segmentId)) : b));
}

function withPlacements<T extends BacklogEntry>(entry: T, placements: BacklogPlacement[]): T {
  return { ...entry, placements, segment_count: placements.length };
}

/** Kortet `segmentId` flyttades, pausades eller ändrade längd. Räknaren rörs inte. */
export function withPlacementMoved<T extends BacklogEntry>(
  items: T[],
  segmentId: string,
  patch: Partial<Pick<BacklogPlacement, 'truck_id' | 'start_day' | 'end_day' | 'on_hold'>>,
): T[] {
  if (!items.some((b) => b.placements.some((p) => p.segment_id === segmentId))) return items;
  return items.map((b) =>
    b.placements.some((p) => p.segment_id === segmentId)
      ? { ...b, placements: sortPlacements(b.placements.map((p) => (p.segment_id === segmentId ? { ...p, ...patch } : p))) }
      : b,
  );
}
