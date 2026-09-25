-- Appärenden, komplettering: admin får radera, och den som tog i ärendet syns.
--
-- ⚠️ DEPLOY-ORDNING: **KÖR DEN HÄR FÖRE KODEN.** Additiv i sig (ny kolumn, ny policy, nytt grant —
-- inget befintligt ändras), MEN koden som hör till selectar `handled_by_name`. Deployas koden först
-- svarar PostgREST "column does not exist" på VARJE läsning av app_tickets — hela ärendelistan och
-- Mina rapporter går ner, inte bara den nya funktionen. Kör SQL:en först och ordningen kan inte
-- bita. Se lärdomen i 20260812_invoice_rounds_index_compat.sql.
--
-- Kör i Supabase SQL editor. Idempotent.
--
-- VARFÖR RADERING ÖVER HUVUD TAGET. `declined` ("Blir inte av") är ett svar till rapportören och ska
-- ligga kvar — det är information. En dubblett eller ett skräpärende är inte information, det är
-- brus i den lista som ska svara på "vad är kvar". Utan radering växer bruset monotont och
-- backloggen slutar gå att lita på. Därför BÅDA: declined för beslut, delete för brus.

-- ---------------------------------------------------------------------------
-- Vem som senast tog i ärendet
-- ---------------------------------------------------------------------------
-- Namnet lagras som en beständig kopia, precis som reporter_name: `profiles` är self-read-only under
-- RLS, så en admin kan inte läsa upp en ANNAN admins namn i efterhand. handled_by (FK) blir kvar för
-- spårbarheten, handled_by_name är det som går att visa.
alter table public.app_tickets
  add column if not exists handled_by_name text;

-- ---------------------------------------------------------------------------
-- Radering (admin)
-- ---------------------------------------------------------------------------
-- Grantet saknades helt i 20260812_app_tickets.sql (select, insert, update) — utan det nekas DELETE
-- på tabellnivå innan RLS ens hinner titta.
grant delete on public.app_tickets to authenticated;

-- Bara admin raderar. Rapportören kan inte ta bort sitt eget ärende: det som är rapporterat är
-- rapporterat, och en backlog som kan tömmas av den som fyllde den är ingen backlog.
drop policy if exists app_tickets_delete on public.app_tickets;
create policy app_tickets_delete on public.app_tickets
  for delete to authenticated
  using (public.is_app_ticket_admin());

-- ── Verifiering (kör efter applicering) ──────────────────────────────────────
--
-- 1. Kolumnen ska finnas.
--
--      select column_name from information_schema.columns
--      where table_schema = 'public' and table_name = 'app_tickets' and column_name = 'handled_by_name';
--
-- 2. Policyerna ska nu vara FYRA, en per kommando.
--
--      select policyname, cmd from pg_policies
--      where schemaname = 'public' and tablename = 'app_tickets' order by cmd;
--
-- 3. Grantet ska omfatta delete.
--
--      select privilege_type from information_schema.role_table_grants
--      where table_schema = 'public' and table_name = 'app_tickets' and grantee = 'authenticated'
--      order by privilege_type;
