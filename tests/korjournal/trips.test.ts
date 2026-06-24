import { describe, it, expect } from 'vitest';
import {
  buildCreateTripRow,
  buildUpdateTripRow,
  monthDateRange,
  listKorjournalTrips,
  normalizeOptionalKilometer,
  normalizeOptionalText,
} from '@/lib/domains/korjournal/trips';

describe('normalize helpers', () => {
  it('normalizeOptionalText: undefined/null/blank/text', () => {
    expect(normalizeOptionalText(undefined)).toBeUndefined();
    expect(normalizeOptionalText(null)).toBeNull();
    expect(normalizeOptionalText('   ')).toBeNull();
    expect(normalizeOptionalText('  hej ')).toBe('hej');
  });

  it('normalizeOptionalKilometer: empty -> null, number, NaN for skräp', () => {
    expect(normalizeOptionalKilometer('')).toBeNull();
    expect(normalizeOptionalKilometer(null)).toBeNull();
    expect(normalizeOptionalKilometer('120')).toBe(120);
    expect(Number.isNaN(normalizeOptionalKilometer('abc'))).toBe(true);
  });
});

describe('buildCreateTripRow', () => {
  it('mappar till snake_case och defaultar datum', () => {
    const res = buildCreateTripRow(
      { startAddress: 'Hem', endAddress: 'Jobb', startKm: '100', endKm: '142', note: ' möte ', salesPerson: 'Anna' },
      { userId: 'u1', defaultDate: '2026-04-01' },
    );
    expect('row' in res && res.row).toMatchObject({
      date: '2026-04-01',
      start_address: 'Hem',
      end_address: 'Jobb',
      start_km: 100,
      end_km: 142,
      note: 'möte',
      user_id: 'u1',
      sales_person: 'Anna',
    });
  });

  it('null-adresser blir tom sträng', () => {
    const res = buildCreateTripRow({ startAddress: null, endAddress: null }, { userId: 'u1', defaultDate: '2026-04-01' });
    expect('row' in res && res.row.start_address).toBe('');
    expect('row' in res && res.row.end_address).toBe('');
  });

  it('ogiltig km ger fel', () => {
    const res = buildCreateTripRow({ startKm: 'abc' }, { userId: 'u1', defaultDate: '2026-04-01' });
    expect(res).toEqual({ error: 'invalid_km' });
  });
});

describe('buildUpdateTripRow', () => {
  it('tar bara med angivna fält', () => {
    const res = buildUpdateTripRow({ note: 'ny', endKm: '200' });
    expect('row' in res && res.row).toEqual({ note: 'ny', end_km: 200 });
  });

  it('ogiltig km ger fel', () => {
    expect(buildUpdateTripRow({ startKm: 'x' })).toEqual({ error: 'invalid_km' });
  });
});

describe('monthDateRange', () => {
  it('vanlig månad', () => {
    expect(monthDateRange('2026-04')).toEqual({ start: '2026-04-01', end: '2026-05-01' });
  });
  it('december rullar över till nästa år', () => {
    expect(monthDateRange('2026-12')).toEqual({ start: '2026-12-01', end: '2027-01-01' });
  });
});

describe('listKorjournalTrips', () => {
  function makeQuery() {
    const calls: Record<string, unknown> = {};
    const q: any = {
      select: () => q,
      eq: (col: string, val: unknown) => { calls[`eq:${col}`] = val; return q; },
      order: () => q,
      gte: (col: string, val: unknown) => { calls.gte = [col, val]; return q; },
      lt: (col: string, val: unknown) => { calls.lt = [col, val]; return q; },
      _calls: calls,
    };
    return q;
  }

  it('scopar på user_id och applicerar månadsintervall', () => {
    const q = makeQuery();
    const supabase: any = { from: () => q };
    const res: any = listKorjournalTrips(supabase, { userId: 'u1', ym: '2026-12' });
    expect(res._calls['eq:user_id']).toBe('u1');
    expect(res._calls.gte).toEqual(['date', '2026-12-01']);
    expect(res._calls.lt).toEqual(['date', '2027-01-01']);
  });

  it('utan ym sätts inget intervall', () => {
    const q = makeQuery();
    const supabase: any = { from: () => q };
    const res: any = listKorjournalTrips(supabase, { userId: 'u1' });
    expect(res._calls.gte).toBeUndefined();
    expect(res._calls.lt).toBeUndefined();
  });
});
