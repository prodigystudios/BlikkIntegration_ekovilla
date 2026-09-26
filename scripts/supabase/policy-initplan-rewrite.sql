-- Genererar en migrering som låter RLS-policyer anropa auth.uid() och has_permission() EN gång per fråga i stället
-- för en gång per rad.
--
-- Varför: has_permission är SQL + SECURITY DEFINER + SET search_path och kan därför aldrig byggas in i frågan. Skriven
-- rakt i en policy körs den för varje rad (tre egna uppslag per anrop). Inslagen i en skalär delfråga,
-- `(select has_permission('x'))`, blir den en InitPlan som körs en gång. Samma sak för auth.uid() — det är vad Supabase
-- advisors auth_rls_initplan pekar på. Mätt 2026-09-26: crm_customers i prods storlek 20 ms -> 0,3 ms per helläsning.
--
-- Omskrivningen är rent textuell på pg_policies (pg_get_expr) och rör BARA anrop med fasta argument:
--   auth.uid()                  -> (select auth.uid())
--   has_permission('x'::text)   -> (select has_permission('x'::text))
-- Anrop med kolumnargument (is_user_on_work_order(auth.uid(), id), is_time_locked(user_id, work_date)) står kvar; bara
-- ett auth.uid() INUTI dem skrivs om. Roller, kommando och PERMISSIVE/RESTRICTIVE rörs inte (alter policy).
--
-- Utskriften är migreringens kropp:
--   1. förkontroll — varje policy måste finnas och, med inslagningen borttagen, vara exakt den som omskrivningen utgår
--      från (md5). En policy i prod som skiljer sig från den lokala skrivs aldrig över; pushen avbryts.
--   2. alter policy för varje berörd policy.
--   3. efterkontroll — samma md5 efter borttagen inslagning (bevisar att bara inslagningen ändrats), och inga
--      oinslagna anrop kvar på de berörda tabellerna.
-- Förkontrollen godtar både originalet och det redan omskrivna, så migreringen kan köras om.
--
-- Körs mot den LOKALA databasen (som ska vara i paritet med prod, se supabase/checks/parity.sql):
--   docker exec -i supabase_db_BlikkIntegration_ekovilla psql -U postgres -X -q -At -v tables='^(crm_|fortnox_)' \
--     -f - < scripts/supabase/policy-initplan-rewrite.sql >> supabase/migrations/<ny migrering>.sql
-- `tables` är en regex mot tabellnamnet i public. Skriv migreringens rubrikkommentar för hand ovanför.
-- -q är nödvändigt: utan det skriver psql BEGIN/CREATE VIEW/ROLLBACK in i migreringen.

\set ON_ERROR_STOP on
-- Vanlig transaktion (temp-vyn kräver det) som alltid rullas tillbaka: generatorn ändrar ingenting.
begin;

create temp view __targets as
  select tablename, policyname, qual, with_check
    from pg_policies
   where schemaname = 'public'
     and tablename ~ :'tables'
     and (coalesce(qual, '') || coalesce(with_check, '')) ~ '(auth\.uid\(\)|has_permission\()'
   order by tablename, policyname;

-- 1. Förkontroll
select concat_ws(E'\n',
  '-- Förkontroll: policyerna ska vara exakt de som omskrivningen utgår från (med ev. inslagning borttagen).',
  'do $pre$',
  'declare',
  '  r record;',
  '  cur_q text;',
  '  cur_c text;',
  'begin',
  '  for r in select * from (values',
  string_agg(format('    (%L, %L, %L, %L)', tablename, policyname, md5(qual), md5(with_check)), E',\n'),
  '  ) as t(tbl, pol, md5_q, md5_c) loop',
  '    select regexp_replace(regexp_replace(p.qual, ''\( SELECT auth\.uid\(\) AS uid\)'', ''auth.uid()'', ''g''),',
  '                          ''\( SELECT (has_permission\(''''[a-z0-9._]+''''::text\)) AS has_permission\)'', ''\1'', ''g''),',
  '           regexp_replace(regexp_replace(p.with_check, ''\( SELECT auth\.uid\(\) AS uid\)'', ''auth.uid()'', ''g''),',
  '                          ''\( SELECT (has_permission\(''''[a-z0-9._]+''''::text\)) AS has_permission\)'', ''\1'', ''g'')',
  '      into cur_q, cur_c',
  '      from pg_policies p where p.schemaname = ''public'' and p.tablename = r.tbl and p.policyname = r.pol;',
  '    if not found then',
  '      raise exception ''policy saknas: %.%'', r.tbl, r.pol;',
  '    end if;',
  '    if md5(cur_q) is distinct from r.md5_q or md5(cur_c) is distinct from r.md5_c then',
  '      raise exception ''policy %.% skiljer sig från den omskrivningen utgår från — skriver inte över'', r.tbl, r.pol;',
  '    end if;',
  '  end loop;',
  'end $pre$;',
  '')
  from __targets;

-- 2. Omskrivningen
select format('alter policy %I on public.%I', policyname, tablename)
    || case when qual is not null then E'\n  using (' || wrapped_q || ')' else '' end
    || case when with_check is not null then E'\n  with check (' || wrapped_c || ')' else '' end
    || E';\n'
  from (
    select tablename, policyname, qual, with_check,
           regexp_replace(regexp_replace(qual, 'auth\.uid\(\)', '(select auth.uid())', 'g'),
                          '(has_permission\(''[a-z0-9._]+''::text\))', '(select \1)', 'g') as wrapped_q,
           regexp_replace(regexp_replace(with_check, 'auth\.uid\(\)', '(select auth.uid())', 'g'),
                          '(has_permission\(''[a-z0-9._]+''::text\))', '(select \1)', 'g') as wrapped_c
      from __targets
  ) t;

-- 3. Efterkontroll
select concat_ws(E'\n',
  '-- Efterkontroll: med inslagningen borttagen är varje policy identisk med originalet, och inga oinslagna anrop',
  '-- finns kvar på de berörda tabellerna (antal anrop minus antal inslagna ska vara noll).',
  'do $post$',
  'declare',
  '  r record;',
  '  cur_q text;',
  '  cur_c text;',
  '  bare int;',
  'begin',
  '  for r in select * from (values',
  string_agg(format('    (%L, %L, %L, %L)', tablename, policyname, md5(qual), md5(with_check)), E',\n'),
  '  ) as t(tbl, pol, md5_q, md5_c) loop',
  '    select regexp_replace(regexp_replace(p.qual, ''\( SELECT auth\.uid\(\) AS uid\)'', ''auth.uid()'', ''g''),',
  '                          ''\( SELECT (has_permission\(''''[a-z0-9._]+''''::text\)) AS has_permission\)'', ''\1'', ''g''),',
  '           regexp_replace(regexp_replace(p.with_check, ''\( SELECT auth\.uid\(\) AS uid\)'', ''auth.uid()'', ''g''),',
  '                          ''\( SELECT (has_permission\(''''[a-z0-9._]+''''::text\)) AS has_permission\)'', ''\1'', ''g'')',
  '      into cur_q, cur_c',
  '      from pg_policies p where p.schemaname = ''public'' and p.tablename = r.tbl and p.policyname = r.pol;',
  '    if md5(cur_q) is distinct from r.md5_q or md5(cur_c) is distinct from r.md5_c then',
  '      raise exception ''policy %.% ändrades mer än inslagningen'', r.tbl, r.pol;',
  '    end if;',
  '  end loop;',
  '',
  '  select coalesce(sum(',
  '           (length(e) - length(replace(e, ''auth.uid()'', ''''))) / length(''auth.uid()'')',
  '         - (length(e) - length(replace(e, ''( SELECT auth.uid() AS uid)'', ''''))) / length(''( SELECT auth.uid() AS uid)'')',
  '         + (length(e) - length(replace(e, ''has_permission('', ''''))) / length(''has_permission('')',
  '         - (length(e) - length(replace(e, ''( SELECT has_permission('', ''''))) / length(''( SELECT has_permission('')',
  '         ), 0) into bare',
  '    from (select coalesce(qual, '''') || '' '' || coalesce(with_check, '''') as e',
  '            from pg_policies',
  format('           where schemaname = ''public'' and tablename ~ %L) x;', :'tables'),
  '  if bare <> 0 then',
  '    raise exception ''% oinslagna auth.uid()/has_permission()-anrop kvar'', bare;',
  '  end if;',
  'end $post$;')
  from __targets;

rollback;
