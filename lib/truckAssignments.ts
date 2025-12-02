export type TruckAssignment = {
  id: string;
  truck_id: string;
  start_day: string; // YYYY-MM-DD
  end_day: string;   // YYYY-MM-DD
  team1_id?: string | null;
  team2_id?: string | null;
  team_member1_name?: string | null;
  team_member2_name?: string | null;
};

export type ResolvedCrew = {
  member1?: string | null;
  member2?: string | null;
};

function cmpDate(a: string, b: string) {
  // simple string compare works for YYYY-MM-DD
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export function normalizeAssignments(list: TruckAssignment[]): TruckAssignment[] {
  return [...list].sort((a, b) => cmpDate(a.start_day, b.start_day) || cmpDate(a.end_day, b.end_day));
}

export function resolveCrewForDay(truckId: string, day: string, assignments: TruckAssignment[]): ResolvedCrew {
  const list = assignments.filter(a => a.truck_id === truckId);
  // naive scan; lists are small per truck. Could binary search if needed.
  for (const a of list) {
    if (a.start_day <= day && day <= a.end_day) {
      return {
        member1: a.team_member1_name ?? null,
        member2: a.team_member2_name ?? null,
      };
    }
  }
  return {};
}

// Optional helper to fetch a reasonable window for planner usage
export function getAssignmentsWindowStart(todayISO: string, daysBack = 30): string {
  const d = new Date(todayISO);
  d.setDate(d.getDate() - daysBack);
  return d.toISOString().slice(0, 10);
}

export function getAssignmentsWindowEnd(todayISO: string, daysForward = 120): string {
  const d = new Date(todayISO);
  d.setDate(d.getDate() + daysForward);
  return d.toISOString().slice(0, 10);
}
