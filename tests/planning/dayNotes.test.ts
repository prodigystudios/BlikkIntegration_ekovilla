import { describe, it, expect } from 'vitest';
import { groupNotesByDay, validateNoteBody, type DayNote } from '@/lib/domains/planning/dayNotes';

function note(id: string, note_day: string, body: string): DayNote {
  return { id, note_day, body, created_by: null };
}

describe('validateNoteBody', () => {
  it('accepts a non-empty body', () => {
    expect(validateNoteBody('Anna ledig')).toBeNull();
  });
  it('rejects empty / whitespace', () => {
    expect(validateNoteBody('')).toBe('empty');
    expect(validateNoteBody('   ')).toBe('empty');
  });
  it('rejects an over-long body', () => {
    expect(validateNoteBody('x'.repeat(501))).toBe('too_long');
  });
});

describe('groupNotesByDay', () => {
  it('returns an empty map for no notes', () => {
    expect(groupNotesByDay([]).size).toBe(0);
  });

  it('groups notes by day, preserving input order within a day', () => {
    const notes = [
      note('1', '2026-06-15', 'Bil 2 på service'),
      note('2', '2026-06-15', 'Anna ledig'),
      note('3', '2026-06-16', 'Helgjobb möjligt'),
    ];
    const map = groupNotesByDay(notes);
    expect(map.get('2026-06-15')?.map((n) => n.id)).toEqual(['1', '2']);
    expect(map.get('2026-06-16')?.map((n) => n.id)).toEqual(['3']);
    expect(map.get('2026-06-17')).toBeUndefined();
  });
});
