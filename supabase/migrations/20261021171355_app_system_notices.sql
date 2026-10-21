-- Driftmeddelanden: bannern överst i appen ("Uppdatering pågår", "Driftstörning" …).
--
-- En admin slår på ett meddelande under Admin → Driftmeddelanden; det visas för ALLA inloggade, även montörerna i
-- fältvyn, tills admin slår av det eller den valfria sluttiden passerat. Var och en kan stänga det för sig själv tills
-- det ändras (det sköts i webbläsaren, inte här).
--
--   kind             update | maintenance | disruption | info — styr etikett och färg.
--   message          det användaren läser, en eller två rader.
--   affected_areas   vilka delar av appen som berörs (nycklarna i lib/domains/systemNotices/types.ts). Tom = inget sagt.
--   starts_at        när det slogs på.
--   ends_at          null = tills admin slår av det. Att slå av = sätta ends_at till nu. Ett framtida värde är den
--                    valfria sluttiden; bannern döljs av sig själv när den passerat.
--   updated_at       ändras vid varje redigering — en ny text ska visas igen för den som stängt den gamla.
--
-- ÅTKOMST
-- Alla inloggade läser det som är aktivt just nu (RLS-filtret nedan); admin läser och skriver allt, med samma
-- funktion som changeloggen (is_app_ticket_admin() = profiles.role = 'admin'). Default privileges är stängda sedan
-- 20260926134651; revoke står ändå här så att tabellen inte blir öppen i en databas där standarden inte är stängd.
-- authenticated har redan EXECUTE på is_app_ticket_admin (baslinjen).
--
-- Additiv: en ny tabell. Kan gå till prod före koden. Idempotent, kan köras om.

set lock_timeout = '5s';

create table if not exists public.app_system_notices (
  id              uuid        not null default gen_random_uuid(),
  kind            text        not null,
  message         text        not null,
  affected_areas  text[]      not null default '{}'::text[],
  starts_at       timestamptz not null default now(),
  ends_at         timestamptz,
  created_by      uuid        references auth.users (id) on delete set null,
  created_by_name text        not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint app_system_notices_pkey primary key (id),
  constraint app_system_notices_kind_chk check (kind in ('update', 'maintenance', 'disruption', 'info')),
  constraint app_system_notices_message_chk check (length(btrim(message)) between 1 and 500),
  constraint app_system_notices_areas_chk check (
    affected_areas <@ array['app', 'crm', 'quotes', 'work_orders', 'planning', 'time', 'fortnox', 'documents']::text[]
  ),
  constraint app_system_notices_window_chk check (ends_at is null or ends_at >= starts_at)
);

comment on table public.app_system_notices is
  'Driftmeddelanden i bannern överst i appen. Admin skriver, alla inloggade läser det aktiva. Se lib/domains/systemNotices.';

alter table public.app_system_notices enable row level security;

revoke all on table public.app_system_notices from anon, authenticated;
grant select, insert, update, delete on table public.app_system_notices to authenticated;
grant select, insert, update, delete on table public.app_system_notices to service_role;

drop policy if exists app_system_notices_select on public.app_system_notices;
create policy app_system_notices_select on public.app_system_notices
  for select to authenticated
  using (
    (starts_at <= now() and (ends_at is null or ends_at > now()))
    or (select public.is_app_ticket_admin())
  );

drop policy if exists app_system_notices_insert on public.app_system_notices;
create policy app_system_notices_insert on public.app_system_notices
  for insert to authenticated
  with check ((select public.is_app_ticket_admin()));

drop policy if exists app_system_notices_update on public.app_system_notices;
create policy app_system_notices_update on public.app_system_notices
  for update to authenticated
  using ((select public.is_app_ticket_admin()))
  with check ((select public.is_app_ticket_admin()));

drop policy if exists app_system_notices_delete on public.app_system_notices;
create policy app_system_notices_delete on public.app_system_notices
  for delete to authenticated
  using ((select public.is_app_ticket_admin()));

reset lock_timeout;

-- ------------------------------------------------------------------------------------------------ efterkontroll

do $$
begin
  if has_table_privilege('anon', 'public.app_system_notices', 'SELECT') then
    raise exception 'driftmeddelanden: anon kan läsa app_system_notices';
  end if;
  if not has_table_privilege('authenticated', 'public.app_system_notices', 'SELECT')
     or not has_function_privilege('authenticated', 'public.is_app_ticket_admin()', 'EXECUTE') then
    raise exception 'driftmeddelanden: authenticated kan inte läsa app_system_notices eller utvärdera policyn';
  end if;
end $$;
