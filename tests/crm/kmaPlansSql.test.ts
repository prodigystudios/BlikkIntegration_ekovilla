import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * KMA-planernas tabell är OFÖRÄNDERLIG och gatas på arbetsorderns nycklar.
 *
 * Planen går till kund, och det kunden fick måste gå att ta fram igen. En UPDATE- eller
 * DELETE-väg — ett grant eller en policy som någon "kompletterar" tabellen med — hade låtit en
 * revision skrivas om under läsarens fötter. Regeln bor i SQL som typsystemet och övriga tester inte
 * når, så testet läser filen.
 */

const FILE = resolve(process.cwd(), 'supabase/sql/20260924_crm_work_order_kma_plans.sql');

// Kommentarerna bort: huvudet FÖRKLARAR varför update och delete saknas, och en textmatchning på
// förklaringen hade gjort vakten omöjlig att uppfylla.
const sql = readFileSync(FILE, 'utf8')
  .replace(/--.*$/gm, '')
  .replace(/\s+/g, ' ')
  .toLowerCase();

const TABLE = 'public.crm_work_order_kma_plans';

/** Villkoret i policyn med det namnet, utan omgivande blanksteg. */
function policyBody(name: string): string {
  const match = sql.match(new RegExp(`create policy ${name} on ${TABLE.replace('.', '\\.')} (.*?);`));
  if (!match) throw new Error(`policyn ${name} saknas`);
  return match[1];
}

describe('crm_work_order_kma_plans (SQL)', () => {
  it('grant är exakt select + insert — ingen update, ingen delete', () => {
    const grants = [...sql.matchAll(new RegExp(`grant ([a-z, ]+) on ${TABLE.replace('.', '\\.')} to authenticated`, 'g'))];
    expect(grants).toHaveLength(1);
    const privileges = grants[0][1].split(',').map((p) => p.trim()).sort();
    expect(privileges).toEqual(['insert', 'select']);
  });

  it('inga update- eller delete-policyer, och ingen "for all"', () => {
    const policies = [...sql.matchAll(new RegExp(`create policy \\S+ on ${TABLE.replace('.', '\\.')} for (\\w+)`, 'g'))];
    expect(policies.map((p) => p[1]).sort()).toEqual(['insert', 'select']);
  });

  it('RLS är påslaget', () => {
    expect(sql).toContain(`alter table ${TABLE} enable row level security`);
  });

  it('läsning gatas på crm.workorder.read (plus egen rad)', () => {
    const body = policyBody('crm_wo_kma_select');
    expect(body).toContain('for select to authenticated');
    expect(body).toContain("public.has_permission('crm.workorder.read')");
    expect(body).toContain('created_by = auth.uid()');
    expect(body).not.toContain('crm.workorder.write');
    expect(body).not.toContain('is_user_on_work_order');
  });

  it('skapande kräver BÅDE skrivnyckeln och att man skriver som sig själv', () => {
    const body = policyBody('crm_wo_kma_insert');
    expect(body).toContain('for insert to authenticated');
    expect(body).toMatch(/created_by = auth\.uid\(\) and public\.has_permission\('crm\.workorder\.write'\)/);
    expect(body).not.toContain(' or ');
  });

  it('revisionen är unik per order och ordern kaskaderar', () => {
    expect(sql).toContain('constraint crm_wo_kma_revision_uniq unique (work_order_id, revision)');
    expect(sql).toMatch(/work_order_id uuid not null references public\.crm_work_orders\(id\) on delete cascade/);
  });
});
