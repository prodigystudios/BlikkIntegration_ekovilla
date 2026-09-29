-- Dokumenten till butiken på ett jobb från återförsäljarportalen: orderbekräftelsen och egenkontrollen (job.document).
--
-- BAKGRUND
-- RESELLER_PORTAL_CRM_PLAN.md, fas 7 (kontraktets job.document). PDF:en skickas som base64 i kroppen, högst 3 300 000
-- byte före base64 (portalens MAX_JOB_DOCUMENT_BYTES), och ett nytt dokument av samma sort ersätter det gamla hos
-- butiken. Besluten (William 2026-09-28):
--   - Orderbekräftelsen i vår egen design skickas AUTOMATISKT en gång, när job.confirmed är levererad. Sedan skickar
--     den som har ordern, eller en admin, en ny med knappen i kortet "Butiken".
--   - Egenkontrollen skickas med knappen, av samma personer.
--   - Ett avbrutet eller borttaget jobb får inga dokument.
--
-- VARFÖR EN EGEN TABELL OCH EN EGEN BUCKET
-- En PDF renderas olika varje gång (pdf-lib stämplar tiden i filen), och portalens idempotens nekar samma nyckel med
-- andra byte (422). PDF:en FRYSES därför en gång, i bucketen portal-job-documents under <quoteId>/<id>.pdf, och kön bär
-- bara en referens med hashen. Utskicket hämtar filen och kontrollerar hashen vid varje försök, så att samma nyckel
-- alltid ger samma byte. Kön (portal_outbound_events) hade annars burit upp mot 4,4 MB per rad, och claim-funktionen
-- lämnat ut hela raden för tjugo händelser åt gången.
--
--   status         building = beslutat, filen fryses (ett lån: next_attempt_at), ready = fryst och klar att köas,
--                  failed = gick inte (error säger varför, t.ex. för stor). En köad rad ändras aldrig mer; en fryst som
--                  inte hunnit köas blir failed om jobbet avbryts under tiden (inga dokument efter avbrottet).
--   name           filnamnet butiken ser: "Orderbekräftelse <Fortnox-nr> – <arbetsplats>.pdf".
--   byte_size, sha256  den frysta filen. Utskicket skickar bara byte med just den hashen.
--   source_ref     varifrån: Fortnox ordernummer, eller egenkontrollens sökväg i arkivet.
--   attempts, next_attempt_at  lånet och omförsöken för den automatiska orderbekräftelsen (Fortnox nere).
--   created_by     den som tryckte, eller null för den automatiska. created_by_name är namnet då: profiles är bara
--                  självläsbar. Ingen FK mot profiles, som meddelandena.
--   ready_at       när filen frystes; händelsens occurredAt.
--   queued_at      köad. En fryst fil som inte hann köas (processen dog emellan) köas av cron.
--   outbound_key   Idempotency-Key i kön: job.document-<id> (samma form som job.message-<id>, kontraktspunkt 24).
--
-- ÅTKOMST (William 2026-09-28)
--   läsa     alla som ser arbetsordern kontorsvägen: crm.workorder.read, eller ansvarig för ordern. Samma som
--            meddelandena. Hash, källa och omförsöken är bara service-rollens.
--   skicka   den som har ordern, eller en admin, med crm.workorder.write: svarsregeln crm_portal_job_message_can_reply()
--            (fas 6), samma personer som svarar butiken. Sessionen lägger bara till beslutet (building) i eget namn;
--            filen, hashen och kön sköter service-rollen. Ändra eller ta bort kan sessionen aldrig.
--   bucketen bara service-rollen: inga policyer på storage.objects för den. Kortets "Öppna" går genom en route.
-- Default privileges är stängda sedan 20260926134651; varje grant står här.
--
-- Additiv: en ny tabell och en ny bucket, inget befintligt ändras. Kan gå till prod före koden. Idempotent.
-- Låset: FK:n tar crm_portal_jobs i share row exclusive (fas 4b:s trigger skriver där vid varje planeringsändring på en
-- portalorder), en kort stund medan den nya, tomma tabellen skapas. lock_timeout (William 2026-09-28): får migreringen
-- inte låset inom 5 s ger den upp och rullar tillbaka, i stället för att köa planeringens skrivningar bakom sig. Kör om
-- den då.

set lock_timeout = '5s';

create table if not exists public.crm_portal_job_documents (
  id uuid primary key default gen_random_uuid(),
  quote_id text not null,
  kind text not null,
  status text not null default 'building',
  name text,
  byte_size integer,
  sha256 text,
  source_ref text,
  error text,
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  created_by uuid,
  created_by_name text,
  created_at timestamptz not null default now(),
  ready_at timestamptz,
  queued_at timestamptz,
  outbound_key text generated always as ('job.document-' || id::text) stored
);

alter table public.crm_portal_job_documents drop constraint if exists crm_portal_job_documents_kind_check;
alter table public.crm_portal_job_documents
  add constraint crm_portal_job_documents_kind_check check (kind in ('order_confirmation', 'self_inspection'));

alter table public.crm_portal_job_documents drop constraint if exists crm_portal_job_documents_status_check;
alter table public.crm_portal_job_documents
  add constraint crm_portal_job_documents_status_check check (status in ('building', 'ready', 'failed'));

-- Portalens gräns för namnet är 200 tecken; ett namn av bara blanksteg är tomt.
alter table public.crm_portal_job_documents drop constraint if exists crm_portal_job_documents_name_check;
alter table public.crm_portal_job_documents
  add constraint crm_portal_job_documents_name_check
  check (name is null or (char_length(name) between 1 and 200 and name ~ '\S'));

-- Portalens gräns: högst 3 300 000 byte före base64. "%PDF-" är fem byte, så en PDF har minst sex.
alter table public.crm_portal_job_documents drop constraint if exists crm_portal_job_documents_byte_size_check;
alter table public.crm_portal_job_documents
  add constraint crm_portal_job_documents_byte_size_check check (byte_size is null or byte_size between 6 and 3300000);

alter table public.crm_portal_job_documents drop constraint if exists crm_portal_job_documents_sha256_check;
alter table public.crm_portal_job_documents
  add constraint crm_portal_job_documents_sha256_check check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$');

alter table public.crm_portal_job_documents drop constraint if exists crm_portal_job_documents_text_lengths_check;
alter table public.crm_portal_job_documents
  add constraint crm_portal_job_documents_text_lengths_check check (
    (source_ref is null or char_length(source_ref) between 1 and 500)
    and (error is null or char_length(error) between 1 and 2000)
    and (created_by_name is null or (char_length(created_by_name) between 1 and 200 and created_by_name ~ '\S'))
    and attempts >= 0
  );

-- Vad varje läge bär. En fryst fil har allt som händelsen behöver, bara en fryst fil kan köas, och en köad rad kan inte
-- bli misslyckad (den är redan på väg till butiken).
alter table public.crm_portal_job_documents drop constraint if exists crm_portal_job_documents_status_fields_check;
alter table public.crm_portal_job_documents
  add constraint crm_portal_job_documents_status_fields_check check (
    (status = 'building' and byte_size is null and sha256 is null and ready_at is null and queued_at is null
       and error is null)
    or (status = 'ready' and name is not null and byte_size is not null and sha256 is not null and source_ref is not null
       and ready_at is not null and error is null)
    or (status = 'failed' and error is not null and queued_at is null)
  );

-- Den som tryckte har ett namn; den automatiska har ingen. Bara orderbekräftelsen skickas automatiskt.
alter table public.crm_portal_job_documents drop constraint if exists crm_portal_job_documents_created_by_check;
alter table public.crm_portal_job_documents
  add constraint crm_portal_job_documents_created_by_check check (
    (created_by is null) = (created_by_name is null)
    and (created_by is not null or kind = 'order_confirmation')
  );

-- Jobben tas aldrig bort; ett dokument hör alltid till ett mottaget jobb.
alter table public.crm_portal_job_documents drop constraint if exists crm_portal_job_documents_quote_id_fkey;
alter table public.crm_portal_job_documents
  add constraint crm_portal_job_documents_quote_id_fkey
  foreign key (quote_id) references public.crm_portal_jobs(quote_id);

-- En automatisk orderbekräftelse per jobb, också när två cron-varv överlappar.
create unique index if not exists crm_portal_job_documents_one_automatic_idx
  on public.crm_portal_job_documents (quote_id) where created_by is null;
-- Kortet visar den senaste per sort.
create index if not exists crm_portal_job_documents_quote_kind_idx
  on public.crm_portal_job_documents (quote_id, kind, created_at);
-- Cron letar efter beslut som inte blivit en fil, och filer som inte köats.
create index if not exists crm_portal_job_documents_building_idx
  on public.crm_portal_job_documents (next_attempt_at) where status = 'building';
create index if not exists crm_portal_job_documents_unqueued_idx
  on public.crm_portal_job_documents (ready_at) where status = 'ready' and queued_at is null;

alter table public.crm_portal_job_documents enable row level security;
revoke all on table public.crm_portal_job_documents from anon, authenticated;
-- Kolumngranterna EFTER revoke all, annars tar revoken bort dem.
grant select (id, quote_id, kind, status, name, byte_size, error, created_by, created_by_name, created_at, ready_at,
              outbound_key)
  on table public.crm_portal_job_documents to authenticated;
grant insert (id, quote_id, kind, created_by, created_by_name)
  on table public.crm_portal_job_documents to authenticated;
grant select, insert, update, delete on table public.crm_portal_job_documents to service_role;

drop policy if exists crm_portal_job_documents_select on public.crm_portal_job_documents;
create policy crm_portal_job_documents_select on public.crm_portal_job_documents
  for select to authenticated
  using (
    (select has_permission('crm.workorder.read'))
    or exists (
      select 1
        from public.crm_portal_jobs j
        join public.crm_work_orders w on w.id = j.work_order_id
       where j.quote_id = crm_portal_job_documents.quote_id
         and w.assigned_to = (select auth.uid())
    )
  );

drop policy if exists crm_portal_job_documents_insert_send on public.crm_portal_job_documents;
create policy crm_portal_job_documents_insert_send on public.crm_portal_job_documents
  for insert to authenticated
  with check (
    status = 'building'
    and created_by = (select auth.uid())
    and public.crm_portal_job_message_can_reply(quote_id)
  );

-- Bucketen: privat, bara PDF, högst portalens gräns. Bucketens gräns är det andra låset; koden nekar först.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('portal-job-documents', 'portal-job-documents', false, 3300000, array['application/pdf'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ------------------------------------------------------------------------------------------------ efterkontroll

-- Pröva effekten: RLS på; anon ingenting; sessionen läser de uppräknade kolumnerna, lägger bara till ett beslut och kan
-- aldrig ändra eller ta bort; service_role allt; policyerna finns med rätt kommando; kön har ingen ny; nyckeln härleds;
-- bucketen är privat med rätt gräns, och ingen policy på storage.objects släpper någon till den.
-- (has_table_privilege med en kommalista svarar på om NÅGON av rättigheterna finns.)
do $$
declare
  tbl constant text := 'public.crm_portal_job_documents';
  col text;
  priv text;
  bucket record;
begin
  if not (select c.relrowsecurity from pg_class c where c.oid = tbl::regclass) then
    raise exception 'portalens dokument: RLS är inte på';
  end if;
  if has_table_privilege('anon', tbl, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') then
    raise exception 'portalens dokument: anon har rättigheter på tabellen';
  end if;
  if has_any_column_privilege('anon', tbl, 'SELECT,INSERT,UPDATE,REFERENCES') then
    raise exception 'portalens dokument: anon har rättigheter på en kolumn';
  end if;
  if has_table_privilege('authenticated', tbl, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') then
    raise exception 'portalens dokument: authenticated har rättigheter på tabellnivå';
  end if;
  if has_any_column_privilege('authenticated', tbl, 'UPDATE,REFERENCES') then
    raise exception 'portalens dokument: authenticated kan ändra en kolumn';
  end if;
  foreach col in array array['id', 'quote_id', 'kind', 'status', 'name', 'byte_size', 'error', 'created_by',
                             'created_by_name', 'created_at', 'ready_at', 'outbound_key'] loop
    if not has_column_privilege('authenticated', tbl, col, 'SELECT') then
      raise exception 'portalens dokument: authenticated kan inte läsa %', col;
    end if;
  end loop;
  foreach col in array array['sha256', 'source_ref', 'attempts', 'next_attempt_at', 'queued_at'] loop
    if has_column_privilege('authenticated', tbl, col, 'SELECT') then
      raise exception 'portalens dokument: authenticated kan läsa %', col;
    end if;
  end loop;
  foreach col in array array['id', 'quote_id', 'kind', 'created_by', 'created_by_name'] loop
    if not has_column_privilege('authenticated', tbl, col, 'INSERT') then
      raise exception 'portalens dokument: authenticated kan inte skriva %', col;
    end if;
  end loop;
  foreach col in array array['status', 'name', 'byte_size', 'sha256', 'source_ref', 'error', 'attempts',
                             'next_attempt_at', 'created_at', 'ready_at', 'queued_at'] loop
    if has_column_privilege('authenticated', tbl, col, 'INSERT') then
      raise exception 'portalens dokument: authenticated kan skriva %', col;
    end if;
  end loop;
  foreach priv in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] loop
    if not has_table_privilege('service_role', tbl, priv) then
      raise exception 'portalens dokument: service_role saknar % på tabellen', priv;
    end if;
  end loop;

  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'crm_portal_job_documents') <> 2 then
    raise exception 'portalens dokument: tabellen ska ha exakt två policyer';
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'crm_portal_job_documents'
                   and policyname = 'crm_portal_job_documents_select' and cmd = 'SELECT' and roles = '{authenticated}') then
    raise exception 'portalens dokument: läspolicyn saknas';
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'crm_portal_job_documents'
                   and policyname = 'crm_portal_job_documents_insert_send' and cmd = 'INSERT' and roles = '{authenticated}'
                   and with_check like '%crm_portal_job_message_can_reply%') then
    raise exception 'portalens dokument: policyn för att skicka saknas, eller frågar inte svarsregeln';
  end if;
  -- Kön öppnas inte för fler: bara 2b:s policy (crm.portal.manage) läser den.
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'portal_outbound_events'
               and policyname <> 'portal_outbound_events_select_portal') then
    raise exception 'portalens dokument: kön har en policy till';
  end if;

  if (select pg_get_expr(d.adbin, d.adrelid)
        from pg_attrdef d
        join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
       where d.adrelid = tbl::regclass and a.attname = 'outbound_key') not like '%job.document-%' then
    raise exception 'portalens dokument: outbound_key härleds inte ur id';
  end if;

  select b.public, b.file_size_limit, b.allowed_mime_types into bucket
    from storage.buckets b where b.id = 'portal-job-documents';
  if not found then
    raise exception 'portalens dokument: bucketen saknas';
  end if;
  if bucket.public is distinct from false then
    raise exception 'portalens dokument: bucketen är publik';
  end if;
  if bucket.file_size_limit is distinct from 3300000 or bucket.allowed_mime_types is distinct from array['application/pdf'] then
    raise exception 'portalens dokument: bucketen har fel gräns eller filtyp';
  end if;
  -- En policy på storage.objects som inte nämner bucket_id gäller varje bucket, också den här. En som nämner den här
  -- bucketen öppnar den. Båda nekas: filerna läses bara av service-rollen.
  if exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
               and (coalesce(qual, '') || coalesce(with_check, '')) not like '%bucket_id%') then
    raise exception 'portalens dokument: en policy på storage.objects gäller alla buckets';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
               and (coalesce(qual, '') || coalesce(with_check, '')) like '%portal-job-documents%') then
    raise exception 'portalens dokument: en policy på storage.objects släpper någon till bucketen';
  end if;
end $$;

reset lock_timeout;
