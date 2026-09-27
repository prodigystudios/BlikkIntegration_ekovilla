import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Läspolicyerna på kontakter, nyheter, Dokument & information och dokumentbiblioteket var "inloggad"
 * (`auth.role() = 'authenticated'`) fram till 20260927080615_rls_read_policies_app_keys.sql. Lönebyrån
 * (`ekonomi`) har ingen av app-nycklarna men läste tabellerna direkt via /rest/v1 med sin session.
 *
 * Migreringens efterkontroll prövar prod EN gång. Det här testet vaktar framåt: den SENASTE create/alter policy
 * för var och en av de nio policyerna, i filnamnsordning, ska fråga efter sin nyckel och aldrig efter auth.role().
 * En senare migrering som skriver om en av dem till "inloggad" (eller en regenerering ur ett gammalt läge) blir röd.
 */

const DIR = 'supabase/migrations';

const EXPECTED: { table: string; policy: string; keys: string[] }[] = [
  { table: 'contacts', policy: 'contacts_select_all', keys: ['app.contacts.read'] },
  { table: 'addresses', policy: 'addr_select_all', keys: ['app.contacts.read'] },
  { table: 'contact_categories', policy: 'cat_select_all', keys: ['app.contacts.read'] },
  { table: 'news_items', policy: 'news_items_select_all', keys: ['app.access'] },
  { table: 'info_groups', policy: 'info_groups_select', keys: ['app.access'] },
  { table: 'info_sections', policy: 'info_sections_select', keys: ['app.access'] },
  { table: 'info_section_images', policy: 'info_section_images_select', keys: ['app.access'] },
  { table: 'documents_folders', policy: 'documents_folders_select', keys: ['crm.access', 'app.access'] },
  { table: 'documents_files', policy: 'documents_files_select', keys: ['crm.access', 'app.access'] },
];

/** Den sista create/alter policy per tabell.policy, över alla migreringar i filnamnsordning (baslinjen först). */
function latestPolicyStatements(): Map<string, { file: string; text: string }> {
  const latest = new Map<string, { file: string; text: string }>();
  for (const file of readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort()) {
    const text = readFileSync(join(DIR, file), 'utf8')
      .replace(/--.*$/gm, '')
      .replace(/\s+/g, ' ')
      .toLowerCase();
    // Baslinjen skriver CREATE POLICY "namn" ON "public"."tabell"; migreringarna alter policy namn on public.tabell.
    for (const m of text.matchAll(/\b(?:create|alter) policy ("[^"]+"|\S+) on (?:"?public"?\.)?"?([a-z_]+)"?[^;]*/g)) {
      latest.set(`${m[2]}.${m[1].replace(/"/g, '')}`, { file, text: m[0] });
    }
  }
  return latest;
}

describe('läspolicyerna som var "inloggad"', () => {
  const latest = latestPolicyStatements();

  it.each(EXPECTED)('$policy på $table frågar efter sin nyckel, inte auth.role()', ({ table, policy, keys }) => {
    const statement = latest.get(`${table}.${policy}`);
    expect(statement, `hittar ingen create/alter policy för ${table}.${policy}`).toBeDefined();
    expect(statement!.text).not.toContain('auth.role()');
    expect(statement!.text).toContain('to authenticated');
    for (const key of keys) expect(statement!.text).toContain(`has_permission('${key}')`);
  });
});
