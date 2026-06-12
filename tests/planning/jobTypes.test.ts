import { describe, it, expect } from 'vitest';
import { resolveJobTypeFrom, validateJobType, slugifyJobType, DEFAULT_JOB_TYPES } from '@/lib/domains/planning/jobTypes';

describe('resolveJobTypeFrom', () => {
  it('resolves a known key (case-insensitive) to label + colour', () => {
    expect(resolveJobTypeFrom(DEFAULT_JOB_TYPES, 'ekovilla')).toMatchObject({ key: 'ekovilla', label: 'Ekovilla' });
    expect(resolveJobTypeFrom(DEFAULT_JOB_TYPES, 'UTSUGNING')).toMatchObject({ key: 'utsugning', label: 'Utsugning' });
  });
  it('returns null for empty/nullish', () => {
    expect(resolveJobTypeFrom(DEFAULT_JOB_TYPES, null)).toBeNull();
    expect(resolveJobTypeFrom(DEFAULT_JOB_TYPES, '  ')).toBeNull();
  });
  it('renders an unknown key in a neutral colour, labelled by the raw key', () => {
    const r = resolveJobTypeFrom(DEFAULT_JOB_TYPES, 'special');
    expect(r?.label).toBe('special');
    expect(r?.color).toBe('#64748b');
  });
  it('default set has unique keys', () => {
    expect(new Set(DEFAULT_JOB_TYPES.map((t) => t.key)).size).toBe(DEFAULT_JOB_TYPES.length);
  });
});

describe('validateJobType', () => {
  it('accepts a label + hex colour', () => {
    expect(validateJobType('Specialjobb', '#112233')).toBeNull();
  });
  it('requires a label', () => {
    expect(validateJobType('', '#112233')).toBe('label_required');
  });
  it('rejects a malformed colour', () => {
    expect(validateJobType('X', 'blue')).toBe('bad_color');
  });
});

describe('slugifyJobType', () => {
  it('lowercases + transliterates Swedish + dashes spaces', () => {
    expect(slugifyJobType('Övrigt jobb')).toBe('ovrigt-jobb');
    expect(slugifyJobType('Vitull')).toBe('vitull');
  });
  it('falls back to "typ" when nothing usable remains', () => {
    expect(slugifyJobType('!!!')).toBe('typ');
  });
});
