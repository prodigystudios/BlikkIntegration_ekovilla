import { describe, it, expect } from 'vitest';
import {
  calculateOpenRowDensity,
  calculateClosedRowDensity,
  formatDensity,
  installedThickness,
  parseEtappRows,
  sumOpenBags,
  sumClosedBags,
} from '@/lib/domains/egenkontroll/calculations';

describe('calculateOpenRowDensity', () => {
  it('kg/m³ = bags*bagWeight / (area*tjocklek_m)', () => {
    // 100 m² × 0.5 m = 50 m³; 100 säck × 15 kg = 1500 kg → 30 kg/m³
    expect(calculateOpenRowDensity({ ytaM2: '100', bestalldTjocklek: '500', antalSack: '100' }, 15)).toBe(30);
  });
  it('0 vid saknad/ogiltig indata eller bagWeight', () => {
    expect(calculateOpenRowDensity({ ytaM2: '', bestalldTjocklek: '500', antalSack: '10' }, 15)).toBe(0);
    expect(calculateOpenRowDensity({ ytaM2: '100', bestalldTjocklek: '500', antalSack: '10' }, 0)).toBe(0);
  });
});

describe('calculateClosedRowDensity', () => {
  it('föredrar uppmät tjocklek, faller tillbaka på beställd', () => {
    // uppmät 200mm används: 10 m² × 0.2 = 2 m³; 2 × 20 = 40 → 20
    expect(calculateClosedRowDensity({ ytaM2: '10', uppmatTjocklek: '200', bestalldTjocklek: '999', antalSackKgPerSack: '2' }, 20)).toBe(20);
    // ingen uppmät → använder beställd 200
    expect(calculateClosedRowDensity({ ytaM2: '10', uppmatTjocklek: '', bestalldTjocklek: '200', antalSackKgPerSack: '2' }, 20)).toBe(20);
  });
});

describe('formatDensity', () => {
  it('rundar till 2 decimaler, tom för icke-positivt', () => {
    expect(formatDensity(30.126)).toBe('30.13');
    expect(formatDensity(0)).toBe('');
    expect(formatDensity(NaN)).toBe('');
  });
});

describe('installedThickness', () => {
  it('beställd + sättningspåslag, avrundat', () => {
    expect(installedThickness('500', '30')).toBe('650');
  });
  it('tom vid ogiltig indata', () => {
    expect(installedThickness('', '30')).toBe('');
    expect(installedThickness('abc', '10')).toBe('');
  });
});

describe('parseEtappRows', () => {
  it('Vind → öppen rad; övriga → sluten; kommatecken normaliseras', () => {
    const { open, closed } = parseEtappRows('Vind - 120 m² x 500 mm - 30 eko\nSnedtak - 50,5 m² x 300 mm - 10 eko', '0.04');
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ etapp: 'Vind', ytaM2: '120', bestalldTjocklek: '500', antalSack: '30', lambdavarde: '0.04' });
    expect(closed).toHaveLength(1);
    expect(closed[0]).toMatchObject({ etapp: 'Snedtak', ytaM2: '50.5', bestalldTjocklek: '300', antalSackKgPerSack: '10' });
  });
});

describe('sumOpenBags/sumClosedBags', () => {
  it('summerar säckar och ignorerar ogiltiga', () => {
    expect(sumOpenBags([{ antalSack: '3' }, { antalSack: '' }, { antalSack: '2' }])).toBe(5);
    expect(sumClosedBags([{ antalSackKgPerSack: '4' }, { antalSackKgPerSack: 'x' }])).toBe(4);
  });
});
