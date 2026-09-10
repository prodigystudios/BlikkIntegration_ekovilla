-- Väntade leveranser: material som är beställt men ännu inte står på depån.
--
-- BAKGRUND
-- ops_depot_deliveries (20260612) betyder "står FYSISKT på depån" — varje rad räknas rakt in i
-- lagersaldot av computeDepotBalances. Något som är på väg har därför ingen plats där, och när
-- planeraren tittar på veckan syns inte att det kommer material på tisdag.
--
-- ⚠️ BESTÄLLDA SÄCKAR FÅR ALDRIG RÄKNAS I SALDOT. Saldot är levererat − förbrukat, läst ur
-- ops_depot_deliveries. Den här filen lägger därför INGEN kolumn på den tabellen och rör den inte
-- alls: en väntad leverans blir en lagerrad först när ankomsten bekräftas, och då genom en vanlig
-- insert. Kopplingen tillbaka (delivery_id) pekar ÅT DET HÅLLET av precis det skälet — den kan inte
-- råka bli en väg in i saldot.
--
-- ⚠️ Räknades väntat material som lager skulle bristvarningen "Lagret räcker inte" slockna så fort
-- någon lagt in en beställning, oavsett om fabriken levererar. Felet upptäcks först när en bil står
-- utan material.
--
-- FRAMÅT
-- Samma rad är det materialbeställningen till fabriken kommer skapa. Då tillkommer en additiv
-- kolumn order_id → ops_material_orders; en rad utan order_id är inlagd för hand, en med är
-- beställd via systemet. Tabellen är avsiktligt namngiven efter VAD raden är, inte varifrån den kom.
--
-- DEPLOY-ORDNING
-- Kör EFTER 20260612_ops_depots.sql (FK → ops_depots), 20260612_ops_depot_deliveries.sql
-- (FK → ops_depot_deliveries) och 20260611_planning_permissions.sql (policyerna anropar
-- has_permission). ADDITIV — inget befintligt rörs, ingen befintlig behörighet ändras — så
-- ordningen mot koden är fri. Körs koden först svarar PostgREST 400 på saknad relation och remsan
-- visar bara ankomna leveranser; tavlan och saldot är opåverkade.
--
-- Kör i Supabase SQL editor. Idempotent — kör den TVÅ gånger innan du litar på påståendet.
-- Inga tecken utanför BMP i den här filen.

-- ---------------------------------------------------------------------------
-- Tabell
-- ---------------------------------------------------------------------------

create table if not exists public.ops_expected_deliveries (
  id           uuid primary key default gen_random_uuid(),
  -- RESTRICT, inte CASCADE. ops_depot_deliveries.depot_id är cascade, vilket gör att en raderad
  -- depå tyst tar hela sin leveranshistorik med sig — UI:ts riskzon nämner bara att bilar nollas.
  -- Upprepa inte det: en depå med utestående leveranser ska inte gå att radera. Avveckling sker
  -- genom ops_depots.active.
  depot_id     uuid not null references public.ops_depots(id) on delete restrict,
  -- Kanonisk kortkod ur MATERIAL_SHORTS (lib/domains/crm/materials.ts). Ingen CHECK, av samma skäl
  -- som systertabellerna: vokabulären bor i koden och valideras i Zod på ETT ställe. Identiteten är
  -- ändå hård — stämmer strängen inte tecken för tecken möts leverans och behov aldrig.
  material     text not null,
  sacks        integer not null check (sacks > 0),
  expected_on  date not null,
  note         text,
  -- 'expected' -> 'arrived' (ankomst bekräftad) eller 'cancelled'. Ingen radering: raden är
  -- revision över vad vi trodde skulle komma.
  status       text not null default 'expected'
    check (status in ('expected', 'arrived', 'cancelled')),
  -- Lagerraden som skapades vid kvitteringen. Enkelriktad med flit, se filhuvudet.
  delivery_id  uuid references public.ops_depot_deliveries(id) on delete set null,
  arrived_at   timestamptz,
  arrived_by   uuid references public.profiles(id) on delete set null,
  -- Durabelt visningsnamn: profiles är self-read-only, så listan kan aldrig läsa om en kollegas
  -- namn i efterhand. Samma mönster som ops_segments.created_by_name och ops_activity_events.
  arrived_by_name text,
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now()
);

-- Tavlans remsa läser ett datumfönster; de öppna raderna är den lilla delmängden.
create index if not exists ops_expected_deliveries_day_idx
  on public.ops_expected_deliveries (expected_on) where status = 'expected';
-- Saldot och prognosen frågar "vad är utestående för den här depån och materialet".
create index if not exists ops_expected_deliveries_stock_idx
  on public.ops_expected_deliveries (depot_id, material, status);
-- En väntad leverans kvitteras EN gång och ger då upphov till EXAKT en lagerrad. Delleverans är
-- avfört (Williams beslut 2026-09-10): kommer bara halva lasset kvitteras det med antalet som kom.
create unique index if not exists ops_expected_deliveries_delivery_uniq
  on public.ops_expected_deliveries (delivery_id) where delivery_id is not null;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
--
-- SELECT är board-nivå: raden bär bara depå, material, antal och datum — inget om leverantör eller
-- pris — och tavlans remsa ska kunna visa den för alla som får se schemat.
--
-- INSERT/DELETE kräver planning.depot.manage. Att lägga in en väntad leverans ÄR att säga att något
-- är beställt, alltså samma inköpsbeslut som materialbeställningen kommer kräva.
--
-- UPDATE kräver planning.schedule.write: att ta emot gods är lagerarbete, samma nyckel som
-- "Registrera leverans" redan använder. Med depot.manage här hade ingen utom admin kunnat kvittera
-- en leverans som stod på depån en fredag.

alter table public.ops_expected_deliveries enable row level security;
grant select, insert, update, delete on public.ops_expected_deliveries to authenticated;

drop policy if exists ops_expected_deliveries_select on public.ops_expected_deliveries;
create policy ops_expected_deliveries_select on public.ops_expected_deliveries
  for select to authenticated
  using (public.has_permission('planning.schedule.read'));

drop policy if exists ops_expected_deliveries_insert on public.ops_expected_deliveries;
create policy ops_expected_deliveries_insert on public.ops_expected_deliveries
  for insert to authenticated
  with check (created_by = auth.uid() and public.has_permission('planning.depot.manage'));

drop policy if exists ops_expected_deliveries_update on public.ops_expected_deliveries;
create policy ops_expected_deliveries_update on public.ops_expected_deliveries
  for update to authenticated
  using (public.has_permission('planning.schedule.write'))
  with check (public.has_permission('planning.schedule.write'));

drop policy if exists ops_expected_deliveries_delete on public.ops_expected_deliveries;
create policy ops_expected_deliveries_delete on public.ops_expected_deliveries
  for delete to authenticated
  using (public.has_permission('planning.depot.manage'));

-- ---------------------------------------------------------------------------
-- Kvittering: en väntad leverans blir en lagerrad
-- ---------------------------------------------------------------------------
--
-- ⚠️ TVÅ SKRIVNINGAR SOM MÅSTE LYCKAS IHOP. En insert i ops_depot_deliveries och en update av den
-- väntade raden. PostgREST ger ingen transaktion, men plpgsql via .rpc() gör det.
--
--   lagerrad skriven, väntad rad kvar som 'expected'
--     -> samma säckar räknas både som lager OCH som på väg -> UNDERbeställning, och det upptäcks
--        först när en bil står utan material
--   väntad rad satt till 'arrived', lagerrad uteblev
--     -> saldot för lågt -> överbeställning (dyrt men ofarligt)
--
-- Funktionen gör dessutom "ta emot en gång" till en databasregel: en dubbelkvittering är inte ett
-- gränssnittsfel utan en dubbeldebitering av lagret.
--
-- ⚠️ ANROPA ALDRIG MED SERVICE-ROLE-KLIENTEN. has_permission nycklar allt på auth.uid(), som är
-- null under service-role, så grinden nedan skulle alltid neka. Sessionsklienten, alltid.
-- (Samma fälla som en gång gjorde att admin inte kunde skapa användare, tyst i tre månader.)

create or replace function public.receive_expected_delivery(
  p_expected_id  uuid,
  p_delivered_on date,
  p_sacks        integer,
  p_note         text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row         public.ops_expected_deliveries%rowtype;
  v_delivery_id uuid;
  v_name        text;
begin
  -- SECURITY DEFINER går förbi RLS på båda tabellerna, så nyckeln prövas här. Samma nyckel som
  -- ops_depot_deliveries_insert kräver: mottagning är lagerarbete.
  if not public.has_permission('planning.schedule.write') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_sacks is null or p_sacks <= 0 then
    raise exception 'invalid_sacks' using errcode = '22023';
  end if;
  -- Samma tak som createDeliverySchema: en leverans daterad framåt höjer saldot redan idag och
  -- tystar bristvarningen.
  if p_delivered_on is null or p_delivered_on > ((now() at time zone 'Europe/Stockholm')::date) then
    raise exception 'delivered_on_in_future' using errcode = '22023';
  end if;

  select * into v_row from public.ops_expected_deliveries where id = p_expected_id for update;
  if not found then
    raise exception 'expected_not_found' using errcode = 'P0002';
  end if;
  if v_row.status <> 'expected' then
    raise exception 'expected_not_open' using errcode = '23514';
  end if;

  select full_name into v_name from public.profiles where id = auth.uid();

  insert into public.ops_depot_deliveries (depot_id, material, sacks, delivered_on, note, created_by)
  values (v_row.depot_id, v_row.material, p_sacks, p_delivered_on, coalesce(p_note, v_row.note), auth.uid())
  returning id into v_delivery_id;

  update public.ops_expected_deliveries
     set status = 'arrived',
         delivery_id = v_delivery_id,
         arrived_at = now(),
         arrived_by = auth.uid(),
         arrived_by_name = v_name
   where id = p_expected_id;

  return v_delivery_id;
end $$;

revoke all on function public.receive_expected_delivery(uuid, date, integer, text) from public;
grant execute on function public.receive_expected_delivery(uuid, date, integer, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------
--
-- Egen block i den här filen, inte en redigering av 20260612_enable_realtime_ops_tables.sql — den
-- är körd. Samma mönster som 20260613_ops_activity_events.sql.
--
-- Tabellen bär inget känsligt (depå, material, antal, datum), så en publicerad rad läcker ingenting
-- som inte redan är läsbart för planning.schedule.read. En kommande leverantörs- eller ordertabell
-- är en annan sak: postgres_changes skickar hela raden vid INSERT oavsett RLS, och en mailadress
-- hör inte hemma i den strömmen.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'ops_expected_deliveries'
  ) then
    alter publication supabase_realtime add table public.ops_expected_deliveries;
  end if;
  alter table public.ops_expected_deliveries replica identity full;
end $$;

-- ---------------------------------------------------------------------------
-- Verifiering (kör efter applicering)
-- ---------------------------------------------------------------------------
--
-- 1. Tabellen har RLS och fyra policyer:
--
--    select relrowsecurity from pg_class where oid = 'public.ops_expected_deliveries'::regclass;
--    select policyname, cmd from pg_policies
--    where schemaname = 'public' and tablename = 'ops_expected_deliveries' order by policyname;
--
-- 2. Saldot ser ingen väntad leverans. Lägg in en rad för hand och kontrollera att
--    ops_depot_deliveries är oförändrad:
--
--    select count(*) from public.ops_depot_deliveries;   -- före och efter, samma tal
--
-- 3. Dubbelkvittering nekas. Kör receive_expected_delivery två gånger på samma id — andra gången
--    ska ge 'expected_not_open', och antalet rader i ops_depot_deliveries ska ha ökat med ETT:
--
--    select public.receive_expected_delivery('<uuid>', current_date, 180, null);
--    select public.receive_expected_delivery('<uuid>', current_date, 180, null);  -- ska fela
