import { workOrderRef } from '@/lib/domains/planning/display';

// Field cutover fas 1e — mirror a CRM work order time entry into Blikk.
//
// Time is entered in CRM from now on, but Blikk stays the payroll system of record until CRM can
// carry absence, internal time, travel and a payroll export (fas 4). So every entry logged on a
// work order is also written to Blikk.
//
// WHY AN INTERNAL PROJECT: a Blikk time report must target exactly one of
// projectId / internalProjectId / absenceProjectId, and a CRM work order has no Blikk project —
// nothing creates one (lib/blikk.ts can update projects but not create them). So the hours land on
// one designated internal project ("CRM-arbetsorder", BLIKK_CRM_INTERNAL_PROJECT_ID) and the
// description carries the reference, so payroll gets correct hours per person per day and the job
// attribution stays readable. Attribution proper lives in CRM.
//
// Pure: this module only builds the request body. The call, and the fact that failure is
// non-fatal, belong to the route.

export type CrmTimeMirrorInput = {
  // From profiles.blikk_id. Null when the person has never been mapped in Admin → Blikk-koppling.
  blikkUserId: number | null;
  // From BLIKK_CRM_INTERNAL_PROJECT_ID. Null when the mirror is not configured.
  internalProjectId: number | null;
  workDate: string;
  hours: number;
  note?: string | null;
  orderNumber: string;
  fortnoxOrderNumber?: string | null;
  projectName?: string | null;
  clientName?: string | null;
  // Blikk requires a time article; the tenant-wide default is 3400 (BLIKK_TIME_ARTICLE_ID).
  timeArticleId?: number | null;
};

export type CrmTimeMirrorBody = {
  userId: number;
  internalProjectId: number;
  date: string;
  minutes: number;
  description: string;
  timeArticleId?: number;
};

const str = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.trim() : '';
  return s === '' ? null : s;
};

// What the hours were for, as one line in Blikk. Leads with the same reference the business uses
// everywhere else (Fortnox number when synced, else the internal order number).
export function buildCrmTimeMirrorDescription(input: {
  orderNumber: string;
  fortnoxOrderNumber?: string | null;
  projectName?: string | null;
  clientName?: string | null;
  note?: string | null;
}): string {
  const { ref } = workOrderRef(input.fortnoxOrderNumber, input.orderNumber);
  const head = [ref, str(input.projectName), str(input.clientName)].filter(Boolean).join(' · ');
  const note = str(input.note);
  return note ? `${head} — ${note}` : head;
}

// Build the Blikk createTimeReport body for a CRM time entry.
//
// Returns null when the entry cannot be mirrored — the person has no Blikk mapping, the target
// internal project is not configured, or the hours are not a positive number. The caller treats
// null as "skip and record it as unmirrored", never as an error: the CRM row is already saved and
// losing someone's reported hours would be far worse than a gap in Blikk.
export function buildCrmTimeMirrorBody(input: CrmTimeMirrorInput): CrmTimeMirrorBody | null {
  const userId = Number(input.blikkUserId);
  const internalProjectId = Number(input.internalProjectId);
  const hours = Number(input.hours);

  if (!Number.isFinite(userId) || userId <= 0) return null;
  if (!Number.isFinite(internalProjectId) || internalProjectId <= 0) return null;
  if (!Number.isFinite(hours) || hours <= 0) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(input.workDate))) return null;

  // Blikk works in minutes; CRM stores numeric(6,2) hours. Round rather than truncate so 7.5 h
  // is 450 min, not 449.
  const minutes = Math.round(hours * 60);
  if (minutes <= 0) return null;

  const articleId = Number(input.timeArticleId);

  return {
    userId,
    internalProjectId,
    date: input.workDate,
    minutes,
    description: buildCrmTimeMirrorDescription(input),
    ...(Number.isFinite(articleId) && articleId > 0 ? { timeArticleId: articleId } : {}),
  };
}

// Read the mirror target from the environment. Absent/blank/invalid = mirroring off, which is a
// valid state (local dev, or after fas 4 pulls the plug) — not an error.
export function resolveCrmMirrorConfig(env: Record<string, string | undefined> = process.env): {
  internalProjectId: number | null;
  timeArticleId: number | null;
} {
  const toId = (raw: string | undefined): number | null => {
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  return {
    internalProjectId: toId(env.BLIKK_CRM_INTERNAL_PROJECT_ID),
    // Same tenant-wide default the legacy time-report route forces (3400).
    timeArticleId: toId(env.BLIKK_TIME_ARTICLE_ID) ?? 3400,
  };
}
