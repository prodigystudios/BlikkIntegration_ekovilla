import { describe, it, expect } from 'vitest';
import { validateSegmentDates, mapSegment } from '@/lib/domains/planning/schedule';

const baseRow = {
  id: 'seg-1',
  truck_id: 'truck-1',
  start_day: '2026-06-20',
  end_day: '2026-06-20',
  sort_index: 0,
  job_type: null,
  on_hold: false,
  created_by: 'user-1',
  created_by_name: 'Anna Andersson',
  placeholder_title: null,
  placeholder_customer: null,
  created_at: '2026-06-13T08:00:00Z',
  updated_at: '2026-06-13T08:00:00Z',
};

describe('mapSegment', () => {
  it('maps a work-order segment with the embedded job', () => {
    const seg = mapSegment({
      ...baseRow,
      work_order_id: 'wo-1',
      work_order: {
        order_number: 'AO-1', fortnox_order_number: '5418', project_name: 'Vind', client_name: 'Acme',
        status: 'scheduled', customer_snapshot: null, work_address: null, line_items: [],
      },
    } as any);
    expect(seg.work_order_id).toBe('wo-1');
    expect(seg.job?.ref).toBe('#5418');
    expect(seg.placeholder_title).toBeNull();
    expect(seg.created_by_name).toBe('Anna Andersson');
  });

  it('maps a placeholder segment (no work order, no job)', () => {
    const seg = mapSegment({
      ...baseRow,
      work_order_id: null,
      placeholder_title: 'Vind Ekvägen 4',
      placeholder_customer: 'Bygg AB',
      work_order: null,
    } as any);
    expect(seg.work_order_id).toBeNull();
    expect(seg.job).toBeNull();
    expect(seg.placeholder_title).toBe('Vind Ekvägen 4');
    expect(seg.placeholder_customer).toBe('Bygg AB');
  });
});

describe('validateSegmentDates', () => {
  it('accepts a same-day or forward range', () => {
    expect(validateSegmentDates('2026-06-20', '2026-06-20')).toBeNull();
    expect(validateSegmentDates('2026-06-20', '2026-06-22')).toBeNull();
  });

  it('rejects a non-ISO date', () => {
    expect(validateSegmentDates('2026/06/20', '2026-06-22')).toBe('invalid_date');
    expect(validateSegmentDates('20-06-2026', '2026-06-22')).toBe('invalid_date');
  });

  it('rejects an end before the start', () => {
    expect(validateSegmentDates('2026-06-22', '2026-06-20')).toBe('end_before_start');
  });
});
