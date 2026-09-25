-- Samtal loggade FRÅN en offert kopplas till just den offerten.
--
-- VARFÖR
-- Säljaren vill kunna logga ett samtal direkt i offertmodalen och se offertens samtal samlade där,
-- precis som uppgiftsflödet som byggdes i PR #157. crm_calls har hittills bara känt kund och
-- prospekt, alltså vem samtalet gällde — aldrig vilket ärende det handlade om.
--
-- KÖR DEN HÄR FILEN FÖRE KODEN. ⚠️ Additiv i databasen, men INTE fri i ordningen: koden läser
-- quote_id i crmCallSelect, och en kolumn som inte finns får PostgREST att svara 400 på HELA
-- frågan — alltså slocknar samtalslistan, kundkortets samtalshistorik och CRM-översiktens
-- samtalsrader på en gång. Samma fälla som en kolumn i ARTICLE_CACHE_SELECT en gång var.
--
-- on delete set null, INTE cascade: ett loggat samtal är en anteckning om något som faktiskt hänt
-- och ska överleva att offerten raderas. Kopplingen försvinner, samtalet står kvar på kunden.
--
-- RLS RÖRS INTE. crm_calls_select_visible är fortfarande "eget samtal, egen tilldelad kund, eller
-- admin". Offertkortet läser i stället elevated bakom en grind på OFFERTEN (samma konstruktion som
-- /api/crm/quotes/[id]/tasks): syns inte offerten för sessionen svarar routen 404 och den elevated
-- frågan körs aldrig. Att vidga policyn hade gett kollegors samtal överallt, inte bara i kortet.
--
-- Idempotent, säker att köra om.

alter table public.crm_calls
  add column if not exists quote_id uuid references public.crm_quotes(id) on delete set null;

-- Kortet frågar "den här offertens samtal, senaste först".
create index if not exists crm_calls_quote_call_at_idx
  on public.crm_calls(quote_id, call_at desc);

comment on column public.crm_calls.quote_id is
  'Offerten samtalet loggades från (CRM-offertmodalen). Null för samtal loggade utanför en offert.';

-- Verifiering:
--   select column_name, data_type, is_nullable
--   from information_schema.columns
--   where table_schema = 'public' and table_name = 'crm_calls' and column_name = 'quote_id';
