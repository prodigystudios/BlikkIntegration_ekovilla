-- Skyddsronder på arbetsordern — rondinfo, deltagare, checklista och handlingsplan (PR 1 av 4).
--
-- VARFÖR
-- Skyddsronden görs i dag i Excel-mallen "Skyddsrond_mall_arbetsplats.xlsx" (Rondinfo, Checklista,
-- Handlingsplan, Uppföljning förra ronden). Nu fylls den i på plats i mobilen, kopplad till en
-- arbetsorder, och blir ett PDF-protokoll (lib/domains/safetyRounds/). Senare PR: foton (2),
-- kvittens/notiser/uppföljning/påminnelse (3), checklistan redigerbar i admin (4).
--
-- BEHÖRIGHET — egna nycklar, UTANFÖR crm.* (Williams beslut 2026-09-24)
--   * safety.round.read  — se ronder, handlingsplan och protokoll. Seed: admin, sales.
--   * safety.round.write — starta och fylla i ronder.               Seed: admin, sales.
--   En arbetsledare (member) får nyckeln PERSONLIGT, ingen ny roll:
--     select public.set_user_permission('<uuid>', 'safety.round.write', 'grant');
--     select public.set_user_permission('<uuid>', 'safety.round.read',  'grant');
--   INGEN besättningsgren (is_user_on_work_order): att köra ett jobb ger inte rätt att starta ronder.
--
-- ORDERN LÄSES ALDRIG GENOM crm_work_orders-RLS
-- En rondledare kan sakna både crm.workorder.read och plats i besättningen. I stället för att vidga
-- RLS på crm_work_orders (arbetsbeskrivningen bär portkoder) finns två SMALA SECURITY DEFINER-
-- funktioner, grindade på skrivnyckeln, som bara lämnar ut ordernummer, projekt, kund och ADRESS-
-- fälten — aldrig internal_handoff, personnummer eller priser. Ronden snapshottar det den behöver
-- när den startas och läser aldrig ordern igen.
--
-- LÅST EFTER SLUTFÖRD
-- En rond är `draft` tills den slutförs, sedan `completed`. Då går rondinfo, deltagare och checklista
-- inte längre att ändra (policyerna kräver draft). Åtgärderna i handlingsplanen lever vidare —
-- uppföljningen (status, uppföljt datum, effekt, notering) ska kunna föras in efteråt — men själva
-- åtgärden, den ansvarige och datumet är låsta av en trigger när ronden är slutförd.
--
-- ⚠️ `safety_rounds` HAR INGEN INSERT-GRANT. En rond skapas bara av start_safety_round(), som i EN
-- transaktion räknar fram rondnumret, snapshottar ordern och kopierar checklistan. En insert förbi
-- funktionen hade gett en rond utan punkter eller med påhittat ordernummer.
--
-- DEPLOY-ORDNING: KÖR DEN HÄR FILEN FÖRE KODEN.
-- Helt additiv — nya tabeller, nya funktioner, två nya nycklar; inget befintligt objekt ändras. Men
-- getEffectivePermissions() failar stängt, så utan filen svarar varje skyddsrondsrutt 403 och sidan
-- /skyddsrond säger "ingen behörighet".
-- Speglar lib/auth/permissions.ts PERMISSION_KEYS (antalstestet vaktar pariteten: 46 -> 48).
--
-- Kör i Supabase SQL editor. Idempotent (kör den två gånger innan du litar på påståendet).
--
-- ⚠️ INGA EMOJI UTANFÖR BMP I DEN HÄR FILEN — se tests/planning/sqlNoAstralChars.test.ts.

-- ---------------------------------------------------------------------------
-- 1. Nycklar
-- ---------------------------------------------------------------------------

insert into public.permissions (key, description) values
  ('safety.round.read',  'Skyddsrond: se ronder, handlingsplan och protokoll'),
  ('safety.round.write', 'Skyddsrond: starta och fylla i ronder')
on conflict (key) do nothing;

insert into public.role_permissions (role, permission_key) values
  ('admin', 'safety.round.read'),
  ('admin', 'safety.round.write'),
  ('sales', 'safety.round.read'),
  ('sales', 'safety.round.write')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 2. Checklistans katalog
-- ---------------------------------------------------------------------------
-- Ligger i databasen redan nu så att PR 4 (redigering i admin) bara blir ett gränssnitt. En rond
-- KOPIERAR punkterna när den startas (texten snapshottas), så en ändrad katalog påverkar aldrig en
-- gammal rond. Punkter tas aldrig bort — de inaktiveras.

create table if not exists public.safety_checklist_categories (
  id         uuid primary key default gen_random_uuid(),
  code       text not null,
  label      text not null,
  position   integer not null,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  constraint safety_checklist_categories_code_uniq unique (code),
  constraint safety_checklist_categories_label_chk check (btrim(label) <> '')
);

create table if not exists public.safety_checklist_items (
  id          uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.safety_checklist_categories(id),
  -- Mallens egen numrering, med dess hopp (12 -> 34, 38 -> 41): mallen är beskuren ur en längre
  -- lista, och numret är det folk hänvisar till ("punkt 36").
  number      integer not null,
  text        text not null,
  position    integer not null,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  constraint safety_checklist_items_number_uniq unique (number),
  constraint safety_checklist_items_text_chk check (btrim(text) <> '')
);

create index if not exists safety_checklist_items_category_idx
  on public.safety_checklist_items (category_id, position);

alter table public.safety_checklist_categories enable row level security;
alter table public.safety_checklist_items enable row level security;

-- Läses av alla inloggade (texten är ingen hemlighet). Ingen skrivväg förrän PR 4.
grant select on public.safety_checklist_categories to authenticated;
grant select on public.safety_checklist_items to authenticated;

drop policy if exists safety_checklist_categories_select on public.safety_checklist_categories;
create policy safety_checklist_categories_select
  on public.safety_checklist_categories
  for select
  to authenticated
  using (true);

drop policy if exists safety_checklist_items_select on public.safety_checklist_items;
create policy safety_checklist_items_select
  on public.safety_checklist_items
  for select
  to authenticated
  using (true);

-- Seed ur Excel-mallens flik "2. Checklista". Rubrikerna är mallens kategorirubriker (kolumn A), inte
-- dess "Område"-kolumn. I har inga fasta punkter: där hamnar rondens egna.
insert into public.safety_checklist_categories (code, label, position) values
  ('A', 'Tillträde, ordning och allmän säkerhet', 1),
  ('B', 'Fallrisk och arbete på höjd', 2),
  ('C', 'Damm, kvarts och luft (särskilt lösull/cellulosa/sågning)', 3),
  ('D', 'Ergonomi, lyft och arbetsställningar', 4),
  ('E', 'Maskiner, slangar, el och fordon', 5),
  ('F', 'Material och avfall', 6),
  ('G', 'Personlig skyddsutrustning och klädsel', 7),
  ('H', 'Organisation, samordning och OSA på plats', 8),
  ('I', 'Egna punkter / objektsspecifika risker', 9)
on conflict (code) do nothing;

insert into public.safety_checklist_items (category_id, number, text, position)
select c.id, v.number, v.text, v.position
from (values
  ('A', 1,  'Gångvägar, transportvägar och uppställningsytor är fria från material, slangar och skräp?', 1),
  ('A', 2,  'Utrymningsvägar kända och fria? Samlingsplats känd?', 2),
  ('A', 3,  'Första hjälpen-väska och ögondusch/spolning tillgänglig och komplett?', 3),
  ('B', 4,  'Fallskyddssele används när räcke saknas, och fästpunkt är godkänd (inte i stege)?', 1),
  ('B', 5,  'Stegar hela, rätt lutning, förankrade och används bara för kort, enkelt arbete?', 2),
  ('C', 6,  'Andningsskydd (rätt filter, rätt modell, utprovat) används när damm inte kan elimineras?', 1),
  ('D', 7,  'Arbete över axelhöjd / i knä begränsas och varvas med andra moment?', 1),
  ('D', 8,  'Paus och återhämtning möjligt vid kyla, värme eller hög arbetsbelastning?', 2),
  ('E', 9,  'Blåsmaskin, slangar hela, rätt kopplade?', 1),
  ('E', 10, 'Elverktyg och sladdar hela, jordade/skyddade, inte i vatten eller gångväg?', 2),
  ('E', 11, 'Daglig tillsyn av fordon/maskin gjord? Synliga fel anmälda?', 3),
  ('F', 12, 'Avfall (plast, spill, dammfilter) samlas och lämnas enligt rutin?', 1),
  ('G', 34, 'Hjälm, skyddsskor, varsel, skyddsglasögon används där det krävs på bygget?', 1),
  ('G', 35, 'Handskar anpassade till moment (skär samt kyla)?', 2),
  ('G', 36, 'Andningsskydd och hörselskydd används när risken finns, och underhålls?', 3),
  ('G', 37, 'Kläder rena från damm vid raster/hemfärd (ta inte med kvartsdamm hem)?', 4),
  ('H', 38, 'Alla på platsen vet vem som är arbetsledare och hur man anmäler risk/tillbud?', 1),
  ('H', 41, 'Ensamarbete undviks eller har avstämningsrutin (särskilt vind/krypgrund)?', 2),
  ('H', 42, 'Arbetsbelastning och tidplan tillåter säkert arbete – inte bara "köra på"?', 3),
  ('H', 43, 'Tillbud och nästan-olyckor från senaste tiden är kända och åtgärdade?', 4)
) as v(code, number, text, position)
join public.safety_checklist_categories c on c.code = v.code
on conflict (number) do nothing;

-- ---------------------------------------------------------------------------
-- 3. Ronderna
-- ---------------------------------------------------------------------------

create table if not exists public.safety_rounds (
  id                    uuid primary key default gen_random_uuid(),

  work_order_id         uuid not null references public.crm_work_orders(id) on delete cascade,

  -- 1, 2, 3 ... per order. Räknas fram i start_safety_round() som max + 1; två som startar samtidigt
  -- krockar på det unika indexet och rutten svarar 409.
  round_number          integer not null,

  status                text not null default 'draft',

  -- Snapshot av ordern när ronden startades (via funktionen, som läser förbi RLS).
  order_number          text,
  fortnox_order_number  text,
  project_name          text not null,
  client_name           text,

  -- Rondinfo, som i mallens flik 1. Allt utom datum är fritext som rondledaren kan justera.
  site_address          text,      -- Projekt / adress
  object_label          text,      -- Objekt / husnr
  held_on               date not null,
  held_at               time,      -- Klockslag
  client_label          text,      -- Beställare / byggherre
  contract_step         text,      -- Entreprenadmoment
  employer              text,      -- Arbetsgivare
  work_type             text,      -- Typ av arbete
  weather               text,
  leader_id             uuid references public.profiles(id) on delete set null,
  leader_name           text,      -- Rondledare (chef). SNAPSHOT: profiles är self-read-only.
  safety_rep_name       text,      -- Skyddsombud
  next_round_due        date,      -- Nästa rond senast
  previous_followed_up  boolean,   -- Uppföljning av förra ronden gjord? (null = inte besvarat)

  created_by            uuid references public.profiles(id) on delete set null,
  created_by_name       text not null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  completed_at          timestamptz,
  completed_by          uuid references public.profiles(id) on delete set null,

  constraint safety_rounds_number_chk check (round_number >= 1),
  constraint safety_rounds_status_chk check (status in ('draft', 'completed')),
  constraint safety_rounds_completed_chk check ((status = 'completed') = (completed_at is not null)),
  constraint safety_rounds_project_name_chk check (btrim(project_name) <> ''),
  constraint safety_rounds_created_by_name_chk check (btrim(created_by_name) <> ''),
  constraint safety_rounds_number_uniq unique (work_order_id, round_number)
);

-- Listan på /skyddsrond (senaste först). Orderns lista går på det unika indexet.
create index if not exists safety_rounds_held_on_idx on public.safety_rounds (held_on desc, created_at desc);

create table if not exists public.safety_round_participants (
  id          uuid primary key default gen_random_uuid(),
  round_id    uuid not null references public.safety_rounds(id) on delete cascade,
  -- null för externa (UE, beställare). PR 3 låter en deltagare med profil kvittera själv.
  profile_id  uuid references public.profiles(id) on delete set null,
  name        text not null,
  role        text not null,
  company     text,
  present     boolean not null default true,
  initials    text,
  comment     text,
  position    integer not null default 0,
  created_at  timestamptz not null default now(),
  constraint safety_round_participants_name_chk check (btrim(name) <> ''),
  constraint safety_round_participants_role_chk
    check (role in ('leader', 'safety_rep', 'installer', 'site_manager', 'other'))
);

create index if not exists safety_round_participants_round_idx
  on public.safety_round_participants (round_id, position);

create table if not exists public.safety_round_items (
  id                uuid primary key default gen_random_uuid(),
  round_id          uuid not null references public.safety_rounds(id) on delete cascade,
  -- null = rondens egen punkt ("Lägg till fler risker..."). Katalogpunkten kan inaktiveras senare;
  -- texten nedan är snapshottad och det är den som gäller.
  catalog_item_id   uuid references public.safety_checklist_items(id) on delete set null,
  category_code     text not null,
  category_label    text not null,
  number            integer,
  text              text not null,
  position          integer not null,

  -- null = inte bedömd ännu. Slutför kräver att varje punkt är bedömd.
  status            text,
  -- null = "–".
  risk              text,
  description       text,
  fixed_on_site     boolean,
  to_action_plan    text,
  comment           text,

  constraint safety_round_items_text_chk check (btrim(text) <> ''),
  constraint safety_round_items_status_chk check (status is null or status in ('ok', 'partial', 'defect', 'na')),
  constraint safety_round_items_risk_chk check (risk is null or risk in ('low', 'medium', 'high', 'severe')),
  constraint safety_round_items_plan_chk check (to_action_plan is null or to_action_plan in ('yes', 'no', 'fixed'))
);

create index if not exists safety_round_items_round_idx on public.safety_round_items (round_id, position);

create table if not exists public.safety_round_actions (
  id               uuid primary key default gen_random_uuid(),
  round_id         uuid not null references public.safety_rounds(id) on delete cascade,
  item_id          uuid references public.safety_round_items(id) on delete set null,
  position         integer not null default 0,

  -- Låsta när ronden är slutförd (triggern nedan).
  finding          text not null,   -- Risk / brist
  risk             text,
  action           text,            -- Åtgärd
  responsible_id   uuid references public.profiles(id) on delete set null,
  responsible_name text,            -- "En person per åtgärd" (mallen). SNAPSHOT.
  due_on           date,            -- Klart senast

  -- Uppföljningen — öppen även efter slutförd rond.
  status           text not null default 'not_started',
  followed_up_on   date,
  effect           text,
  cost_note        text,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint safety_round_actions_finding_chk check (btrim(finding) <> ''),
  constraint safety_round_actions_risk_chk check (risk is null or risk in ('low', 'medium', 'high', 'severe')),
  constraint safety_round_actions_status_chk
    check (status in ('not_started', 'in_progress', 'done', 'delayed', 'written_off')),
  constraint safety_round_actions_effect_chk
    check (effect is null or effect in ('yes', 'no', 'partial', 'not_assessed'))
);

create index if not exists safety_round_actions_round_idx on public.safety_round_actions (round_id, position);

alter table public.safety_rounds enable row level security;
alter table public.safety_round_participants enable row level security;
alter table public.safety_round_items enable row level security;
alter table public.safety_round_actions enable row level security;

-- ---------------------------------------------------------------------------
-- 4. Hjälpare
-- ---------------------------------------------------------------------------

-- Är ronden fortfarande ett utkast? SECURITY DEFINER så att barn-tabellernas policyer inte beror på
-- att den som skriver också råkar ha läsnyckeln (policyns underfråga hade annars gått genom
-- safety_rounds egen RLS). Okänd rond = false = ingen skrivning.
create or replace function public.safety_round_is_draft(p_round_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.safety_rounds r where r.id = p_round_id and r.status = 'draft');
$$;

revoke all on function public.safety_round_is_draft(uuid) from public;
grant execute on function public.safety_round_is_draft(uuid) to authenticated;

-- updated_at + låset på åtgärden. Uppföljningsfälten får ändras efter slutförd rond; själva
-- åtgärden, den ansvarige och datumet får det inte — de är det protokollet sa.
create or replace function public.safety_round_actions_before_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.round_id is distinct from old.round_id then
    raise exception 'safety_round_actions: round_id kan inte ändras' using errcode = '42501';
  end if;
  if not public.safety_round_is_draft(old.round_id) and (
       new.item_id          is distinct from old.item_id
    or new.finding          is distinct from old.finding
    or new.risk             is distinct from old.risk
    or new.action           is distinct from old.action
    or new.responsible_id   is distinct from old.responsible_id
    or new.responsible_name is distinct from old.responsible_name
    or new.due_on           is distinct from old.due_on
    or new.position         is distinct from old.position
  ) then
    raise exception 'safety_round_actions: ronden är slutförd, bara uppföljningen kan ändras'
      using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists safety_round_actions_before_update on public.safety_round_actions;
create trigger safety_round_actions_before_update
  before update on public.safety_round_actions
  for each row execute function public.safety_round_actions_before_update();

-- updated_at på ronden, och vem/när den slutfördes sätts HÄR — inte ur klienten.
create or replace function public.safety_rounds_before_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.work_order_id is distinct from old.work_order_id
     or new.round_number is distinct from old.round_number
     or new.created_by is distinct from old.created_by then
    raise exception 'safety_rounds: order, rondnummer och skapare kan inte ändras' using errcode = '42501';
  end if;
  if new.status = 'completed' and old.status = 'draft' then
    new.completed_at := now();
    new.completed_by := auth.uid();
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists safety_rounds_before_update on public.safety_rounds;
create trigger safety_rounds_before_update
  before update on public.safety_rounds
  for each row execute function public.safety_rounds_before_update();

-- ---------------------------------------------------------------------------
-- 5. Grants
-- ---------------------------------------------------------------------------
-- En radpolicy gör INGENTING utan tabellprivilegiet, och ett privilegium utan policy ger 0 rader.
-- Både-eller-ingen. safety_rounds saknar insert med flit (se huvudet).
grant select, update, delete on public.safety_rounds to authenticated;
grant select, insert, update, delete on public.safety_round_participants to authenticated;
grant select, insert, update, delete on public.safety_round_items to authenticated;
grant select, insert, update, delete on public.safety_round_actions to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Policyer
-- ---------------------------------------------------------------------------
-- Läsning: läsnyckeln. Skrivnyckeln räcker också — den som fyller i en rond måste kunna läsa den,
-- även med bara skrivnyckeln personligt tilldelad.

drop policy if exists safety_rounds_select on public.safety_rounds;
create policy safety_rounds_select
  on public.safety_rounds
  for select
  to authenticated
  using (
    public.has_permission('safety.round.read')
    or public.has_permission('safety.round.write')
  );

-- Uppdatera: bara ett utkast. with check släpper igenom övergången draft -> completed; den omvända
-- vägen stängs av `using` (en slutförd rond matchar aldrig).
drop policy if exists safety_rounds_update on public.safety_rounds;
create policy safety_rounds_update
  on public.safety_rounds
  for update
  to authenticated
  using (status = 'draft' and public.has_permission('safety.round.write'))
  with check (public.has_permission('safety.round.write'));

-- Ta bort: bara ett utkast (en rond startad av misstag). En slutförd rond är ett protokoll.
drop policy if exists safety_rounds_delete on public.safety_rounds;
create policy safety_rounds_delete
  on public.safety_rounds
  for delete
  to authenticated
  using (status = 'draft' and public.has_permission('safety.round.write'));

-- Deltagarna: läs med ronden, skriv bara i ett utkast.
drop policy if exists safety_round_participants_select on public.safety_round_participants;
create policy safety_round_participants_select
  on public.safety_round_participants
  for select
  to authenticated
  using (
    public.has_permission('safety.round.read')
    or public.has_permission('safety.round.write')
  );

drop policy if exists safety_round_participants_insert on public.safety_round_participants;
create policy safety_round_participants_insert
  on public.safety_round_participants
  for insert
  to authenticated
  with check (public.has_permission('safety.round.write') and public.safety_round_is_draft(round_id));

drop policy if exists safety_round_participants_update on public.safety_round_participants;
create policy safety_round_participants_update
  on public.safety_round_participants
  for update
  to authenticated
  using (public.has_permission('safety.round.write') and public.safety_round_is_draft(round_id))
  with check (public.has_permission('safety.round.write') and public.safety_round_is_draft(round_id));

drop policy if exists safety_round_participants_delete on public.safety_round_participants;
create policy safety_round_participants_delete
  on public.safety_round_participants
  for delete
  to authenticated
  using (public.has_permission('safety.round.write') and public.safety_round_is_draft(round_id));

-- Punkterna: katalogpunkterna kommer in via start_safety_round(); härifrån läggs bara EGNA punkter
-- till (catalog_item_id is null), och bara egna punkter kan tas bort.
drop policy if exists safety_round_items_select on public.safety_round_items;
create policy safety_round_items_select
  on public.safety_round_items
  for select
  to authenticated
  using (
    public.has_permission('safety.round.read')
    or public.has_permission('safety.round.write')
  );

drop policy if exists safety_round_items_insert on public.safety_round_items;
create policy safety_round_items_insert
  on public.safety_round_items
  for insert
  to authenticated
  with check (
    catalog_item_id is null
    and public.has_permission('safety.round.write')
    and public.safety_round_is_draft(round_id)
  );

drop policy if exists safety_round_items_update on public.safety_round_items;
create policy safety_round_items_update
  on public.safety_round_items
  for update
  to authenticated
  using (public.has_permission('safety.round.write') and public.safety_round_is_draft(round_id))
  with check (public.has_permission('safety.round.write') and public.safety_round_is_draft(round_id));

drop policy if exists safety_round_items_delete on public.safety_round_items;
create policy safety_round_items_delete
  on public.safety_round_items
  for delete
  to authenticated
  using (
    catalog_item_id is null
    and public.has_permission('safety.round.write')
    and public.safety_round_is_draft(round_id)
  );

-- Åtgärderna: skapa och ta bort bara i ett utkast; uppdatera även efteråt (uppföljningen) — vilka
-- fält som får ändras då avgör triggern.
drop policy if exists safety_round_actions_select on public.safety_round_actions;
create policy safety_round_actions_select
  on public.safety_round_actions
  for select
  to authenticated
  using (
    public.has_permission('safety.round.read')
    or public.has_permission('safety.round.write')
  );

drop policy if exists safety_round_actions_insert on public.safety_round_actions;
create policy safety_round_actions_insert
  on public.safety_round_actions
  for insert
  to authenticated
  with check (public.has_permission('safety.round.write') and public.safety_round_is_draft(round_id));

drop policy if exists safety_round_actions_update on public.safety_round_actions;
create policy safety_round_actions_update
  on public.safety_round_actions
  for update
  to authenticated
  using (public.has_permission('safety.round.write'))
  with check (public.has_permission('safety.round.write'));

drop policy if exists safety_round_actions_delete on public.safety_round_actions;
create policy safety_round_actions_delete
  on public.safety_round_actions
  for delete
  to authenticated
  using (public.has_permission('safety.round.write') and public.safety_round_is_draft(round_id));

-- ---------------------------------------------------------------------------
-- 7. Ordern — smala uppslag förbi crm_work_orders-RLS
-- ---------------------------------------------------------------------------
-- ⚠️ SECURITY DEFINER läser förbi RLS. Grinden är skrivnyckeln, och det som lämnas ut är BARA
-- kolumnerna nedan: ordernummer, projekt, kund, status och adressfälten. Aldrig internal_handoff
-- (portkoder), aldrig customer_snapshot i sin helhet (personnummer), aldrig priser. Adressen lämnas
-- som fält i den form resolveJobAddress (lib/domains/planning/display.ts) läser — samma avsmalning
-- som get_my_crm_jobs gör — så att adressregeln bor på ETT ställe, i TypeScript.

create or replace function public.safety_round_order_lookup(p_query text)
returns table (
  id                    uuid,
  order_number          text,
  fortnox_order_number  text,
  project_name          text,
  client_name           text,
  status                text,
  work_address          jsonb,
  customer_address      jsonb
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_q text := btrim(coalesce(p_query, ''));
begin
  if not public.has_permission('safety.round.write') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if length(v_q) < 2 then
    return;
  end if;

  return query
  select
    wo.id,
    wo.order_number,
    wo.fortnox_order_number,
    wo.project_name,
    wo.client_name,
    wo.status,
    jsonb_build_object(
      'street_address', wo.work_address ->> 'street_address',
      'postal_code',    wo.work_address ->> 'postal_code',
      'city',           wo.work_address ->> 'city'
    ),
    jsonb_build_object(
      'delivery_address',     wo.customer_snapshot ->> 'delivery_address',
      'delivery_postal_code', wo.customer_snapshot ->> 'delivery_postal_code',
      'delivery_city',        wo.customer_snapshot ->> 'delivery_city',
      'street_address',       wo.customer_snapshot ->> 'street_address',
      'postal_code',          wo.customer_snapshot ->> 'postal_code',
      'city',                 wo.customer_snapshot ->> 'city'
    )
  from public.crm_work_orders wo
  where wo.status <> 'cancelled'
    and (
      wo.order_number ilike '%' || v_q || '%'
      or wo.fortnox_order_number ilike '%' || v_q || '%'
      or wo.project_name ilike '%' || v_q || '%'
      or wo.client_name ilike '%' || v_q || '%'
    )
  order by wo.created_at desc
  limit 20;
end;
$$;

revoke all on function public.safety_round_order_lookup(text) from public;
grant execute on function public.safety_round_order_lookup(text) to authenticated;

create or replace function public.safety_round_order_header(p_work_order_id uuid)
returns table (
  id                    uuid,
  order_number          text,
  fortnox_order_number  text,
  project_name          text,
  client_name           text,
  status                text,
  work_address          jsonb,
  customer_address      jsonb
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.has_permission('safety.round.write') then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  return query
  select
    wo.id,
    wo.order_number,
    wo.fortnox_order_number,
    wo.project_name,
    wo.client_name,
    wo.status,
    jsonb_build_object(
      'street_address', wo.work_address ->> 'street_address',
      'postal_code',    wo.work_address ->> 'postal_code',
      'city',           wo.work_address ->> 'city'
    ),
    jsonb_build_object(
      'delivery_address',     wo.customer_snapshot ->> 'delivery_address',
      'delivery_postal_code', wo.customer_snapshot ->> 'delivery_postal_code',
      'delivery_city',        wo.customer_snapshot ->> 'delivery_city',
      'street_address',       wo.customer_snapshot ->> 'street_address',
      'postal_code',          wo.customer_snapshot ->> 'postal_code',
      'city',                 wo.customer_snapshot ->> 'city'
    )
  from public.crm_work_orders wo
  where wo.id = p_work_order_id;
end;
$$;

revoke all on function public.safety_round_order_header(uuid) from public;
grant execute on function public.safety_round_order_header(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Starta en rond
-- ---------------------------------------------------------------------------
-- EN transaktion: rondnumret räknas fram, ordern snapshottas, rondledaren sätts till den som
-- startar, och katalogens AKTIVA punkter kopieras in med texten snapshottad.
--
-- ⚠️ Anropas med SESSIONSKLIENTEN. auth.uid() är null under service-roll, och då nekar funktionen —
-- det är avsikten (created_by och rondledaren ska vara en riktig person).
--
-- p_site_address kommer från rutten, som löst upp adressen med resolveJobAddress ur
-- safety_round_order_header(). Det är fritext rondledaren ändå kan ändra; att den kommer utifrån
-- ger ingen rättighet utöver den nyckeln redan ger.
create or replace function public.start_safety_round(
  p_work_order_id uuid,
  p_held_on date,
  p_site_address text,
  p_employer text,
  p_work_type text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_name text;
  v_wo record;
  v_round_id uuid;
  v_number integer;
begin
  if v_uid is null or not public.has_permission('safety.round.write') then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select wo.order_number, wo.fortnox_order_number, wo.project_name, wo.client_name, wo.status
    into v_wo
  from public.crm_work_orders wo
  where wo.id = p_work_order_id;

  if not found then
    raise exception 'work order not found' using errcode = 'P0002';
  end if;

  select nullif(btrim(p.full_name), '') into v_name from public.profiles p where p.id = v_uid;

  select coalesce(max(r.round_number), 0) + 1 into v_number
  from public.safety_rounds r
  where r.work_order_id = p_work_order_id;

  insert into public.safety_rounds (
    work_order_id, round_number, status,
    order_number, fortnox_order_number, project_name, client_name,
    site_address, held_on, client_label, employer, work_type,
    leader_id, leader_name,
    created_by, created_by_name
  ) values (
    p_work_order_id, v_number, 'draft',
    v_wo.order_number, v_wo.fortnox_order_number,
    coalesce(nullif(btrim(v_wo.project_name), ''), 'Arbetsorder ' || coalesce(v_wo.order_number, '')),
    v_wo.client_name,
    nullif(btrim(p_site_address), ''), p_held_on, v_wo.client_name,
    nullif(btrim(p_employer), ''), nullif(btrim(p_work_type), ''),
    v_uid, v_name,
    v_uid, coalesce(v_name, 'Okänd')
  )
  returning id into v_round_id;

  insert into public.safety_round_items (
    round_id, catalog_item_id, category_code, category_label, number, text, position
  )
  select
    v_round_id, i.id, c.code, c.label, i.number, i.text,
    row_number() over (order by c.position, i.position, i.number)::integer
  from public.safety_checklist_items i
  join public.safety_checklist_categories c on c.id = i.category_id
  where i.active and c.active;

  -- Rondledaren står först i deltagarlistan, som i mallen ("Chef/arbetsledare").
  insert into public.safety_round_participants (round_id, profile_id, name, role, position)
  values (v_round_id, v_uid, coalesce(v_name, 'Okänd'), 'leader', 0);

  return v_round_id;
end;
$$;

revoke all on function public.start_safety_round(uuid, date, text, text, text) from public;
grant execute on function public.start_safety_round(uuid, date, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Verifiering (kör efter applicering)
-- ---------------------------------------------------------------------------
--
-- 1. Nycklarna och deras roller. Förväntat: admin + sales på båda, inget annat.
--
--      select permission_key, role from public.role_permissions
--      where permission_key like 'safety.%' order by 1, 2;
--
-- 2. Katalogen: 9 kategorier, 20 punkter.
--
--      select (select count(*) from public.safety_checklist_categories) as categories,
--             (select count(*) from public.safety_checklist_items) as items;
--
-- 3. Grants för authenticated. safety_rounds ska sakna INSERT; katalogen ska bara ha SELECT.
--
--      select table_name, string_agg(privilege_type, ', ' order by privilege_type)
--      from information_schema.role_table_grants
--      where table_schema = 'public' and grantee = 'authenticated'
--        and (table_name like 'safety_round%' or table_name like 'safety_checklist%')
--      group by table_name order by table_name;
--
-- 4. RLS på alla sex tabellerna:
--
--      select relname, relrowsecurity from pg_class
--      where relname like 'safety_round%' or relname like 'safety_checklist%' order by relname;
--
-- 5. Låset: i en transaktion, starta en rond som dig själv, slutför den, och försök sedan ändra en
--    punkt (ska ge 0 rader) och åtgärdens text (ska kasta 42501). Rulla tillbaka.
--
-- 6. En installatör (member, utan nycklarna) ska se NOLL ronder och få 42501 från
--    safety_round_order_lookup. Impersonera enligt metoden i
--    20260811_crm_work_order_rls_perf_probe.sql — rollbytet, frågan och avläsningen MÅSTE ligga i
--    EN sats:
--
--      select count(*) from public.safety_rounds;
