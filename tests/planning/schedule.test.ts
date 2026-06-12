import { describe, it, expect } from 'vitest';
import { validateSegmentDates } from '@/lib/domains/planning/schedule';

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
