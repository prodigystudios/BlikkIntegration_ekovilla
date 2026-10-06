import { describe, it, expect } from 'vitest';
import { backlogWithOrderStatus, segmentsWithOrderStatus } from '@/lib/domains/planning/orderStatus';

describe('backlogWithOrderStatus', () => {
  const backlog = [
    { key: 'wo1:s1', id: 'wo1', status: 'draft' },
    { key: 'wo1:s2', id: 'wo1', status: 'draft' },
    { key: 'wo2', id: 'wo2', status: 'draft' },
  ];

  it('ger ordens ALLA poster den nya statusen, och rör inga andra ordrar', () => {
    const next = backlogWithOrderStatus(backlog, 'wo1', 'scheduled');
    expect(next.map((b) => b.status)).toEqual(['scheduled', 'scheduled', 'draft']);
  });

  it('samma array när statusen saknas (servern kunde inte läsa den) eller redan stämmer', () => {
    expect(backlogWithOrderStatus(backlog, 'wo1', null)).toBe(backlog);
    expect(backlogWithOrderStatus(backlog, 'wo1', undefined)).toBe(backlog);
    expect(backlogWithOrderStatus(backlog, 'wo2', 'draft')).toBe(backlog);
  });
});

describe('segmentsWithOrderStatus', () => {
  const segments = [
    { id: 'a', work_order_id: 'wo1', job: { status: 'draft' } },
    { id: 'b', work_order_id: 'wo1', job: { status: 'draft' } },
    { id: 'c', work_order_id: 'wo2', job: { status: 'draft' } },
    { id: 'p', work_order_id: null, job: null }, // platshållare
  ];

  it('ger ordens alla kort den nya statusen; platshållare och andra ordrar orörda', () => {
    const next = segmentsWithOrderStatus(segments, 'wo1', 'scheduled');
    expect(next.map((s) => s.job?.status ?? null)).toEqual(['scheduled', 'scheduled', 'draft', null]);
  });

  it('samma array när statusen saknas eller redan stämmer', () => {
    expect(segmentsWithOrderStatus(segments, 'wo1', null)).toBe(segments);
    expect(segmentsWithOrderStatus(segments, 'wo2', 'draft')).toBe(segments);
  });
});
