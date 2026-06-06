import { describe, it, expect } from 'vitest';
import { unitCreateSchema, unitUpdateSchema } from '@/app/api/fortnox/units/_lib';

describe('unitCreateSchema', () => {
  it('accepts a code with description', () => {
    const parsed = unitCreateSchema.safeParse({ code: 'm2', description: 'Kvadratmeter' });
    expect(parsed.success).toBe(true);
  });

  it('accepts a code without description', () => {
    const parsed = unitCreateSchema.safeParse({ code: 'st' });
    expect(parsed.success).toBe(true);
  });

  it('trims the code', () => {
    const parsed = unitCreateSchema.safeParse({ code: '  st  ' });
    expect(parsed.success && parsed.data.code).toBe('st');
  });

  it('rejects a missing/empty code', () => {
    expect(unitCreateSchema.safeParse({ description: 'Stycke' }).success).toBe(false);
    expect(unitCreateSchema.safeParse({ code: '   ' }).success).toBe(false);
  });
});

describe('unitUpdateSchema', () => {
  it('accepts a description', () => {
    expect(unitUpdateSchema.safeParse({ description: 'Timme' }).success).toBe(true);
  });

  it('accepts an empty body (description optional)', () => {
    expect(unitUpdateSchema.safeParse({}).success).toBe(true);
  });
});
