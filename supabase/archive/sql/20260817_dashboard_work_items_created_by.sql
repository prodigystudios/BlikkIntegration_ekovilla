-- Vem som skapade en uppgift, när det inte är den som ska göra den.
--
-- Säljchefen ska kunna lägga upp CRM-uppgifter åt sina säljare och se vad han delegerat.
-- CRM-uppgifter är rader i den här tabellen (kind='note', metadata.crm=true), så kolumnen
-- läggs där. Den fylls i på ALLA nya uppgifter, inte bara delegerade — en halvfylld kolumn är
-- svårare att lita på än en tom.
--
-- ⚠️ KÖR FÖRE KODEN. Rutten skriver created_by på varje uppgift som skapas; utan kolumnen
-- avvisar PostgREST insert:en och då går det inte att skapa NÅGON uppgift, inte bara de
-- delegerade. Migrationen är rent additiv och påverkar ingenting som redan finns, så den är
-- ofarlig att köra i förväg.
--
-- INGEN POLICYÄNDRING, och det är avsiktligt.
--
-- Det naturliga hade varit att lägga en gren i SELECT-policyn — `or auth.uid() = created_by` —
-- så att skaparen kunde läsa sina delegerade rader direkt. Men tabellen är den PERSONLIGA
-- dashboarden: den bär allas privata anteckningar och möten, och components/dashboard/
-- DashboardNotes.tsx läser den UTAN user_id-filter och litar helt på RLS för avgränsningen.
-- En vidgad policy hade därför omedelbart fyllt chefens egen dashboard med de uppgifter han
-- lagt på andra — tyst, eftersom frågan inte har något filter som kan märka skillnaden, och på
-- en icke-CRM-yta som ligger i den uppskjutna ombyggnaden.
--
-- Läsningen av "uppgifter jag delegerat" görs i stället i CRM-rutten med en elevated klient,
-- hårt scopad till created_by = den inloggade. Auktoriseringen är trivial (det är hans egna
-- rader) och inget annat blir läsbart.
--
-- on delete set null: en chef kan sluta utan att säljarens uppgift går sönder.
-- Idempotent.

alter table public.dashboard_work_items
  add column if not exists created_by uuid references public.profiles(id) on delete set null;

-- Partiellt index: bara delegerade rader frågas på created_by, och de är en minoritet.
create index if not exists dashboard_work_items_created_by_idx
  on public.dashboard_work_items (created_by, created_at desc)
  where created_by is not null;

comment on column public.dashboard_work_items.created_by is
  'Vem som skapade raden. Skiljer sig från user_id när en uppgift delegerats (chef → säljare). RLS oförändrad — se huvudkommentaren i 20260817_dashboard_work_items_created_by.sql.';
