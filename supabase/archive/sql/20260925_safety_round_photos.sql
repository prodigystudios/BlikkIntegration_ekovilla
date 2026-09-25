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
-- ETT FOTO SPARAS BARA AV add_safety_round_photo(). Funktionen låser ronden, så att numret och
-- taket (30 per rond) prövas ett foto i taget även när två sparas samtidigt, och numret tas ur en
-- räknare på ronden som bara går uppåt — ett borttaget fotos nummer ges aldrig till ett annat foto.
-- Därför ingen INSERT-grant på tabellen.
--
-- DEPLOY-ORDNING: KÖR DEN HÄR FILEN FÖRE KODEN.
-- Additiv — en ny bucket, en ny tabell, en ny kolumn (safety_rounds.last_photo_no, default 0) och ett
-- nytt unikt villkor på safety_round_items (trivialt uppfyllt: id är redan primärnyckel). Men koden
-- läser fototabellen varje gång en rond öppnas: utan filen går INGEN rond att öppna, skriva ut
-- eller slutföra — inte bara fotona.
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

-- Räknaren för "Foto-nr". Går bara uppåt, och bara via add_safety_round_photo(). Klienten kan inte
-- skriva den: UPDATE på safety_rounds är kolumnvis (20260924_safety_rounds.sql), och kolumnen står
-- inte i listan.
alter table public.safety_rounds add column if not exists last_photo_no integer not null default 0;

-- ---------------------------------------------------------------------------
-- 3. Tabellen
-- ---------------------------------------------------------------------------

create table if not exists public.safety_round_photos (
  id               uuid primary key default gen_random_uuid(),
  round_id         uuid not null references public.safety_rounds(id) on delete cascade,
  item_id          uuid not null,

  -- 1, 2, 3 ... per rond — "Foto-nr", ur safety_rounds.last_photo_no. Ett borttaget foto lämnar ett
  -- hål i serien: numret är en hänvisning, och en hänvisning får aldrig byta foto.
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
-- authenticated) när den skapas i SQL-editorn. Ingen UPDATE — ett foto är oföränderligt. Ingen
-- INSERT — ett foto sparas bara av add_safety_round_photo() (avsnitt 6).
revoke all on public.safety_round_photos from anon, authenticated;
grant select, delete on public.safety_round_photos to authenticated;

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

-- Ingen insert-policy: ett foto sparas bara av add_safety_round_photo(), som prövar samma sak (och
-- mer) inifrån en låst rond.
drop policy if exists safety_round_photos_insert on public.safety_round_photos;

drop policy if exists safety_round_photos_delete on public.safety_round_photos;
create policy safety_round_photos_delete
  on public.safety_round_photos
  for delete
  to authenticated
  using (public.has_permission('safety.round.write') and public.safety_round_is_draft(round_id));

-- ---------------------------------------------------------------------------
-- 6. Spara ett foto
-- ---------------------------------------------------------------------------
-- Rutten har redan prövat att objekten finns i lagringen och är JPEG under taket (bara servern når
-- bucketen). Funktionen prövar allt som hör till DATAN, i EN transaktion med ronden låst:
--   * den inloggade har skrivnyckeln (auth.uid() — anropas med sessionsklienten, aldrig service-roll),
--   * sökvägen är <rond>/<den inloggade>/<uuid>.jpg och den lilla varianten ligger bredvid — samma
--     regel som parsePhotoPath i lib/domains/safetyRounds/photoRules.ts,
--   * ronden är ett utkast,
--   * sökvägen är inte redan registrerad (prövas FÖRE taket: en dubbelbekräftelse av samma foto ska
--     svara "redan sparat", och rutten städar aldrig bort ett registrerat fotos objekt),
--   * ronden har färre än 30 foton (MAX_PHOTOS_PER_ROUND i photoRules.ts),
--   * numret tas ur räknaren, som bara går uppåt.
-- Punkten måste höra till ronden — det avgör den sammansatta nyckeln (23503).
create or replace function public.add_safety_round_photo(
  p_round_id uuid,
  p_item_id uuid,
  p_storage_path text,
  p_print_path text,
  p_size_bytes integer,
  p_print_size_bytes integer
)
returns public.safety_round_photos
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_status text;
  v_no integer;
  v_name text;
  v_row public.safety_round_photos;
begin
  if v_uid is null or not public.has_permission('safety.round.write') then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  if p_storage_path is null
     or p_storage_path !~ ('^' || p_round_id::text || '/' || v_uid::text
                           || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$')
     or p_print_path is distinct from regexp_replace(p_storage_path, '\.jpg$', '.print.jpg') then
    raise exception 'invalid photo path' using errcode = '22023';
  end if;

  -- Låset: två foton i samma rond sparas ett i taget. Numret och taket prövas under låset.
  select r.status into v_status from public.safety_rounds r where r.id = p_round_id for update;
  if not found then
    raise exception 'round not found' using errcode = 'P0002';
  end if;
  if v_status <> 'draft' then
    raise exception 'round is completed' using errcode = '55000';
  end if;

  if exists (select 1 from public.safety_round_photos p where p.storage_path = p_storage_path) then
    raise exception 'photo already registered' using errcode = '23505';
  end if;

  if (select count(*) from public.safety_round_photos p where p.round_id = p_round_id) >= 30 then
    raise exception 'photo limit reached' using errcode = '54000';
  end if;

  update public.safety_rounds set last_photo_no = last_photo_no + 1
  where id = p_round_id
  returning last_photo_no into v_no;

  select nullif(btrim(pr.full_name), '') into v_name from public.profiles pr where pr.id = v_uid;

  insert into public.safety_round_photos (
    round_id, item_id, photo_no, storage_path, print_path, size_bytes, print_size_bytes, created_by, created_by_name
  ) values (
    p_round_id, p_item_id, v_no, p_storage_path, p_print_path, p_size_bytes, p_print_size_bytes, v_uid, coalesce(v_name, 'Okänd')
  )
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.add_safety_round_photo(uuid, uuid, text, text, integer, integer) from public, anon;
grant execute on function public.add_safety_round_photo(uuid, uuid, text, text, integer, integer) to authenticated;

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
-- 3. Exakt SELECT och DELETE för authenticated (ingen INSERT — bara funktionen sparar), ingenting
--    för anon:
--
--      select grantee, string_agg(privilege_type, ', ' order by privilege_type)
--      from information_schema.role_table_grants
--      where table_schema = 'public' and table_name = 'safety_round_photos'
--        and grantee in ('anon', 'authenticated')
--      group by grantee;
--
-- 4. Två policyer (select, delete) och RLS på:
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
--
-- 6. Räknaren finns och står på 0 på alla befintliga ronder:
--
--      select count(*) filter (where last_photo_no <> 0) from public.safety_rounds;   -- förväntat 0
