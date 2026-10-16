import { describe, it, expect, vi, beforeEach } from 'vitest';
import { adminUser, effectivePermissionsForRole } from '../crm/helpers/supabase';

// Avplaneringen (DELETE /api/crm/planering/segments/[id]). Regeln om säckrapporterna bor i databasen
// (ops_segments_keep_sack_reports, prövad i supabase/checks/segment_delete_keeps_sack_reports.sql). Det som prövas HÄR
// är rutans översättning av triggerns nej: 23503 är orderns sista kort med rapporter, och tavlan visar `error` som den är.
// Ett 500 med databasens text hade sett ut som ett fel i appen, inte som ett besked om vad man ska göra i stället.

vi.mock('@/lib/auth/route', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/route')>();
  return { ...actual, getCurrentUser: vi.fn() };
});
vi.mock('@/lib/auth/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/permissions')>();
  return { ...actual, getEffectivePermissions: vi.fn() };
});
vi.mock('@/lib/domains/planning/schedule', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/domains/planning/schedule')>();
  return {
    ...actual,
    removeSegment: vi.fn(),
    getSegmentRef: vi.fn(),
    readWorkOrderStatus: vi.fn(),
  };
});
vi.mock('@/lib/domains/planning/reports', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/domains/planning/reports')>();
  return { ...actual, countSackReportsOnSegment: vi.fn() };
});
vi.mock('@/lib/domains/planning/activity', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/domains/planning/activity')>();
  return { ...actual, logActivity: vi.fn() };
});
vi.mock('@/lib/supabase/server', () => ({ getSupabaseAdmin: vi.fn(() => ({ __client: 'admin' })) }));
vi.mock('next/headers', () => ({ cookies: vi.fn() }));
vi.mock('@/lib/supabase/session', () => ({
  createSessionClient: vi.fn(() => ({ __client: 'session' })),
}));

import { getCurrentUser } from '@/lib/auth/route';
import { getEffectivePermissions } from '@/lib/auth/permissions';
import { removeSegment, getSegmentRef, readWorkOrderStatus } from '@/lib/domains/planning/schedule';
import { logActivity } from '@/lib/domains/planning/activity';
import { countSackReportsOnSegment } from '@/lib/domains/planning/reports';
import { DELETE } from '@/app/api/crm/planering/segments/[id]/route';

const SEGMENT_ID = '7afccfe9-7767-42d1-b5b5-39829bae0481';

const del = () => DELETE(new Request('http://localhost/x', { method: 'DELETE' }), { params: { id: SEGMENT_ID } });

beforeEach(() => {
  vi.clearAllMocks();
  (getCurrentUser as any).mockResolvedValue(adminUser);
  (getEffectivePermissions as any).mockResolvedValue(effectivePermissionsForRole(adminUser.role));
  (getSegmentRef as any).mockResolvedValue({ workOrderId: 'wo-1', ref: '#272' });
  (readWorkOrderStatus as any).mockResolvedValue('scheduled');
  (countSackReportsOnSegment as any).mockResolvedValue(0);
});

describe('avplaneringen: triggerns nej', () => {
  it('orderns sista kort med säckrapporter (23503) blir 409 med ett besked tavlan kan visa', async () => {
    (removeSegment as any).mockResolvedValue({
      error: { code: '23503', message: 'Kortet har säckrapporter (1 st) och är orderns enda kort på schemat' },
    });
    const res = await del();
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.errorDetails.code).toBe('segment_has_sack_reports');
    expect(body.error).toMatch(/Flytta eller pausa/);
    // Ingenting togs bort, så ingenting loggas som borttaget.
    expect(logActivity).not.toHaveBeenCalled();
  });

  it('andra databasfel är fortfarande 500', async () => {
    (removeSegment as any).mockResolvedValue({ error: { code: '42501', message: 'permission denied' } });
    const res = await del();
    expect(res.status).toBe(500);
    expect((await res.json()).errorDetails.code).toBe('planning_segment_delete_failed');
  });

  it('en lyckad borttagning loggas och svarar med orderns status', async () => {
    (removeSegment as any).mockResolvedValue({ error: null });
    const res = await del();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.work_order_status).toBe('scheduled');
    expect(body.data.moved_sack_reports).toBe(0);
    expect(logActivity).toHaveBeenCalledTimes(1);
    const entry = (logActivity as any).mock.calls[0][2];
    expect(entry).toMatchObject({ action: 'segment.delete', segmentId: SEGMENT_ID, summary: 'Tog bort #272 från kalendern' });
    expect(entry.details).toBeUndefined();
  });
});

describe('avplaneringen: flyttade säckrapporter syns', () => {
  // Har kortet rapporter och borttagningen går igenom har databasen flyttat dem till orderns andra kort, och säckarna
  // dras då från en annan bils depå. Det får inte ske tyst.
  it('räknar kortets rapporter FÖRE borttagningen — efteråt sitter de på ett annat kort', async () => {
    const order: string[] = [];
    (countSackReportsOnSegment as any).mockImplementation(async () => { order.push('count'); return 2; });
    (removeSegment as any).mockImplementation(async () => { order.push('remove'); return { error: null }; });
    await del();
    expect(order).toEqual(['count', 'remove']);
    expect((countSackReportsOnSegment as any).mock.calls[0]).toEqual([{ __client: 'session' }, SEGMENT_ID]);
  });

  it('skriver antalet i loggraden och i svaret', async () => {
    (countSackReportsOnSegment as any).mockResolvedValue(2);
    (removeSegment as any).mockResolvedValue({ error: null });
    const res = await del();
    expect((await res.json()).data.moved_sack_reports).toBe(2);
    const entry = (logActivity as any).mock.calls[0][2];
    expect(entry.summary).toBe('Tog bort #272 från kalendern. 2 säckrapporter flyttades till orderns andra kort.');
    expect(entry.details).toEqual({ moved_sack_reports: 2 });
  });

  it('en rapport får singular', async () => {
    (countSackReportsOnSegment as any).mockResolvedValue(1);
    (removeSegment as any).mockResolvedValue({ error: null });
    await del();
    expect((logActivity as any).mock.calls[0][2].summary).toBe(
      'Tog bort #272 från kalendern. Säckrapporten flyttades till orderns andra kort.',
    );
  });

  it('gick räkningen inte att läsa tas kortet ändå bort, utan påstående om flytt', async () => {
    (countSackReportsOnSegment as any).mockResolvedValue(null);
    (removeSegment as any).mockResolvedValue({ error: null });
    const res = await del();
    expect(res.status).toBe(200);
    expect((await res.json()).data.moved_sack_reports).toBe(0);
    expect((logActivity as any).mock.calls[0][2].summary).toBe('Tog bort #272 från kalendern');
  });
});
