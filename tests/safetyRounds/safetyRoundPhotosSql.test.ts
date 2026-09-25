import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Fotonas SQL. Det som vaktas: en PRIVAT bucket som bara tar JPEG under taket, inga storage-policyer
 * (bara servern når den), foton som bara läggs till och tas bort i ett utkast, ingen UPDATE, och en
 * sammansatt nyckel som håller fotot i samma rond som sin punkt.
 */

const sql = readFileSync(resolve(process.cwd(), 'supabase/sql/20260925_safety_round_photos.sql'), 'utf8')
  .replace(/--.*$/gm, '')
  .replace(/\s+/g, ' ')
  .toLowerCase();

const TABLE = 'public.safety_round_photos';

function policyBody(name: string): string {
  const start = sql.indexOf(`create policy ${name} on ${TABLE} `);
  if (start < 0) throw new Error(`policyn ${name} saknas`);
  return sql.slice(start, sql.indexOf(';', start));
}

describe('safety_round_photos (SQL)', () => {
  it('bucketen är privat, 2 MB, bara JPEG — och inställningarna skrivs över om den redan finns', () => {
    expect(sql).toContain(
      "insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('safety-round-photos', 'safety-round-photos', false, 2097152, array['image/jpeg'])",
    );
    expect(sql).toContain('on conflict (id) do update set public = false');
  });

  it('inga storage.objects-policyer — bara servern når bucketen', () => {
    expect(sql).not.toMatch(/on storage\.objects/);
  });

  it('revoke all före grant, och bara select + insert + delete (ingen update)', () => {
    const revoke = sql.indexOf(`revoke all on ${TABLE} from anon, authenticated;`);
    const grant = sql.indexOf(`grant select, insert, delete on ${TABLE} to authenticated;`);
    expect(revoke).toBeGreaterThan(-1);
    expect(grant).toBeGreaterThan(revoke);
    expect(sql).not.toMatch(/grant [a-z, ()]*update/);
    expect([...sql.matchAll(/create policy \S+ on public\.safety_round_photos for (\w+)/g)].map((m) => m[1]).sort()).toEqual([
      'delete',
      'insert',
      'select',
    ]);
  });

  it('lägga till: som sig själv, med skrivnyckeln, i ett utkast. Ta bort: skrivnyckeln, i ett utkast', () => {
    const insert = policyBody('safety_round_photos_insert');
    expect(insert).toContain('created_by = auth.uid()');
    expect(insert).toContain("public.has_permission('safety.round.write')");
    expect(insert).toContain('public.safety_round_is_draft(round_id)');
    const del = policyBody('safety_round_photos_delete');
    expect(del).toContain("public.has_permission('safety.round.write')");
    expect(del).toContain('public.safety_round_is_draft(round_id)');
  });

  it('läsning = läs- eller skrivnyckeln, utan besättningsgren', () => {
    const select = policyBody('safety_round_photos_select');
    expect(select).toContain("public.has_permission('safety.round.read')");
    expect(select).toContain("public.has_permission('safety.round.write')");
    expect(sql).not.toContain('is_user_on_work_order');
  });

  it('fotot hålls i samma rond som sin punkt (sammansatt nyckel), och numret är unikt per rond', () => {
    expect(sql).toContain('foreign key (item_id, round_id) references public.safety_round_items(id, round_id) on delete cascade');
    expect(sql).toContain('add constraint safety_round_items_id_round_uniq unique (id, round_id)');
    expect(sql).toContain('constraint safety_round_photos_no_uniq unique (round_id, photo_no)');
    expect(sql).toContain('constraint safety_round_photos_path_uniq unique (storage_path)');
    expect(sql).toContain('constraint safety_round_photos_print_path_uniq unique (print_path)');
  });

  it('det nya villkoret på punkterna läggs bara till om det saknas (idempotent)', () => {
    expect(sql).toMatch(/if not exists \(select 1 from pg_constraint where conname = 'safety_round_items_id_round_uniq'\) then alter table/);
  });

  it('RLS är påslaget', () => {
    expect(sql).toContain(`alter table ${TABLE} enable row level security`);
  });
});
