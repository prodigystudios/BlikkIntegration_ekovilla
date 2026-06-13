import { describe, it, expect } from 'vitest';
import { describeSegmentPatch } from '@/lib/domains/planning/activity';

describe('describeSegmentPatch', () => {
  it('prioritises pause/resume over everything else', () => {
    // on_hold wins even when a move is in the same patch (drag-to-pause edge).
    expect(describeSegmentPatch({ onHold: true, truckId: 't1' }, '#5418')).toEqual({
      action: 'segment.hold',
      summary: 'Pausade #5418',
    });
    expect(describeSegmentPatch({ onHold: false }, '#5418')).toEqual({
      action: 'segment.resume',
      summary: 'Återupptog #5418',
    });
  });

  it('treats any truck/day change as a move', () => {
    expect(describeSegmentPatch({ truckId: 't2' }, '#5418').action).toBe('segment.move');
    expect(describeSegmentPatch({ startDay: '2026-06-15' }, '#5418').action).toBe('segment.move');
    expect(describeSegmentPatch({ endDay: '2026-06-16' }, '#5418')).toEqual({
      action: 'segment.move',
      summary: 'Flyttade #5418',
    });
  });

  it('distinguishes job-type and reorder-only patches', () => {
    expect(describeSegmentPatch({ jobType: 'ekovilla' }, '#5418')).toEqual({
      action: 'segment.jobtype',
      summary: 'Ändrade jobbtyp för #5418',
    });
    expect(describeSegmentPatch({ sortIndex: 2 }, '#5418')).toEqual({
      action: 'segment.reorder',
      summary: 'Ändrade ordningen för #5418',
    });
  });

  it('a move takes precedence over a same-patch reorder/job-type', () => {
    expect(describeSegmentPatch({ truckId: 't2', sortIndex: 0, jobType: 'vitull' }, '#5418').action).toBe('segment.move');
  });

  it('falls back to a generic update for an empty patch', () => {
    expect(describeSegmentPatch({}, '#5418')).toEqual({ action: 'segment.update', summary: 'Uppdaterade #5418' });
  });

  it('uses the given reference verbatim (Fortnox or internal)', () => {
    expect(describeSegmentPatch({ truckId: 't2' }, 'AO-1001').summary).toBe('Flyttade AO-1001');
    expect(describeSegmentPatch({}, 'jobb').summary).toBe('Uppdaterade jobb');
  });
});
