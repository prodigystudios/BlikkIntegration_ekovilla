import { describe, it, expect } from 'vitest';
import { toSwedishE164 } from '@/lib/phone';

describe('toSwedishE164', () => {
  it('converts national 0-prefixed Swedish numbers', () => {
    expect(toSwedishE164('0701234567')).toBe('+46701234567');
    expect(toSwedishE164('070-123 45 67')).toBe('+46701234567');
    expect(toSwedishE164('08-123 456')).toBe('+468123456');
    expect(toSwedishE164('(070) 123 45 67')).toBe('+46701234567');
  });

  it('keeps already-international numbers', () => {
    expect(toSwedishE164('+46701234567')).toBe('+46701234567');
    expect(toSwedishE164('+46 70 123 45 67')).toBe('+46701234567');
    expect(toSwedishE164('0046701234567')).toBe('+46701234567');
    expect(toSwedishE164('46701234567')).toBe('+46701234567');
  });

  it('handles bare national digits missing the leading 0', () => {
    expect(toSwedishE164('701234567')).toBe('+46701234567');
  });

  it('rejects empty / nonsense', () => {
    expect(toSwedishE164(null)).toBeNull();
    expect(toSwedishE164('')).toBeNull();
    expect(toSwedishE164('   ')).toBeNull();
    expect(toSwedishE164('abc')).toBeNull();
    expect(toSwedishE164('+')).toBeNull();
    expect(toSwedishE164('123')).toBeNull(); // too short for E.164
  });
});
