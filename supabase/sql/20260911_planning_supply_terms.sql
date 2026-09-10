-- Leveransvillkoren — ledtid och pallstorlek — läsbara för den som får se schemat.
--
-- BAKGRUND: EN TYST DEGRADERING SOM BARA ADMIN INTE SÅG
-- Prognosen (depotForecast) behöver två tal per material: leverantörens LEDTID (för att datera
-- beställningen bakåt från run-out) och PALLSTORLEKEN (för att avrunda antalet). Båda bor på
-- ops_material_suppliers, vars SELECT-policy kräver planning.depot.manage — med rätta, för raden
-- bär också fabrikens mailadress och kontaktperson.
--
-- ⚠️ MEN RLS NEKAR INTE, DEN FILTRERAR. Lagerrutten grindar på planning.schedule.read, som `sales`
-- och `konsult` håller. För dem returnerade leverantörsläsningen NOLL RADER UTAN FEL — och
-- prognosen föll då tillbaka på "ingen ledtid, ingen avrundning" utan att något syntes. Mätt på
-- samma data, samma sekund:
--
--     admin:  beställ senast 2026-09-23, 1056 säck
--     sales:  beställ senast 2026-09-30, 1043 säck
--
-- Alltså: planeraren fick "beställ senast den dag depån är tom". Ledtiden på sju dagar försvann
-- tyst, och felet gick åt det farliga hållet. Att en läsning failar STÄNGT hjälper inte när
-- utfallet inte är ett fel utan en tom lista.
--
-- LÖSNINGEN: dela raden, inte grinden. Villkoren nedan bär ingenting känsligt — de säger hur lång
-- ledtid ett material har och hur stor pallen är, aldrig VEM som levererar. Namn, mailadress,
-- kontaktperson, telefon och notering stannar kvar bakom planning.depot.manage.
--
-- ⚠️ LÄGG ALDRIG TILL name, email, contact_name, phone ELLER note I RETURTYPEN. Hela skälet att
-- funktionen finns är att den är smalare än tabellen. Behöver något dem är det tabellen som ska
-- läsas, med sin egen grind.
--
-- DEPLOY-ORDNING
-- ⚠️ SQL FÖRE KODEN. Koden anropar rpc('planning_supply_terms'); saknas funktionen svarar PostgREST
-- 404 (PGRST202), och eftersom lagerläsningen failar stängt slår det ut HELA lagervyn och
-- bristbanderollen — inte bara ledtiden.
--
-- Kör EFTER 20260910_ops_material_suppliers.sql och 20260911_ops_material_suppliers_round_up_to.sql
-- (funktionen läser round_up_to).
--
-- Kör i Supabase SQL editor. Idempotent — kör den TVÅ gånger innan du litar på påståendet.
-- Inga tecken utanför BMP i den här filen.

create or replace function public.planning_supply_terms()
returns table (
  supplier_id    uuid,
  materials      text[],
  lead_time_days integer,
  round_up_to    integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  -- SECURITY DEFINER går förbi RLS på ops_material_suppliers, så grinden prövas här. Board-nivå,
  -- till skillnad från tabellen: prognosen visas för alla som får se schemat.
  --
  -- ⚠️ ALDRIG MED SERVICE-ROLE-KLIENTEN. has_permission nycklar allt på auth.uid(), som är null
  -- under service-role — grinden nedan skulle då alltid neka. Sessionsklienten, alltid. (Samma
  -- fälla som en gång gjorde att admin inte kunde skapa användare, tyst i tre månader.)
  if not public.has_permission('planning.schedule.read') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- Bara AKTIVA. En avvecklad leverantörs ledtid får inte styra en ny beställning — samma regel som
  -- suppliersForMaterial i domänlagret, och att den gäller redan här är avsiktlig dubbel botten.
  return query
    select s.id, s.materials, s.lead_time_days, s.round_up_to
    from public.ops_material_suppliers s
    where s.active;
end $$;

revoke all on function public.planning_supply_terms() from public;
grant execute on function public.planning_supply_terms() to authenticated;

-- ---------------------------------------------------------------------------
-- Verifiering (kör efter applicering)
-- ---------------------------------------------------------------------------
--
-- 1. Funktionen finns, är SECURITY DEFINER och STABLE:
--
--    select p.proname, p.prosecdef, p.provolatile
--    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname = 'planning_supply_terms';
--    -- prosecdef = true, provolatile = 's'
--
-- 2. RETURTYPEN LÄCKER INGET. Frågan ska ge exakt fyra kolumner, och ingen av dem får heta
--    name, email, contact_name, phone eller note:
--
--    select unnest(p.proargnames) as col
--    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname = 'planning_supply_terms';
--
-- 3. Den ger samma villkor som tabellen, för en admin:
--
--    select * from public.planning_supply_terms() order by supplier_id;
--    select id, materials, lead_time_days, round_up_to
--    from public.ops_material_suppliers where active order by id;
--    -- samma rader
--
-- 4. En INAKTIV leverantör syns inte:
--
--    update public.ops_material_suppliers set active = false where id = '<uuid>';
--    select count(*) from public.planning_supply_terms() where supplier_id = '<uuid>';  -- 0
--    update public.ops_material_suppliers set active = true where id = '<uuid>';
--
-- 5. ⚠️ DET SOM FAKTISKT SKA PROVAS: en användare med schedule.read men UTAN depot.manage får
--    villkoren, men INTE tabellen. Logga in som en sales-användare i appen och kontrollera att
--    prognoskortet visar "beställ senast" med ett datum som ligger FÖRE run-out-dagen — det är
--    beviset att ledtiden kom fram. Kontrollera samtidigt att Leverantörer-fliken inte syns.
