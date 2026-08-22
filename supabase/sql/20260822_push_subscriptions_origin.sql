-- Push-prenumerationer: vilket origin skapades raden på?
--
-- Bakgrund: appen flyttade från blikk-integration-ekovilla.vercel.app till app.ekovilla.se, och
-- den gamla adressen lever kvar parallellt. En PushSubscription är bunden till service workerns
-- origin, så en rad som skapades på den gamla adressen levererar till den gamla installationen —
-- inte till den nya. Utan den här kolumnen går de två sorterna inte att skilja åt.
--
-- ADDITIV: kolumnen är nullbar och ingen kod kräver den. Ordningen mot deployen är fri.
-- Befintliga rader får null = "skapad före den här kolumnen, origin okänt" (i praktiken legacy).
--
-- Städningen av legacy-rader ligger MEDVETET inte här, utan i
-- supabase/sql/manual/20260822_push_subscriptions_dedupe_legacy_origin.sql — den får inte köras
-- av migreringskedjan. Se den filen för varför.

alter table public.dashboard_push_subscriptions
  add column if not exists origin text;

comment on column public.dashboard_push_subscriptions.origin is
  'Browser-origin som prenumerationen skapades pa, t.ex. https://app.ekovilla.se. Stamplas av app/api/push/subscription/route.ts fran requestens host - INTE fran NEXT_PUBLIC_SITE_URL, som alltid pekar pa den kanoniska domanen. null = rad skapad innan kolumnen fanns.';
