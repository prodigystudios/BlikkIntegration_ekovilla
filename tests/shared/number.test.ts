import { describe, it, expect } from 'vitest';
import { parseDecimal } from '@/lib/shared/number';

describe('parseDecimal', () => {
  it('parses a Swedish comma decimal that plain parseFloat would truncate', () => {
    expect(parseDecimal('1,5')).toBe(1.5);
    expect(parseDecimal('0,25')).toBe(0.25);
    // Regression guard: parseFloat('1,5') === 1
    expect(parseDecimal('1,5')).not.toBe(parseFloat('1,5'));
  });

  it('parses plain dot decimals and integers', () => {
    expect(parseDecimal('1.5')).toBe(1.5);
    expect(parseDecimal('42')).toBe(42);
  });

  it('strips spaces used as thousands separators', () => {
    expect(parseDecimal('1 200,50')).toBe(1200.5);
    expect(parseDecimal(' 12 ')).toBe(12);
  });

  it('passes finite numbers through and returns the fallback otherwise', () => {
    expect(parseDecimal(3.14)).toBe(3.14);
    expect(parseDecimal(NaN)).toBe(0);
    expect(parseDecimal(NaN, 1)).toBe(1);
  });

  it('returns the fallback for empty/invalid input', () => {
    expect(parseDecimal('')).toBe(0);
    expect(parseDecimal('   ')).toBe(0);
    expect(parseDecimal(null)).toBe(0);
    expect(parseDecimal(undefined)).toBe(0);
    expect(parseDecimal('abc')).toBe(0);
    expect(parseDecimal('', 1)).toBe(1);
  });
});
