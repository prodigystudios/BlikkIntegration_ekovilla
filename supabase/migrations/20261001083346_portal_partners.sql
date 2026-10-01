-- Partner i återförsäljarportalen: flaggan på kundkortet och inbjudningarna till portalen.
--
-- BAKGRUND
-- RESELLER_PORTAL_CRM_PLAN.md, 10a (William 2026-10-01). En kund flaggas som återförsäljare eller partner, och
-- kundkortet får knappen "Bjud in till portalen". Inbjudan skapar ett företag i portalen med kortets kundnummer och
-- bjuder in dess första admin (kontraktets flöde 5, `POST /api/ekovilla/resellers`). CRM:et väljer företagets id
-- själv och skapar butikens rad i crm_portal_resellers direkt, kopplad till kortet, så att det första jobbet aldrig
-- saknar kund.
--
--   crm_portal_partners           en rad per kundkort som är partner, med typen: `reseller` (Återförsäljare) eller
--                                 `partner` (Partner, till exempel ett ventilationsföretag). Typen finns bara i
--                                 CRM:et; portalen är densamma för båda (William 2026-10-01). En egen tabell och
--                                 inte en kolumn på crm_customers: sessionen har tabellgrant där, och en ny kolumn
--                                 hade varit skrivbar för varje säljare som får ändra kortet. En kolumnspärr gör
--                                 ingenting mot en tabellgrant. Att kortet är ett företagskort prövas i koden.
--   crm_portal_reseller_invites   varje inbjudan till ett företag i portalen: försöksnumret (1 = inbjudan, 2 = första
--                                 "Skicka inbjudan igen" …), Idempotency-Key (`reseller-invite-<resellerId>-<n>`,
--                                 samma som händelsen i portal_outbound_events), kroppen som skickades, adminens namn
--                                 och e-post, vem och när. Kroppen behövs för nästa försök: företagets telefon och
--                                 e-post står inte på butikens rad. Historik: skrivs av service-rollen i samma steg som butikens rad, som bara
--                                 service_role skriver (fas 3a). Vem sparas också som NAMN, som publiceringarna:
--                                 sessionen läser bara sin egen profil.
--
-- ÅTKOMST
-- Bara crm.portal.manage (admin), som resten av portalsidan. Default privileges är stängda sedan 20260926134651;
-- varje grant står här, service_role uttryckligen (se 20260928053434). updated_at sätts av en trigger och behöver
-- ingen grant.
--
-- Additiv: två nya tabeller, inget befintligt ändras. Kan gå till prod före koden. Idempotent, kan köras om.

-- ------------------------------------------------------------------------------------------------------- flaggan

create table if not exists public.crm_portal_partners (
  customer_id uuid primary key,
  partner_type text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid
);

alter table public.crm_portal_partners drop constraint if exists crm_portal_partners_partner_type_check;
alter table public.crm_portal_partners
  add constraint crm_portal_partners_partner_type_check check (partner_type in ('reseller', 'partner'));

-- Tas kortet bort försvinner flaggan med det. Butikerna i crm_portal_resellers står kvar (on delete set null där).
alter table public.crm_portal_partners drop constraint if exists crm_portal_partners_customer_id_fkey;
alter table public.crm_portal_partners
  add constraint crm_portal_partners_customer_id_fkey
  foreign key (customer_id) references public.crm_customers(id) on delete cascade;

alter table public.crm_portal_partners drop constraint if exists crm_portal_partners_updated_by_fkey;
alter table public.crm_portal_partners
  add constraint crm_portal_partners_updated_by_fkey
  foreign key (updated_by) references public.profiles(id) on delete set null;

drop trigger if exists crm_portal_partners_set_updated_at on public.crm_portal_partners;
create trigger crm_portal_partners_set_updated_at
  before update on public.crm_portal_partners
  for each row execute function public.set_updated_at();

alter table public.crm_portal_partners enable row level security;
revoke all on table public.crm_portal_partners from anon, authenticated;
-- Hela tabellen: en upsert från PostgREST skriver om varje kolumn i kroppen, också nyckeln, och hade nekats med
-- kolumngrants. Policyerna är grinden.
grant select, insert, update, delete on table public.crm_portal_partners to authenticated;
grant select, insert, update, delete on table public.crm_portal_partners to service_role;

drop policy if exists crm_portal_partners_select on public.crm_portal_partners;
create policy crm_portal_partners_select on public.crm_portal_partners
  for select to authenticated
  using ((select has_permission('crm.portal.manage')));

drop policy if exists crm_portal_partners_insert on public.crm_portal_partners;
create policy crm_portal_partners_insert on public.crm_portal_partners
  for insert to authenticated
  with check ((select has_permission('crm.portal.manage')) and updated_by = (select auth.uid()));

drop policy if exists crm_portal_partners_update on public.crm_portal_partners;
create policy crm_portal_partners_update on public.crm_portal_partners
  for update to authenticated
  using ((select has_permission('crm.portal.manage')))
  with check ((select has_permission('crm.portal.manage')) and updated_by = (select auth.uid()));

drop policy if exists crm_portal_partners_delete on public.crm_portal_partners;
create policy crm_portal_partners_delete on public.crm_portal_partners
  for delete to authenticated
  using ((select has_permission('crm.portal.manage')));

-- -------------------------------------------------------------------------------------------------- inbjudningarna

create table if not exists public.crm_portal_reseller_invites (
  id uuid primary key default gen_random_uuid(),
  reseller_id text not null,
  attempt integer not null,
  idempotency_key text not null,
  payload jsonb not null,
  admin_name text not null,
  admin_email text not null,
  invited_by uuid,
  invited_by_name text,
  created_at timestamptz not null default now()
);

alter table public.crm_portal_reseller_invites drop constraint if exists crm_portal_reseller_invites_reseller_id_fkey;
alter table public.crm_portal_reseller_invites
  add constraint crm_portal_reseller_invites_reseller_id_fkey
  foreign key (reseller_id) references public.crm_portal_resellers(reseller_id) on delete cascade;

alter table public.crm_portal_reseller_invites drop constraint if exists crm_portal_reseller_invites_attempt_key;
alter table public.crm_portal_reseller_invites
  add constraint crm_portal_reseller_invites_attempt_key unique (reseller_id, attempt);

alter table public.crm_portal_reseller_invites drop constraint if exists crm_portal_reseller_invites_idempotency_key_key;
alter table public.crm_portal_reseller_invites
  add constraint crm_portal_reseller_invites_idempotency_key_key unique (idempotency_key);

alter table public.crm_portal_reseller_invites drop constraint if exists crm_portal_reseller_invites_attempt_check;
alter table public.crm_portal_reseller_invites
  add constraint crm_portal_reseller_invites_attempt_check check (attempt > 0);

-- Nyckeln är försökets: samma som händelsen i kön, och den enda formen portalen ser.
alter table public.crm_portal_reseller_invites drop constraint if exists crm_portal_reseller_invites_idempotency_key_check;
alter table public.crm_portal_reseller_invites
  add constraint crm_portal_reseller_invites_idempotency_key_check check (
    idempotency_key = 'reseller-invite-' || reseller_id || '-' || attempt::text
  );

alter table public.crm_portal_reseller_invites drop constraint if exists crm_portal_reseller_invites_admin_check;
alter table public.crm_portal_reseller_invites
  add constraint crm_portal_reseller_invites_admin_check check (
    char_length(btrim(admin_name)) between 1 and 200
    and char_length(admin_email) <= 254
    and admin_email ~ '^[^@[:space:]]+@[^@[:space:]]+$'
  );

alter table public.crm_portal_reseller_invites drop constraint if exists crm_portal_reseller_invites_invited_by_name_check;
alter table public.crm_portal_reseller_invites
  add constraint crm_portal_reseller_invites_invited_by_name_check check (
    invited_by_name is null or char_length(invited_by_name) <= 200
  );

alter table public.crm_portal_reseller_invites drop constraint if exists crm_portal_reseller_invites_invited_by_fkey;
alter table public.crm_portal_reseller_invites
  add constraint crm_portal_reseller_invites_invited_by_fkey
  foreign key (invited_by) references public.profiles(id) on delete set null;

alter table public.crm_portal_reseller_invites enable row level security;
revoke all on table public.crm_portal_reseller_invites from anon, authenticated;
grant select on table public.crm_portal_reseller_invites to authenticated;
grant select, insert, update, delete on table public.crm_portal_reseller_invites to service_role;

drop policy if exists crm_portal_reseller_invites_select on public.crm_portal_reseller_invites;
create policy crm_portal_reseller_invites_select on public.crm_portal_reseller_invites
  for select to authenticated
  using ((select has_permission('crm.portal.manage')));

-- ------------------------------------------------------------------------------------------------ efterkontroll

-- Pröva effekten: flaggan är läs- och skrivbar för sessionen bakom RLS, inbjudningarna bara läsbara; service_role får
-- allt; anon ingenting.
do $$
declare
  partners constant text := 'public.crm_portal_partners';
  invites constant text := 'public.crm_portal_reseller_invites';
  t text;
  priv text;
begin
  foreach t in array array[partners, invites] loop
    if not (select c.relrowsecurity from pg_class c where c.oid = t::regclass) then
      raise exception 'portalens partner: RLS är inte på för %', t;
    end if;
    foreach priv in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] loop
      if not has_table_privilege('service_role', t, priv) then
        raise exception 'portalens partner: service_role saknar % på %', priv, t;
      end if;
    end loop;
    -- En kommaseparerad lista svarar sant om NÅGON finns.
    if has_table_privilege('anon', t, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') then
      raise exception 'portalens partner: anon har rättigheter på %', t;
    end if;
    if has_table_privilege('authenticated', t, 'TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') then
      raise exception 'portalens partner: authenticated har mer än läsning och skrivning på %', t;
    end if;
  end loop;

  foreach priv in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] loop
    if not has_table_privilege('authenticated', partners, priv) then
      raise exception 'portalens partner: authenticated saknar % på flaggan', priv;
    end if;
  end loop;

  if not has_table_privilege('authenticated', invites, 'SELECT') then
    raise exception 'portalens partner: authenticated kan inte läsa inbjudningarna';
  end if;
  if has_table_privilege('authenticated', invites, 'INSERT,UPDATE,DELETE') then
    raise exception 'portalens partner: authenticated kan skriva inbjudningar';
  end if;
end $$;
