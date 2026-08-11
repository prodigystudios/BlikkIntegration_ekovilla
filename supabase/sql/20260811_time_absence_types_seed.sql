-- Tid & lön (fas 4) — frånvaroorsakerna, från lönebyrån.
--
-- Listan kommer direkt från byrån (2026-08-11) och är därmed auktoritativ på ett sätt Blikks lista
-- inte är: det är de här nio raderna hon vill kunna se i underlaget. Seedas i stället för att
-- importeras.
--
-- `code` får ett unikt index så seeden går att köra om utan dubbletter. Namnen är inte unika i
-- tabellen (och ska inte vara det — admin kan behöva två varianter av samma sak), så koden är det
-- som gör raden identifierbar.
--
-- `payroll_code` lämnas TOM med flit. Det är byråns egen benämning på löneart, och ingen i det här
-- repot vet vad den ska vara — admin fyller i den i Admin → Tidkoder, där en gul ruta räknar hur
-- många aktiva rader som saknar den.
--
-- ⚠️ HAR DU REDAN KÖRT "Hämta från Blikk" på frånvarotyper? Då kan Blikks egna rader ligga kvar med
-- liknande namn. De blir inte dubbletter i teknisk mening (olika `code`), men två "Semester" i en
-- dropdown är ett sätt att få fel lönesort. Verifieringsfrågan längst ned listar överlapp — inaktivera
-- Blikk-raden (is_active = false), radera aldrig: historiken får inte tappa sin lönesort.
--
-- DEPLOY-ORDNING: efter 20260811_time_reference_tables.sql. Idempotent.

create unique index if not exists crm_absence_types_code_uniq on public.crm_absence_types (code);

insert into public.crm_absence_types (code, name, sort_index) values
  ('SEM',  'Semester',                        10),
  ('SJK',  'Sjukfrånvaro',                    20),
  ('VAB',  'VAB',                             30),
  ('FLD',  'Föräldraledighet',                40),
  ('TIO',  '10-dagar vid barns födelse',      50),
  ('TJL',  'Tjänstledighet',                  60),
  ('ATF',  'Uttag ATF (arbetstidsförkortning)', 70),
  ('KOMP', 'Uttag komp',                      80),
  ('PERM', 'Permission (betald ledighet)',    90)
on conflict (code) do nothing;

-- ── Verifiering ──────────────────────────────────────────────────────────────
-- Nio rader, alla aktiva, ingen med lönesort än:
--   select code, name, payroll_code, is_active from public.crm_absence_types order by sort_index;
--
-- Överlapp mot en tidigare Blikk-import (ska helst vara tom — annars inaktivera Blikk-raden):
--   select a.code, a.name as seedad, b.name as fran_blikk, b.blikk_id
--   from public.crm_absence_types a
--   join public.crm_absence_types b
--     on lower(b.name) = lower(a.name) and b.id <> a.id and b.blikk_id is not null
--   where a.blikk_id is null;
