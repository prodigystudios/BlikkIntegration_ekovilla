-- Rollen `ekonomi` får LÄSA arbetsordrar — fakturaunderlaget.
--
-- VARFÖR
-- Williams beslut 2026-09-18: byrån behöver se ordrarna för att kunna ta fram fakturaunderlag.
-- Fakturorna skapas fortsatt i Fortnox; det appen ska ge dem är underlaget — vad som är sålt, till
-- vilket pris, vad som är utfört och vad som redan delfakturerats.
--
-- ⚠️ DETTA ÄNDRAR EN TIDIGARE DOKUMENTERAD UTSAGA. `20260831_ekonomi_role_seed.sql:27` säger
-- "crm.* / fortnox.* — Hon ska aldrig se en kund, ett pris eller en faktura." Den meningen gällde
-- rollens ursprungliga uppdrag (enbart löneunderlag) och är nu överspelad av beslutet ovan. Den
-- filen har fått en hänvisning hit så att de två inte läses som motstridiga. Seeden där är
-- `on conflict do nothing`, så en omkörning av den tar INTE bort nycklarna nedan.
--
-- ADDITIV. Inga befintliga rader ändras eller tas bort — rollen får tre nya rader i
-- role_permissions. Ordningen mot koden är därmed fri, men kör gärna den här FÖRE deployen:
-- `effective_permissions` failar closed, så en sida som grindar på en nyckel som ännu inte finns
-- nekar alla. Tvärtom (nyckeln finns, sidan är inte deployad) är harmlöst.
--
-- Kör i Supabase SQL-editorn.

-- ── Knippet ──────────────────────────────────────────────────────────────────
--
-- Vad de tre nycklarna öppnar, och varför var och en behövs:
--
--   crm.access          Den grova läsgrinden bakom `requireCrmUser()` i app/api/crm/_shared.ts.
--                       Utan den svarar 403 på arbetsorderlistan, PDF:en och följesedeln, oavsett
--                       vad de andra nycklarna säger.
--   crm.workorder.read  RLS på crm_work_orders: SELECT är "assigned_to = auth.uid() OR
--                       has_permission('crm.workorder.read')" (20260810_crm_work_order_crew_access).
--                       Utan den är varje rad osynlig i databasen — routen svarar 200 med noll rader.
--   crm.report.read     Efterkalkylen: TB1/TB2, marginaler och utfall mot plan
--                       (/api/crm/work-orders/[id]/after-calculation). William 2026-09-18: byrån ska
--                       se lonsamheten per jobb.
--
-- ⚠️ INGEN SKRIVNYCKEL. `crm.write`, `crm.workorder.write`, `fortnox.invoice.create` och
-- `fortnox.workorder.push` är MEDVETET utelämnade: byrån läser underlaget, kontoret äger ordern.
-- Läsvyn i appen speglar det — varje skrivingång är avstängd där. Ger man knapparna utan nycklarna
-- får man en yta där allt svarar 403; ger man nycklarna utan att mena det kan en extern part ändra
-- priser på en order och skapa fakturor i Fortnox.
--
-- ⚠️ crm.report.read öppnar ÄVEN /api/crm/reports (försäljningsrapporter och nyckeltal). Själva
-- ytan /crm/rapportering är fortsatt stängd av rollgrinden i app/crm/layout.tsx, så det ger ingen
-- sida att gå till — men API:et svarar. Det är den bredaste av de tre nycklarna; vill man snäva in
-- det är vägen en egen nyckel för efterkalkylen, inte att dela ut den här smalare.
insert into public.role_permissions (role, permission_key) values
  ('ekonomi','crm.access'),
  ('ekonomi','crm.workorder.read'),
  ('ekonomi','crm.report.read')
on conflict do nothing;

-- ── Följd som är värd att känna till ─────────────────────────────────────────
--
-- Attestvyns kolumn "Orsak / jobb" var TOM på varje arbetsorderrad, eftersom tidraderna embeddar
-- crm_work_orders och policyn krävde crm.workorder.read. `reasonOrJobLabel` i
-- lib/domains/time/summary.ts skrev därför en neutral markör ("Arbetsorder") i stället.
--
-- Med nyckeln ovan fylls kolumnen nu med ordernamnet, alltså KUNDNAMN PER ARBETAD TIMME. Det var
-- 2026-08-31 ett medvetet val att inte visa. Beslutet 2026-09-18 väger tyngre, men följden ska vara
-- sedd och inte upptäckas i efterhand. Koden behöver ingen ändring: `reasonOrJobLabel` visar
-- etiketten när den finns och markören när den saknas.

-- ── Verifiering ──────────────────────────────────────────────────────────────
--   -- Rollens hela knippe, de tre nya ska ligga med:
--   select permission_key from public.role_permissions where role = 'ekonomi' order by 1;
--
--   -- Ingen skrivnyckel har smugit sig in:
--   select permission_key from public.role_permissions
--   where role = 'ekonomi' and (permission_key like '%.write%' or permission_key like 'fortnox.%');
--   -- Förväntat: noll rader.
