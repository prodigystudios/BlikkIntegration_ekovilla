// Shared, pure builder for the Blikk time-report request body. Previously this
// mapping was duplicated across the dashboard, "mina jobb" and "tidrapport"
// pages; centralizing it keeps the field names + target-id rules in one tested place.

export type TimeReportSubmitPayload = {
  totalHours: number;
  date: string;
  breakMinutes?: number | null;
  start?: string | null;
  end?: string | null;
  reportType: 'project' | 'internal' | 'absence' | string;
  projectId?: string | number | null;
  internalProjectId?: string | number | null;
  absenceProjectId?: string | number | null;
  activityId?: string | number | null;
  timecodeId?: string | number | null;
  description?: string | null;
  travelReport?: unknown;
};

// Maps the modal payload to the API body. Exactly one of project/internal/absence
// id is set, based on reportType. travelReport is included only when present.
export function buildTimeReportBody(payload: TimeReportSubmitPayload): Record<string, unknown> {
  const body: Record<string, unknown> = {
    date: payload.date,
    minutes: Math.round(payload.totalHours * 60),
    breakMinutes: payload.breakMinutes,
    start: payload.start,
    end: payload.end,
    projectId: payload.reportType === 'project' && payload.projectId ? Number(payload.projectId) : undefined,
    internalProjectId: payload.reportType === 'internal' && payload.internalProjectId ? Number(payload.internalProjectId) : undefined,
    absenceProjectId: payload.reportType === 'absence' && payload.absenceProjectId ? Number(payload.absenceProjectId) : undefined,
    activityId: payload.activityId ? Number(payload.activityId) : undefined,
    timeCodeId: payload.timecodeId ? Number(payload.timecodeId) : undefined,
    description: payload.description || undefined,
  };
  if (payload.travelReport) body.travelReport = payload.travelReport;
  return body;
}
