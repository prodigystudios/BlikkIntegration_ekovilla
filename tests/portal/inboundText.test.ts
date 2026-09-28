import { describe, it, expect } from 'vitest';
import { findUnstorableText } from '@/lib/domains/portal/inboundText';
import { CONTRACT_JOB } from './helpers/contractFixtures';

/**
 * Text i portalens kropp som Postgres inte kan spara (fas 3b): nolltecken och ensamma surrogat, i värden och nycklar,
 * på vilket djup som helst. Korrekta surrogatpar (emoji) och vanlig svensk text går igenom.
 */
describe('findUnstorableText', () => {
  it('kontraktets exempel går igenom, liksom å, ä, ö, tankstreck och en emoji (ett korrekt surrogatpar)', () => {
    expect(findUnstorableText(CONTRACT_JOB)).toBeNull();
    expect(findUnstorableText({ notes: 'Hunden är lös 🐕 – ring först' })).toBeNull();
    expect(findUnstorableText([1, true, null, { a: 2.5 }])).toBeNull();
  });

  it.each<[string, unknown, string]>([
    ['ett nolltecken i ett värde', { workplace: { notes: 'a\u0000b' } }, 'workplace.notes'],
    ['en ensam hög halva', { lines: [{ name: 'x' }, { name: 'a\ud800' }] }, 'lines.1.name'],
    ['en ensam låg halva', { quoteNumber: '\udc00' }, 'quoteNumber'],
    ['omvänt par', { a: '\udc00\ud800' }, 'a'],
    ['en nyckel', { store: { 'na\u0000me': 'x' } }, 'store.(nyckel)'],
    ['en ensam sträng', 'a\u0000', '(kroppen)'],
  ])('hittar %s', (_name, value, path) => {
    expect(findUnstorableText(value)).toBe(path);
  });
});
