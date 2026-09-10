import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Ingen .sql-fil får innehålla tecken utanför BMP (Basic Multilingual Plane, U+0000–U+FFFF).
 *
 * 🧨 DET HAR HÄNT, OCH DET KOSTADE EN HEL MIGRERING. Ett tecken utanför BMP lagras i JavaScript och
 * i vissa editor-/klientled som ett SURROGATPAR, och när paret bryts på fel ställe på vägen in i
 * Supabase SQL-editorn kan det kapa en `--`-kommentarsrad mitt itu. Raden efter kommentaren blir då
 * kod som ingen skrev, satsen felar, och hela filen rullas tillbaka — med ett felmeddelande som
 * pekar på en rad där ingenting ser konstigt ut.
 *
 * Fällan är extra lömsk för att de emoji husets kommentarsstil faktiskt använder ligger på var sin
 * sida om gränsen:
 *
 *   ⚠️  U+26A0 + U+FE0F  — BMP, ofarlig
 *   ✅  U+2705            — BMP, ofarlig
 *   🧨  U+1F9E8           — ASTRAL, förbjuden
 *   ⛔  U+26D4            — BMP, ofarlig
 *
 * Det går alltså inte att se på en emoji om den duger, och två av tre nya SQL-filer i det här
 * projektet har fastnat på just 🧨. Därför en mekanisk vakt i stället för ett åtagande att minnas.
 *
 * Testet ligger under tests/planning/ eftersom det var där felet uppstod, men det granskar HELA
 * supabase/-trädet — regeln gäller varje .sql-fil i repot.
 */

const SQL_ROOTS = ['supabase/sql', 'supabase/migrations'];

function sqlFilesUnder(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return []; // katalogen behöver inte finnas
  }
  return entries.flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return sqlFilesUnder(full);
    return full.endsWith('.sql') ? [full] : [];
  });
}

/** Kodpunkt för kodpunkt (for...of itererar kodpunkter, inte UTF-16-enheter). */
function astralChars(text: string): Array<{ line: number; char: string; code: string }> {
  const hits: Array<{ line: number; char: string; code: string }> = [];
  text.split('\n').forEach((line, i) => {
    for (const ch of line) {
      const cp = ch.codePointAt(0) ?? 0;
      if (cp > 0xffff) hits.push({ line: i + 1, char: ch, code: `U+${cp.toString(16).toUpperCase()}` });
    }
  });
  return hits;
}

describe('SQL-filer innehåller inga tecken utanför BMP', () => {
  const files = SQL_ROOTS.flatMap((root) => sqlFilesUnder(root));

  // 🧨 Utan den här raden är hela sviten tom om sökvägarna någon gång ändras — och ett tomt test
  // ser exakt ut som ett godkänt.
  it('hittar faktiskt SQL-filer att granska', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it.each(files)('%s', (file) => {
    const hits = astralChars(readFileSync(file, 'utf-8'));
    // Felmeddelandet ska räcka för att laga felet utan att öppna filen och leta.
    const detail = hits.map((h) => `rad ${h.line}: ${h.char} (${h.code})`).join(', ');
    expect(hits.length, `${file} har tecken utanför BMP — ${detail}. Byt mot en BMP-emoji, t.ex. ⚠️.`).toBe(0);
  });
});
