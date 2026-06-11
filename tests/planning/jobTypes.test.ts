import { describe, it, expect } from 'vitest';
import { resolveJobType, JOB_TYPES } from '@/lib/domains/planning/jobTypes';

describe('resolveJobType', () => {
  it('resolves a known key (case-insensitive) to label + colour', () => {
    expect(resolveJobType('ekovilla')).toMatchObject({ key: 'ekovilla', label: 'Ekovilla' });
    expect(resolveJobType('UTSUGNING')).toMatchObject({ key: 'utsugning', label: 'Utsugning' });
  });
  it('returns null for empty/nullish', () => {
    expect(resolveJobType(null)).toBeNull();
    expect(resolveJobType('  ')).toBeNull();
  });
  it('renders an unknown key in a neutral colour', () => {
    const r = resolveJobType('special');
    expect(r?.label).toBe('special');
    expect(r?.color).toBe('#64748b');
  });
  it('has unique keys', () => {
    expect(new Set(JOB_TYPES.map((t) => t.key)).size).toBe(JOB_TYPES.length);
  });
});
