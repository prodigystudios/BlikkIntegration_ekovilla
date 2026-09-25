-- Skyddsrondernas foton (PR 2 av 4) — "Ta foto på brister och spara tillsammans med detta protokoll"
-- (Excel-mallens instruktion). Ett foto hör till en punkt i checklistan och får ett löpnummer per
-- rond ("Foto-nr" i mallen), som protokollet hänvisar till.
--
-- EGEN PRIVAT BUCKET — första gången repot skapar en bucket i SQL
-- Allt annat i appen ligger i den delade bucketen `pdfs`, och /api/storage/* når den bucketen UTAN
-- behörighetsgrind (vilken inloggad som helst kan lista och ladda ned). Fotona visar arbetsplatser
-- och personer, så de ligger i `safety-round-photos`, som de rutterna aldrig pekar på (de är
-- hårdkodade till SUPABASE_BUCKET/`pdfs`). Bucketen har INGA storage.objects-policyer: bara servern
-- når den, med service-rollen, och bara efter att RLS släppt igenom läsningen av raden —
-- samma mönster som arbetsorderns filer (lib/domains/crm/workOrderFiles/storage.ts).
-- Bucketen själv bär storleks- och typtaket, så även en signerad uppladdning som ljuger om sin
-- storlek stoppas av lagringen.
--
-- TVÅ STORLEKAR PER FOTO
-- Telefonen laddar upp en full bild (att titta på i appen) och en liten (till PDF:en). Vercel
-- stoppar svar över 4,5 MB, och ett protokoll med tjugo fullstora foton hade slagit i taket — med
-- den lilla varianten ryms alla fotona i protokollet.
--
-- LÅST EFTER SLUTFÖRD: foton läggs till och tas bort bara i ett utkast, som resten av checklistan.
-- Ingen UPDATE alls — ett foto byts genom att tas bort och tas om.
--
-- DEPLOY-ORDNING: KÖR DEN HÄR FILEN FÖRE KODEN.
-- Additiv — en ny bucket, en ny tabell och ett nytt unikt villkor på safety_round_items (trivialt
-- uppfyllt: id är redan primärnyckel). Utan filen svarar fotoknappen med fel; resten av ronden
-- fungerar som förut.
--
-- Kör i Supabase SQL editor. Idempotent (kör den två gånger innan du litar på påståendet).
--
-- ⚠️ INGA EMOJI UTANFÖR BMP I DEN HÄR FILEN — se tests/planning/sqlNoAstralChars.test.ts.

-- ---------------------------------------------------------------------------
-- 1. Bucketen
-- ---------------------------------------------------------------------------
-- 2 MB per objekt och bara JPEG: telefonen gör om varje bild till JPEG innan uppladdningen (så en
-- iPhone-HEIC blir läsbar i alla webbläsare och går att bädda in i PDF:en), och den fulla varianten
-- stannar under 0,7 MB. `do update` så att en bucket som redan finns får rätt inställningar.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('safety-round-photos', 'safety-round-photos', false, 2097152, array['image/jpeg'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- 2. Punkten måste höra till SAMMA rond
-- ---------------------------------------------------------------------------
-- En sammansatt främmande nyckel (item_id, round_id) -> safety_round_items(id, round_id) gör det
-- omöjligt att koppla ett foto i en rond till en punkt i en annan, även förbi rutterna. Den kräver
-- ett unikt villkor på (id, round_id) — trivialt uppfyllt, eftersom id redan är primärnyckel.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'safety_round_items_id_round_uniq') then
    alter table public.safety_round_items
      add constraint safety_round_items_id_round_uniq unique (id, round_id);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Tabellen
-- ---------------------------------------------------------------------------

create table if not exists public.safety_round_photos (
  id               uuid primary key default gen_random_uuid(),
  round_id         uuid not null references public.safety_rounds(id) on delete cascade,
  item_id          uuid not null,

  -- 1, 2, 3 ... per rond — "Foto-nr". Räknas fram i rutten som max + 1; två samtidiga krockar på
  -- det unika villkoret och rutten försöker igen. Ett borttaget foto lämnar ett hål i serien: numret
  -- är en hänvisning, och en hänvisning får aldrig byta foto.
  photo_no         integer not null,

  -- <round_id>/<uppladdarens id>/<uuid>.jpg och .print.jpg — se lib/domains/safetyRounds/photoRules.ts.
  storage_path     text not null,
  print_path       text not null,
  size_bytes       integer not null,
  print_size_bytes integer not null,

  created_by       uuid references public.profiles(id) on delete set null,
  -- SNAPSHOT: profiles är self-read-only.
  created_by_name  text not null,
  created_at       timestamptz not null default now(),

  constraint safety_round_photos_item_fk
    foreign key (item_id, round_id) references public.safety_round_items(id, round_id) on delete cascade,
  constraint safety_round_photos_no_chk check (photo_no >= 1),
  constraint safety_round_photos_no_uniq unique (round_id, photo_no),
  constraint safety_round_photos_path_uniq unique (storage_path),
  constraint safety_round_photos_print_path_uniq unique (print_path),
  constraint safety_round_photos_size_chk check (size_bytes > 0 and size_bytes <= 2097152),
  constraint safety_round_photos_print_size_chk check (print_size_bytes > 0 and print_size_bytes <= 2097152),
  constraint safety_round_photos_created_by_name_chk check (btrim(created_by_name) <> '')
);

-- Den sammansatta nyckelns kaskad (en egen punkt tas bort) går på det här indexet.
create index if not exists safety_round_photos_item_idx on public.safety_round_photos (item_id, round_id);

alter table public.safety_round_photos enable row level security;

-- ---------------------------------------------------------------------------
-- 4. Grants
-- ---------------------------------------------------------------------------
-- REVOKE ALL FÖRST: tabellen får projektets default privileges (grant all till anon och
-- authenticated) när den skapas i SQL-editorn. Ingen UPDATE — ett foto är oföränderligt.
revoke all on public.safety_round_photos from anon, authenticated;
grant select, insert, delete on public.safety_round_photos to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Policyer
-- ---------------------------------------------------------------------------

drop policy if exists safety_round_photos_select on public.safety_round_photos;
create policy safety_round_photos_select
  on public.safety_round_photos
  for select
  to authenticated
  using (
    public.has_permission('safety.round.read')
    or public.has_permission('safety.round.write')
  );

-- Bara i ett utkast, bara med skrivnyckeln, och alltid som sig själv.
drop policy if exists safety_round_photos_insert on public.safety_round_photos;
create policy safety_round_photos_insert
  on public.safety_round_photos
  for insert
  to authenticated
  with check (
    created_by = auth.uid()
    and public.has_permission('safety.round.write')
    and public.safety_round_is_draft(round_id)
  );

drop policy if exists safety_round_photos_delete on public.safety_round_photos;
create policy safety_round_photos_delete
  on public.safety_round_photos
  for delete
  to authenticated
  using (public.has_permission('safety.round.write') and public.safety_round_is_draft(round_id));

-- ---------------------------------------------------------------------------
-- Verifiering (kör efter applicering)
-- ---------------------------------------------------------------------------
--
-- 1. Bucketen är privat, 2 MB, bara JPEG:
--
--      select id, public, file_size_limit, allowed_mime_types
--      from storage.buckets where id = 'safety-round-photos';
--
-- 2. Ingen storage-policy nämner bucketen (bara servern når den):
--
--      select policyname from pg_policies
--      where schemaname = 'storage' and tablename = 'objects'
--        and (qual like '%safety-round-photos%' or with_check like '%safety-round-photos%');
--
--    Förväntat: noll rader.
--
-- 3. Exakt SELECT, INSERT och DELETE för authenticated, ingenting för anon:
--
--      select grantee, string_agg(privilege_type, ', ' order by privilege_type)
--      from information_schema.role_table_grants
--      where table_schema = 'public' and table_name = 'safety_round_photos'
--        and grantee in ('anon', 'authenticated')
--      group by grantee;
--
-- 4. Tre policyer (select, insert, delete) och RLS på:
--
--      select policyname, cmd from pg_policies
--      where schemaname = 'public' and tablename = 'safety_round_photos' order by cmd;
--
-- 5. Ett foto kan inte kopplas till en punkt i en annan rond (23503 på safety_round_photos_item_fk).
--    Rulla tillbaka:
--
--      begin;
--      insert into public.safety_round_photos
--        (round_id, item_id, photo_no, storage_path, print_path, size_bytes, print_size_bytes, created_by_name)
--      values ('<rond A>', '<punkt i rond B>', 1, 'x', 'y', 1, 1, 'Test');
--      rollback;
