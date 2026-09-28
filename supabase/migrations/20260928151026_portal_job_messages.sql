-- Meddelandena mellan butiken och Ekovilla på ett jobb från återförsäljarportalen.
--
-- BAKGRUND
-- RESELLER_PORTAL_CRM_PLAN.md, fas 6 (kontraktets "Meddelanden från butiken" och job.message). Butiken skriver i
-- portalen (POST /api/portal/jobs/{quoteId}/messages, service-rollen), och den som har arbetsordern svarar på kortet
-- "Butiken" (POST /api/crm/portal/jobs/{workOrderId}/messages, sessionen). Svaret köas som job.message i portalens kö.
--
-- En EGEN tabell, aldrig crm_work_order_comments: de interna kommentarerna läses av besättningen och ska aldrig kunna
-- nå butiken, och butikens meddelanden hör inte hemma bland dem.
--
--   direction      from_store = butiken skrev (portalens messageId), to_store = Ekovilla svarade (vårt id, som skickas
--                  som messageId). Samma id sparas en gång per riktning: portalen gör om anropet, och en dubbelklick
--                  på Skicka ger samma rad.
--   author_name    namnet när meddelandet skrevs. profiles är bara självläsbar, så ingen annan kan slå upp svararens
--                  namn efteråt. Ingen FK från author_user_id mot profiles: den hade låst profiles under migreringen,
--                  och namnet står ändå här.
--   department     avdelningen som butiken ser ("Anna Berg · Planering"), vald vid svaret (William 2026-09-28).
--                  Butikens meddelanden har ingen.
--   sent_at        butikens sentAt, eller databasens tid för ett svar (sessionen kan inte sätta den).
--   outbound_key   Idempotency-Key för svarets job.message i kön (härledd, så att den alltid stämmer med raden).
--   queued_at      svaret är köat. Ett svar som sparats men inte köats (processen dog emellan) köas av cron.
--   notify_claimed_at  lånet på notisen om butikens meddelande: den som tar det (där det saknas eller gått ut efter
--                  fem minuter) skickar. Dör processen innan notisen gått iväg går lånet ut, och cron gör om den.
--   notified_at    notisen är skickad. Sätts först EFTER utskicket: hellre en notis för mycket än en som tappas.
--
-- ÅTKOMST (William 2026-09-28)
--   läsa    alla som ser arbetsordern kontorsvägen: crm.workorder.read (säljare, admin, konsult, ekonomi), eller
--           ansvarig för ordern. Samma två vägar som crm_portal_jobs. Besättningen (fältvyn) ser ingenting.
--   svara   den som har ordern, eller en admin, med crm.workorder.write: samma som får redigera arbetsordern och
--           koppla kund (fas 3c). Bara i eget namn, och bara to_store. Regeln står EN gång, i
--           crm_portal_job_message_can_reply(): policyn använder den, och kortet frågar den om svarsfältet ska visas.
--   ändra   ingen. Portalen sparar ett meddelande en gång per messageId, så ett skickat svar är slutgiltigt.
-- Sessionens läsning och insert går genom kolumngrants; markeringarna (queued_at, notify_claimed_at, notified_at) är
-- bara service-rollens. Kön (portal_outbound_events) får ingen ny policy: kortet får svarens status av servern, som
-- läser just status för de svar sessionen själv kunde läsa. Default privileges är stängda sedan 20260926134651; varje
-- grant står här.
--
-- Additiv: en ny tabell och en ny funktion, inget befintligt ändras. Kan gå till prod före koden. Idempotent.
-- Låset: FK:n tar crm_portal_jobs i share row exclusive (fas 4b:s trigger skriver där när en portalorder ändras), en
-- kort stund medan den nya, tomma tabellen skapas.

create table if not exists public.crm_portal_job_messages (
  id uuid primary key default gen_random_uuid(),
  quote_id text not null,
  direction text not null,
  message_id text not null,
  author_name text not null,
  author_user_id uuid,
  department text not null default '',
  body text not null,
  sent_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  outbound_key text generated always as (
    case when direction = 'to_store' then 'job.message-' || message_id end
  ) stored,
  queued_at timestamptz,
  notify_claimed_at timestamptz,
  notified_at timestamptz
);

alter table public.crm_portal_job_messages drop constraint if exists crm_portal_job_messages_direction_check;
alter table public.crm_portal_job_messages
  add constraint crm_portal_job_messages_direction_check check (direction in ('from_store', 'to_store'));

-- Kontraktets messageId: synliga ASCII-tecken, högst 200 (samma som portalens kolumn och Idempotency-Key).
alter table public.crm_portal_job_messages drop constraint if exists crm_portal_job_messages_message_id_check;
alter table public.crm_portal_job_messages
  add constraint crm_portal_job_messages_message_id_check check (message_id ~ '^[!-~]{1,200}$');

alter table public.crm_portal_job_messages drop constraint if exists crm_portal_job_messages_author_name_check;
alter table public.crm_portal_job_messages
  add constraint crm_portal_job_messages_author_name_check
  check (char_length(author_name) between 1 and 200 and author_name ~ '\S');

-- Portalens gräns är 5000 tecken; ett meddelande av bara blanksteg och radbrytningar är tomt.
alter table public.crm_portal_job_messages drop constraint if exists crm_portal_job_messages_body_check;
alter table public.crm_portal_job_messages
  add constraint crm_portal_job_messages_body_check check (char_length(body) between 1 and 5000 and body ~ '\S');

-- Svaret har en av portalens avdelningar, butikens meddelande ingen.
alter table public.crm_portal_job_messages drop constraint if exists crm_portal_job_messages_department_check;
alter table public.crm_portal_job_messages
  add constraint crm_portal_job_messages_department_check check (
    (direction = 'to_store' and department in ('Försäljning', 'Planering', 'Ekonomi'))
    or (direction = 'from_store' and department = '')
  );

-- Ett svar har en svarare och notiseras aldrig; butikens meddelande har ingen svarare och köas aldrig.
alter table public.crm_portal_job_messages drop constraint if exists crm_portal_job_messages_direction_fields_check;
alter table public.crm_portal_job_messages
  add constraint crm_portal_job_messages_direction_fields_check check (
    (direction = 'to_store' and author_user_id is not null and notify_claimed_at is null and notified_at is null)
    or (direction = 'from_store' and author_user_id is null and queued_at is null)
  );

alter table public.crm_portal_job_messages drop constraint if exists crm_portal_job_messages_direction_message_id_key;
alter table public.crm_portal_job_messages
  add constraint crm_portal_job_messages_direction_message_id_key unique (direction, message_id);

alter table public.crm_portal_job_messages drop constraint if exists crm_portal_job_messages_outbound_key_key;
alter table public.crm_portal_job_messages
  add constraint crm_portal_job_messages_outbound_key_key unique (outbound_key);

-- Jobben tas aldrig bort; ett meddelande hör alltid till ett mottaget jobb.
alter table public.crm_portal_job_messages drop constraint if exists crm_portal_job_messages_quote_id_fkey;
alter table public.crm_portal_job_messages
  add constraint crm_portal_job_messages_quote_id_fkey
  foreign key (quote_id) references public.crm_portal_jobs(quote_id);

-- Tråden i den ordning meddelandena kom fram: sent_at är avsändarens klocka, och ett sent omförsök från portalen hade
-- annars hamnat före ett svar som skrevs under tiden.
create index if not exists crm_portal_job_messages_quote_created_idx on public.crm_portal_job_messages (quote_id, created_at);
-- Cron letar efter svar som inte köats och butiksmeddelanden utan notis.
create index if not exists crm_portal_job_messages_unqueued_idx
  on public.crm_portal_job_messages (created_at) where direction = 'to_store' and queued_at is null;
create index if not exists crm_portal_job_messages_unnotified_idx
  on public.crm_portal_job_messages (created_at) where direction = 'from_store' and notified_at is null;

-- Vem som får svara, EN gång: svarspolicyn använder den, och kortet frågar den om svarsfältet ska visas. Invoker:
-- jobbet och arbetsordern läses som sessionen, med deras egen RLS.
create or replace function public.crm_portal_job_message_can_reply(p_quote_id text)
  returns boolean
  language sql
  stable
  security invoker
  set search_path = ''
as $$
  select (select public.has_permission('crm.workorder.write'))
     and exists (
       select 1
         from public.crm_portal_jobs j
         join public.crm_work_orders w on w.id = j.work_order_id
        where j.quote_id = p_quote_id
          and (w.assigned_to = (select auth.uid()) or (select public.has_permission('crm.admin')))
     );
$$;

revoke all on function public.crm_portal_job_message_can_reply(text) from public, anon, authenticated, service_role;
grant execute on function public.crm_portal_job_message_can_reply(text) to authenticated;

alter table public.crm_portal_job_messages enable row level security;
revoke all on table public.crm_portal_job_messages from anon, authenticated;
-- Kolumngranterna EFTER revoke all, annars tar revoken bort dem.
grant select (id, quote_id, direction, message_id, author_name, author_user_id, department, body, sent_at, created_at,
              outbound_key)
  on table public.crm_portal_job_messages to authenticated;
grant insert (quote_id, direction, message_id, author_name, author_user_id, department, body)
  on table public.crm_portal_job_messages to authenticated;
grant select, insert, update, delete on table public.crm_portal_job_messages to service_role;

drop policy if exists crm_portal_job_messages_select on public.crm_portal_job_messages;
create policy crm_portal_job_messages_select on public.crm_portal_job_messages
  for select to authenticated
  using (
    (select has_permission('crm.workorder.read'))
    or exists (
      select 1
        from public.crm_portal_jobs j
        join public.crm_work_orders w on w.id = j.work_order_id
       where j.quote_id = crm_portal_job_messages.quote_id
         and w.assigned_to = (select auth.uid())
    )
  );

drop policy if exists crm_portal_job_messages_insert_reply on public.crm_portal_job_messages;
create policy crm_portal_job_messages_insert_reply on public.crm_portal_job_messages
  for insert to authenticated
  with check (
    direction = 'to_store'
    and author_user_id = (select auth.uid())
    and public.crm_portal_job_message_can_reply(quote_id)
  );

-- ------------------------------------------------------------------------------------------------ efterkontroll

-- Pröva effekten: RLS på; anon ingenting; sessionen läser de uppräknade kolumnerna, skriver bara ett svars kolumner
-- och kan aldrig ändra eller ta bort; service_role allt; policyerna finns med rätt kommando och kön har ingen ny;
-- svarsregeln körs av sessionen men inte av anon; nyckeln härleds.
-- (has_table_privilege med en kommalista svarar på om NÅGON av rättigheterna finns.)
do $$
declare
  tbl constant text := 'public.crm_portal_job_messages';
  col text;
  priv text;
begin
  if not (select c.relrowsecurity from pg_class c where c.oid = tbl::regclass) then
    raise exception 'portalens meddelanden: RLS är inte på';
  end if;
  if has_table_privilege('anon', tbl, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') then
    raise exception 'portalens meddelanden: anon har rättigheter på tabellen';
  end if;
  if has_any_column_privilege('anon', tbl, 'SELECT,INSERT,UPDATE,REFERENCES') then
    raise exception 'portalens meddelanden: anon har rättigheter på en kolumn';
  end if;
  if has_table_privilege('authenticated', tbl, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') then
    raise exception 'portalens meddelanden: authenticated har rättigheter på tabellnivå';
  end if;
  if has_any_column_privilege('authenticated', tbl, 'UPDATE,REFERENCES') then
    raise exception 'portalens meddelanden: authenticated kan ändra en kolumn';
  end if;
  foreach col in array array['id', 'quote_id', 'direction', 'message_id', 'author_name', 'author_user_id', 'department',
                             'body', 'sent_at', 'created_at', 'outbound_key'] loop
    if not has_column_privilege('authenticated', tbl, col, 'SELECT') then
      raise exception 'portalens meddelanden: authenticated kan inte läsa %', col;
    end if;
  end loop;
  foreach col in array array['queued_at', 'notify_claimed_at', 'notified_at'] loop
    if has_column_privilege('authenticated', tbl, col, 'SELECT') then
      raise exception 'portalens meddelanden: authenticated kan läsa %', col;
    end if;
  end loop;
  foreach col in array array['quote_id', 'direction', 'message_id', 'author_name', 'author_user_id', 'department',
                             'body'] loop
    if not has_column_privilege('authenticated', tbl, col, 'INSERT') then
      raise exception 'portalens meddelanden: authenticated kan inte skriva %', col;
    end if;
  end loop;
  foreach col in array array['id', 'sent_at', 'created_at', 'queued_at', 'notify_claimed_at', 'notified_at'] loop
    if has_column_privilege('authenticated', tbl, col, 'INSERT') then
      raise exception 'portalens meddelanden: authenticated kan skriva %', col;
    end if;
  end loop;
  foreach priv in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] loop
    if not has_table_privilege('service_role', tbl, priv) then
      raise exception 'portalens meddelanden: service_role saknar % på tabellen', priv;
    end if;
  end loop;

  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'crm_portal_job_messages') <> 2 then
    raise exception 'portalens meddelanden: tabellen ska ha exakt två policyer';
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'crm_portal_job_messages'
                   and policyname = 'crm_portal_job_messages_select' and cmd = 'SELECT' and roles = '{authenticated}') then
    raise exception 'portalens meddelanden: läspolicyn saknas';
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'crm_portal_job_messages'
                   and policyname = 'crm_portal_job_messages_insert_reply' and cmd = 'INSERT' and roles = '{authenticated}') then
    raise exception 'portalens meddelanden: svarspolicyn saknas';
  end if;
  -- Kön öppnas inte för fler: bara 2b:s policy (crm.portal.manage) läser den.
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'portal_outbound_events'
               and policyname <> 'portal_outbound_events_select_portal') then
    raise exception 'portalens meddelanden: kön har en policy till';
  end if;
  if not has_function_privilege('authenticated', 'public.crm_portal_job_message_can_reply(text)', 'EXECUTE') then
    raise exception 'portalens meddelanden: sessionen kan inte fråga om den får svara';
  end if;
  if has_function_privilege('anon', 'public.crm_portal_job_message_can_reply(text)', 'EXECUTE') then
    raise exception 'portalens meddelanden: anon kan köra svarsregeln';
  end if;
  if (select p.prosecdef from pg_proc p where p.oid = 'public.crm_portal_job_message_can_reply(text)'::regprocedure) then
    raise exception 'portalens meddelanden: svarsregeln ska köras som den som frågar (invoker)';
  end if;
  if has_table_privilege('authenticated', 'public.portal_outbound_events', 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') then
    raise exception 'portalens meddelanden: authenticated kan skriva i kön';
  end if;
  if has_table_privilege('anon', 'public.portal_outbound_events', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') then
    raise exception 'portalens meddelanden: anon har rättigheter på kön';
  end if;

  if (select pg_get_expr(d.adbin, d.adrelid)
        from pg_attrdef d
        join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
       where d.adrelid = tbl::regclass and a.attname = 'outbound_key') not like '%job.message-%' then
    raise exception 'portalens meddelanden: outbound_key härleds inte ur message_id';
  end if;
end $$;
