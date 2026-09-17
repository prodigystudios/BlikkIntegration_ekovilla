import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Fältfeeden (get_my_crm_jobs) ska visa ett jobb för den som kör DEN DAGEN — inte för alla som
 * någon gång kört ordern.
 *
 * Buggen som vakten finns för (belagd 2026-09-17 mot riktig data): feeden släppte igenom ett riktigt
 * jobbs segment på is_user_on_work_order, "är du på NÅGOT segment av ordern". Förra veckans lag fick
 * då nästa veckas dagar — på andra bilar, med andra besättningar — i /mina-jobb, startsidans schema
 * och jobbväljaren i /tid (som väljer ett ensamt jobb automatiskt). 14 segment, 8 personer.
 *
 * Regeln bor i SQL som typsystemet och övriga tester inte når, så testet läser den SENASTE filen som
 * definierar respektive funktion. En framtida revision av feeden granskas alltså också — det är där
 * felet återkommer: den som skriver om funktionen och "förenklar" till samma helper som RLS.
 */

const SQL_DIR = resolve(process.cwd(), 'supabase/sql');

// Kommentarer bort före varje kontroll: filerna FÖRKLARAR varför is_user_on_work_order inte får stå
// i feeden, och en textmatchning på kommentaren hade gjort vakten omöjlig att uppfylla.
function stripSqlComments(sql: string): string {
  return sql.replace(/--.*$/gm, '');
}

function squash(sql: string): string {
  return sql.replace(/\s+/g, ' ');
}

/** Kroppen (mellan `as $$` och `$$;`) i den senaste filen som skapar funktionen. */
function latestFunctionBody(name: string): { file: string; body: string } {
  const header = new RegExp(`create\\s+(?:or\\s+replace\\s+)?function\\s+public\\.${name}\\s*\\(`, 'i');
  // Filnamnen börjar med YYYYMMDD, så lexikal ordning är kronologisk. Underkataloger (manual/) är
  // engångsskript och räknas inte.
  const files = readdirSync(SQL_DIR).filter((f) => f.endsWith('.sql')).sort();
  for (const file of [...files].reverse()) {
    const sql = stripSqlComments(readFileSync(resolve(SQL_DIR, file), 'utf8'));
    const start = sql.search(header);
    if (start < 0) continue;
    const body = sql.slice(start).match(/\bas\s+\$\$([\s\S]*?)\$\$\s*;/i)?.[1];
    if (body) return { file, body: squash(body) };
  }
  return { file: '', body: '' };
}

describe('get_my_crm_jobs — besättning per segment och dag', () => {
  const feed = latestFunctionBody('get_my_crm_jobs');

  it('hittade feedens senaste definition', () => {
    expect(feed.body).toContain('from public.ops_segments s');
  });

  it('frågar ALDRIG is_user_on_work_order — åtkomst till ordern är inte att köra dagen', () => {
    expect(feed.body).not.toMatch(/is_user_on_work_order/);
  });

  it('avgör besättningen för raden: segmentet och just den dagen (gs.d), för båda sorterna', () => {
    expect(feed.body).toContain('is_user_on_segment_between(auth.uid(), s.id, gs.d::date, gs.d::date)');
    // Inte villkorat bakom en case-gren som bara gäller platshållare — det var så riktiga jobb
    // hamnade på den bredare helpern från början.
    expect(feed.body).not.toMatch(/\bcase\b/i);
  });
});

describe('is_user_on_segment — oförändrat svar, grenarna på ett ställe', () => {
  const seg = latestFunctionBody('is_user_on_segment');

  it('delegerar till primitiven med segmentets EGNA dagar — samma svar som förut, RLS orörd', () => {
    expect(seg.body).toContain('is_user_on_segment_between(p_uid, s.id, s.start_day, s.end_day)');
  });

  it('har ingen egen kopia av besättningsgrenarna — två definitioner glider isär tyst', () => {
    expect(seg.body).not.toMatch(/ops_truck_crew|ops_truck_default_crew|ops_segment_crew/);
  });
});
