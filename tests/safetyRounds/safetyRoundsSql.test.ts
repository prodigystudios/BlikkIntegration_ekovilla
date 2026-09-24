import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Skyddsrondernas SQL. Reglerna bor i databasen, där typsystemet och övriga tester inte når, så
 * testet läser filen. Det som vaktas:
 *
 *   * Ordern lämnas bara ut SMALT: uppslagen läser aldrig internal_handoff (portkoder) och aldrig
 *     hela customer_snapshot (personnummer), och de är grindade på skrivnyckeln.
 *   * En rond skapas BARA av start_safety_round() — ingen insert-grant på safety_rounds.
 *   * Rondinfo, deltagare och punkter går bara att skriva i ett UTKAST.
 *   * Ingen besättningsgren någonstans (Williams beslut: egen nyckel, inte "är på jobbet").
 *   * Grant och policy följs åt — både-eller-ingen.
 */

const FILE = resolve(process.cwd(), 'supabase/sql/20260924_safety_rounds.sql');

// Kommentarerna bort: huvudet FÖRKLARAR varför saker saknas, och en textmatchning på förklaringen
// hade gjort vakten omöjlig att uppfylla (eller lurat den att bli grön).
const sql = readFileSync(FILE, 'utf8')
  .replace(/--.*$/gm, '')
  .replace(/\s+/g, ' ')
  .toLowerCase();

function grantsFor(table: string): string[] {
  const matches = [...sql.matchAll(new RegExp(`grant ([a-z, ]+) on public\\.${table} to authenticated`, 'g'))];
  return matches.flatMap((m) => m[1].split(',').map((p) => p.trim())).sort();
}

function policyCommands(table: string): string[] {
  return [...sql.matchAll(new RegExp(`create policy \\S+ on public\\.${table} for (\\w+)`, 'g'))].map((m) => m[1]).sort();
}

function policyBody(name: string): string {
  const match = sql.match(new RegExp(`create policy ${name} on public\\.\\S+ (.*?);`));
  if (!match) throw new Error(`policyn ${name} saknas`);
  return match[1];
}

/** Kroppen i en funktion ($$ … $$). */
function functionBody(name: string): string {
  const match = sql.match(new RegExp(`create or replace function public\\.${name}\\(.*?as \\$\\$(.*?)\\$\\$`));
  if (!match) throw new Error(`funktionen ${name} saknas`);
  return match[1];
}

const CHILD_TABLES = ['safety_round_participants', 'safety_round_items', 'safety_round_actions'];

describe('skyddsronder (SQL)', () => {
  it('nycklarna seedas till admin och sales — och ingen annan roll', () => {
    const seeds = [...sql.matchAll(/\('(\w+)', '(safety\.round\.\w+)'\)/g)].map((m) => `${m[1]}:${m[2]}`).sort();
    expect(seeds).toEqual([
      'admin:safety.round.read',
      'admin:safety.round.write',
      'sales:safety.round.read',
      'sales:safety.round.write',
    ]);
  });

  it('safety_rounds har INGEN insert-grant och ingen insert-policy — ronden skapas bara av start_safety_round()', () => {
    expect(grantsFor('safety_rounds')).toEqual(['delete', 'select', 'update']);
    expect(policyCommands('safety_rounds')).toEqual(['delete', 'select', 'update']);
  });

  it('barntabellerna: grant och policy följs åt', () => {
    for (const table of CHILD_TABLES) {
      expect(grantsFor(table), table).toEqual(['delete', 'insert', 'select', 'update']);
      expect(policyCommands(table), table).toEqual(['delete', 'insert', 'select', 'update']);
    }
  });

  it('katalogen går bara att läsa (redigeringen kommer i PR 4)', () => {
    for (const table of ['safety_checklist_categories', 'safety_checklist_items']) {
      expect(grantsFor(table), table).toEqual(['select']);
      expect(policyCommands(table), table).toEqual(['select']);
    }
  });

  it('RLS är påslaget på alla sex tabeller', () => {
    for (const table of ['safety_rounds', ...CHILD_TABLES, 'safety_checklist_categories', 'safety_checklist_items']) {
      expect(sql, table).toContain(`alter table public.${table} enable row level security`);
    }
  });

  it('rondinfo, deltagare och punkter skrivs bara i ett utkast', () => {
    expect(policyBody('safety_rounds_update')).toMatch(/using \(status = 'draft' and public\.has_permission\('safety\.round\.write'\)\)/);
    expect(policyBody('safety_rounds_delete')).toMatch(/using \(status = 'draft' and public\.has_permission\('safety\.round\.write'\)\)/);
    for (const name of [
      'safety_round_participants_insert',
      'safety_round_participants_update',
      'safety_round_participants_delete',
      'safety_round_items_insert',
      'safety_round_items_update',
      'safety_round_items_delete',
      'safety_round_actions_insert',
      'safety_round_actions_delete',
    ]) {
      const body = policyBody(name);
      expect(body, name).toContain("public.has_permission('safety.round.write')");
      expect(body, name).toContain('public.safety_round_is_draft(round_id)');
    }
  });

  it('åtgärdens uppföljning är öppen efter slutförd rond — men triggern låser själva åtgärden', () => {
    const update = policyBody('safety_round_actions_update');
    expect(update).not.toContain('safety_round_is_draft');
    const trigger = functionBody('safety_round_actions_before_update');
    for (const column of ['finding', 'risk', 'action', 'responsible_id', 'responsible_name', 'due_on', 'item_id']) {
      expect(trigger, column).toContain(`new.${column} is distinct from old.${column}`);
    }
    for (const column of ['status', 'followed_up_on', 'effect', 'cost_note']) {
      expect(trigger, column).not.toContain(`new.${column} is distinct from`);
    }
  });

  it('bara egna punkter läggs till och tas bort från appen', () => {
    expect(policyBody('safety_round_items_insert')).toContain('catalog_item_id is null');
    expect(policyBody('safety_round_items_delete')).toContain('catalog_item_id is null');
  });

  it('läsning = läs- ELLER skrivnyckeln, utan besättningsgren', () => {
    for (const table of ['safety_rounds', ...CHILD_TABLES]) {
      const body = policyBody(`${table}_select`);
      expect(body, table).toContain("public.has_permission('safety.round.read')");
      expect(body, table).toContain("public.has_permission('safety.round.write')");
    }
    expect(sql).not.toContain('is_user_on_work_order');
    expect(sql).not.toContain('is_user_on_segment');
  });

  it('orderuppslagen är grindade på skrivnyckeln och lämnar aldrig ut portkoder eller personnummer', () => {
    for (const name of ['safety_round_order_lookup', 'safety_round_order_header', 'start_safety_round']) {
      const body = functionBody(name);
      expect(body, name).toContain("public.has_permission('safety.round.write')");
      expect(body, name).not.toContain('internal_handoff');
      expect(body, name).not.toContain('rot_details');
      expect(body, name).not.toContain('personal_number');
      // customer_snapshot bara fält för fält (->>), aldrig som helhet.
      expect(body.replace(/wo\.customer_snapshot ->> '\w+'/g, ''), name).not.toContain('customer_snapshot');
    }
  });

  it('start_safety_round kräver en riktig person (auth.uid()) och kopierar bara aktiva punkter', () => {
    const body = functionBody('start_safety_round');
    expect(body).toMatch(/if v_uid is null or not public\.has_permission\('safety\.round\.write'\)/);
    expect(body).toContain('where i.active and c.active');
    expect(sql).toMatch(/create or replace function public\.start_safety_round\(.*?\) returns uuid language plpgsql volatile security definer set search_path = public/);
  });

  it('SECURITY DEFINER-funktionerna är låsta för public och öppna för authenticated', () => {
    for (const fn of [
      'safety_round_is_draft(uuid)',
      'safety_round_order_lookup(text)',
      'safety_round_order_header(uuid)',
      'start_safety_round(uuid, date, text, text, text)',
    ]) {
      const escaped = fn.replace(/[()]/g, '\\$&');
      expect(sql, fn).toMatch(new RegExp(`revoke all on function public\\.${escaped} from public`));
      expect(sql, fn).toMatch(new RegExp(`grant execute on function public\\.${escaped} to authenticated`));
    }
  });

  it('rondnumret är unikt per order och ordern kaskaderar', () => {
    expect(sql).toContain('constraint safety_rounds_number_uniq unique (work_order_id, round_number)');
    expect(sql).toMatch(/work_order_id uuid not null references public\.crm_work_orders\(id\) on delete cascade/);
  });

  it('databasens värden är desamma som kodens', async () => {
    const types = await import('@/lib/domains/safetyRounds/types');
    const inList = (values: readonly string[]) => values.map((v) => `'${v}'`).join(', ');
    expect(sql).toContain(`status in (${inList(types.ITEM_STATUSES)})`);
    expect(sql).toContain(`risk in (${inList(types.RISK_LEVELS)})`);
    expect(sql).toContain(`to_action_plan in (${inList(types.TO_ACTION_PLAN)})`);
    expect(sql).toContain(`role in (${inList(types.PARTICIPANT_ROLES)})`);
    expect(sql).toContain(`status in (${inList(types.ACTION_STATUSES)})`);
    expect(sql).toContain(`effect in (${inList(types.ACTION_EFFECTS)})`);
  });

  it('katalogens seed: 20 punkter i A–H och en tom kategori I', () => {
    const items = [...sql.matchAll(/\('([a-i])', (\d+), '/g)];
    expect(items).toHaveLength(20);
    expect(new Set(items.map((m) => m[1]))).toEqual(new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']));
    expect(sql).toContain("('i', 'egna punkter / objektsspecifika risker', 9)");
  });
});
