import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MAX_PHOTOS_PER_ROUND } from '@/lib/domains/safetyRounds/photoRules';

/**
 * Fotonas SQL. Det som vaktas: en PRIVAT bucket som bara tar JPEG under taket, inga storage-policyer
 * (bara servern når den), att ett foto BARA sparas av add_safety_round_photo() — som låser ronden,
 * numrerar ur en räknare som aldrig går bakåt och prövar taket under låset — ingen UPDATE, och en
 * sammansatt nyckel som håller fotot i samma rond som sin punkt.
 */

const sql = readFileSync(resolve(process.cwd(), 'supabase/archive/sql/20260925_safety_round_photos.sql'), 'utf8')
  .replace(/--.*$/gm, '')
  .replace(/\s+/g, ' ')
  .toLowerCase();

const TABLE = 'public.safety_round_photos';

/** Kroppen i en funktion ($$ … $$). */
function functionBody(name: string): string {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  if (start < 0) throw new Error(`funktionen ${name} saknas`);
  const open = sql.indexOf('as $$', start);
  return sql.slice(open + 5, sql.indexOf('$$;', open));
}

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

  it('revoke all före grant — bara select + delete: ingen insert (funktionen sparar), ingen update', () => {
    const revoke = sql.indexOf(`revoke all on ${TABLE} from anon, authenticated;`);
    const grant = sql.indexOf(`grant select, delete on ${TABLE} to authenticated;`);
    expect(revoke).toBeGreaterThan(-1);
    expect(grant).toBeGreaterThan(revoke);
    expect(sql).not.toMatch(/grant [a-z, ()]*(insert|update)[a-z, ()]* on public\.safety_round_photos/);
    expect([...sql.matchAll(/create policy \S+ on public\.safety_round_photos for (\w+)/g)].map((m) => m[1]).sort()).toEqual([
      'delete',
      'select',
    ]);
  });

  it('ta bort: skrivnyckeln, i ett utkast', () => {
    const del = policyBody('safety_round_photos_delete');
    expect(del).toContain("public.has_permission('safety.round.write')");
    expect(del).toContain('public.safety_round_is_draft(round_id)');
  });

  describe('add_safety_round_photo()', () => {
    const body = functionBody('add_safety_round_photo');

    it('kräver en riktig person med skrivnyckeln (sessionsklienten, aldrig service-roll)', () => {
      expect(body).toMatch(/if v_uid is null or not public\.has_permission\('safety\.round\.write'\) then raise exception '[^']+' using errcode = '42501'/);
      expect(sql).toMatch(/create or replace function public\.add_safety_round_photo\(.*?\) returns public\.safety_round_photos language plpgsql volatile security definer set search_path = public/);
    });

    it('sökvägen måste vara <rond>/<den inloggade>/<uuid>.jpg och den lilla ligga bredvid', () => {
      expect(body).toContain("p_storage_path !~ ('^' || p_round_id::text || '/' || v_uid::text");
      expect(body).toContain("p_print_path is distinct from regexp_replace(p_storage_path, '\\.jpg$', '.print.jpg')");
    });

    it('låser ronden och prövar utkast, "redan sparad" och taket — i DEN ordningen, under låset', () => {
      const lock = body.indexOf('for update');
      const draft = body.indexOf("errcode = '55000'");
      const duplicate = body.indexOf("errcode = '23505'");
      const limit = body.indexOf("errcode = '54000'");
      const insert = body.indexOf('insert into public.safety_round_photos');
      expect(lock).toBeGreaterThan(-1);
      // "Redan sparad" före taket: en dubbelbekräftelse ska svara 23505, och då städar rutten aldrig.
      expect([lock, draft, duplicate, limit, insert]).toEqual([...[lock, draft, duplicate, limit, insert]].sort((a, b) => a - b));
    });

    it('taket i SQL är detsamma som i koden', () => {
      expect(body).toContain(`>= ${MAX_PHOTOS_PER_ROUND} then raise exception 'photo limit reached'`);
    });

    it('numret tas ur räknaren på ronden — aldrig max + 1, så ett borttaget fotos nummer ges aldrig bort', () => {
      expect(body).toContain('update public.safety_rounds set last_photo_no = last_photo_no + 1 where id = p_round_id returning last_photo_no into v_no');
      expect(body).not.toMatch(/max\(\s*p\.photo_no|max\(photo_no/);
      expect(sql).toContain('alter table public.safety_rounds add column if not exists last_photo_no integer not null default 0');
    });

    it('räknaren går inte att skriva från appen (inte i rondernas kolumnvisa update)', () => {
      const rounds = readFileSync(resolve(process.cwd(), 'supabase/archive/sql/20260924_safety_rounds.sql'), 'utf8').toLowerCase();
      const grant = rounds.slice(rounds.indexOf('grant update ('), rounds.indexOf(') on public.safety_rounds to authenticated'));
      expect(grant).not.toContain('last_photo_no');
    });

    it('är låst för public och anon, öppen för authenticated', () => {
      expect(sql).toContain('revoke all on function public.add_safety_round_photo(uuid, uuid, text, text, integer, integer) from public, anon;');
      expect(sql).toContain('grant execute on function public.add_safety_round_photo(uuid, uuid, text, text, integer, integer) to authenticated;');
    });
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
