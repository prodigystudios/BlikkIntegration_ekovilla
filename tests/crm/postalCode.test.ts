import { describe, it, expect } from 'vitest';
import { splitPostalCodeAndCity, postalCodeWarning } from '@/lib/domains/crm/postalCode';

// Postnummerfältet som bär orten. Uppmätt i drift 2026-09-17: en kund kunde inte skapas i Fortnox
// (som avvisar bokstäver i ZipCode), orderpushen föll på "Ingen Fortnox-kundkoppling", och den
// verkliga orsaken satt i ett fält ingen hade anledning att misstänka.

describe('splitPostalCodeAndCity', () => {
  it('delar "79192 Falun"', () => {
    expect(splitPostalCodeAndCity('79192 Falun')).toEqual({ postalCode: '79192', city: 'Falun' });
  });

  // 🧨 SVENSKA POSTNUMMER SKRIVS OFTA "791 92". En regel som gick på mellanslag hade flaggat varje
  // korrekt inskrivet nummer i landet — därför är mellanslaget i mitten tillåtet.
  it('delar "791 92 Falun" — mellanslaget i numret hör dit', () => {
    expect(splitPostalCodeAndCity('791 92 Falun')).toEqual({ postalCode: '79192', city: 'Falun' });
  });

  it('rör inte ett korrekt postnummer', () => {
    expect(splitPostalCodeAndCity('79192')).toBeNull();
    expect(splitPostalCodeAndCity('791 92')).toBeNull();
    expect(splitPostalCodeAndCity('')).toBeNull();
    expect(splitPostalCodeAndCity(null)).toBeNull();
  });

  it('klarar ortnamn med flera ord och bindestreck', () => {
    expect(splitPostalCodeAndCity('12345 Stockholm Södra')).toEqual({ postalCode: '12345', city: 'Stockholm Södra' });
    expect(splitPostalCodeAndCity('98139 Kiruna-Jukkasjärvi')?.city).toBe('Kiruna-Jukkasjärvi');
  });
});

describe('postalCodeWarning', () => {
  it('pekar ut orten och vad den ska bli', () => {
    const w = postalCodeWarning('79192 Falun', null);
    expect(w).toContain('79192');
    expect(w).toContain('Falun');
  });

  // Står orten redan rätt är det en dubblering, inte en tappad ort — då nämns inte ortnamnet igen.
  it('nämner inte ortnamnet när Ort redan är ifyllt', () => {
    expect(postalCodeWarning('79192 Falun', 'Falun')).not.toContain('(Falun)');
  });

  it('tiger för ett korrekt postnummer', () => {
    expect(postalCodeWarning('79192', 'Falun')).toBeNull();
    expect(postalCodeWarning('791 92', 'Falun')).toBeNull();
    expect(postalCodeWarning('', null)).toBeNull();
  });

  // Bokstäver som INTE är en ort efter ett postnummer får ett kortare besked — men tigs inte bort.
  it('varnar även när formen inte går att dela', () => {
    expect(postalCodeWarning('Falun', null)).toContain('bokstäver');
    expect(postalCodeWarning('SE-79192', null)).toContain('bokstäver');
  });
});
