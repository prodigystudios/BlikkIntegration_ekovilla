import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { resolveSegmentForDay } from '@/lib/domains/planning/sackLedger';

/**
 * Ett kort som tas bort tar inte med sig orderns säckrapporter (20261016105146_segment_delete_keeps_sack_reports.sql).
 *
 * ops_segment_reports.segment_id är on delete cascade. På #272 och #279 (2026-10-15) låg ordern på två kort samma dag,
 * rapporterna satt på dubbletten, och dubbletten städades bort: egenkontrollens säckar försvann ur huvudboken och depån.
 * Triggern ops_segments_keep_sack_reports flyttar rapporterna till orderns andra kort, eller nekar när det är orderns sista.
 *
 * Testet läser den SISTA definitionen i hela kedjan, så att en senare migrering som skriver om funktionen inte i
 * tysthet tappar en egenskap. Beteendet prövas mot en databas med supabase/checks/segment_delete_keeps_sack_reports.sql.
 */

const DIR = resolve(process.cwd(), 'supabase/migrations');
const FILES = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();

const normalize = (text: string) => text.replace(/--.*$/gm, '').replace(/\s+/g, ' ').toLowerCase();
const chain = FILES.map((file) => ({ file, sql: normalize(readFileSync(resolve(DIR, file), 'utf8')) }));
const all = chain.map((c) => c.sql).join('\n');

function lastDefinition(name: string): { file: string; header: string; body: string } | null {
  let found: { file: string; header: string; body: string } | null = null;
  const re = new RegExp(`create or replace function public\\.${name} ?\\(\\)(.*?)as (\\$[a-z_]*\\$)(.*?)\\2`, 'g');
  for (const { file, sql } of chain) {
    for (const m of sql.matchAll(re)) found = { file, header: m[1], body: m[3] };
  }
  return found;
}

describe('säckrapporterna överlever att ett kort tas bort (SQL)', () => {
  const fn = lastDefinition('ops_segments_keep_sack_reports');

  it('hittar funktionen i kedjan — annars är testet tomt', () => {
    expect(fn?.file).toBeDefined();
  });

  it('är security definer med tomt search_path, och ingen roll får EXECUTE', () => {
    // Som invoker hade flytten gått under RLS: en roll som får ta bort kort men inte uppdatera rapporter hade
    // uppdaterat 0 rader utan fel, och kaskaden hade raderat dem ändå.
    expect(fn?.header).toContain('security definer');
    expect(fn?.header).toContain("set search_path = ''");
    expect(all).toContain(
      'revoke all on function public.ops_segments_keep_sack_reports() from public, anon, authenticated, service_role;',
    );
  });

  it('går FÖRE borttagningen, per rad — efteråt har kaskaden redan tagit rapporterna', () => {
    expect(all).toContain(
      'create trigger ops_segments_keep_sack_reports before delete on public.ops_segments for each row execute function public.ops_segments_keep_sack_reports();',
    );
  });

  it('släpper igenom när ordern själv raderas, och prövar det före nejet', () => {
    const body = fn?.body ?? '';
    // `is not null` först: ett kort utan order har ingen order som "försvunnit" (w.id = null är aldrig sant), och
    // utan villkoret hade dess rapporter släppts till kaskaden i stället för att nekas.
    const orderGone = body.indexOf(
      'if old.work_order_id is not null and not exists (select 1 from public.crm_work_orders w where w.id = old.work_order_id) then return old;',
    );
    expect(orderGone).toBeGreaterThanOrEqual(0);
    expect(orderGone).toBeLessThan(body.indexOf('raise exception'));
  });

  it('nekar orderns sista kort med foreign_key_violation — rutten översätter just den koden till 409', () => {
    expect(fn?.body).toContain("errcode = 'foreign_key_violation'");
    const route = readFileSync(resolve(process.cwd(), 'app/api/crm/planering/segments/[id]/route.ts'), 'utf8');
    expect(route).toContain("code === '23503'");
  });

  it('räknar aldrig kortet som tas bort, varken som "annat kort" eller som mål', () => {
    const body = fn?.body ?? '';
    expect(body).toContain('select 1 from public.ops_segments s where s.work_order_id = old.work_order_id and s.id <> old.id');
    expect(body).toMatch(/set segment_id = \( select s\.id from public\.ops_segments s where s\.work_order_id = old\.work_order_id and s\.id <> old\.id order by/);
  });

  it('väljer mål i samma ordning som resolveSegmentForDay: avstånd, tidigast start, id', () => {
    expect(fn?.body).toContain(
      'order by greatest(s.start_day - r.report_day, r.report_day - s.end_day, 0), s.start_day, s.id limit 1',
    );
  });
});

describe('kontrollskriptets svar är resolveSegmentForDays svar', () => {
  // Samma kort och dagar som fallen 2, 3 och 3b i supabase/checks/segment_delete_keeps_sack_reports.sql: korten som
  // blir KVAR när ett tas bort, och kortet varje rapportdag ska hamna på.
  const id = (suffix: string) => `b5b00000-0000-4000-8000-0000000000${suffix}`;

  it('2. täckande kort först, annars närmaste', () => {
    const left = [
      { id: id('b1'), start_day: '2026-10-10', end_day: '2026-10-12' },
      { id: id('b2'), start_day: '2026-10-20', end_day: '2026-10-20' },
    ];
    expect(resolveSegmentForDay(left, '2026-10-11')?.segmentId).toBe(id('b1'));
    expect(resolveSegmentForDay(left, '2026-10-19')?.segmentId).toBe(id('b2'));
    expect(resolveSegmentForDay(left, '2026-10-15')?.segmentId).toBe(id('b1'));
  });

  it('3. två täckande kort med samma start: lägsta id', () => {
    const left = [
      { id: id('c2'), start_day: '2026-10-10', end_day: '2026-10-11' },
      { id: id('c1'), start_day: '2026-10-10', end_day: '2026-10-10' },
    ];
    expect(resolveSegmentForDay(left, '2026-10-10')?.segmentId).toBe(id('c1'));
  });

  it('3b. två täckande kort med olika start: tidigast start, fast det har högre id', () => {
    const left = [
      { id: id('c5'), start_day: '2026-10-10', end_day: '2026-10-10' },
      { id: id('c7'), start_day: '2026-10-09', end_day: '2026-10-11' },
    ];
    expect(resolveSegmentForDay(left, '2026-10-10')?.segmentId).toBe(id('c7'));
  });
});
