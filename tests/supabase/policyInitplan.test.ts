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
 * `create policy` eller `alter policy` skriva ett anrop som körs per rad — inte heller inuti ett DO-block
 * (`execute 'create policy …'`). Bara de exakta formerna godkänns: `(select auth.uid() = user_id)` refererar raden
 * och blir en SubPlan per rad, inte en InitPlan.
 */

const DIR = 'supabase/migrations';
const FROM = '20260926142144';

/** Varje create/alter policy i filer från och med FROM, i hela filtexten (även i DO-block och execute-strängar). */
function policySegments(): { file: string; policy: string; text: string }[] {
  return readdirSync(DIR)
    .filter((f) => f.endsWith('.sql') && f.slice(0, FROM.length) >= FROM)
    .sort()
    .flatMap((file) => {
      const text = readFileSync(join(DIR, file), 'utf8')
        .replace(/--.*$/gm, '')
        .replace(/\s+/g, ' ')
        .replace(/''/g, "'") // citattecken dubblerade i en execute-sträng
        .toLowerCase();
      return [...text.matchAll(/\b(?:create|alter) policy ("[^"]+"|\S+)[^;]*/g)].map((m) => ({
        file,
        policy: m[1].replace(/"/g, ''),
        text: m[0],
      }));
    });
}

// De enda godkända formerna: hela delfrågan är anropet och inget annat.
const WRAPPED = /\(select (?:auth\.[a-z_]+\(\)|has_permission\('[^']*'(?:::text)?\))\)/g;
// Ett anrop (inte en del av ett längre namn eller schema-kvalificerat på annat sätt).
const CALL = /(?<![.\w])(?:auth\.[a-z_]+\(\)|has_permission\()/g;

describe('RLS-policyer i nya migreringar', () => {
  const segments = policySegments();

  it('hittar policy-satserna — annars är testet tomt', () => {
    // CRM-omskrivningen ensam har 89 alter policy.
    expect(segments.length).toBeGreaterThanOrEqual(89);
  });

  it('anropar auth.*() och has_permission() bara som (select …) — aldrig per rad', () => {
    const bare = segments
      .map((s) => ({ ...s, hits: s.text.replace(WRAPPED, '').match(CALL) ?? [] }))
      .filter((s) => s.hits.length > 0)
      .map((s) => `${s.file}: ${s.policy} (${s.hits.join(', ')})`);
    expect(bare, "skriv (select auth.uid()) / (select has_permission('x')) — se policyInitplan.test.ts").toEqual([]);
  });
});
