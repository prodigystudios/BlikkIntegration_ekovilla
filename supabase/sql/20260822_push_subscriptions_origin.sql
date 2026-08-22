-- Push-prenumerationer: vilket origin skapades raden på?
--
-- Bakgrund: appen flyttade från blikk-integration-ekovilla.vercel.app till app.ekovilla.se, och
-- den gamla adressen lever kvar parallellt. En PushSubscription är bunden till service workerns
-- origin, så en rad som skapades på den gamla adressen levererar till den gamla installationen —
-- inte till den nya. Utan den här kolumnen går de två sorterna inte att skilja åt.
--
-- ⚠️ SQL FÖRST, KODEN SEDAN. Kolumnen är nullbar, men koden är INTE valfri i sin tur: upserten i
-- app/api/push/subscription/route.ts skickar alltid med `origin`, och PostgREST svarar 400
-- (PGRST204, "could not find the 'origin' column") om kolumnen saknas. Deployas koden först
-- returnerar varje POST 500 och INGEN kan slå på notiser förrän den här filen är körd.
--
-- Befintliga rader får null = "skapad före den här kolumnen, origin okänt".
--
-- Städningen av legacy-rader ligger MEDVETET inte här, utan i
-- supabase/sql/manual/20260822_push_subscriptions_dedupe_legacy_origin.sql — den får inte köras
-- av migreringskedjan. Se den filen för varför.

alter table public.dashboard_push_subscriptions
  add column if not exists origin text;

comment on column public.dashboard_push_subscriptions.origin is
  'Browser-origin som prenumerationen skapades pa, t.ex. https://app.ekovilla.se. Stamplas av app/api/push/subscription/route.ts fran requestens host - INTE fran NEXT_PUBLIC_SITE_URL, som alltid pekar pa den kanoniska domanen. null = rad skapad innan kolumnen fanns.';
