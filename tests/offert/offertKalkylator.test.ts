import { describe, it, expect } from 'vitest';
import {
  computeOffertKalkylator,
  getTierByAreaKvm,
  OFFERT_KALKYLATOR_DEFAULT_STATE,
  type OffertKalkylatorState,
} from '@/lib/offertKalkylator';

function state(p: Partial<OffertKalkylatorState>): OffertKalkylatorState {
  return { ...OFFERT_KALKYLATOR_DEFAULT_STATE, isoleringKvm: 0, isoleringHojd: '', utsugningHojd: '', etableringKr: 0, marginalKr: 0, ...p };
}

describe('getTierByAreaKvm', () => {
  it('väljer rätt prisklass på gränserna', () => {
    expect(getTierByAreaKvm(15)).toBe('15-65');
    expect(getTierByAreaKvm(65)).toBe('15-65');
    expect(getTierByAreaKvm(66)).toBe('66-100');
    expect(getTierByAreaKvm(101)).toBe('101-150');
    expect(getTierByAreaKvm(151)).toBe('151+');
  });
});

describe('computeOffertKalkylator', () => {
  it('isoleringsrad: kvm × prisklass-pris', () => {
    const t = computeOffertKalkylator(state({ isoleringKvm: 50, isoleringHojd: '25-35' }));
    const iso = t.lines.find((l) => l.key === 'isolering')!;
    expect(iso.unitPrice).toBe(270); // 15-65 @ 25-35
    expect(iso.lineTotal).toBe(13500);
    expect(t.subtotal).toBe(13500);
  });

  it('ROT = (delsumma + marginal) × 0.6 × 0.3; etablering ej avdragsgill', () => {
    const t = computeOffertKalkylator(state({ isoleringKvm: 50, isoleringHojd: '25-35', etableringKr: 4500, marginalKr: 10000 }));
    expect(t.totalBeforeRot).toBe(28000); // 13500 + 4500 + 10000
    expect(t.rotAmount).toBeCloseTo(4230, 6); // 23500 * 0.18
    expect(t.totalAfterRot).toBeCloseTo(23770, 6); // (23500 - 4230) + 4500
  });

  it('tom state: inga rader, totalBeforeRot = etablering + marginal', () => {
    const t = computeOffertKalkylator(state({ etableringKr: 4500, marginalKr: 10000 }));
    expect(t.lines).toHaveLength(0);
    expect(t.subtotal).toBe(0);
    expect(t.totalBeforeRot).toBe(14500);
    expect(t.rotAmount).toBeCloseTo(1800, 6); // 10000 * 0.18
  });

  it('rader läggs bara till för positiva kvantiteter; styckpris-rader summeras', () => {
    const t = computeOffertKalkylator(state({ sargSt: 2, isoleringKvm: 0, isoleringHojd: '' }));
    const sarg = t.lines.find((l) => l.key === 'sarg')!;
    expect(sarg.lineTotal).toBe(5000); // 2 × 2500
    expect(t.lines.every((l) => l.qty > 0)).toBe(true);
  });

  it('klampar negativa kvantiteter till noll', () => {
    const t = computeOffertKalkylator(state({ isoleringKvm: -10, isoleringHojd: '25-35' }));
    expect(t.lines.find((l) => l.key === 'isolering')).toBeUndefined();
    expect(t.subtotal).toBe(0);
  });
});
