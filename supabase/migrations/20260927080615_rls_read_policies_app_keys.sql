-- Läspolicyerna på kontakter, nyheter, Dokument & information och dokumentbiblioteket frågar efter en behörighetsnyckel
-- i stället för "inloggad".
--
-- BAKGRUND
-- De nio SELECT-policyerna nedan var `auth.role() = 'authenticated'`, och authenticated har SELECT på tabellerna. RBAC-
-- passet (#228–#232) grindade sidorna och rutterna på app.*-nycklarna, men inte RLS: lönebyrån (`ekonomi`, extern)
-- har ingen av nycklarna och ser inte ytorna i appen, men läste kontaktregistret, nyheterna, Dokument & information
-- och hela dokumentbibliotekets mapp- och filrader direkt via /rest/v1 med sin egen session. Bekräftat lokalt
-- 2026-09-27 med testrader (`ekonomi@example.test`). Filerna själva ligger i den privata bucketen `pdfs`, som
-- saknar storage-policyer i prod, så de signeras bara av service-rollen EFTER en sessionsläsning av raden. Därför
-- är tabellens RLS också filernas grind.
--
-- NYCKLARNA — samma som SIDAN som läser tabellen grindas på, inte menyradens smalare nyckel. Sidorna för de anställda
-- är medvetet bredare än sina menyrader (PERMISSIONS.md, 2026-09-26); en policy på menynyckeln hade gjort /nyheter tom
-- i stället för nekad för den som har app.access men fått app.news.read återkallad.
--   contacts, addresses, contact_categories        -> app.contacts.read  (/kontakt-lista och /api/contacts)
--   news_items                                     -> app.access         (/nyheter)
--   info_groups, info_sections, info_section_images -> app.access        (/dokument-information)
--   documents_folders, documents_files             -> crm.access ELLER app.access
--     Biblioteket (/crm/dokument) = crm.access. En publicerad fil öppnas av mottagaren via /mina-dokument
--     (app.access), och `open`-rutten läser filraden med sessionen. Snävare än så (montören ser bara filer
--     publicerade till hen) ändrar beteendet och väntar på att dokumentdomänen tas samlad.
-- I dag har admin, konsult, member och sales app.contacts.read och app.access; crm.access har admin, konsult och
-- sales; ekonomi har ingen av dem. Ingen annan roll än ekonomi tappar något — prövat per testroll före och efter.
--
-- LÄSARE MED SESSIONEN, och varför ingen av dem tappar något:
--   * /api/contacts (grind app.contacts.read); KMA-planens förifyllning (crm.workorder.write) och skyddsrondens
--     förslag (safety.round.write) via listKmaDirectory — båda nycklarna har bara admin och sales.
--   * /nyheter och /dokument-information (layoutgrind app.access), /api/news/latest och /api/info/files/[id]
--     (grindas i samma PR), admin-rutterna för nyheter och information (admin har nycklarna).
--   * /api/documents/* (UI:t är /crm/dokument, crm.access) och publiceringens `open` (mottagarna).
--   Admin-CRUD för kontakterna, kundaviseringen och publiceringarnas listor går via service-rollen: BYPASSRLS.
--   Ingen vy eller funktion i databasen läser tabellerna.
--
-- Skrivpolicyerna (`profiles.role = 'admin'`) rörs inte. `to authenticated`: anon hade bara fått false.
--
-- Stramar åt, men koden är redan först: varje legitim läsare har redan sin nyckel. Idempotent, kan köras om.

-- crm.access finns i prod sedan RBAC-passet, men som DATA: ingen migrering lägger in den. I en databas byggd från noll
-- (`npm run db:reset`, testprojektet ekovilla-crm-test) kom den först med seeden, efter hela kedjan, och efterkontrollen
-- nedan stoppade pushen mot testprojektet (2026-09-30). Tillagt då; i prod finns raden redan och filen körs inte om.
-- Rollraderna kommer fortfarande från seeden (reference.sql, `on conflict do nothing`), med prods beskrivning här.
insert into public.permissions (key, description) values ('crm.access', 'CRM: read access (any CRM role)')
on conflict (key) do nothing;

-- pg_get_expr skriver ut schemanamn för allt som inte syns i sökvägen; kontrollerna nedan förutsätter den här.
set local search_path = public, extensions;

create temp table __read_policy_expected (tbl text, pol text, new_qual text);
insert into __read_policy_expected values
  ('contacts',            'contacts_select_all',        '( SELECT has_permission(''app.contacts.read''::text) AS has_permission)'),
  ('addresses',           'addr_select_all',            '( SELECT has_permission(''app.contacts.read''::text) AS has_permission)'),
  ('contact_categories',  'cat_select_all',             '( SELECT has_permission(''app.contacts.read''::text) AS has_permission)'),
  ('news_items',          'news_items_select_all',      '( SELECT has_permission(''app.access''::text) AS has_permission)'),
  ('info_groups',         'info_groups_select',         '( SELECT has_permission(''app.access''::text) AS has_permission)'),
  ('info_sections',       'info_sections_select',       '( SELECT has_permission(''app.access''::text) AS has_permission)'),
  ('info_section_images', 'info_section_images_select', '( SELECT has_permission(''app.access''::text) AS has_permission)'),
  ('documents_folders',   'documents_folders_select',   '(( SELECT has_permission(''crm.access''::text) AS has_permission) OR ( SELECT has_permission(''app.access''::text) AS has_permission))'),
  ('documents_files',     'documents_files_select',     '(( SELECT has_permission(''crm.access''::text) AS has_permission) OR ( SELECT has_permission(''app.access''::text) AS has_permission))');

-- Förkontroll: varje policy är en SELECT-policy som i dag är "inloggad" (efter 20260926143749) eller redan den nya
-- texten (omkörning). Något annat = drift i prod, som inte ska skrivas över i blindo.
do $$
declare
  e record;
  cur record;
begin
  perform set_config('search_path', 'public, extensions', true);
  for e in select * from __read_policy_expected loop
    select p.cmd, p.qual into cur
      from pg_policies p
     where p.schemaname = 'public' and p.tablename = e.tbl and p.policyname = e.pol;
    if not found then
      raise exception '%.%: policyn finns inte', e.tbl, e.pol;
    end if;
    if cur.cmd <> 'SELECT' then
      raise exception '%.%: väntade SELECT, fann %', e.tbl, e.pol, cur.cmd;
    end if;
    if cur.qual is distinct from '(( SELECT auth.role() AS role) = ''authenticated''::text)'
       and cur.qual is distinct from e.new_qual then
      raise exception '%.%: oväntad policytext: %', e.tbl, e.pol, cur.qual;
    end if;
  end loop;
end $$;

alter policy contacts_select_all on public.contacts
  to authenticated
  using ((select has_permission('app.contacts.read')));

alter policy addr_select_all on public.addresses
  to authenticated
  using ((select has_permission('app.contacts.read')));

alter policy cat_select_all on public.contact_categories
  to authenticated
  using ((select has_permission('app.contacts.read')));

alter policy news_items_select_all on public.news_items
  to authenticated
  using ((select has_permission('app.access')));

alter policy info_groups_select on public.info_groups
  to authenticated
  using ((select has_permission('app.access')));

alter policy info_sections_select on public.info_sections
  to authenticated
  using ((select has_permission('app.access')));

alter policy info_section_images_select on public.info_section_images
  to authenticated
  using ((select has_permission('app.access')));

alter policy documents_folders_select on public.documents_folders
  to authenticated
  using ((select has_permission('crm.access')) or (select has_permission('app.access')));

alter policy documents_files_select on public.documents_files
  to authenticated
  using ((select has_permission('crm.access')) or (select has_permission('app.access')));

-- Efterkontroll: exakt den nya texten, bara authenticated, och ingen annan policy på tabellerna som släpper igenom
-- en SELECT för alla inloggade. Nycklarna finns (en saknad nyckel hade stängt tabellen för alla), ekonomi har
-- ingen av dem, och authenticated får köra has_permission.
do $$
declare
  e record;
  cur record;
  k text;
begin
  perform set_config('search_path', 'public, extensions', true);
  for e in select * from __read_policy_expected loop
    select p.qual, p.roles into cur
      from pg_policies p
     where p.schemaname = 'public' and p.tablename = e.tbl and p.policyname = e.pol;
    if cur.qual is distinct from e.new_qual then
      raise exception '%.%: policytexten blev %', e.tbl, e.pol, cur.qual;
    end if;
    if cur.roles is distinct from array['authenticated']::name[] then
      raise exception '%.%: rollerna blev %', e.tbl, e.pol, cur.roles;
    end if;
  end loop;

  if exists (
    select 1 from pg_policies p
     where p.schemaname = 'public'
       and p.tablename in (select tbl from __read_policy_expected)
       and p.cmd in ('SELECT', 'ALL')
       and p.qual ~ 'auth\.role\(\)'
  ) then
    raise exception 'en policy på tabellerna frågar fortfarande efter auth.role()';
  end if;

  foreach k in array array['app.contacts.read', 'app.access', 'crm.access'] loop
    if not exists (select 1 from public.permissions where key = k) then
      raise exception 'permissions saknar %', k;
    end if;
    if exists (select 1 from public.role_permissions where permission_key = k and role::text = 'ekonomi') then
      raise exception 'ekonomi (lönebyrån) har %', k;
    end if;
  end loop;

  if not has_function_privilege('authenticated', 'public.has_permission(text)', 'EXECUTE') then
    raise exception 'authenticated får inte köra has_permission';
  end if;
end $$;

drop table __read_policy_expected;
