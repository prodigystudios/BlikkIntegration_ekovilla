-- Filer på arbetsordern — ritningar, förberedelser, foto före/efter.
--
-- VARFÖR: installatörerna ska kunna förbereda dagen ur ordern i stället för ur en tråd i mobilen.
-- Både kontoret och besättningen laddar upp; interna filer är dolda för fält.
--
-- VARFÖR INGEN NY BUCKET, INGA STORAGE-POLICYER: samma linje som Support och Dokument. Den
-- befintliga privata bucketen används med prefix per område (Documents/, Egenkontroller/,
-- Support/, nu Arbetsorder/). All läsning sker via en kortlivad signerad URL som servern skapar
-- med service-role EFTER att policyerna nedan gatat raden. Bucketnamnet sparas PER RAD, så en
-- framtida bucketflytt inte gör gamla rader olästbara.
--
-- VARFÖR created_by_name: `profiles` är self-read-only (profiles_select_self i
-- auth_roles_setup.sql:71 är enda SELECT-policyn), så en PostgREST-join `uploader:profiles(...)`
-- ger null för alla utom en själv — det är redan skälet till att listMentionableProfiles går via
-- admin-klienten. Namnet snapshottas på raden, precis som app_tickets.reporter_name och
-- fault_reports.reporter_name, med samma motivering.
--
-- DEPLOY-ORDNING: KÖR DEN HÄR FILEN FÖRE KODEN. Ändringen är helt additiv (ny tabell, inga
-- ändringar på befintliga objekt), men utan tabellen myntar upload-url-routen en signerad URL,
-- klienten laddar upp bytes över mobilnätet, och bekräftelsen dör på "relation does not exist" —
-- fail-closed men fult, och användaren har redan betalat för uppladdningen.
--
-- Kör i Supabase SQL editor. Idempotent (kör den två gånger innan du litar på påståendet).

-- ---------------------------------------------------------------------------
-- Tabell
-- ---------------------------------------------------------------------------

create table if not exists public.crm_work_order_files (
  id              uuid primary key default gen_random_uuid(),
  work_order_id   uuid not null references public.crm_work_orders(id) on delete cascade,

  -- text + CHECK, inte enum och inte uppslagstabell: samma stil som crm_work_orders.status,
  -- crm_customers.status och app_tickets.area. Enum går inte att utöka idempotent (`alter type
  -- ... add value` kan inte köras om), och fem fasta värden är ingen datamängd att förvalta i en
  -- egen tabell. Svenska etiketter bor i lib/domains/crm/workOrderFiles/types.ts; databasen håller
  -- stabila engelska nycklar.
  category        text not null default 'other',

  -- Intern = dold för fält. `not null default false` är inte kosmetik: en nullbar kolumn hade
  -- gjort `is_internal = false` i SELECT-policyn nedan FALSK för NULL, och varje rad utan
  -- uttryckligt värde hade blivit osynlig för hela besättningen — ett tyst, totalt bortfall.
  is_internal     boolean not null default false,

  file_name       text not null,
  storage_bucket  text not null,
  storage_path    text not null,
  content_type    text,
  size_bytes      bigint,

  -- on delete set null: en avslutad anställd ska inte hindra radering av profilen, och filen
  -- (ritningen) ska överleva. created_by_name bär visningen vidare, se huvudet.
  created_by      uuid references public.profiles(id) on delete set null,
  created_by_name text not null,
  created_at      timestamptz not null default now(),

  constraint crm_work_order_files_category_chk
    check (category in ('drawing', 'preparation', 'photo_before', 'photo_after', 'other'))
);

-- MEDVETET INGET UNIKT INDEX PÅ (work_order_id, lower(file_name)) — till skillnad från
-- documents_files. Två foton från samma telefon heter ofta IMG_0001.HEIC, och att andra bilden
-- avvisas som dubblett är fel svar på ett jobb där hela poängen är att dokumentera.

-- Listfrågan: where work_order_id = $1 order by created_at desc.
create index if not exists crm_work_order_files_work_order_idx
  on public.crm_work_order_files (work_order_id, created_at desc);

-- Stöder policy-predikatet created_by = auth.uid() (SELECT + DELETE).
create index if not exists crm_work_order_files_created_by_idx
  on public.crm_work_order_files (created_by);

-- ⚠️ SÄKERHETSSPÄRR, inte en datastädning. Ett lagringsobjekt får bäras av exakt EN rad.
--
-- Bekräftelsesteget (POST /files) städar bort objektet när raden inte kan skrivas. Sökvägen till en
-- bild går att läsa ut ur den signerade URL:en som listan skickar till klienten, så en klient kan
-- spela tillbaka en sökväg som redan tillhör någon annan. Utan det här indexet skulle en andra rad
-- kunna registrera samma objekt — och när den raden tas bort försvinner byten under den första
-- radens fötter, som då blir ett trasigt kort i listan.
-- Routen kontrollerar samma sak i förväg och svarar 409; indexet är spärren som håller även om
-- kontrollen någon gång tas bort.
create unique index if not exists crm_work_order_files_storage_path_key
  on public.crm_work_order_files (storage_path);

alter table public.crm_work_order_files enable row level security;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
-- En radpolicy gör INGENTING utan tabellprivilegiet: PostgreSQL nekar satsen innan RLS ens
-- utvärderas. Repot har blivit bitet av precis det en gång
-- (20260629_crm_work_order_comments_update_grant.sql — varje kommentarsredigering gav 500 i drift).
--
-- INGEN UPDATE, med flit — och därför inte heller någon UPDATE-policy. Att i efterhand ändra
-- kategori eller kryssa i "intern" ingår inte i den här omgången, och ett grant utan policy är
-- lika fel som en policy utan grant. Vill man ha det senare är det en egen liten fil med BÅDA:
--   grant update on public.crm_work_order_files to authenticated;
--   create policy crm_wo_files_update on public.crm_work_order_files for update to authenticated
--     using (public.has_permission('crm.workorder.write'))
--     with check (public.has_permission('crm.workorder.write'));
grant select, insert, delete on public.crm_work_order_files to authenticated;

-- ---------------------------------------------------------------------------
-- Policyer
-- ---------------------------------------------------------------------------
-- Grenordning: billigast först (samma princip som 20260811_time_entries_rls.sql:54-77).
-- Kolumnjämförelse → has_permission (ett svar per fråga) → is_user_on_work_order (slår i
-- ops_segments/ops_*_crew och kan utvärderas per rad). Inuti besättningsgrenen står
-- `is_internal = false` FÖRE funktionen, så en intern rad aldrig kostar ett funktionsanrop.
--
-- INGEN assigned_to-gren, till skillnad från crm_work_orders_select_visible. crm_work_orders.assigned_to
-- pekar på ansvarig kontorsanvändare, och de bär alla crm.workorder.read — grenen hade varit död
-- vikt som besättningen betalar för på varje rad. Kontrollera antagandet en gång, se verifiering 6.
--
-- Hjälpfunktionen public.is_user_on_work_order(uuid, uuid) finns sedan
-- 20260810_crm_work_order_crew_access.sql och definieras INTE om här.

drop policy if exists crm_wo_files_select on public.crm_work_order_files;
create policy crm_wo_files_select
  on public.crm_work_order_files
  for select
  to authenticated
  using (
    created_by = auth.uid()
    or public.has_permission('crm.workorder.read')
    or (is_internal = false and public.is_user_on_work_order(auth.uid(), work_order_id))
  );

-- INSERT: alltid som sig själv. Kontoret behöver crm.workorder.WRITE — konsult är läsbehörig i
-- hela CRM (crm.workorder.read men inte .write, se 20260608_permissions_model.sql:263) och ska
-- inte kunna ladda upp. Besättningen får ladda upp på sitt eget jobb men ALDRIG internt: det
-- villkoret sitter här och inte bara i routen, så en handskriven POST inte kan gömma en fil för
-- sina kollegor.
drop policy if exists crm_wo_files_insert on public.crm_work_order_files;
create policy crm_wo_files_insert
  on public.crm_work_order_files
  for insert
  to authenticated
  with check (
    created_by = auth.uid()
    and (
      public.has_permission('crm.workorder.write')
      or (is_internal = false and public.is_user_on_work_order(auth.uid(), work_order_id))
    )
  );

-- DELETE: var och en raderar sitt eget, kontoret raderar allt på ordern. Installatören kan alltså
-- ångra en felvänd bild men inte råka ta bort kontorets ritning.
-- `write` och inte `read` — annars hade konsult kunnat radera andras filer.
drop policy if exists crm_wo_files_delete on public.crm_work_order_files;
create policy crm_wo_files_delete
  on public.crm_work_order_files
  for delete
  to authenticated
  using (
    created_by = auth.uid()
    or public.has_permission('crm.workorder.write')
  );

-- ── Verifiering (kör efter applicering) ──────────────────────────────────────
--
-- 1. Tre policyer, RLS på, och INGEN update-policy (den ska saknas i den här omgången):
--
--      select policyname, cmd from pg_policies
--      where schemaname = 'public' and tablename = 'crm_work_order_files'
--      order by cmd, policyname;
--
--      select relrowsecurity from pg_class where oid = 'public.crm_work_order_files'::regclass;
--
-- 2. Grants ska vara exakt SELECT/INSERT/DELETE för authenticated — inget UPDATE:
--
--      select privilege_type from information_schema.role_table_grants
--      where table_schema = 'public' and table_name = 'crm_work_order_files'
--        and grantee = 'authenticated'
--      order by 1;
--
-- 3. CHECK:en ska neka en okänd kategori (förväntat: fel om crm_work_order_files_category_chk):
--
--      insert into public.crm_work_order_files
--        (work_order_id, category, file_name, storage_bucket, storage_path, created_by_name)
--      values ('<work_order_id>', 'sketch', 'x.pdf', 'pdfs', 'Arbetsorder/x', 'Test');
--
-- 4. Hjälpfunktionen som besättningsgrenen vilar på ska svara. true för besättningen på jobbet,
--    false för alla andra (samma punktprov som 20260810_crm_work_order_crew_access.sql):
--
--      select p.full_name, public.is_user_on_work_order(p.id, '<work_order_id>') as pa_jobbet
--      from public.profiles p
--      order by pa_jobbet desc, p.full_name;
--
-- 5. Intern fil ska vara osynlig för besättningen. Lägg upp en rad med is_internal = true som
--    kontoret, impersonera sedan installatören enligt metoden i
--    20260811_crm_work_order_rls_perf_probe.sql — rollbytet, frågan och avläsningen MÅSTE ligga i
--    EN sats — och räkna raderna:
--
--      select count(*) from public.crm_work_order_files where work_order_id = '<work_order_id>';
--
--    Kontoret ska se N, besättningen N minus de interna.
--
-- 6. Antagandet bakom att assigned_to-grenen utelämnats. Ska vara 0:
--
--      select count(*) from public.crm_work_orders w
--      join public.profiles p on p.id = w.assigned_to
--      where p.role = 'member';
