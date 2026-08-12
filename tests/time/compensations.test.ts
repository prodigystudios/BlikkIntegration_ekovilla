import { describe, it, expect } from 'vitest';
import { summarizeCompensations, COMPENSATION_UNITS, type CompensationItem } from '@/lib/domains/time/compensations';

const item = (over: Partial<CompensationItem> = {}): CompensationItem => ({
  id: 'x', user_id: 'anna', entry_date: '2026-08-11', kind: 'expense',
  quantity: null, amount: 100, note: null, ...over,
});

describe('summarizeCompensations', () => {
  it('summerar belopp och antal per sort', () => {
    const totals = summarizeCompensations([
      item({ kind: 'travel', quantity: 12.5, amount: 312.5 }),
      item({ kind: 'travel', quantity: 4, amount: 100 }),
      item({ kind: 'expense', amount: 249 }),
    ]);
    expect(totals).toEqual([
      { kind: 'travel', quantity: 16.5, amount: 412.5, count: 2 },
      { kind: 'expense', quantity: 0, amount: 249, count: 1 },
    ]);
  });

  // Regression: PostgREST returnerar numeric som STRÄNG. Med + i stället för Number() hade
  // '120.50' + '80.25' blivit '120.5080.25' — ett belopp som ser ut som ett belopp.
  it('behandlar numeric-strängar från PostgREST som tal', () => {
    const totals = summarizeCompensations([
      item({ kind: 'per_diem', amount: '120.50' as any, quantity: '1' as any }),
      item({ kind: 'per_diem', amount: '80.25' as any, quantity: '1' as any }),
    ]);
    expect(totals[0].amount).toBe(200.75);
    expect(totals[0].quantity).toBe(2);
  });

  it('utelämnar sorter utan poster', () => {
    expect(summarizeCompensations([item({ kind: 'expense', amount: 50 })]).map((t) => t.kind)).toEqual(['expense']);
  });

  it('är tom när det inte finns några poster', () => {
    expect(summarizeCompensations([])).toEqual([]);
  });
});

describe('COMPENSATION_UNITS', () => {
  // Utlägg har ingen enhet — beloppet är hela sanningen. Mil och traktamente har det, så formuläret
  // kan fråga efter antal utöver kronorna.
  it('ger utlägg ingen enhet', () => {
    expect(COMPENSATION_UNITS.expense).toBeNull();
    expect(COMPENSATION_UNITS.travel).toBe('mil');
    expect(COMPENSATION_UNITS.per_diem).toBe('dagar');
  });
});
