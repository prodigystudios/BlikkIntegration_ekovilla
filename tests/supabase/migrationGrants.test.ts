import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * En kolumnbehörighet (GRANT UPDATE (kolumn) ON t TO r) som följs av en tabellrevoke
 * (REVOKE ALL ON t FROM r) är borta: i Postgres tar en revoke på tabellnivå också bort
 * kolumnbehörigheterna för samma privilegium.
 *
 * 🧨 DET HAR HÄNT. Baslinjen, pull:ad från prod, skrev skyddsrondens 38 kolumnbehörigheter FÖRE
 * tabellernas REVOKE ALL — i en databas byggd ur migreringarna kunde ingen redigera en skyddsrond.
 * Varken type-check, testerna eller paritetsfrågorna såg det; `db diff` mot prod gjorde det. Samma
 * motor genererar framtida migreringar, så ordningen prövas här för hela kedjan.
 *
 * Läser supabase/migrations i filnamnsordning — samma ordning som `db reset` och `db push` kör dem.
 */

const DIR = 'supabase/migrations';

/** Satserna i körordning, normaliserade: utan kommentarer, funktionskroppar och citattecken. */
function statements(): string[] {
  return readdirSync(DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .flatMap((f) =>
      readFileSync(join(DIR, f), 'utf8')
        .replace(/\$(\w*)\$[\s\S]*?\$\1\$/g, '') // funktionskroppar och DO-block
        .replace(/--.*$/gm, '')
        .split(';')
        .map((s) => s.replace(/"/g, '').replace(/\s+/g, ' ').trim().toLowerCase())
        .filter(Boolean),
    );
}

const COLUMN_GRANT = /^grant [a-z_, ]+? \([^)]*\) on (?:table )?(public\.[a-z0-9_]+) to (.+)$/;
const TABLE_REVOKE_ALL = /^revoke all(?: privileges)? on (?:table )?((?:public\.[a-z0-9_]+(?:, )?)+) from (.+)$/;

function roles(list: string): string[] {
  return list.split(/, ?/).map((r) => r.trim()).filter(Boolean);
}

function analyse() {
  const lastColumnGrant = new Map<string, number>();
  const lastTableRevoke = new Map<string, number>();
  statements().forEach((stmt, i) => {
    const grant = stmt.match(COLUMN_GRANT);
    if (grant) for (const role of roles(grant[2])) lastColumnGrant.set(`${grant[1]} → ${role}`, i);
    const revoke = stmt.match(TABLE_REVOKE_ALL);
    if (revoke) {
      for (const table of revoke[1].split(/, ?/)) {
        for (const role of roles(revoke[2])) lastTableRevoke.set(`${table} → ${role}`, i);
      }
    }
  });
  return { lastColumnGrant, lastTableRevoke };
}

describe('kolumnbehörigheter i migreringarna', () => {
  const { lastColumnGrant, lastTableRevoke } = analyse();

  // Utan den här raden är testet tomt om parsningen slutar matcha — och ett tomt test ser ut som
  // ett godkänt. Baslinjen har 38 kolumnbehörigheter på fyra skyddsrondstabeller.
  it('hittar faktiskt kolumnbehörigheterna och tabellrevokerna', () => {
    expect([...lastColumnGrant.keys()]).toEqual(
      expect.arrayContaining([
        'public.safety_rounds → authenticated',
        'public.safety_round_items → authenticated',
        'public.safety_round_actions → authenticated',
        'public.safety_round_participants → authenticated',
      ]),
    );
    expect(lastTableRevoke.has('public.safety_rounds → authenticated')).toBe(true);
  });

  it('ingen kolumnbehörighet tas bort av en senare REVOKE ALL på samma tabell och roll', () => {
    const wiped = [...lastColumnGrant]
      .filter(([key, grantAt]) => (lastTableRevoke.get(key) ?? -1) > grantAt)
      .map(([key]) => key);
    expect(wiped, 'kolumnbehörigheterna försvinner — lägg GRANT UPDATE (kolumn) EFTER tabellens REVOKE ALL').toEqual([]);
  });
});

/**
 * set_user_tags är SECURITY DEFINER utan kontroll av anroparen — "rely on GRANTs". anon fick EXECUTE
 * via default privileges och kunde skriva om vilken profils taggar som helst med bara den publika
 * nyckeln (lagat 2026-09-25). Den SENASTE satsen om anon och funktionen i kedjan måste vara en revoke.
 */
describe('set_user_tags i migreringarna', () => {
  const ABOUT_FN = /^(grant|revoke) (?:execute|all)(?: privileges)? on function public\.set_user_tags\(uuid, text\[\]\) (?:to|from) (.+)$/;

  it('är inte körbar för anon efter hela kedjan', () => {
    const touching = statements()
      .map((s) => s.match(ABOUT_FN))
      .filter((m): m is RegExpMatchArray => m !== null && roles(m[2]).includes('anon'));
    // Baslinjen har prods GRANT till anon — utan den raden är testet tomt.
    expect(touching.map((m) => m[1])).toContain('grant');
    expect(touching.at(-1)?.[1]).toBe('revoke');
  });
});
