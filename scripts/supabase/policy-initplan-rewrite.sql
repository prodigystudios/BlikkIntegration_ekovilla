-- Genererar en migrering som låter RLS-policyer anropa auth.*() och has_permission() EN gång per fråga i stället
-- för en gång per rad.
--
-- Varför: has_permission är SQL + SECURITY DEFINER + SET search_path och kan därför aldrig byggas in i frågan. Skriven
-- rakt i en policy körs den för varje rad (tre egna uppslag per anrop). Inslagen i en skalär delfråga,
-- `(select has_permission('x'))`, blir den en InitPlan som körs en gång. Samma sak för auth.uid() — det är vad Supabase
-- advisors auth_rls_initplan pekar på. Mätt 2026-09-26: crm_customers i prods storlek 20 ms -> 0,3 ms per helläsning.
--
-- Omskrivningen är rent textuell på pg_policies (pg_get_expr) och rör BARA anrop med fasta argument:
--   auth.<fn>()                 -> (select auth.<fn>())
--   has_permission('x'::text)   -> (select has_permission('x'::text))
-- Anrop med kolumnargument (is_user_on_work_order(auth.uid(), id), is_time_locked(user_id, work_date)) står kvar; bara
-- ett auth.uid() INUTI dem skrivs om. Roller, kommando och PERMISSIVE/RESTRICTIVE rörs inte (alter policy).
-- Policyer som redan är helt inslagna hoppas över; delvis inslagna tas med och blir helt inslagna.
--
-- Utskriften är migreringens kropp:
--   1. en temp-tabell med varje policys ORIGINAL (md5, med all inslagning borttagen) och en temp-funktion som tar bort
--      inslagningen,
--   2. förkontroll — varje policy måste finnas och, med inslagningen borttagen, vara exakt originalet. En policy i
--      prod som skiljer sig från den lokala skrivs aldrig över; pushen avbryts,
--   3. alter policy för varje berörd policy,
--   4. efterkontroll — samma md5 efter borttagen inslagning (bevisar att bara inslagningen ändrats) och inga
--      oinslagna anrop kvar på de berörda tabellerna.
-- Förkontrollen godtar både originalet och det redan omskrivna, så migreringen kan köras om. search_path sätts
-- uttryckligen, eftersom pg_get_expr skriver ut schemanamn för allt som inte syns i sökvägen.
--
-- Körs mot den LOKALA databasen (som ska vara i paritet med prod, se supabase/checks/parity.sql). -q är nödvändigt:
-- utan det skriver psql BEGIN/CREATE … in i migreringen. CRM-migreringen genererades så här:
--   docker exec -i supabase_db_BlikkIntegration_ekovilla psql -U postgres -X -q -At \
--     -v tables='^(crm_|fortnox_|korjournal_)' \
--     -f - < scripts/supabase/policy-initplan-rewrite.sql >> supabase/migrations/<ny migrering>.sql
-- `tables` är en regex mot tabellnamnet i public. Skriv migreringens rubrikkommentar för hand ovanför.

\set ON_ERROR_STOP on
-- Vanlig transaktion (temp-objekten kräver det) som alltid rullas tillbaka: generatorn ändrar ingenting.
begin;
set local search_path = public, extensions;

-- Samma definition skrivs in i migreringen (se nedan) — ändra båda tillsammans.
create function pg_temp.unwrap(e text) returns text language sql immutable as $f$
  select regexp_replace(regexp_replace(e,
           '\( SELECT (auth\.([a-z_]+)\(\)) AS \2\)', '\1', 'g'),
           '\( SELECT (has_permission\(''[a-z0-9._]+''::text\)) AS has_permission\)', '\1', 'g')
$f$;
create function pg_temp.wrap(e text) returns text language sql immutable as $f$
  select regexp_replace(regexp_replace(pg_temp.unwrap(e),
           '(^|[^.a-z0-9_])(auth\.[a-z_]+\(\))', '\1(select \2)', 'g'),
           '(^|[^.a-z0-9_])(has_permission\(''[a-z0-9._]+''::text\))', '\1(select \2)', 'g')
$f$;
-- Antal oinslagna anrop: alla anrop minus de inslagna.
create function pg_temp.bare(e text) returns int language sql immutable as $f$
  select coalesce((select count(*) from regexp_matches(e, '(^|[^.a-z0-9_])(auth\.[a-z_]+\(\)|has_permission\()', 'g'))
                - (select count(*) from regexp_matches(e, '\( SELECT (auth\.[a-z_]+\(\)|has_permission\()', 'g')), 0)::int
$f$;

create temp view __targets as
  select tablename, policyname, qual, with_check
    from pg_policies
   where schemaname = 'public'
     and tablename ~ :'tables'
     and pg_temp.bare(coalesce(qual, '') || ' ' || coalesce(with_check, '')) > 0
   order by tablename, policyname;

select count(*) = 0 as none from __targets \gset
\if :none
  \echo '-- (inga oinslagna policyer på tabellerna — ingenting att skriva om)'
  rollback;
  \quit
\endif

-- 1. Originalen och borttagningen av inslagningen
select concat_ws(E'\n',
  '-- pg_get_expr skriver ut schemanamn för allt som inte syns i sökvägen; kontrollerna nedan förutsätter den här.',
  'set local search_path = public, extensions;',
  '',
  '-- Varje policys original (md5 av texten med all inslagning borttagen), som för- och efterkontrollen jämför mot.',
  'create temp table __initplan_expected (tbl text, pol text, md5_q text, md5_c text);',
  'insert into __initplan_expected values',
  string_agg(format('  (%L, %L, %L, %L)', tablename, policyname, md5(pg_temp.unwrap(qual)), md5(pg_temp.unwrap(with_check))), E',\n')
    || ';',
  '',
  'create function pg_temp.__initplan_unwrap(e text) returns text language sql immutable as $f$',
  '  select regexp_replace(regexp_replace(e,',
  '           ''\( SELECT (auth\.([a-z_]+)\(\)) AS \2\)'', ''\1'', ''g''),',
  '           ''\( SELECT (has_permission\(''''[a-z0-9._]+''''::text\)) AS has_permission\)'', ''\1'', ''g'')',
  '$f$;',
  '',
  '-- Förkontroll: policyerna ska vara exakt de som omskrivningen utgår från (med ev. inslagning borttagen).',
  'do $pre$',
  'declare',
  '  r record;',
  'begin',
  '  perform set_config(''search_path'', ''public, extensions'', true);',
  '  for r in select e.*, p.policyname as found, p.qual, p.with_check',
  '             from __initplan_expected e',
  '             left join pg_policies p on p.schemaname = ''public'' and p.tablename = e.tbl and p.policyname = e.pol loop',
  '    if r.found is null then',
  '      raise exception ''policy saknas: %.%'', r.tbl, r.pol;',
  '    end if;',
  '    if md5(pg_temp.__initplan_unwrap(r.qual)) is distinct from r.md5_q',
  '       or md5(pg_temp.__initplan_unwrap(r.with_check)) is distinct from r.md5_c then',
  '      raise exception ''policy %.% skiljer sig från den omskrivningen utgår från — skriver inte över'', r.tbl, r.pol;',
  '    end if;',
  '  end loop;',
  'end $pre$;',
  '')
  from __targets;

-- 2. Omskrivningen
select format('alter policy %I on public.%I', policyname, tablename)
    || case when qual is not null then E'\n  using (' || pg_temp.wrap(qual) || ')' else '' end
    || case when with_check is not null then E'\n  with check (' || pg_temp.wrap(with_check) || ')' else '' end
    || E';\n'
  from __targets;

-- 3. Efterkontroll
select concat_ws(E'\n',
  '-- Efterkontroll: med inslagningen borttagen är varje policy identisk med originalet, och inga oinslagna anrop',
  '-- finns kvar på de berörda tabellerna (alla anrop minus de inslagna ska vara noll).',
  'do $post$',
  'declare',
  '  r record;',
  '  bare int;',
  'begin',
  '  perform set_config(''search_path'', ''public, extensions'', true);',
  '  for r in select e.*, p.qual, p.with_check',
  '             from __initplan_expected e',
  '             join pg_policies p on p.schemaname = ''public'' and p.tablename = e.tbl and p.policyname = e.pol loop',
  '    if md5(pg_temp.__initplan_unwrap(r.qual)) is distinct from r.md5_q',
  '       or md5(pg_temp.__initplan_unwrap(r.with_check)) is distinct from r.md5_c then',
  '      raise exception ''policy %.% ändrades mer än inslagningen'', r.tbl, r.pol;',
  '    end if;',
  '  end loop;',
  '',
  '  select coalesce(sum(',
  '           (select count(*) from regexp_matches(x.e, ''(^|[^.a-z0-9_])(auth\.[a-z_]+\(\)|has_permission\()'', ''g''))',
  '         - (select count(*) from regexp_matches(x.e, ''\( SELECT (auth\.[a-z_]+\(\)|has_permission\()'', ''g''))',
  '         ), 0) into bare',
  '    from (select coalesce(p.qual, '''') || '' '' || coalesce(p.with_check, '''') as e',
  '            from pg_policies p',
  '           where p.schemaname = ''public'' and p.tablename in (select tbl from __initplan_expected)) x;',
  '  if bare <> 0 then',
  '    raise exception ''% oinslagna auth.*()/has_permission()-anrop kvar'', bare;',
  '  end if;',
  'end $post$;',
  '',
  'drop function pg_temp.__initplan_unwrap(text);',
  'drop table __initplan_expected;');

rollback;
