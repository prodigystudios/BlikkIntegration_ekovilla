import { describe, expect, it } from 'vitest';
import { normalizeDecimalInput } from '@/lib/shared/number';

// Måttfälten på arbetsorderns artikelrader är fritext. `parseDecimal` räddar matten, så skräp
// överlever tyst i databasen — en skarp order hade "162m" i m²-fältet, vilket läsläget skrev ut
// som "162m m² × 190 mm". Normaliseringen körs vid blur i editorn.
//
// Regressionsvakten här gäller två saker som är lätta att råka bryta:
//   1. Svenskt decimalkomma ska överleva. Skrivs värdet tillbaka med punkt driver formatet isär
//      från allt annat i databasen.
//   2. Funktionen får ALDRIG göra otolkbar text till en nolla. `parseDecimal` har fallback 0, och
//      en naiv normalisering hade tyst nollat ett mått någon skrivit fel — värre än att visa felet.

describe('normalizeDecimalInput', () => {
  it('rensar bort skräptecken men behåller talet', () => {
    // Det verkliga fallet från order #56.
    expect(normalizeDecimalInput('162m')).toBe('162');
  });

  it('trimmar blanksteg runt talet', () => {
    expect(normalizeDecimalInput('  52  ')).toBe('52');
    expect(normalizeDecimalInput('162 m')).toBe('162');
  });

  it('skriver tillbaka med svenskt decimalkomma', () => {
    expect(normalizeDecimalInput('67.5')).toBe('67,5');
    expect(normalizeDecimalInput('67,5')).toBe('67,5');
  });

  it('lämnar redan rena värden orörda — annars markeras formuläret som ändrat i onödan', () => {
    for (const clean of ['162', '190', '52', '67,5', '0']) {
      expect(normalizeDecimalInput(clean)).toBe(clean);
    }
  });

  it('gör tomt fält till tomt, inte till noll', () => {
    // Tomt betyder "inte ifyllt". En nolla är ett påstående om måttet.
    expect(normalizeDecimalInput('')).toBe('');
    expect(normalizeDecimalInput('   ')).toBe('');
  });

  it('lämnar text utan siffror orörd i stället för att nolla den', () => {
    // ⚠️ parseDecimal har fallback 0. Utan vakten hade det här blivit "0" — ett mått som
    // ser giltigt ut och som ingen längre kan se var fel.
    expect(normalizeDecimalInput('ca')).toBe('ca');
    expect(normalizeDecimalInput('vet ej')).toBe('vet ej');
  });

  // ⚠️ Regressionsvakt mot en FÖR SVAG vakt. En första version nöjde sig med "innehåller en
  // siffra" och lät parseDecimal göra resten — men parseFloat läser prefixet av vad som helst,
  // så de här blev tyst omskrivna till fel tal. Matten var redan fel i de fallen; strängen var
  // det enda som fortfarande visade att raden behövde rättas.
  it('rör inte tvetydig input — hellre synligt skräp än fel tal', () => {
    expect(normalizeDecimalInput('6x8')).toBe('6x8');
    expect(normalizeDecimalInput('3/4')).toBe('3/4');
    expect(normalizeDecimalInput('24 32')).toBe('24 32');
    // Tusental eller decimal? Gissa inte.
    expect(normalizeDecimalInput('1,200')).toBe('1,200');
    expect(normalizeDecimalInput('1 200')).toBe('1 200');
  });

  it('behåller negativa och decimaltal', () => {
    expect(normalizeDecimalInput('-5')).toBe('-5');
    expect(normalizeDecimalInput('0,25')).toBe('0,25');
  });
});
