-- Exporterar referensdata ur prod till seed-filer. Läser bara — allt körs i en läs-transaktion
-- som rullas tillbaka.
--
-- Körs från repots rot, mot prod:
--   psql "$PROD_DB_URL" -X -q -A -t -f supabase/seed/export_reference.sql
--
-- Skriver två filer:
--   supabase/seed/reference.sql       committas. Det appen behöver för att fungera.
--   supabase/seed/articles.local.sql  committas INTE (gitignorerad): Fortnox-artiklarna med
--                                     inköpspriser, som inte ska ligga kvar i git-historiken.
-- Båda skrivs först till .tmp och flyttas på plats sist. Stoppar en fråga halvvägs (ON_ERROR_STOP)
-- ligger de gamla filerna kvar orörda i stället för en halvskriven reference.sql som ser giltig ut.
--
-- Ingen rad från prod får peka på prods användare eller bära namn på personer: användarna finns
-- inte lokalt eller i test, och raderna är personer. Kolumner som created_by/updated_by plockas
-- därför bort, leverantörernas kontaktuppgifter byts ut och Blikks rådata (med namn) utelämnas.
-- Tabeller som i grunden handlar om personer tas inte med alls: felanmälans mottagare och
-- standardbemanningen skapar dev.sql mot testanvändarna; säljrouting och artikelfavoriter lämnas tomma.
-- fortnox_integrations tas ALDRIG med: prods tokens.
--
-- `on conflict do nothing` på varje insert: `db reset` kör migreringarna FÖRE seeden, och en migrering
-- som lägger in data (t.ex. nya behörighetsnycklar) har redan skrivit raden som prods export — tagen efter
-- att migreringen körts i prod — innehåller igen. Utan det hade första exporten efter en sådan push
-- stoppat `db reset` på en dubblett. Raden från migreringen vinner; den är densamma.
--
-- Varje tabell blir en insert från JSON med UTTRYCKLIG kolumnlista (JSON-nycklarna vid exporten).
-- En kolumn som en senare migrering lägger till får då sin DEFAULT — med `select *` hade den fått
-- NULL, och en ny NOT NULL-kolumn hade stoppat `db reset` tills prod fått kolumnen. Tomma tabeller
-- ger ingen rad. Sorteringen gör att en ny export ger en läsbar diff.

\set ON_ERROR_STOP on
begin transaction read only;

\o supabase/seed/reference.sql.tmp
\qecho '-- Referensdata ur prod. GENERERAD av supabase/seed/export_reference.sql — redigera inte för hand.'
\qecho '-- Kolumner som pekar på prods användare eller bär personuppgifter är bortplockade eller utbytta.'
\qecho

-- Behörighetskatalogen (RBAC). Utan den når ingen användare något.
with r as (select coalesce(jsonb_agg(to_jsonb(t)
       order by t.key), '[]') as rows from public.permissions t)
select format('insert into public.%1$I (%2$s) select %2$s from jsonb_populate_recordset(null::public.%1$I, %3$L::jsonb) on conflict do nothing;',
       'permissions', c.cols, r.rows)
  from r, lateral (select string_agg(quote_ident(k), ', ' order by n) as cols
                     from jsonb_object_keys(r.rows->0) with ordinality as x(k, n)) c
 where jsonb_array_length(r.rows) > 0;

with r as (select coalesce(jsonb_agg(to_jsonb(t)
       order by t.role, t.permission_key), '[]') as rows from public.role_permissions t)
select format('insert into public.%1$I (%2$s) select %2$s from jsonb_populate_recordset(null::public.%1$I, %3$L::jsonb) on conflict do nothing;',
       'role_permissions', c.cols, r.rows)
  from r, lateral (select string_agg(quote_ident(k), ', ' order by n) as cols
                     from jsonb_object_keys(r.rows->0) with ordinality as x(k, n)) c
 where jsonb_array_length(r.rows) > 0;


-- Jobbtyper och färger (planeringen, nya och gamla).
with r as (select coalesce(jsonb_agg(to_jsonb(t)
       order by t.id), '[]') as rows from public.ops_job_types t)
select format('insert into public.%1$I (%2$s) select %2$s from jsonb_populate_recordset(null::public.%1$I, %3$L::jsonb) on conflict do nothing;',
       'ops_job_types', c.cols, r.rows)
  from r, lateral (select string_agg(quote_ident(k), ', ' order by n) as cols
                     from jsonb_object_keys(r.rows->0) with ordinality as x(k, n)) c
 where jsonb_array_length(r.rows) > 0;

with r as (select coalesce(jsonb_agg(to_jsonb(t) - 'created_by'
       order by t.job_type), '[]') as rows from public.planning_job_type_colors t)
select format('insert into public.%1$I (%2$s) select %2$s from jsonb_populate_recordset(null::public.%1$I, %3$L::jsonb) on conflict do nothing;',
       'planning_job_type_colors', c.cols, r.rows)
  from r, lateral (select string_agg(quote_ident(k), ', ' order by n) as cols
                     from jsonb_object_keys(r.rows->0) with ordinality as x(k, n)) c
 where jsonb_array_length(r.rows) > 0;


-- Tidsreferenserna (/tid) och Blikks äldre koder. Blikks `source` är rå Blikk-data med createdBy/updatedBy
-- — namn på anställda — och läses inte av appen.
with r as (select coalesce(jsonb_agg(to_jsonb(t)
       order by t.id), '[]') as rows from public.crm_absence_types t)
select format('insert into public.%1$I (%2$s) select %2$s from jsonb_populate_recordset(null::public.%1$I, %3$L::jsonb) on conflict do nothing;',
       'crm_absence_types', c.cols, r.rows)
  from r, lateral (select string_agg(quote_ident(k), ', ' order by n) as cols
                     from jsonb_object_keys(r.rows->0) with ordinality as x(k, n)) c
 where jsonb_array_length(r.rows) > 0;

with r as (select coalesce(jsonb_agg(to_jsonb(t)
       order by t.id), '[]') as rows from public.crm_time_codes t)
select format('insert into public.%1$I (%2$s) select %2$s from jsonb_populate_recordset(null::public.%1$I, %3$L::jsonb) on conflict do nothing;',
       'crm_time_codes', c.cols, r.rows)
  from r, lateral (select string_agg(quote_ident(k), ', ' order by n) as cols
                     from jsonb_object_keys(r.rows->0) with ordinality as x(k, n)) c
 where jsonb_array_length(r.rows) > 0;

with r as (select coalesce(jsonb_agg(to_jsonb(t)
       order by t.id), '[]') as rows from public.crm_internal_projects t)
select format('insert into public.%1$I (%2$s) select %2$s from jsonb_populate_recordset(null::public.%1$I, %3$L::jsonb) on conflict do nothing;',
       'crm_internal_projects', c.cols, r.rows)
  from r, lateral (select string_agg(quote_ident(k), ', ' order by n) as cols
                     from jsonb_object_keys(r.rows->0) with ordinality as x(k, n)) c
 where jsonb_array_length(r.rows) > 0;

with r as (select coalesce(jsonb_agg(to_jsonb(t) - 'source'
       order by t.id), '[]') as rows from public.blikk_timecodes t)
select format('insert into public.%1$I (%2$s) select %2$s from jsonb_populate_recordset(null::public.%1$I, %3$L::jsonb) on conflict do nothing;',
       'blikk_timecodes', c.cols, r.rows)
  from r, lateral (select string_agg(quote_ident(k), ', ' order by n) as cols
                     from jsonb_object_keys(r.rows->0) with ordinality as x(k, n)) c
 where jsonb_array_length(r.rows) > 0;

with r as (select coalesce(jsonb_agg(to_jsonb(t) - 'source'
       order by t.id), '[]') as rows from public.blikk_activities t)
select format('insert into public.%1$I (%2$s) select %2$s from jsonb_populate_recordset(null::public.%1$I, %3$L::jsonb) on conflict do nothing;',
       'blikk_activities', c.cols, r.rows)
  from r, lateral (select string_agg(quote_ident(k), ', ' order by n) as cols
                     from jsonb_object_keys(r.rows->0) with ordinality as x(k, n)) c
 where jsonb_array_length(r.rows) > 0;


-- Kalkylinställningarna i CRM.
with r as (select coalesce(jsonb_agg(to_jsonb(t) - 'updated_by'
       order by t.id), '[]') as rows from public.crm_calc_settings t)
select format('insert into public.%1$I (%2$s) select %2$s from jsonb_populate_recordset(null::public.%1$I, %3$L::jsonb) on conflict do nothing;',
       'crm_calc_settings', c.cols, r.rows)
  from r, lateral (select string_agg(quote_ident(k), ', ' order by n) as cols
                     from jsonb_object_keys(r.rows->0) with ordinality as x(k, n)) c
 where jsonb_array_length(r.rows) > 0;

with r as (select coalesce(jsonb_agg(to_jsonb(t) - 'updated_by'
       order by t.construction, t.material), '[]') as rows from public.crm_productivity_rates t)
select format('insert into public.%1$I (%2$s) select %2$s from jsonb_populate_recordset(null::public.%1$I, %3$L::jsonb) on conflict do nothing;',
       'crm_productivity_rates', c.cols, r.rows)
  from r, lateral (select string_agg(quote_ident(k), ', ' order by n) as cols
                     from jsonb_object_keys(r.rows->0) with ordinality as x(k, n)) c
 where jsonb_array_length(r.rows) > 0;

with r as (select coalesce(jsonb_agg(to_jsonb(t) - 'updated_by'
       order by t.material), '[]') as rows from public.crm_material_cost_articles t)
select format('insert into public.%1$I (%2$s) select %2$s from jsonb_populate_recordset(null::public.%1$I, %3$L::jsonb) on conflict do nothing;',
       'crm_material_cost_articles', c.cols, r.rows)
  from r, lateral (select string_agg(quote_ident(k), ', ' order by n) as cols
                     from jsonb_object_keys(r.rows->0) with ordinality as x(k, n)) c
 where jsonb_array_length(r.rows) > 0;


-- Depåer och bilar (nya planeringen). Depåerna före bilarna — främmande nyckel.
with r as (select coalesce(jsonb_agg(to_jsonb(t)
       order by t.id), '[]') as rows from public.ops_depots t)
select format('insert into public.%1$I (%2$s) select %2$s from jsonb_populate_recordset(null::public.%1$I, %3$L::jsonb) on conflict do nothing;',
       'ops_depots', c.cols, r.rows)
  from r, lateral (select string_agg(quote_ident(k), ', ' order by n) as cols
                     from jsonb_object_keys(r.rows->0) with ordinality as x(k, n)) c
 where jsonb_array_length(r.rows) > 0;

with r as (select coalesce(jsonb_agg(to_jsonb(t)
       order by t.id), '[]') as rows from public.ops_trucks t)
select format('insert into public.%1$I (%2$s) select %2$s from jsonb_populate_recordset(null::public.%1$I, %3$L::jsonb) on conflict do nothing;',
       'ops_trucks', c.cols, r.rows)
  from r, lateral (select string_agg(quote_ident(k), ', ' order by n) as cols
                     from jsonb_object_keys(r.rows->0) with ordinality as x(k, n)) c
 where jsonb_array_length(r.rows) > 0;


-- Materialleverantörerna. Kontaktperson, telefon och anteckning bort; e-posten byts mot en adress
-- på .invalid, som aldrig kan levereras (RFC 2606). Beställningar är dessutom spärrade utanför prod.
with r as (select coalesce(jsonb_agg((to_jsonb(t) - 'created_by' - 'contact_name' - 'phone' - 'note')
       || jsonb_build_object('email', 'leverantor-' || left(t.id::text, 8) || '@example.invalid')
       order by t.id), '[]') as rows from public.ops_material_suppliers t)
select format('insert into public.%1$I (%2$s) select %2$s from jsonb_populate_recordset(null::public.%1$I, %3$L::jsonb) on conflict do nothing;',
       'ops_material_suppliers', c.cols, r.rows)
  from r, lateral (select string_agg(quote_ident(k), ', ' order by n) as cols
                     from jsonb_object_keys(r.rows->0) with ordinality as x(k, n)) c
 where jsonb_array_length(r.rows) > 0;


-- Depåer och bilar (gamla /plannering). Bilarnas besättning — personer — bort.
with r as (select coalesce(jsonb_agg(to_jsonb(t) - 'created_by'
       order by t.id), '[]') as rows from public.planning_depots t)
select format('insert into public.%1$I (%2$s) select %2$s from jsonb_populate_recordset(null::public.%1$I, %3$L::jsonb) on conflict do nothing;',
       'planning_depots', c.cols, r.rows)
  from r, lateral (select string_agg(quote_ident(k), ', ' order by n) as cols
                     from jsonb_object_keys(r.rows->0) with ordinality as x(k, n)) c
 where jsonb_array_length(r.rows) > 0;

with r as (select coalesce(jsonb_agg(to_jsonb(t) - 'created_by' - 'team_member1' - 'team_member2' - 'team_member1_name'
       - 'team_member2_name' - 'team1_id' - 'team2_id'
       order by t.id), '[]') as rows from public.planning_trucks t)
select format('insert into public.%1$I (%2$s) select %2$s from jsonb_populate_recordset(null::public.%1$I, %3$L::jsonb) on conflict do nothing;',
       'planning_trucks', c.cols, r.rows)
  from r, lateral (select string_agg(quote_ident(k), ', ' order by n) as cols
                     from jsonb_object_keys(r.rows->0) with ordinality as x(k, n)) c
 where jsonb_array_length(r.rows) > 0;


-- Skyddsrondens checklista. Kategorierna före punkterna — främmande nyckel.
with r as (select coalesce(jsonb_agg(to_jsonb(t)
       order by t.id), '[]') as rows from public.safety_checklist_categories t)
select format('insert into public.%1$I (%2$s) select %2$s from jsonb_populate_recordset(null::public.%1$I, %3$L::jsonb) on conflict do nothing;',
       'safety_checklist_categories', c.cols, r.rows)
  from r, lateral (select string_agg(quote_ident(k), ', ' order by n) as cols
                     from jsonb_object_keys(r.rows->0) with ordinality as x(k, n)) c
 where jsonb_array_length(r.rows) > 0;

with r as (select coalesce(jsonb_agg(to_jsonb(t)
       order by t.id), '[]') as rows from public.safety_checklist_items t)
select format('insert into public.%1$I (%2$s) select %2$s from jsonb_populate_recordset(null::public.%1$I, %3$L::jsonb) on conflict do nothing;',
       'safety_checklist_items', c.cols, r.rows)
  from r, lateral (select string_agg(quote_ident(k), ', ' order by n) as cols
                     from jsonb_object_keys(r.rows->0) with ordinality as x(k, n)) c
 where jsonb_array_length(r.rows) > 0;

\o supabase/seed/articles.local.sql.tmp
\qecho '-- Fortnox-artiklarna ur prod, med inköpspriser. GENERERAD av supabase/seed/export_reference.sql.'
\qecho '-- Gitignorerad med flit: priserna ska inte ligga kvar i git-historiken.'
\qecho

with r as (select coalesce(jsonb_agg(to_jsonb(t)
       order by t.article_number), '[]') as rows from public.fortnox_articles_cache t)
select format('insert into public.%1$I (%2$s) select %2$s from jsonb_populate_recordset(null::public.%1$I, %3$L::jsonb) on conflict do nothing;',
       'fortnox_articles_cache', c.cols, r.rows)
  from r, lateral (select string_agg(quote_ident(k), ', ' order by n) as cols
                     from jsonb_object_keys(r.rows->0) with ordinality as x(k, n)) c
 where jsonb_array_length(r.rows) > 0;

with r as (select coalesce(jsonb_agg(to_jsonb(t) - 'created_by'
       order by t.article_number), '[]') as rows from public.fortnox_article_work_description_defaults t)
select format('insert into public.%1$I (%2$s) select %2$s from jsonb_populate_recordset(null::public.%1$I, %3$L::jsonb) on conflict do nothing;',
       'fortnox_article_work_description_defaults', c.cols, r.rows)
  from r, lateral (select string_agg(quote_ident(k), ', ' order by n) as cols
                     from jsonb_object_keys(r.rows->0) with ordinality as x(k, n)) c
 where jsonb_array_length(r.rows) > 0;

\o
rollback;

-- Hit når skriptet bara om varje fråga lyckades.
\! mv supabase/seed/reference.sql.tmp supabase/seed/reference.sql && mv supabase/seed/articles.local.sql.tmp supabase/seed/articles.local.sql
