import { describe, it, expect } from 'vitest';
import {
  formatPersonalNumber,
  isValidPersonalNumber,
  normalizePersonalNumber,
  parsePersonalNumberBirthDate,
  personalNumberDigits,
} from '@/lib/domains/crm/personalNumber';

// Referensnummer med giltig Luhn-kontrollsiffra över de tio sista siffrorna.
// 850101-1236 → checksumman går jämnt ut.
const VALID_10 = '8501011236';
const VALID_12 = `19${VALID_10}`;
const NOW = new Date('2026-08-12T12:00:00.000Z');

describe('formatPersonalNumber', () => {
  it('maskar till ÅÅÅÅMMDD-XXXX', () => {
    expect(formatPersonalNumber('198501011236')).toBe('19850101-1236');
  });

  it('lägger bindestrecket efter ÅTTA siffror, inte sex', () => {
    // Det var precis felet: org.nr-maskningen satte det efter sex och kapade vid tio, vilket
    // klippte bort århundradet ur ett personnummer.
    expect(formatPersonalNumber('19850101')).toBe('19850101');
    expect(formatPersonalNumber('198501011')).toBe('19850101-1');
  });

  it('kapar vid tolv siffror och struntar i skiljetecken', () => {
    expect(formatPersonalNumber('19850101-1236999')).toBe('19850101-1236');
    expect(formatPersonalNumber('19850101 1236')).toBe('19850101-1236');
    expect(formatPersonalNumber('19850101+1236')).toBe('19850101-1236');
  });

  it('hanterar tomt och skräp utan att krascha', () => {
    expect(formatPersonalNumber('')).toBe('');
    expect(formatPersonalNumber('abc')).toBe('');
    expect(personalNumberDigits('19850101-1236')).toBe('198501011236');
  });
});

describe('isValidPersonalNumber', () => {
  it('godkänner ett fullständigt nummer', () => {
    expect(isValidPersonalNumber(VALID_12, NOW)).toBe(true);
    expect(isValidPersonalNumber('19850101-1236', NOW)).toBe(true);
  });

  // Kärnan i hela ändringen: tio siffror sparades förut utan protest och gav trasiga
  // ROT-uppgifter i Fortnox.
  it('NEKAR tio siffror, även med giltig kontrollsiffra', () => {
    expect(isValidPersonalNumber(VALID_10, NOW)).toBe(false);
    expect(isValidPersonalNumber('850101-1236', NOW)).toBe(false);
  });

  it('nekar fel kontrollsiffra', () => {
    expect(isValidPersonalNumber('19850101-1237', NOW)).toBe(false);
  });

  // Luhn räknas bara på de tio sista siffrorna, så ett felaktigt århundrade passerar
  // kontrollsiffran. Datumkontrollen är det enda som fångar det.
  it('nekar ett århundrade som ger ett födelsedatum i framtiden', () => {
    expect(isValidPersonalNumber(`20${VALID_10}`, NOW)).toBe(false);
  });

  it('nekar en orimligt gammal person', () => {
    expect(isValidPersonalNumber(`18${VALID_10}`, NOW)).toBe(false);
  });

  it('nekar omöjliga datum', () => {
    expect(isValidPersonalNumber('19851301-1236', NOW)).toBe(false); // månad 13
    expect(isValidPersonalNumber('19850230-1236', NOW)).toBe(false); // 30 februari
  });

  it('nekar tomt och skräp', () => {
    expect(isValidPersonalNumber('', NOW)).toBe(false);
    expect(isValidPersonalNumber('inte ett nummer', NOW)).toBe(false);
  });
});

// Samordningsnummer (dag + 60) tilldelas den som saknar personnummer men ska folkbokföras —
// de kan äga fastighet och vara kund. De får inte nekas.
describe('samordningsnummer', () => {
  it('tolkar dag + 60 som ett verkligt datum', () => {
    const birth = parsePersonalNumberBirthDate('198501611236');
    expect(birth).not.toBeNull();
    expect(birth!.getDate()).toBe(1);
    expect(birth!.getMonth()).toBe(0);
  });

  it('nekar en dag som är omöjlig även efter avdraget', () => {
    expect(parsePersonalNumberBirthDate('198501991236')).toBeNull(); // 99 − 60 = 39
  });
});

describe('normalizePersonalNumber', () => {
  it('ger den kanoniska formen', () => {
    expect(normalizePersonalNumber('198501011236', NOW)).toBe('19850101-1236');
    expect(normalizePersonalNumber(' 19850101 1236 ', NOW)).toBe('19850101-1236');
  });

  // Att härleda århundradet ur tio siffror vore en gissning — och en gissning på fel sida av
  // sekelskiftet ger exakt samma trasiga ROT-uppgifter som felet vi rättar.
  it('GISSAR INTE århundradet, utan returnerar null', () => {
    expect(normalizePersonalNumber(VALID_10, NOW)).toBeNull();
  });
});
