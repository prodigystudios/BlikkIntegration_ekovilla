-- Paritetskontroll: det `supabase db diff` inte visar, eller inte visar tillförlitligt.
--
-- Körs mot två databaser och utskrifterna jämförs med diff:
--   psql "$PROD_DB_URL" -X -A -f supabase/checks/parity.sql > /tmp/parity-prod.txt
--   (lokalt) docker exec -i supabase_db_BlikkIntegration_ekovilla psql -U postgres -X -A -f - \
--     < supabase/checks/parity.sql > /tmp/parity-local.txt
--   diff /tmp/parity-prod.txt /tmp/parity-local.txt
--
-- Allt körs i en läs-transaktion som rullas tillbaka: en felskriven fråga kan inte skriva något.
-- Behörigheter jämförs rad för rad (aclexplode), inte som aclitem-strängar — ordningen i en ACL
-- skiljer mellan databaser utan att betyda något.
--
-- Väntade skillnader mot prod (2026-09-25, efter baslinjen + 20260925083330_baseline_privileges):
--   - cron.job: prods 'scheduler_run-due-delivers' är medvetet borttaget ur baslinjen.
--   - storage.buckets: `pdfs` har ingen egen gräns i prod men CLI:ts 50 MiB lokalt.
--   - triggers: protect_bucket_control_* på storage.buckets finns bara i prod — plattformens, de
--     följer storage-api-versionen och finns inte i repots SQL.
-- Allt annat — realtime, behörigheter, RLS, policies, extensions — ska vara identiskt.

\set ON_ERROR_STOP on
begin transaction read only;

\echo '== realtime: tabeller i supabase_realtime'
select schemaname || '.' || tablename
  from pg_publication_tables
 where pubname = 'supabase_realtime'
 order by 1;

\echo '== public: tabellbehörigheter för anon/authenticated'
select c.relname,
       pg_get_userbyid(a.grantee) as grantee,
       string_agg(a.privilege_type, ',' order by a.privilege_type) as privileges
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
 where n.nspname = 'public'
   and c.relkind in ('r', 'p', 'v', 'm')
   and a.grantee <> 0
   and pg_get_userbyid(a.grantee) in ('anon', 'authenticated')
 group by 1, 2
 order by 1, 2;

\echo '== public: funktionsbehörigheter för PUBLIC/anon/authenticated'
select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as fn,
       case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end as grantee
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
 where n.nspname = 'public'
   and (a.grantee = 0 or pg_get_userbyid(a.grantee) in ('anon', 'authenticated'))
 order by 1, 2;

\echo '== public: RLS per tabell'
select c.relname, c.relrowsecurity, c.relforcerowsecurity
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind in ('r', 'p')
 order by 1;

\echo '== policies i public och storage'
select schemaname, tablename, policyname, cmd, roles::text
  from pg_policies
 where schemaname in ('public', 'storage')
 order by 1, 2, 3;

\echo '== triggers på tabeller i auth och storage'
select c.relnamespace::regnamespace::text as schema, c.relname, t.tgname
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
 where not t.tgisinternal
   and c.relnamespace::regnamespace::text in ('auth', 'storage')
 order by 1, 2, 3;

\echo '== extensions'
select extname, extnamespace::regnamespace::text as schema
  from pg_extension
 order by 1;

\echo '== storage.buckets (rader, skapas per miljö)'
select id, public, file_size_limit, allowed_mime_types
  from storage.buckets
 order by id;

\echo '== cron.job (rader; prods jobb är medvetet inte i baslinjen)'
select jobname, schedule, active
  from cron.job
 order by 1;

rollback;
