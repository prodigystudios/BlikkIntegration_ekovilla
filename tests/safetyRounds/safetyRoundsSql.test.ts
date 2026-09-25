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

const FILE = resolve(process.cwd(), 'supabase/archive/sql/20260924_safety_rounds.sql');

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

/** Kolumnerna i `grant update (…) on public.<table>`. */
function updateColumns(table: string): string[] {
  const match = sql.match(new RegExp(`grant update \\(([^)]*)\\) on public\\.${table} to authenticated`));
  if (!match) throw new Error(`kolumnvis update saknas för ${table}`);
  return match[1].split(',').map((c) => c.trim()).sort();
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
    expect(grantsFor('safety_rounds')).toEqual(['delete', 'select']);
    expect(policyCommands('safety_rounds')).toEqual(['delete', 'select', 'update']);
  });

  it('barntabellerna: grant och policy följs åt (update kolumnvis)', () => {
    for (const table of CHILD_TABLES) {
      expect(grantsFor(table), table).toEqual(['delete', 'insert', 'select']);
      expect(updateColumns(table).length, table).toBeGreaterThan(0);
      expect(policyCommands(table), table).toEqual(['delete', 'insert', 'select', 'update']);
    }
  });

  it('revoke all FÖRE grant på varje tabell — projektets default privileges ger annars anon och authenticated allt', () => {
    for (const table of ['safety_checklist_categories', 'safety_checklist_items', 'safety_rounds', ...CHILD_TABLES]) {
      const revoke = sql.indexOf(`revoke all on public.${table} from anon, authenticated`);
      const grant = sql.indexOf(` on public.${table} to authenticated`);
      expect(revoke, table).toBeGreaterThan(-1);
      expect(revoke, table).toBeLessThan(grant);
    }
    expect(sql).not.toMatch(/grant [a-z, ()_]+ on (public\.)?\S+ to [a-z, ]*anon/);
  });

  it('UPDATE är kolumnvis: order, nummer, snapshot, skapare och round_id går inte att skriva', () => {
    expect(updateColumns('safety_rounds')).toEqual(
      [
        'site_address', 'object_label', 'held_on', 'held_at', 'client_label', 'contract_step', 'employer', 'work_type',
        'weather', 'leader_id', 'leader_name', 'safety_rep_name', 'next_round_due', 'previous_followed_up', 'status',
      ].sort(),
    );
    expect(updateColumns('safety_round_participants')).toEqual(['comment', 'company', 'initials', 'name', 'present', 'role']);
    expect(updateColumns('safety_round_items')).toEqual(['comment', 'description', 'fixed_on_site', 'risk', 'status', 'to_action_plan']);
    expect(updateColumns('safety_round_actions')).toEqual(
      ['action', 'cost_note', 'due_on', 'effect', 'finding', 'followed_up_on', 'item_id', 'position', 'responsible_name', 'risk', 'status'],
    );
    for (const table of ['safety_rounds', ...CHILD_TABLES]) {
      for (const locked of ['round_id', 'work_order_id', 'round_number', 'created_by', 'catalog_item_id', 'text', 'project_name', 'completed_at']) {
        expect(updateColumns(table), `${table}.${locked}`).not.toContain(locked);
      }
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
    for (const column of ['finding', 'risk', 'action', 'responsible_name', 'due_on']) {
      expect(trigger, column).toContain(`new.${column} is distinct from old.${column}`);
    }
    for (const column of ['status', 'followed_up_on', 'effect', 'cost_note']) {
      expect(trigger, column).not.toContain(`new.${column} is distinct from`);
    }
  });

  it('on delete set null går igenom triggrarna — annars går varken en användare eller en punkt att ta bort', () => {
    const actions = functionBody('safety_round_actions_before_update');
    // Främmande nycklar får NOLLAS (databasens städning), aldrig bytas.
    expect(actions).toContain('(new.item_id is distinct from old.item_id and new.item_id is not null)');
    expect(actions).toContain('(new.responsible_id is distinct from old.responsible_id and new.responsible_id is not null)');
    // Ronden: ingen spärr på created_by/leader_id/completed_by alls — kolumnlistan gör det jobbet.
    const rounds = functionBody('safety_rounds_before_update');
    expect(rounds).not.toMatch(/created_by is distinct|leader_id is distinct|completed_by is distinct/);
    expect(rounds).not.toContain('raise exception');
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

  it('ordersöket behandlar söktexten som text: % och _ escapas', () => {
    const body = functionBody('safety_round_order_lookup');
    expect(body).toContain("replace(replace(replace(v_q, '\\', '\\\\'), '%', '\\%'), '_', '\\_')");
    expect(body).toMatch(/wo\.order_number ilike v_pattern/);
    expect(body).not.toMatch(/ilike '%' \|\| v_q/);
  });

  it('en avbruten order får ingen rond (andra spärren efter rutten)', () => {
    expect(functionBody('start_safety_round')).toMatch(/if v_wo\.status = 'cancelled' then raise exception '[^']+' using errcode = '55000'/);
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
      // Ren textjämförelse, inget RegExp: `sql` är redan normaliserad (kommentarer bort, blanksteg
      // hopslagna, gemener), och signaturen innehåller parenteser som annars måste escapas.
      expect(sql, fn).toContain(`revoke all on function public.${fn} from public, anon;`);
      expect(sql, fn).toContain(`grant execute on function public.${fn} to authenticated;`);
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
