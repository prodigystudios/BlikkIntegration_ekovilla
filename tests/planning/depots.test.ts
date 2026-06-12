import { describe, it, expect } from 'vitest';
import { validateDepot } from '@/lib/domains/planning/depots';

describe('validateDepot', () => {
  it('accepts a named depot', () => {
    expect(validateDepot('Huvudlager')).toBeNull();
  });
  it('requires a name', () => {
    expect(validateDepot('')).toBe('name_required');
    expect(validateDepot('   ')).toBe('name_required');
  });
  it('rejects an over-long name', () => {
    expect(validateDepot('x'.repeat(81))).toBe('name_too_long');
  });
});
