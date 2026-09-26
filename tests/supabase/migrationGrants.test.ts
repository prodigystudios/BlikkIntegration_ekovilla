import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SELF_EDITABLE_PROFILE_FIELDS } from '@/lib/profileDetails';

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

/**
 * profiles_update_self släpper igenom varje uppdatering av den egna raden, så det enda som hindrar en
 * användare från att skriva sin egen `role` (och därmed rollens alla nycklar) är att UPDATE bara är
 * beviljat per kolumn (lagat 2026-09-26). En grant på tabellnivå — ny eller kvarglömd — öppnar allt igen.
 *
 * Kedjan simuleras för UPDATE: `create table` ger default privileges (anon, authenticated) på tabellnivå;
 * en revoke på tabellnivå tar också bort kolumngrantarna; en kolumnrevoke rör ALDRIG tabellgranten; PUBLIC
 * når båda rollerna. Slutläget ska vara exakt vitlistan som /api/profile skriver med användarens session.
 */
describe('profiles UPDATE i migreringarna', () => {
  // `public.` är valfritt: search_path är public, så en handskriven `grant ... on profiles` biter lika mycket.
  const CREATE = /^create table (?:if not exists )?(?:public\.)?profiles \(/;
  const GRANT_OR_REVOKE = /^(grant|revoke) (grant option for )?(.+?) on (?:table )?(.+?) (?:to|from) (.+)$/;
  const PRIVILEGE = /^([a-z]+(?: privileges)?) ?(?:\(([^)]*)\))?$/;
  const TRACKED = ['public', 'anon', 'authenticated'] as const;
  type Role = (typeof TRACKED)[number];

  /** "update (a, b), select" → [{ name: 'update', columns: ['a','b'] }, { name: 'select', columns: null }] */
  function privileges(list: string) {
    const parts: string[] = [];
    let depth = 0;
    let current = '';
    for (const ch of list) {
      if (ch === '(') depth += 1;
      if (ch === ')') depth -= 1;
      if (ch === ',' && depth === 0) {
        parts.push(current.trim());
        current = '';
      } else current += ch;
    }
    parts.push(current.trim());
    return parts.flatMap((part) => {
      const m = part.match(PRIVILEGE);
      if (!m) return [];
      return [{ name: m[1], columns: m[2] ? m[2].split(',').map((c) => c.trim()).filter(Boolean) : null }];
    });
  }

  function simulate() {
    let created = false;
    let sawTableGrant = false;
    const table: Record<Role, boolean> = { public: false, anon: false, authenticated: false };
    const columns: Record<Role, Set<string>> = { public: new Set(), anon: new Set(), authenticated: new Set() };

    for (const stmt of STATEMENTS) {
      if (CREATE.test(stmt)) {
        created = true;
        table.anon = table.authenticated = true;
        continue;
      }
      const m = stmt.match(GRANT_OR_REVOKE);
      if (!m || m[2]) continue; // "revoke grant option for" tar inte bort rätten
      const targets = m[4].split(/, ?/).map((t) => t.replace(/^public\./, ''));
      if (!targets.includes('profiles') && m[4] !== 'all tables in schema public') continue;
      const grantees = roles(m[5].replace(/ with grant option$| granted by .*$| cascade$| restrict$/, ''));
      for (const priv of privileges(m[3])) {
        if (priv.name !== 'update' && priv.name !== 'all' && priv.name !== 'all privileges') continue;
        for (const role of TRACKED) {
          if (!grantees.includes(role)) continue;
          if (m[1] === 'grant') {
            if (priv.columns) priv.columns.forEach((c) => columns[role].add(c));
            else {
              table[role] = true;
              if (role !== 'public') sawTableGrant = true;
            }
          } else if (priv.columns) priv.columns.forEach((c) => columns[role].delete(c));
          else {
            table[role] = false;
            columns[role].clear();
          }
        }
      }
    }

    const effective = (role: 'anon' | 'authenticated') => ({
      wholeTable: table[role] || table.public,
      columns: [...new Set([...columns[role], ...columns.public])].sort(),
    });
    return { created, sawTableGrant, anon: effective('anon'), authenticated: effective('authenticated') };
  }

  const RESULT = simulate();

  // Baslinjen skapar tabellen och ger UPDATE på tabellnivå. Ser simuleringen inte det är testet tomt.
  it('hittar tabellen och baslinjens tabellgrant — annars är testet tomt', () => {
    const { created, sawTableGrant } = RESULT;
    expect({ created, sawTableGrant }).toEqual({ created: true, sawTableGrant: true });
  });

  it('anon kan inte uppdatera någonting', () => {
    expect(RESULT.anon).toEqual({ wholeTable: false, columns: [] });
  });

  it('authenticated kan bara uppdatera vitlistan som /api/profile skriver', () => {
    expect(RESULT.authenticated).toEqual({
      wholeTable: false,
      columns: [...SELF_EDITABLE_PROFILE_FIELDS].sort(),
    });
  });

  it('rollen står aldrig på vitlistan', () => {
    expect(SELF_EDITABLE_PROFILE_FIELDS).not.toContain('role');
  });

  // Efterkontrollen i migreringen bär en egen kopia av listan (DO-blocket kan inte läsa granten). Simuleringen
  // ovan skalar bort DO-block, så utan det här testet hade en glidning först märkts som en avbruten push i prod.
  it('efterkontrollens lista är samma som vitlistan', () => {
    const sql = readFileSync(join(DIR, '20260926084111_profiles_role_column_lock.sql'), 'utf8');
    const array = sql.match(/editable constant text\[\] := array\[([^\]]*)\]/);
    expect(array, 'hittar inte editable-listan i efterkontrollen').not.toBeNull();
    const listed = [...array![1].matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]).sort();
    expect(listed).toEqual([...SELF_EDITABLE_PROFILE_FIELDS].sort());
  });
});
