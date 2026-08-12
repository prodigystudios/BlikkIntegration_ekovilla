-- Tid & lön (fas 4) — RLS på crm_time_entries efter omformningen.
--
-- Fas 4.2, syskonfil till 20260811_time_entries_reshape.sql. Kör direkt efter den.
--
-- Tabellen bar åtta policyer från tre filer, skrivna vid tre tillfällen för tre olika behov:
--   20260530064347  *_select_visible / _insert_self / _update_self_or_visible / _delete_self_or_visible
--   20260606        crm_wo_time_entries_update_own / _delete_own
--   20260810        crm_wo_time_entries_select_crew / _insert_crew   (sovande, byggda för fas 4)
-- De överlevde namnbytet (policyer följer tabellens OID) men bär gamla namn och en hårdkodad
-- `p.role = 'admin'`-gren. Här ersätts alla åtta av FYRA, med behörighetsnycklar i stället för roll
-- och med grenarna sorterade billigast först.
--
-- Vad som ÄNDRAS i sak — läs det här, det är inte bara en omdöpning:
--   1. `role = 'admin'` blir has_permission('time.entry.read.all'). Samma personer i dag, men nu
--      går det att ge en arbetsledare insyn utan att göra hen till admin.
--   2. INSERT tillåter rader UTAN arbetsorder. Det är hela poängen: frånvaro och interntid har
--      ingen. Båda gamla insert-policyerna krävde en arbetsorder, så de raderna hade varit omöjliga.
--   3. UPDATE/DELETE blir RENT ÄGARSKOPADE. Tidigare kunde den som ägde arbetsordern, eller en
--      admin, radera någon annans tidrad. Det är en avsiktlig ÅTSTRAMNING: från och med nu är det
--      här löneunderlag, och ingen ska kunna ändra någon annans timmar tyst. Behöver en admin rätta
--      en annans rad går det via attesten i fas 4.4 (öppna perioden, personen rättar själv) — och
--      periodlåset läggs på i samma fil.
--
-- DEPLOY-ORDNING: efter 20260811_time_permissions.sql (nycklarna måste finnas — has_permission på
-- en okänd nyckel är false, alltså nekad) och efter reshape-filen. Idempotent.

-- ── Bort med de åtta gamla ───────────────────────────────────────────────────
drop policy if exists crm_work_order_time_entries_select_visible on public.crm_time_entries;
drop policy if exists crm_work_order_time_entries_insert_self on public.crm_time_entries;
drop policy if exists crm_work_order_time_entries_update_self_or_visible on public.crm_time_entries;
drop policy if exists crm_work_order_time_entries_delete_self_or_visible on public.crm_time_entries;
drop policy if exists crm_wo_time_entries_update_own on public.crm_time_entries;
drop policy if exists crm_wo_time_entries_delete_own on public.crm_time_entries;
drop policy if exists crm_wo_time_entries_select_crew on public.crm_time_entries;
drop policy if exists crm_wo_time_entries_insert_crew on public.crm_time_entries;

-- ── ...och bort med de FYRA NYA, så filen går att köra om ─────────────────────
-- Utan de här raderna är filen bara körbar EN gång: andra körningen dör på
-- "policy ... already exists" (42710) vid första create, och då hinner ingenting ersättas — man
-- sitter kvar med exakt de policyer man försökte byta ut, i tron att man just uppdaterat dem.
-- Det hände på riktigt när UPDATE-policyn skulle rättas. `create policy` har inget `or replace`,
-- så drop-först är enda vägen.
drop policy if exists crm_time_entries_select on public.crm_time_entries;
drop policy if exists crm_time_entries_insert on public.crm_time_entries;
drop policy if exists crm_time_entries_update_own on public.crm_time_entries;
drop policy if exists crm_time_entries_delete_own on public.crm_time_entries;

-- ── SELECT ───────────────────────────────────────────────────────────────────
-- Grenarna står billigast först. `user_id = auth.uid()` är en kolumnjämförelse och sann för de allra
-- flesta rader en person läser; has_permission är ett svar per fråga; de två sista slår i tabeller
-- och utvärderas per rad. Ordningen är mätbar med metoden i
-- supabase/sql/20260811_crm_work_order_rls_perf_probe.sql — mät om när tabellen vuxit.
--
-- `work_order_id is not null`-vakten framför de två sista är inte kosmetik: is_user_on_work_order
-- svarar false på NULL (dess `where s.work_order_id = p_wo` matchar aldrig), men vakten gör det
-- billigt och läsbart att frånvaro- och internrader ALDRIG kan nås via arbetsorder-grenarna. Det är
-- den mekanism som gör att en sjukfrånvarorad inte syns för besättningskollegorna.
create policy crm_time_entries_select on public.crm_time_entries
  for select to authenticated
  using (
    user_id = auth.uid()
    or public.has_permission('time.entry.read.all')
    or (
      work_order_id is not null
      and exists (
        select 1 from public.crm_work_orders w
        where w.id = crm_time_entries.work_order_id and w.assigned_to = auth.uid()
      )
    )
    or (work_order_id is not null and public.is_user_on_work_order(auth.uid(), work_order_id))
  );

-- ── INSERT ───────────────────────────────────────────────────────────────────
-- Alltid bara för sig själv. Utöver det: en arbetsorderrad kräver att man når ordern (egen,
-- besättning, eller CRM-läsare på kontoret), medan frånvaro och interntid inte kräver något alls —
-- de är personens egen tid och har ingen order att höra till.
create policy crm_time_entries_insert on public.crm_time_entries
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and public.has_permission('time.entry.write')
    and (
      work_order_id is null
      or exists (
        select 1 from public.crm_work_orders w
        where w.id = crm_time_entries.work_order_id and w.assigned_to = auth.uid()
      )
      or public.is_user_on_work_order(auth.uid(), work_order_id)
      or public.has_permission('crm.workorder.read')
    )
  );

-- ── UPDATE / DELETE ──────────────────────────────────────────────────────────
-- Bara sin egen rad. Se punkt 3 i huvudet — det är en åtstramning, med flit.
--
-- ⚠️ WITH CHECK SPEGLAR INSERT-VILLKORET, inte bara ägarskapet. Med enbart `user_id = auth.uid()`
-- gick åtkomstkontrollen på arbetsordern att kringgå: man skapar en rad på ett jobb man når och
-- flyttar den sedan med en PATCH till vilken arbetsorder som helst. Tid hade då kunnat bokföras på
-- ett jobb man aldrig varit på — fel jobbkalkyl, och insyn i vilka ordrar som finns. Villkoret
-- måste därför gälla vid varje skrivning, inte bara den första.
create policy crm_time_entries_update_own on public.crm_time_entries
  for update to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and (
      work_order_id is null
      or exists (
        select 1 from public.crm_work_orders w
        where w.id = crm_time_entries.work_order_id and w.assigned_to = auth.uid()
      )
      or public.is_user_on_work_order(auth.uid(), work_order_id)
      or public.has_permission('crm.workorder.read')
    )
  );

create policy crm_time_entries_delete_own on public.crm_time_entries
  for delete to authenticated
  using (user_id = auth.uid());

-- ── Verifiering (kör efter applicering) ──────────────────────────────────────
-- Fyra policyer, inga kvarvarande gamla namn:
--   select policyname, cmd from pg_policies
--   where schemaname = 'public' and tablename = 'crm_time_entries' order by cmd, policyname;
--
-- Ingen policy får referera role-kolumnen längre (samma orakel som 20260609_rls_permissions_verify):
--   select policyname, qual::text like '%profiles%role%' as still_references_role
--   from pg_policies where schemaname='public' and tablename='crm_time_entries';
--
-- Punktprov mot en riktig installatör och ett riktigt jobb (ska ge true för besättningen,
-- false för andra) — samma metod som crew-access-filens spot-check:
--   select p.full_name, public.is_user_on_work_order(p.id, '<work_order_id>') as pa_jobbet
--   from public.profiles p order by pa_jobbet desc, p.full_name;
