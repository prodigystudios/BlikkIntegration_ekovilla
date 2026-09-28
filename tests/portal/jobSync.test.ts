import { describe, it, expect } from 'vitest';
import { markPortalJobForSync, parsePendingPortalEvents, syncPortalJobs } from '@/lib/domains/portal/jobSync';
import { memoryAdmin } from './helpers/memoryAdmin';

// Omräkningen av de markerade jobben (fas 4b). Läget och händelserna sparas i en skrivning innan de köas, så att en
// krasch mitt i varken tappar eller dubblerar en händelse; sync_version stoppar en andra samtidig körning.

const NOW = new Date('2026-10-12T08:30:00.000Z');
const MARK = '2026-10-12T08:29:00.000Z';
const job = (over: Record<string, unknown> = {}) => ({
  quote_id: 'q-1',
  work_order_id: 'wo-1',
  work_order_created_at: '2026-10-01T10:00:00.000Z',
  sync_requested_at: MARK,
  sync_state: {},
  sync_pending_events: [],
  sync_version: 0,
  ...over,
});
const workOrder = (over: Record<string, unknown> = {}) => ({
  id: 'wo-1',
  status: 'draft',
  fortnox_order_number: '26',
  fortnox_order_synced_at: '2026-10-01T10:05:00.000Z',
  planned_start_day: '2026-10-14',
  planned_end_day: '2026-10-15',
  fortnox_invoiced_at: null,
  ...over,
});
const sync = (admin: unknown) => syncPortalJobs(admin as never, { now: () => NOW });
const jobRow = (tables: Record<string, Record<string, unknown>[]>, quoteId = 'q-1') =>
  tables.crm_portal_jobs.find((r) => r.quote_id === quoteId)!;

describe('syncPortalJobs', () => {
  it('bekräftad köas mot portalens events-route, läget sparas med nyckeln, markeringen står kvar (flyttad sist) tills den levererats', async () => {
    const { admin, tables } = memoryAdmin({ crm_portal_jobs: [job()], crm_work_orders: [workOrder()] });
    expect(await sync(admin)).toEqual({ jobs: 1, queued: 1, unchanged: 0, conflicts: 0, errors: 0 });

    const events = tables.portal_outbound_events;
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      idempotency_key: 'job.confirmed-q-1-2026-10-12T08:30:00.000Z',
      path: '/api/ekovilla/events',
      ordering_key: 'job:q-1',
      supersede_key: null,
      status: 'pending',
    });
    expect((events[0].payload as { data: unknown }).data).toEqual({ quoteId: 'q-1', ekovillaOrderNumber: '26', confirmedAt: '2026-10-01T10:05:00.000Z' });
    expect(jobRow(tables)).toMatchObject({
      sync_state: { confirmedKey: 'job.confirmed-q-1-2026-10-12T08:30:00.000Z' },
      sync_pending_events: [],
      sync_version: 1,
      sync_requested_at: NOW.toISOString(),
    });
  });

  it('köad men inte levererad: inget nytt, markeringen står kvar men flyttas sist i kön', async () => {
    const key = 'job.confirmed-q-1-2026-10-12T08:00:00.000Z';
    const { admin, tables } = memoryAdmin({
      crm_portal_jobs: [job({ sync_state: { confirmedKey: key }, sync_version: 1 })],
      crm_work_orders: [workOrder()],
      portal_outbound_events: [{ id: 'e1', seq: 1, idempotency_key: key, status: 'pending' }],
    });
    expect(await sync(admin)).toMatchObject({ unchanged: 1 });
    expect(tables.portal_outbound_events).toHaveLength(1);
    expect(jobRow(tables).sync_requested_at).toBe(NOW.toISOString());
  });

  it('jobb som väntar tränger inte undan nya: de tas äldst först, och de väntande hamnar sist', async () => {
    const key = (q: string) => `job.confirmed-${q}-2026-10-12T08:00:00.000Z`;
    const waiting = (q: string, mark: string) =>
      job({ quote_id: q, work_order_id: `wo-${q}`, reserved_work_order_id: `wo-${q}`, sync_requested_at: mark, sync_state: { confirmedKey: key(q) }, sync_version: 1 });
    const { admin, tables } = memoryAdmin({
      crm_portal_jobs: [waiting('q-a', '2026-10-12T07:00:00.000Z'), waiting('q-b', '2026-10-12T07:01:00.000Z'), job({ quote_id: 'q-ny', work_order_id: 'wo-q-ny', reserved_work_order_id: 'wo-q-ny', sync_requested_at: '2026-10-12T08:20:00.000Z' })],
      crm_work_orders: [workOrder({ id: 'wo-q-a' }), workOrder({ id: 'wo-q-b' }), workOrder({ id: 'wo-q-ny', order_number: 'AO-NY' })],
      portal_outbound_events: [
        { id: 'a', seq: 1, idempotency_key: key('q-a'), status: 'pending' },
        { id: 'b', seq: 2, idempotency_key: key('q-b'), status: 'pending' },
      ],
    });
    await syncPortalJobs(admin, { now: () => NOW, limit: 2 });
    expect(tables.crm_portal_jobs.filter((j) => j.sync_requested_at === NOW.toISOString()).map((j) => j.quote_id)).toEqual(['q-a', 'q-b']);
    // Nästa varv tar det nya jobbet först.
    await syncPortalJobs(admin, { now: () => new Date(NOW.getTime() + 60_000), limit: 1 });
    expect(tables.portal_outbound_events.some((e) => String(e.idempotency_key).startsWith('job.confirmed-q-ny'))).toBe(true);
  });

  it('levererad: planerad köas med ersättningsnyckel, och markeringen nollas', async () => {
    const key = 'job.confirmed-q-1-2026-10-12T08:00:00.000Z';
    const { admin, tables } = memoryAdmin({
      crm_portal_jobs: [job({ sync_state: { confirmedKey: key }, sync_version: 1 })],
      crm_work_orders: [workOrder()],
      portal_outbound_events: [{ id: 'e1', seq: 1, idempotency_key: key, status: 'sent' }],
    });
    expect(await sync(admin)).toMatchObject({ queued: 1 });
    const scheduled = tables.portal_outbound_events.find((e) => String(e.idempotency_key).startsWith('job.scheduled'))!;
    expect(scheduled).toMatchObject({ ordering_key: 'job:q-1', supersede_key: 'job.scheduled:q-1' });
    expect((scheduled.payload as { data: unknown }).data).toEqual({ quoteId: 'q-1', scheduledFor: '2026-10-14', scheduledUntil: '2026-10-15' });
    expect(jobRow(tables)).toMatchObject({ sync_requested_at: null, sync_version: 2, synced_at: NOW.toISOString() });
  });

  it('krasch efter att läget sparats (kön svarar fel): nästa varv köar samma händelse, en gång', async () => {
    const { admin, tables, failOn } = memoryAdmin({ crm_portal_jobs: [job()], crm_work_orders: [workOrder()] });
    failOn((c) => c.table === 'portal_outbound_events' && c.op === 'upsert', { message: 'kön är nere' });
    expect(await sync(admin)).toMatchObject({ errors: 1 });
    // Beslutet står på raden, markeringen står kvar, inget köat.
    expect(tables.portal_outbound_events ?? []).toHaveLength(0);
    const pending = jobRow(tables).sync_pending_events as unknown[];
    expect(pending).toHaveLength(1);
    expect(jobRow(tables)).toMatchObject({ sync_version: 1, sync_requested_at: MARK });

    // Nästa varv, en minut senare: samma nyckel köas, en gång, och posten töms.
    await syncPortalJobs(admin, { now: () => new Date(NOW.getTime() + 60_000) });
    expect(tables.portal_outbound_events).toHaveLength(1);
    expect(tables.portal_outbound_events[0].idempotency_key).toBe('job.confirmed-q-1-2026-10-12T08:30:00.000Z');
    expect(jobRow(tables).sync_pending_events).toEqual([]);
  });

  it('krasch efter kön men före tömningen: nästa varv köar inte en gång till', async () => {
    const { admin, tables, failOn } = memoryAdmin({ crm_portal_jobs: [job()], crm_work_orders: [workOrder()] });
    failOn((c) => c.table === 'crm_portal_jobs' && c.op === 'update' && Array.isArray((c.values as Record<string, unknown>).sync_pending_events) && ((c.values as Record<string, unknown[]>).sync_pending_events).length === 0 && !('sync_state' in (c.values as object)), { message: 'avbrott' });
    await sync(admin);
    expect(tables.portal_outbound_events).toHaveLength(1);
    expect(jobRow(tables).sync_pending_events as unknown[]).toHaveLength(1);
    await sync(admin);
    expect(tables.portal_outbound_events).toHaveLength(1);
    expect(jobRow(tables).sync_pending_events).toEqual([]);
  });

  it('två körningar samtidigt: den som kommer sist sparar och köar ingenting', async () => {
    const { admin, tables } = memoryAdmin(
      { crm_portal_jobs: [job()], crm_work_orders: [workOrder()] },
      {
        beforeExecute: (call, t) => {
          // Den andra körningen hinner spara sitt läge mellan vår läsning och vår skrivning.
          if (call.table === 'crm_portal_jobs' && call.op === 'update' && 'sync_state' in (call.values as object)) {
            t.crm_portal_jobs[0].sync_version = 1;
          }
        },
      },
    );
    expect(await sync(admin)).toMatchObject({ conflicts: 1, queued: 0 });
    expect(tables.portal_outbound_events ?? []).toHaveLength(0);
  });

  it('en ny ändring under tiden: markeringen står kvar, så att jobbet räknas om igen', async () => {
    const key = 'job.confirmed-q-1-2026-10-12T08:00:00.000Z';
    const { admin, tables } = memoryAdmin(
      {
        crm_portal_jobs: [job({ sync_state: { confirmedKey: key, scheduled: { for: '2026-10-14', until: '2026-10-15' } }, sync_version: 1 })],
        crm_work_orders: [workOrder()],
        portal_outbound_events: [{ id: 'e1', seq: 1, idempotency_key: key, status: 'sent' }],
      },
      {
        beforeExecute: (call, t) => {
          if (call.table === 'crm_portal_jobs' && call.op === 'update' && (call.values as Record<string, unknown>).sync_requested_at === null) {
            t.crm_portal_jobs[0].sync_requested_at = '2026-10-12T08:29:30.000Z';
          }
        },
      },
    );
    expect(await sync(admin)).toMatchObject({ unchanged: 1 });
    expect(jobRow(tables).sync_requested_at).toBe('2026-10-12T08:29:30.000Z');
  });

  it('arbetsordern borttagen: job.cancelled köas', async () => {
    const { admin, tables } = memoryAdmin({ crm_portal_jobs: [job({ work_order_id: null })], crm_work_orders: [] });
    await sync(admin);
    expect(tables.portal_outbound_events.map((e) => (e.payload as { type: string }).type)).toEqual(['job.cancelled']);
    // Kontraktspunkt 20: reason når kön, tom men med.
    expect((tables.portal_outbound_events[0].payload as { data: unknown }).data).toEqual({
      quoteId: 'q-1',
      reason: '',
      cancelledAt: expect.any(String),
    });
    expect(jobRow(tables)).toMatchObject({ sync_state: { cancelled: true }, sync_requested_at: null });
  });

  it('bara markerade jobb räknas om, och ett jobb som faller hindrar inte nästa', async () => {
    const { admin, tables, failOn } = memoryAdmin({
      crm_portal_jobs: [
        job({ quote_id: 'q-1', work_order_id: 'wo-1', sync_requested_at: '2026-10-12T08:00:00.000Z' }),
        job({ quote_id: 'q-2', work_order_id: 'wo-2', sync_requested_at: '2026-10-12T08:10:00.000Z', reserved_work_order_id: 'wo-2' }),
        job({ quote_id: 'q-3', work_order_id: 'wo-3', sync_requested_at: null, reserved_work_order_id: 'wo-3' }),
      ],
      crm_work_orders: [workOrder(), workOrder({ id: 'wo-2' }), workOrder({ id: 'wo-3' })],
    });
    failOn((c) => c.table === 'crm_work_orders' && c.filters.some(([, col, v]) => col === 'id' && v === 'wo-1'), { message: 'läsfel' });
    expect(await sync(admin)).toEqual({ jobs: 2, queued: 1, unchanged: 0, conflicts: 0, errors: 1 });
    expect(tables.portal_outbound_events.map((e) => e.ordering_key)).toEqual(['job:q-2']);
    expect(jobRow(tables, 'q-3').sync_state).toEqual({});
  });
});

describe('parsePendingPortalEvents', () => {
  it('en trasig post kastar i stället för att tyst försvinna', () => {
    expect(() => parsePendingPortalEvents([{ idempotencyKey: 'k' }])).toThrow(/sync_pending_events\[0\]/);
    expect(() => parsePendingPortalEvents({})).toThrow(/inte en lista/);
    expect(parsePendingPortalEvents([])).toEqual([]);
  });
});

describe('markPortalJobForSync', () => {
  it('sätter markeringen', async () => {
    const { admin, tables } = memoryAdmin({ crm_portal_jobs: [job({ sync_requested_at: null })] });
    await markPortalJobForSync(admin, 'q-1', NOW);
    expect(jobRow(tables).sync_requested_at).toBe(NOW.toISOString());
  });
});
