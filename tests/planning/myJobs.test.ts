import { describe, it, expect } from 'vitest';
import { mergeMyJobs, type BlikkJobRow, type CrmJobRow } from '@/lib/domains/planning/myJobs';

const blikk = (over: Partial<BlikkJobRow> = {}): BlikkJobRow => ({
  segment_id: 'seg-b1',
  project_id: 4711,
  project_name: 'Vindsisolering',
  customer: 'Bygg AB',
  order_number: '9001',
  job_day: '2026-08-12',
  start_day: '2026-08-12',
  truck: 'Bil 1',
  job_type: 'Ekovilla',
  bag_count: 42,
  ...over,
});

const crm = (over: Partial<CrmJobRow> = {}): CrmJobRow => ({
  segment_id: 'seg-c1',
  work_order_id: 'wo-1',
  order_number: 'AO-20260810-A1B2',
  fortnox_order_number: '5418',
  project_name: 'Snedtak',
  customer: 'Villa Ek',
  job_day: '2026-08-11',
  start_day: '2026-08-11',
  truck: 'Bil 2',
  truck_color: '#16a34a',
  job_type: 'Vitull',
  status: 'scheduled',
  work_address: { street_address: 'Jobbvägen 1', postal_code: '131 30', city: 'Nacka' },
  customer_address: { street_address: 'Kontoret 9', postal_code: '111 22', city: 'Stockholm' },
  ...over,
});

describe('mergeMyJobs', () => {
  it('interleaves both sources chronologically and tags each row', () => {
    const merged = mergeMyJobs([blikk({ job_day: '2026-08-13' })], [crm({ job_day: '2026-08-11' })]);
    expect(merged.map((j) => [j.day, j.source])).toEqual([
      ['2026-08-11', 'crm'],
      ['2026-08-13', 'blikk'],
    ]);
  });

  it('leads a CRM row with the Fortnox number, and falls back to the internal order number', () => {
    const [synced] = mergeMyJobs([], [crm()]);
    expect(synced.ref).toBe('#5418');

    const [unsynced] = mergeMyJobs([], [crm({ fortnox_order_number: null })]);
    expect(unsynced.ref).toBe('AO-20260810-A1B2');
  });

  it('resolves the CRM job-site address, preferring the work address over the customer address', () => {
    const [withWorkAddress] = mergeMyJobs([], [crm()]);
    expect(withWorkAddress.address).toBe('Jobbvägen 1, 131 30, Nacka');

    const [withoutWorkAddress] = mergeMyJobs([], [crm({ work_address: {} })]);
    expect(withoutWorkAddress.address).toBe('Kontoret 9, 111 22, Stockholm');
  });

  it('routes each row to its own world: CRM carries a work order, Blikk a project', () => {
    const merged = mergeMyJobs([blikk()], [crm()]);
    const crmRow = merged.find((j) => j.source === 'crm')!;
    const blikkRow = merged.find((j) => j.source === 'blikk')!;

    expect(crmRow.workOrderId).toBe('wo-1');
    expect(crmRow.projectId).toBeNull();
    expect(blikkRow.projectId).toBe('4711');
    expect(blikkRow.workOrderId).toBeNull();
  });

  it('keeps the legacy "#order number" label and sack count on Blikk rows', () => {
    const [row] = mergeMyJobs([blikk()], []);
    expect(row.ref).toBe('#9001');
    expect(row.bagCount).toBe(42);
    // Sacks are not in the v1 CRM RPC — the work order view owns them.
    const [crmRow] = mergeMyJobs([], [crm()]);
    expect(crmRow.bagCount).toBeNull();
  });

  it('falls back to the segment start when the expanded day is missing', () => {
    const [row] = mergeMyJobs([blikk({ job_day: null, start_day: '2026-08-14' })], []);
    expect(row.day).toBe('2026-08-14');
  });

  it('drops rows that have no day at all rather than rendering an undated card', () => {
    expect(mergeMyJobs([blikk({ job_day: null, start_day: null })], [])).toEqual([]);
    expect(mergeMyJobs([], [crm({ job_day: null, start_day: null })])).toEqual([]);
  });

  it('collapses the same segment-day arriving twice', () => {
    const merged = mergeMyJobs([], [crm(), crm()]);
    expect(merged).toHaveLength(1);
  });

  it('keeps a segment that spans several days as one row per day', () => {
    const merged = mergeMyJobs(
      [],
      [crm({ job_day: '2026-08-11' }), crm({ job_day: '2026-08-12' })],
    );
    expect(merged.map((j) => j.day)).toEqual(['2026-08-11', '2026-08-12']);
  });

  it('never lets a Blikk and a CRM segment collide on the same id', () => {
    const merged = mergeMyJobs(
      [blikk({ segment_id: 'shared-id', job_day: '2026-08-11' })],
      [crm({ segment_id: 'shared-id', job_day: '2026-08-11' })],
    );
    expect(merged).toHaveLength(2);
    expect(new Set(merged.map((j) => j.key)).size).toBe(2);
  });

  it('orders deterministically within a day so the list does not reshuffle between loads', () => {
    const a = crm({ segment_id: 'seg-a', fortnox_order_number: '1000' });
    const b = crm({ segment_id: 'seg-b', fortnox_order_number: '2000' });
    expect(mergeMyJobs([], [b, a]).map((j) => j.ref)).toEqual(['#1000', '#2000']);
    expect(mergeMyJobs([], [a, b]).map((j) => j.ref)).toEqual(['#1000', '#2000']);
  });

  it('tolerates null/undefined feeds (one RPC failing must not blank the other)', () => {
    expect(mergeMyJobs(null, undefined)).toEqual([]);
    expect(mergeMyJobs(null, [crm()])).toHaveLength(1);
    expect(mergeMyJobs([blikk()], null)).toHaveLength(1);
  });
});
