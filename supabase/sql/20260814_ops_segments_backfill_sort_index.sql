-- Ge befintliga placeringar den ordning de faktiskt lades ut i (planering, fas 7)
--
-- William 2026-08-14: "dom har ju en satt ordning i planering 1 och 2?" — nej, och det var hela
-- poängen. Badgen "Ordning på dagen" renderar en POSITION (`order.index + 1`), inte ett lagrat
-- värde, så den räknade 1, 2, 3 även när ingen ordning fanns. Under ytan hade varje placering
-- kolumnens default `0`, eftersom ingen skrivväg utom upp/ner-pilarna någonsin satte fältet.
--
-- Med allt på 0 var jobben på en dag likvärdiga, och visningsordningen föll tillbaka på id — ett
-- slumpat UUID. Symptomet William såg: två jobb på leveransbilen bytte plats när ett jobb på en
-- HELT ANNAN bil flyttades till en annan dag. (Den delen är fixad i koden: en gemensam jämförare
-- plus id som sista brytpunkt i frågan. Den här filen fyller i det som saknas — en MENINGSFULL
-- ordning i stället för bara en stabil.)
--
-- ⚠️ KÖRS EFTER KODEN, men ordningen är ofarlig åt båda håll. Additiv i schemat (rör bara data),
-- och ingen kodväg kraschar på något värde i sort_index. Kör man SQL:en först får ett jobb som
-- placeras innan deployen fortfarande 0 och hamnar först på sin dag — irriterande, inte trasigt,
-- och rättas med pilarna.


-- ── Torrkörning: kör DEN HÄR FÖRST och titta på resultatet ────────────────────
-- Visar exakt vilka rader som skulle ändras, och till vad. Ändrar ingenting.
--
--   with untouched as (
--     select truck_id, start_day
--       from public.ops_segments
--      group by truck_id, start_day
--     having max(sort_index) = 0 and count(*) > 1
--   )
--   select s.truck_id, s.start_day, s.id, s.created_at, s.sort_index as nu,
--          row_number() over (partition by s.truck_id, s.start_day
--                             order by s.created_at, s.id) - 1 as blir
--     from public.ops_segments s
--     join untouched u on u.truck_id = s.truck_id and u.start_day = s.start_day
--    order by s.truck_id, s.start_day, blir;
--
-- Förväntat: bara dagar med FLER ÄN ETT jobb, och `blir` ska följa `created_at` stigande.
-- Ser du en dag där du redan satt ordningen för hand ska den INTE dyka upp här.


-- ── Backfillen ───────────────────────────────────────────────────────────────
-- ⚠️ `untouched` är hela säkerheten i den här filen, och den finns av två skäl:
--
--   1. Den skyddar manuellt satt ordning. Har någon redan tryckt på pilarna för en bil+dag så har
--      den gruppen ett max(sort_index) > 0, och då rör vi den inte. Utan det villkoret hade en
--      omkörning tyst skrivit över planerarnas egna beslut med created_at-ordningen.
--   2. Den gör filen idempotent i praktiken. Efter första körningen har varje flerjobbsdag
--      max(sort_index) > 0, så en andra körning matchar ingenting och är en no-op.
--
-- `count(*) > 1` utesluter dagar med ett enda jobb: där är 0 redan rätt, och att skriva 0 = 0 hade
-- bara skräpat ner updated_at.
--
-- Sorteringen är `created_at, id`: den ordning ni faktiskt lade ut jobben. id:t är bara med som
-- sista brytpunkt ifall två rader delar tidsstämpel på mikrosekunden — samma tiebreak som
-- compareBoardOrder i koden, så databasen och tavlan är överens.
with untouched as (
  select truck_id, start_day
    from public.ops_segments
   group by truck_id, start_day
  having max(sort_index) = 0 and count(*) > 1
),
ranked as (
  select s.id,
         row_number() over (partition by s.truck_id, s.start_day
                            order by s.created_at, s.id) - 1 as rn
    from public.ops_segments s
    join untouched u on u.truck_id = s.truck_id and u.start_day = s.start_day
)
update public.ops_segments s
   set sort_index = r.rn
  from ranked r
 where r.id = s.id
   and s.sort_index is distinct from r.rn;


-- ── Verifiering ──────────────────────────────────────────────────────────────
-- Inga flerjobbsdagar ska ligga kvar på idel nollor (ska ge 0 rader):
--   select truck_id, start_day, count(*)
--     from public.ops_segments
--    group by truck_id, start_day
--   having max(sort_index) = 0 and count(*) > 1;
--
-- Ordningen ska följa created_at (stickprov på en bil+dag du känner igen):
--   select id, created_at, sort_index
--     from public.ops_segments
--    where truck_id = '<uuid>' and start_day = '<YYYY-MM-DD>'
--    order by sort_index;
--
-- Inga dubbletter inom en dag (ska ge 0 rader):
--   select truck_id, start_day, sort_index, count(*)
--     from public.ops_segments
--    group by truck_id, start_day, sort_index
--   having count(*) > 1;
-- (⚠️ Ett fåtal dubbletter här är INTE ett fel i sig — två planerare som placerar samtidigt kan
-- landa på samma index, och tavlan är fortfarande stabil tack vare id-brytpunkten. Men direkt
-- efter den här körningen ska det vara tomt.)
