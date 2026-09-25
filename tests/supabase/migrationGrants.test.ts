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

// Hela kedjan läses och normaliseras en gång per körning.
const STATEMENTS = statements();

function analyse() {
  const lastColumnGrant = new Map<string, number>();
  const lastTableRevoke = new Map<string, number>();
  STATEMENTS.forEach((stmt, i) => {
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
 * set_user_tags är SECURITY DEFINER utan kontroll av anroparen — den "rely on GRANTs". anon fick EXECUTE
 * via default privileges och kunde skriva om vilken profils taggar som helst med bara den publika
 * nyckeln (lagat 2026-09-25). Självregistreringen är öppen, så authenticated är inte heller "anställd".
 *
 * Testet simulerar hela kedjan i stället för att leta efter en viss rad: en ny `create function` (första
 * gången, eller efter en drop) får PUBLIC + Supabase default privileges (anon, authenticated); grant och
 * revoke — i vilken stavning som helst, även `on all functions in schema public` — ändrar läget; PUBLIC
 * når anon och authenticated. Slutläget ska vara stängt för båda.
 */
describe('set_user_tags i migreringarna', () => {
  const FN = String.raw`(?:public\.)?set_user_tags\s*\([^)]*\)`;
  const CREATE = /^create (?:or replace )?function public\.set_user_tags\s*\(/;
  const DROP = /^drop function (?:if exists )?public\.set_user_tags\b/;
  const GRANT_OR_REVOKE = new RegExp(
    String.raw`^(grant|revoke) (grant option for )?([a-z, ]+?) on (?:function ${FN}|all functions in schema public) (?:to|from) (.+)$`,
  );
  const TRACKED = ['public', 'anon', 'authenticated'] as const;

  function simulate() {
    let exists = false;
    let created = false;
    const can: Record<(typeof TRACKED)[number], boolean> = { public: false, anon: false, authenticated: false };
    for (const stmt of STATEMENTS) {
      if (DROP.test(stmt)) {
        exists = false;
        continue;
      }
      if (CREATE.test(stmt)) {
        if (!exists) for (const role of TRACKED) can[role] = true;
        exists = created = true;
        continue;
      }
      const m = stmt.match(GRANT_OR_REVOKE);
      if (!m || m[2] || !/\b(execute|all)\b/.test(m[3])) continue; // "revoke grant option for" tar inte bort rätten
      const targets = m[4].split(/, ?/).map((r) => r.replace(/ with grant option$| granted by .*$/, '').trim());
      for (const role of TRACKED) if (targets.includes(role)) can[role] = m[1] === 'grant';
    }
    return {
      created,
      anon: can.anon || can.public,
      authenticated: can.authenticated || can.public,
    };
  }

  it('skapas i kedjan — annars är testet tomt', () => {
    expect(simulate().created).toBe(true);
  });

  it('är varken körbar för anon eller authenticated efter hela kedjan', () => {
    const { anon, authenticated } = simulate();
    expect({ anon, authenticated }).toEqual({ anon: false, authenticated: false });
  });
});
