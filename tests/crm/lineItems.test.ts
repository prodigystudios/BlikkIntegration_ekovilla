import { describe, it, expect } from 'vitest';
import { lineItemQuantity } from '@/lib/domains/crm/lineItems';

describe('lineItemQuantity', () => {
  it('computes m³ volume from m² × thickness/1000', () => {
    expect(lineItemQuantity({ pricing_mode: 'm3', m2: '100', thickness_mm: '200' })).toBe(20);
    // 24,4 m² × 200 mm → 4.88 m³ (Swedish comma handled)
    expect(lineItemQuantity({ pricing_mode: 'm3', m2: '24,4', thickness_mm: '200' })).toBeCloseTo(4.88, 5);
  });

  it('treats a missing pricing_mode as m³ (matches the form default)', () => {
    expect(lineItemQuantity({ m2: '50', thickness_mm: '100' })).toBe(5);
  });

  it('uses the entered quantity for item pricing', () => {
    expect(lineItemQuantity({ pricing_mode: 'item', quantity: '12' })).toBe(12);
    expect(lineItemQuantity({ pricing_mode: 'item', quantity: '1,5' })).toBe(1.5);
  });

  it('returns 0 for empty m³ or item inputs', () => {
    expect(lineItemQuantity({ pricing_mode: 'm3', m2: '', thickness_mm: '' })).toBe(0);
    expect(lineItemQuantity({ pricing_mode: 'item', quantity: '' })).toBe(0);
  });
});
