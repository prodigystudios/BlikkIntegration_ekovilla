import { describe, it, expect } from 'vitest';
import { validateTruck } from '@/lib/domains/planning/trucks';

describe('validateTruck', () => {
  it('accepts a named truck with a valid hex colour', () => {
    expect(validateTruck('Bil 4', '#3f6f52')).toBeNull();
  });
  it('accepts a named truck with no colour', () => {
    expect(validateTruck('Bil 4', null)).toBeNull();
  });
  it('requires a name', () => {
    expect(validateTruck('', '#3f6f52')).toBe('name_required');
    expect(validateTruck('   ', null)).toBe('name_required');
  });
  it('rejects an over-long name', () => {
    expect(validateTruck('x'.repeat(61), null)).toBe('name_too_long');
  });
  it('rejects a malformed colour', () => {
    expect(validateTruck('Bil 4', 'red')).toBe('bad_color');
    expect(validateTruck('Bil 4', '#fff')).toBe('bad_color');
  });
});
