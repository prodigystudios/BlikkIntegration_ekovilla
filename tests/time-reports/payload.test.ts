import { describe, it, expect } from 'vitest';
import { buildTimeReportBody } from '@/lib/domains/time-reports/payload';

const base = { totalHours: 8, date: '2026-04-01', breakMinutes: 30, start: '07:00', end: '16:00' };

describe('buildTimeReportBody', () => {
  it('project: sätter bara projectId, minuter avrundas', () => {
    const body = buildTimeReportBody({ ...base, totalHours: 7.5, reportType: 'project', projectId: '42' });
    expect(body.minutes).toBe(450);
    expect(body.projectId).toBe(42);
    expect(body.internalProjectId).toBeUndefined();
    expect(body.absenceProjectId).toBeUndefined();
  });

  it('internal/absence: sätter rätt mål-id', () => {
    expect(buildTimeReportBody({ ...base, reportType: 'internal', internalProjectId: 5 }).internalProjectId).toBe(5);
    expect(buildTimeReportBody({ ...base, reportType: 'absence', absenceProjectId: '9' }).absenceProjectId).toBe(9);
  });

  it('tom beskrivning blir undefined; aktivitet/tidkod konverteras', () => {
    const body = buildTimeReportBody({ ...base, reportType: 'project', projectId: 1, description: '', activityId: '3', timecodeId: '7' });
    expect(body.description).toBeUndefined();
    expect(body.activityId).toBe(3);
    expect(body.timeCodeId).toBe(7);
  });

  it('travelReport tas med endast om den finns', () => {
    expect('travelReport' in buildTimeReportBody({ ...base, reportType: 'project', projectId: 1 })).toBe(false);
    const withTravel = buildTimeReportBody({ ...base, reportType: 'project', projectId: 1, travelReport: { km: 10 } });
    expect(withTravel.travelReport).toEqual({ km: 10 });
  });
});
