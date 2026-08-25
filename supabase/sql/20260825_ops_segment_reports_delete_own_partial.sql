-- Rapportören får ta bort sin egen delrapport.
--
-- BAKGRUND — DET HÄR VÄNDER PÅ ETT TIDIGARE BESLUT, LÄS VARFÖR
-- 20260820_ops_segment_reports_sack_reporting.sql gav besättningen SELECT och INSERT men medvetet
-- varken UPDATE eller DELETE: "huvudboken är append-only från fältet, en felskriven delrapport
-- rättas med en ny rad". Den filen säger till och med att om en radpolicy någon gång behövdes
-- skulle den nycklas på kind = 'final' och aldrig ge besättningen delete på partials.
--
-- Det höll inte i drift. 2026-08-24 hade två installatörer dålig mottagning, tryckte Spara, såg
-- ingenting hända och rapporterade en gång till. Båda skrivningarna gick igenom och jobbets total
-- blev dubbel. Med append-only fanns ingen rättning alls: en ny rad kan bara ADDERA (kolumnen har
-- `check (sacks_blown >= 0)`, så en negativ motbokning är omöjlig), kontoret hade ingen knapp, och
-- fältet fick inte röra raden. Den enda vägen var en manuell delete i Supabase.
--
-- Williams beslut 2026-08-25: kontoret OCH den installatör som skrev rapporten ska kunna ta bort
-- den. Den här filen ger den andra halvan — kontorets väg finns redan (ops_segment_reports_delete,
-- 20260611, gatar på planning.schedule.write) och rörs inte här.
--
-- VAD SOM INTE ÄNDRAS
--   * Egenkontrollens rader (kind = 'final') kan INTE tas bort den här vägen. Se avsnittet nedan
--     om varför just det villkoret bär hela regeln.
--   * Ingen UPDATE-policy. En rad rättas genom att tas bort och skrivas om, aldrig genom att
--     skrivas om under läsarens fötter.
--   * Kontorets fyra befintliga policyer och besättningens två från 20260820 rörs inte.
--
-- DEPLOY-ORDNING: KÖR DEN HÄR FÖRE KODEN.
-- Additiv i den meningen att ingenting befintligt ändras, men koden räknar med den: utan policyn
-- ser installatören en "Ta bort"-knapp vars DELETE träffar noll rader och svarar 403. Inget går
-- sönder och ingen data far illa, men knappen ljuger tills filen är körd.
--
-- Kör i Supabase SQL editor. Idempotent (kör den två gånger innan du litar på påståendet).
--
-- ⚠️ INGA EMOJI UTANFÖR BMP I DEN HÄR FILEN. Ett surrogatpar kapar en `--`-kommentar mitt i raden
-- och rullar tillbaka HELA migreringen — belagt 2026-08-20, se huvudet i 20260820-filen. ⚠️ och ✅
-- ligger i BMP och är ofarliga.

-- ---------------------------------------------------------------------------
-- DELETE: din egen delrapport, på ett jobb du är besättning på
-- ---------------------------------------------------------------------------
-- Tre villkor, och varje villkor stänger ett eget hål:
--
--   1. kind = 'partial'
--      BÄR HELA SÄKERHETEN I REGELN, och är inte samma sak som "installatören skrev den inte".
--      Egenkontrollen (dörr 1) skriver sina final-rader genom SESSIONSKLIENTEN med
--      created_by = installatörens id — alltså skulle villkor 2 och 3 ensamma ha gett hen delete
--      på sin egen egenkontroll. Och att radera en final är inte en liten sak: regeln är "finns en
--      final är den jobbets sanning, annars summan av partial", så när den sista finalen försvinner
--      SLÄPPS delrapporterna fram som total igen. En borttagning som ser ut att sänka siffran hade
--      alltså höjt den (30 + 25 där svaret var 91). Egenkontrollen rättas genom att lämnas in på
--      nytt — den vägen ersätter mängden och är redan byggd.
--
--   2. created_by = auth.uid()
--      "Installatören SOM RAPPORTERADE", inte vem som helst i besättningen. Två man på samma jobb
--      ska inte kunna städa bort varandras rader; den som skrev den vet vad den var.
--
--   3. is_user_on_work_order(auth.uid(), work_order_id)
--      Samma funktion som SELECT- och INSERT-policyerna redan vilar på (20260810_crm_work_order_
--      crew_access.sql, definieras INTE om här), så borttagningen kan inte nå längre än
--      rapporteringen gjorde. Priset är att en installatör som lyfts ur besättningen efteråt inte
--      längre kan rätta sin egen rad — då får kontoret göra det, och det är rätt ordning.
--
-- PostgreSQL OR-kombinerar permissiva policyer, så den här ligger BREDVID kontorets
-- ops_segment_reports_delete (planning.schedule.write). Ingen roll tappar något.
--
-- ⚠️ Borttagningen är HÅRD — raden är borta, inte överstruken. Ett "annullerad"-flagga hade krävt
-- en kolumn OCH en ändring i båda summeringsställena (reportedSacksByWorkOrder och
-- deriveConsumptionRows), och missas det andra dubbeldebiteras depån av rader ingen längre ser.
-- Spåret på ordern visar fortfarande allt som FINNS; en borttagen dubblett ska inte finnas.
drop policy if exists ops_segment_reports_delete_own_partial on public.ops_segment_reports;
create policy ops_segment_reports_delete_own_partial
  on public.ops_segment_reports
  for delete
  to authenticated
  using (
    kind = 'partial'
    and created_by = auth.uid()
    and public.is_user_on_work_order(auth.uid(), work_order_id)
  );

-- Tabellgrants (select, insert, update, delete till authenticated) finns sedan 20260611 — en
-- policy utan grant gör ingenting alls, men här behövs inget nytt grant.

-- ---------------------------------------------------------------------------
-- Verifiering (kör efter applicering)
-- ---------------------------------------------------------------------------
--
-- 1. Sju policyer: kontorets fyra (20260611), besättningens två (20260820) och den här. Ser du
--    färre har du ersatt i stället för att lägga till:
--
--      select policyname, cmd from pg_policies
--      where schemaname = 'public' and tablename = 'ops_segment_reports'
--      order by cmd, policyname;
--
--    Förväntat på DELETE: ops_segment_reports_delete + ops_segment_reports_delete_own_partial.
--
-- 2. Punktprovet som betyder något — impersonera enligt metoden i
--    20260811_crm_work_order_rls_perf_probe.sql (rollbytet, satsen och avläsningen MÅSTE ligga i
--    EN sats). Kör mot ett jobb där installatören har en egen delrapport:
--
--      begin;
--      -- som installatören: den egna delrapporten ska försvinna
--      delete from public.ops_segment_reports where id = '<egen partial>' returning id;
--      -- som installatören: kollegans rad och egenkontrollens rad ska ge NOLL rader
--      delete from public.ops_segment_reports where id = '<kollegans partial>' returning id;
--      delete from public.ops_segment_reports where id = '<egen final>' returning id;
--      rollback;
--
--    ⚠️ Läs `returning`-utfallet, inte frånvaron av fel. En DELETE som RLS nekar är INTE ett fel —
--    den svarar "0 rader" och ser i loggen ut precis som en lyckad borttagning av en rad som redan
--    var borta. Det är samma fälla som gör att routen måste läsa tillbaka raden den raderade.
--
-- 3. Totalen ska röra sig åt rätt håll efteråt. På ett jobb med en dubblett:
--
--      select kind, count(*), sum(sacks_blown) from public.ops_segment_reports
--      where work_order_id = '<work_order_id>' group by 1;
