import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Ingen källfil får innehålla en rå NUL-byte (U+0000).
 *
 * 🧨 DET HAR HÄNT, TVÅ GÅNGER PÅ ETT DYGN (2026-09-11). Avgränsaren i supplyKey och i stockCounts
 * ska vara escape-sekvensen `\u0000` i en template-literal — sex tecken. Två gånger landade den i stället
 * som EN rå byte i filen. TypeScript och Node bryr sig inte: strängen blir precis densamma, alla tester
 * går igenom, och koden fungerar.
 *
 * Det som går sönder är granskningen. En fil med en NUL-byte behandlar git som BINÄR, så diffen i en
 * PR visar bara "Binary files differ" — den nya koden går inte att läsa i den vy där den ska granskas.
 * Felet är alltså osynligt för varje verktyg utom människan som ska godkänna ändringen.
 *
 * Samma sorts vakt som sqlNoAstralChars: en mekanisk kontroll i stället för ett åtagande att minnas.
 */

// supabase/ med: .sql står i filändelserna nedan, och utan roten hade den raden varit ett tomt löfte.
const ROOTS = ['app', 'lib', 'components', 'tests', 'supabase'];
const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.sql', '.css', '.json'];
const SKIP = new Set(['node_modules', '.next', '.git']);

function filesUnder(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries.flatMap((name) => {
    if (SKIP.has(name)) return [];
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return filesUnder(full);
    return EXTENSIONS.some((ext) => full.endsWith(ext)) ? [full] : [];
  });
}

describe('källfiler innehåller inga råa NUL-byte', () => {
  const files = ROOTS.flatMap((root) => filesUnder(root));

  // 🧨 Utan golvet är sviten tom om sökvägarna ändras — och ett tomt test ser ut som ett godkänt.
  it('hittar faktiskt källfiler att granska', () => {
    for (const root of ROOTS) {
      expect(filesUnder(root).length, `${root} gav noll filer — har sökvägen ändrats?`).toBeGreaterThan(0);
    }
    expect(files.length).toBeGreaterThan(500);
  });

  it('ingen fil bär en rå NUL-byte', () => {
    // En enda assertion över alla filer i stället för it.each: tusentals testfall per körning vore brus,
    // och felmeddelandet nedan pekar ut exakt vilken fil och rad det gäller ändå.
    const offenders: string[] = [];
    for (const file of files) {
      const buf = readFileSync(file);
      const at = buf.indexOf(0);
      if (at === -1) continue;
      const line = buf.subarray(0, at).toString('utf-8').split('\n').length;
      offenders.push(`${file}:${line}`);
    }
    expect(
      offenders,
      `Rå NUL-byte i: ${offenders.join(', ')}. Skriv \\u0000 (escape-sekvensen) i stället för själva tecknet.`,
    ).toEqual([]);
  });
});
