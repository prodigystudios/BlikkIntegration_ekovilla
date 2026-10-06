// Backlogpostens kort (`placements`) och räknare (`segment_count`) när tavlan ändras lokalt.
//
// ⚠️ BÅDA I SAMMA STEG, alltid. Räknaren styr filtret Oplanerade/Planerade och listan visar var
// kortet ligger; ändras den ena utan den andra står "Planerade" på en post utan rader, eller tvärt
// om. Servern bygger dem ur samma läsning (listSchedulableWorkOrders); här hålls de ihop mellan två
// omladdningar.
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

/** Ett nytt kort på posten `key` (matchar på nyckeln: etapp 1 och etapp 2 delar arbetsorder-id). */
export function withPlacementAdded<T extends BacklogEntry>(items: T[], key: string, placement: BacklogPlacement): T[] {
  if (!items.some((b) => b.key === key)) return items;
  return items.map((b) =>
    b.key === key
      ? { ...b, segment_count: b.segment_count + 1, placements: sortPlacements([...b.placements, placement]) }
      : b,
  );
}

/** Kortet `segmentId` togs bort från posten `key`. Räknaren går aldrig under noll. */
export function withPlacementRemoved<T extends BacklogEntry>(items: T[], key: string, segmentId: string): T[] {
  if (!items.some((b) => b.key === key)) return items;
  return items.map((b) =>
    b.key === key
      ? {
          ...b,
          segment_count: Math.max(0, b.segment_count - 1),
          placements: b.placements.filter((p) => p.segment_id !== segmentId),
        }
      : b,
  );
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
