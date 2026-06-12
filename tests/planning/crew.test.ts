import { describe, it, expect } from 'vitest';
import { crewInitials, crewColor, validateCrewAssignment } from '@/lib/domains/planning/crew';

describe('crewInitials', () => {
  it('takes the first + last name initials', () => {
    expect(crewInitials('Anna Svensson')).toBe('AS');
    expect(crewInitials('Erik Johan Berg')).toBe('EB');
  });
  it('uses the first two letters of a single name', () => {
    expect(crewInitials('Kenta')).toBe('KE');
  });
  it('uppercases and trims surrounding whitespace', () => {
    expect(crewInitials('  lars  ohlin ')).toBe('LO');
  });
  it('falls back to ? for an empty name', () => {
    expect(crewInitials('')).toBe('?');
    expect(crewInitials('   ')).toBe('?');
  });
});

describe('crewColor', () => {
  it('is deterministic for the same seed', () => {
    expect(crewColor('abc')).toBe(crewColor('abc'));
  });
  it('always returns a hex from the palette', () => {
    for (const seed of ['anna', 'erik', 'lars-123', '']) {
      expect(crewColor(seed)).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

describe('validateCrewAssignment', () => {
  it('accepts a non-empty name', () => {
    expect(validateCrewAssignment('Anna Svensson')).toBeNull();
  });
  it('rejects an empty/whitespace name', () => {
    expect(validateCrewAssignment('')).toBe('invalid_name');
    expect(validateCrewAssignment('   ')).toBe('invalid_name');
  });
});
