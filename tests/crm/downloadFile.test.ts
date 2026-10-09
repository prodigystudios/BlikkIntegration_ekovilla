import { describe, it, expect } from 'vitest';
import { filenameFromDisposition } from '@/app/crm/lib/downloadFile';

// Den delade nedladdningen tar filnamnet ur ruttens Content-Disposition när anroparen inte anger något
// (Excel-exporten); Fortnox-PDF:erna skickar sitt eget.
describe('filenameFromDisposition', () => {
  it('läser filnamnet ur en attachment-rubrik', () => {
    expect(filenameFromDisposition('attachment; filename="Forsaljningsrapport-2026-10-09.xlsx"')).toBe('Forsaljningsrapport-2026-10-09.xlsx');
  });
  it('null utan rubrik eller utan filnamn', () => {
    expect(filenameFromDisposition(null)).toBeNull();
    expect(filenameFromDisposition('inline')).toBeNull();
  });
});
