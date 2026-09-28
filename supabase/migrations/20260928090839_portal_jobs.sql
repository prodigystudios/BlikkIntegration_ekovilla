-- Jobben från återförsäljarportalen: vilket jobb som blev vilken arbetsorder.
--
-- BAKGRUND
-- RESELLER_PORTAL_CRM_PLAN.md, fas 3b. Butikens säljare skickar en godkänd offert till Ekovilla
-- (POST /api/portal/jobs). CRM:et skapar då en arbetsorder hos rätt säljare, och direkt därefter Fortnox-ordern. En rad
-- här per jobb, med portalens quoteId som nyckel:
--
--   reserved_work_order_id   arbetsorderns id, valt INNAN arbetsordern skapas. Ett omförsök efter ett avbrott skapar
--                            arbetsordern med samma id, och därmed samma ordernummer, i stället för en till.
--   work_order_id            satt när arbetsordern finns. Alltid samma som reserved_work_order_id (check). Blir null
--                            om arbetsordern tas bort (on delete set null); work_order_created_at säger då att den
--                            fanns, så att ett nytt anrop för jobbet inte skapar den igen.
--   payload                  kroppen som portalen skickade. Samma quoteId med ett annat innehåll nekas (409) i stället
--                            för att tyst ignoreras. Innehåller butikens inpriser, därför ingen läsning för sessionen.
--   store_name, quote_number brickan "Från återförsäljarportalen · <butik> · offert <nr>" på arbetsordern. Butikens namn
--                            står här, eftersom säljarna inte kan läsa crm_portal_resellers (crm.portal.manage).
--   *_notified_at            notisen "Nytt jobb" och notisen om att Fortnox-ordern inte kunde skapas skickas en gång
--                            var: den som sätter tiden (där den var null) skickar.
--
-- Skrivs bara av service-rollen: anropen från portalen har ingen användare bakom sig.
--
-- ÅTKOMST
-- Sessionen läser bara brickans kolumner (kolumngrant), och bara för en arbetsorder den själv får läsa kontorsvägen:
-- crm.workorder.read, eller ansvarig för ordern (samma två vägar som arbetsorderns egen policy utom besättningen,
-- som inte ser CRM-sidan). Default privileges är stängda sedan 20260926134651; varje grant står här, service_role
-- uttryckligen. Kolumngranten står EFTER tabellens revoke all, annars tar revoken bort den.
--
-- Additiv: en ny tabell, inget befintligt ändras. Kan gå till prod före koden. Idempotent, kan köras om.

create table if not exists public.crm_portal_jobs (
  -- Portalens quoteId. Samma tecken som i sökvägar (planens punkt 16): det står i /api/portal/jobs/{quoteId}/messages.
  quote_id text primary key,
  quote_number text not null,
  reseller_id text not null,
  store_name text not null,
  -- Kundkortet som butikens kundnummer pekade på när jobbet kom. null = inget kundnummer, eller ett okänt.
  customer_id uuid,
  -- Den som fick jobbet, och varför (assignment.ts). Arbetsorderns assigned_to kan ändras efteråt; det här är historik.
  assigned_to uuid,
  assignment_source text not null,
  reserved_work_order_id uuid not null,
  work_order_id uuid,
  work_order_created_at timestamptz,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  received_notified_at timestamptz,
  fortnox_issue_notified_at timestamptz
);

alter table public.crm_portal_jobs drop constraint if exists crm_portal_jobs_quote_id_check;
alter table public.crm_portal_jobs
  add constraint crm_portal_jobs_quote_id_check check (quote_id ~ '^(?!\.+$)[A-Za-z0-9._~-]{1,100}$');

alter table public.crm_portal_jobs drop constraint if exists crm_portal_jobs_quote_number_check;
alter table public.crm_portal_jobs
  add constraint crm_portal_jobs_quote_number_check check (char_length(btrim(quote_number)) between 1 and 50);

alter table public.crm_portal_jobs drop constraint if exists crm_portal_jobs_store_name_check;
alter table public.crm_portal_jobs
  add constraint crm_portal_jobs_store_name_check check (char_length(btrim(store_name)) between 1 and 200);

alter table public.crm_portal_jobs drop constraint if exists crm_portal_jobs_assignment_source_check;
alter table public.crm_portal_jobs
  add constraint crm_portal_jobs_assignment_source_check
  check (assignment_source in ('reseller_seller', 'account_manager', 'county', 'fallback'));

alter table public.crm_portal_jobs drop constraint if exists crm_portal_jobs_payload_check;
alter table public.crm_portal_jobs
  add constraint crm_portal_jobs_payload_check check (jsonb_typeof(payload) = 'object');

-- Arbetsordern är den reserverade, aldrig en annan.
alter table public.crm_portal_jobs drop constraint if exists crm_portal_jobs_work_order_matches_check;
alter table public.crm_portal_jobs
  add constraint crm_portal_jobs_work_order_matches_check
  check (work_order_id is null or work_order_id = reserved_work_order_id);

-- En arbetsorder som finns har en tid för när den skapades.
alter table public.crm_portal_jobs drop constraint if exists crm_portal_jobs_work_order_created_check;
alter table public.crm_portal_jobs
  add constraint crm_portal_jobs_work_order_created_check
  check (work_order_id is null or work_order_created_at is not null);

alter table public.crm_portal_jobs drop constraint if exists crm_portal_jobs_reserved_work_order_id_key;
alter table public.crm_portal_jobs
  add constraint crm_portal_jobs_reserved_work_order_id_key unique (reserved_work_order_id);

alter table public.crm_portal_jobs drop constraint if exists crm_portal_jobs_work_order_id_key;
alter table public.crm_portal_jobs
  add constraint crm_portal_jobs_work_order_id_key unique (work_order_id);

alter table public.crm_portal_jobs drop constraint if exists crm_portal_jobs_work_order_id_fkey;
alter table public.crm_portal_jobs
  add constraint crm_portal_jobs_work_order_id_fkey
  foreign key (work_order_id) references public.crm_work_orders(id) on delete set null;

-- Butikerna tas aldrig bort (ingen delete för sessionen); ett jobb håller kvar sin butik.
alter table public.crm_portal_jobs drop constraint if exists crm_portal_jobs_reseller_id_fkey;
alter table public.crm_portal_jobs
  add constraint crm_portal_jobs_reseller_id_fkey
  foreign key (reseller_id) references public.crm_portal_resellers(reseller_id);

alter table public.crm_portal_jobs drop constraint if exists crm_portal_jobs_customer_id_fkey;
alter table public.crm_portal_jobs
  add constraint crm_portal_jobs_customer_id_fkey
  foreign key (customer_id) references public.crm_customers(id) on delete set null;

alter table public.crm_portal_jobs drop constraint if exists crm_portal_jobs_assigned_to_fkey;
alter table public.crm_portal_jobs
  add constraint crm_portal_jobs_assigned_to_fkey
  foreign key (assigned_to) references public.profiles(id) on delete set null;

create index if not exists crm_portal_jobs_reseller_id_idx on public.crm_portal_jobs (reseller_id);
create index if not exists crm_portal_jobs_customer_id_idx on public.crm_portal_jobs (customer_id);
create index if not exists crm_portal_jobs_assigned_to_idx on public.crm_portal_jobs (assigned_to);

alter table public.crm_portal_jobs enable row level security;
revoke all on table public.crm_portal_jobs from anon, authenticated;
grant select (work_order_id, quote_number, store_name, received_at) on table public.crm_portal_jobs to authenticated;
grant select, insert, update, delete on table public.crm_portal_jobs to service_role;

drop policy if exists crm_portal_jobs_select on public.crm_portal_jobs;
create policy crm_portal_jobs_select on public.crm_portal_jobs
  for select to authenticated
  using (
    (select has_permission('crm.workorder.read'))
    or exists (
      select 1 from public.crm_work_orders w
      where w.id = crm_portal_jobs.work_order_id and w.assigned_to = (select auth.uid())
    )
  );

-- ------------------------------------------------------------------------------------------------ efterkontroll

-- Pröva effekten: RLS på; anon ingenting; sessionen läser BARA brickans fyra kolumner och skriver ingenting;
-- service_role allt. (has_table_privilege med en kommalista svarar på om NÅGON av rättigheterna finns.)
do $$
declare
  col text;
  priv text;
begin
  if not (select c.relrowsecurity from pg_class c where c.oid = 'public.crm_portal_jobs'::regclass) then
    raise exception 'portalens jobb: RLS är inte på';
  end if;
  if has_table_privilege('anon', 'public.crm_portal_jobs', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') then
    raise exception 'portalens jobb: anon har rättigheter på tabellen';
  end if;
  if has_any_column_privilege('anon', 'public.crm_portal_jobs', 'SELECT,INSERT,UPDATE,REFERENCES') then
    raise exception 'portalens jobb: anon har rättigheter på en kolumn';
  end if;
  -- Tabellnivå: ingenting för sessionen. Läsningen går bara genom kolumngranten nedan.
  if has_table_privilege('authenticated', 'public.crm_portal_jobs', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') then
    raise exception 'portalens jobb: authenticated har rättigheter på tabellnivå';
  end if;
  if has_any_column_privilege('authenticated', 'public.crm_portal_jobs', 'INSERT,UPDATE,REFERENCES') then
    raise exception 'portalens jobb: authenticated kan skriva en kolumn';
  end if;
  foreach col in array array['work_order_id', 'quote_number', 'store_name', 'received_at'] loop
    if not has_column_privilege('authenticated', 'public.crm_portal_jobs', col, 'SELECT') then
      raise exception 'portalens jobb: authenticated kan inte läsa crm_portal_jobs.%', col;
    end if;
  end loop;
  foreach col in array array['quote_id', 'reseller_id', 'customer_id', 'assigned_to', 'assignment_source',
                             'reserved_work_order_id', 'work_order_created_at', 'payload', 'received_notified_at',
                             'fortnox_issue_notified_at'] loop
    if has_column_privilege('authenticated', 'public.crm_portal_jobs', col, 'SELECT') then
      raise exception 'portalens jobb: authenticated kan läsa crm_portal_jobs.%', col;
    end if;
  end loop;
  foreach priv in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] loop
    if not has_table_privilege('service_role', 'public.crm_portal_jobs', priv) then
      raise exception 'portalens jobb: service_role saknar % på tabellen', priv;
    end if;
  end loop;
end $$;
