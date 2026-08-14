-- Klockslag blir obligatoriska på arbetstid (fas 4.6)
--
-- William 2026-08-14: "klockslag bör vara tvingade då det är dom vi kommer räkna emot så vi
-- faktiskt kan ge ob och övertid där det krävs". Villkoret låg färdigskrivet som kommentar i
-- 20260811_time_entries_reshape.sql (kring rad 146) och flyttas hit oförändrat.
--
-- ⚠️ KÖR DEN HÄR FILEN EFTER ATT KODEN ÄR DEPLOYAD, inte före.
-- Villkoret avvisar precis det som kontorets Tid-flik skrev tidigare (datum + timmar). Körs det
-- först slutar fliken fungera för alla som hunnit ladda den gamla sidan. Additiva migreringar får
-- köras i vilken ordning som helst — den här är inte additiv.
--
-- ⚠️ `kind = 'absence'` i undantaget är INTE slarv. Lönebyrån vill ha frånvaro i TIMMAR
-- ("Frånvarotimmar" i hennes layout), inte som ett pass: en halv dag VAB är fyra timmar, inte
-- 08:00–12:00. Bara ARBETSTID kräver klockslag. Ta inte bort undantaget.
--
-- `source <> 'crm'` friar de gamla kontorsraderna för alltid. Det är inte en eftergift utan
-- mekanismen: reshapen lade till kolumnen med `default 'legacy_office'` och flippade defaulten till
-- 'crm' efteråt, så allt som fanns före 2026-08-11 bär `legacy_office` och allt nytt bär `crm`.
-- Gränsen mellan "det vi ärvde" och "det vi lovar" är alltså redan dragen i datat.


-- ── 1. Preflight — KÖR DEN HÄR FÖRST, FÖR SIG ────────────────────────────────
-- Raderna som villkoret skulle avvisa: skrivna av den nya koden (source='crm') men utan klockslag.
-- I praktiken rader som kontorets Tid-flik skapade mellan reshapen 2026-08-11 och den här deployen.
--
--   select id, user_id, work_date, hours, minutes_worked, note, created_at
--   from public.crm_time_entries
--   where source = 'crm' and kind <> 'absence'
--     and (start_time is null or end_time is null or minutes_worked is null)
--   order by work_date;
--
-- Noll rader → hoppa direkt till steg 3 och kör constraint:et VALIDERAT.
-- Några rader → antingen komplettera dem med klockslag, eller radera dem om de är testdata:
--
--   -- komplettera (exempel; sätt riktiga tider per rad):
--   update public.crm_time_entries
--      set start_time = '07:00', end_time = '16:00', break_minutes = 60, minutes_worked = 480
--    where id = '<uuid>';
--
--   -- eller radera, men BARA efter att du tittat på dem ovan:
--   delete from public.crm_time_entries
--    where source = 'crm' and kind <> 'absence'
--      and (start_time is null or end_time is null or minutes_worked is null);
--
-- ⚠️ En delete här tar bort någons rapporterade tid. Läs listan innan, inte efter.


-- ── 2. Villkoret ─────────────────────────────────────────────────────────────
-- NOT VALID: regeln tvingas på alla NYA och ÄNDRADE rader direkt, men befintliga rader prövas inte.
-- Det gör steget ögonblickligt och riskfritt även om preflighten hoppades över — låset finns på
-- plats från och med nu, oavsett vad som ligger bakåt.
--
-- `create constraint` har inget `or replace`, så drop först. Filen är därmed körbar mer än en gång.
alter table public.crm_time_entries drop constraint if exists crm_time_entries_clock_check;
alter table public.crm_time_entries add constraint crm_time_entries_clock_check check (
  source <> 'crm' or kind = 'absence'
  or (start_time is not null and end_time is not null and minutes_worked is not null)
) not valid;


-- ── 3. Befordra till validerat — när preflighten ger noll rader ──────────────
-- Först då gäller villkoret även bakåt, och `pg_constraint.convalidated` blir true. Kör som eget
-- steg; misslyckas det betyder det att steg 1 inte är avklarat, inte att något är trasigt.
--
--   alter table public.crm_time_entries validate constraint crm_time_entries_clock_check;


-- ── Verifiering ──────────────────────────────────────────────────────────────
--   select conname, convalidated
--   from pg_constraint
--   where conrelid = 'public.crm_time_entries'::regclass and conname = 'crm_time_entries_clock_check';
--
-- Och att det faktiskt biter (ska ge ett fel, inte en rad):
--   insert into public.crm_time_entries (user_id, kind, work_order_id, work_date, hours)
--   values (auth.uid(), 'work_order', '<order-uuid>', current_date, 8);
