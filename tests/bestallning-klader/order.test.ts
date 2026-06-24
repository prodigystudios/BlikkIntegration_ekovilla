import { describe, it, expect } from 'vitest';
import { buildOrderSummary, type SectionState } from '@/app/bestallning-klader/order';

function section(title: string, pickedSize: string | null, qty = 1): SectionState {
  return {
    key: title.toLowerCase(),
    title,
    qty,
    rows: ['S', 'M', 'L'].map((s) => ({ size: s, selected: s === pickedSize })),
  };
}

describe('buildOrderSummary', () => {
  it('tar bara med plagg med vald storlek', () => {
    const summary = buildOrderSummary([section('T-shirt', 'M'), section('Byxor', null)]);
    expect(summary).toBe('Beställning:\n- T-shirt: M');
  });

  it('lägger till xN-suffix när qty > 1', () => {
    const summary = buildOrderSummary([section('Jacka', 'L', 3)]);
    expect(summary).toBe('Beställning:\n- Jacka: L x3');
  });

  it('returnerar tom sträng när inget är valt', () => {
    expect(buildOrderSummary([section('T-shirt', null), section('Byxor', null)])).toBe('');
  });
});
