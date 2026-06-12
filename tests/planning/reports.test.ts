import { describe, it, expect } from 'vitest';
import { validateReport, sacksRemaining, sacksOverrun } from '@/lib/domains/planning/reports';

describe('validateReport', () => {
  it('accepts a valid report', () => {
    expect(validateReport('2026-06-17', 12)).toBeNull();
    expect(validateReport('2026-06-17', 0)).toBeNull();
  });
  it('rejects a bad date', () => {
    expect(validateReport('2026/06/17', 12)).toBe('invalid_date');
  });
  it('rejects a negative or non-finite amount', () => {
    expect(validateReport('2026-06-17', -1)).toBe('invalid_amount');
    expect(validateReport('2026-06-17', Number.NaN)).toBe('invalid_amount');
  });
});

describe('sacksRemaining', () => {
  it('is planned minus blown', () => {
    expect(sacksRemaining(130, 46)).toBe(84);
  });
  it('floors at zero (never negative)', () => {
    expect(sacksRemaining(40, 55)).toBe(0);
  });
});

describe('sacksOverrun', () => {
  it('is zero while within plan', () => {
    expect(sacksOverrun(130, 46)).toBe(0);
    expect(sacksOverrun(40, 40)).toBe(0);
  });
  it('is blown minus planned once over plan', () => {
    expect(sacksOverrun(40, 55)).toBe(15);
  });
});
