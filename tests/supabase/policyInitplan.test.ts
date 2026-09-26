import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * RLS-policyer ska anropa auth.*() och has_permission() inslagna i en skalär delfråga — `(select auth.uid())`,
 * `(select has_permission('x'))` — så att anropet blir en InitPlan som körs EN gång per fråga. Skrivet rakt körs det
 * för varje rad; has_permission (SQL + SECURITY DEFINER, byggs aldrig in) gör dessutom tre egna uppslag per anrop.
 * Mätt 2026-09-26 på crm_customers i prods storlek: 20 ms -> 0,3 ms.
 *
 * Äldre policyer skrivs om domän för domän (20260926142144_crm_policy_initplan.sql är CRM, med
 * scripts/supabase/policy-initplan-rewrite.sql). Testet vaktar framåt: från och med den filen får ingen
 * `create policy` eller `alter policy` skriva ett oinslaget anrop, annars kryper kostnaden per rad tillbaka.
 */

const DIR = 'supabase/migrations';
const FROM = '20260926142144';

/** Policy-satserna i filer från och med FROM, normaliserade: utan kommentarer och DO-block, gemener, ett blanksteg. */
function policyStatements(): { file: string; stmt: string }[] {
  return readdirSync(DIR)
    .filter((f) => f.endsWith('.sql') && f.slice(0, FROM.length) >= FROM)
    .sort()
    .flatMap((file) =>
      readFileSync(join(DIR, file), 'utf8')
        .replace(/\$(\w*)\$[\s\S]*?\$\1\$/g, '')
        .replace(/--.*$/gm, '')
        .split(';')
        .map((s) => s.replace(/"/g, '').replace(/\s+/g, ' ').trim().toLowerCase())
        .filter((stmt) => /^(create|alter) policy /.test(stmt))
        .map((stmt) => ({ file, stmt })),
    );
}

// Ett anrop som inte föregås av "select " — dvs. inte står först i en skalär delfråga.
const BARE = /(?<!select )\b(auth\.[a-z_]+\(\)|has_permission\()/g;

describe('RLS-policyer i nya migreringar', () => {
  const statements = policyStatements();

  it('hittar policy-satserna — annars är testet tomt', () => {
    // CRM-omskrivningen ensam har 89 alter policy.
    expect(statements.length).toBeGreaterThanOrEqual(89);
  });

  it('anropar auth.*() och has_permission() inslagna i (select …), aldrig per rad', () => {
    const bare = statements
      .map(({ file, stmt }) => ({ file, hits: [...stmt.matchAll(BARE)].map((m) => m[1]), policy: stmt.split(' ')[2] }))
      .filter((s) => s.hits.length > 0)
      .map((s) => `${s.file}: ${s.policy} (${s.hits.join(', ')})`);
    expect(bare, 'skriv (select auth.uid()) / (select has_permission(\'x\')) — se policyInitplan.test.ts').toEqual([]);
  });
});
