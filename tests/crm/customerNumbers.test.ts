import { describe, it, expect } from 'vitest';
import {
  formatSwedishIdNumber,
  isValidSwedishOrgNumber,
  vatFromOrgNumber,
} from '@/app/crm/kunder/customerNumbers';

// 5560000001 is a checksum-valid Swedish org number (Luhn-10); 5560000000 is not.
const VALID_ORG = '556000-0001';
const INVALID_ORG = '556000-0000';

describe('formatSwedishIdNumber', () => {
  it('inserts the hyphen once the 7th digit is typed', () => {
    expect(formatSwedishIdNumber('556000')).toBe('556000');
    expect(formatSwedishIdNumber('5560000')).toBe('556000-0');
    expect(formatSwedishIdNumber('5560000001')).toBe('556000-0001');
  });

  it('strips non-digits and caps at 10 digits (Fortnox 10-digit standard)', () => {
    expect(formatSwedishIdNumber('556000-0001')).toBe('556000-0001');
    expect(formatSwedishIdNumber('5560000001999')).toBe('556000-0001');
    expect(formatSwedishIdNumber('  55 60 00 00 01 ')).toBe('556000-0001');
  });

  it('returns an empty string for empty input', () => {
    expect(formatSwedishIdNumber('')).toBe('');
  });
});

describe('isValidSwedishOrgNumber', () => {
  it('accepts a checksum-valid org number with or without hyphen', () => {
    expect(isValidSwedishOrgNumber(VALID_ORG)).toBe(true);
    expect(isValidSwedishOrgNumber('5560000001')).toBe(true);
  });

  it('rejects a number with a wrong check digit', () => {
    expect(isValidSwedishOrgNumber(INVALID_ORG)).toBe(false);
  });

  it('rejects incomplete numbers', () => {
    expect(isValidSwedishOrgNumber('556000')).toBe(false);
    expect(isValidSwedishOrgNumber('')).toBe(false);
  });
});

describe('vatFromOrgNumber', () => {
  it('builds SE + 10 digits + 01 from a valid org number', () => {
    expect(vatFromOrgNumber(VALID_ORG)).toBe('SE556000000101');
    expect(vatFromOrgNumber('5560000001')).toBe('SE556000000101');
  });

  it('returns null for an invalid org number so Fortnox never gets a bad VAT', () => {
    expect(vatFromOrgNumber(INVALID_ORG)).toBeNull();
  });

  it('returns null until the org number is complete', () => {
    expect(vatFromOrgNumber('556000')).toBeNull();
    expect(vatFromOrgNumber('')).toBeNull();
  });
});
