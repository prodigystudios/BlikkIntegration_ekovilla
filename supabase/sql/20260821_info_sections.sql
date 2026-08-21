-- Redigerbart innehåll för /dokument-information.
--
-- Sidan var hårdkodad i app/dokument-information/page.tsx: två grupper ("Bilder" och
-- "Information") med dragspel under sig, och varje ändring krävde en utvecklare. Här blir
-- samma struktur data: grupper -> sektioner -> bilder, redigerbara från /admin.
--
-- ADDITIV (bara nya tabeller, ingen befintlig rörs) MEN KÖR DEN FÖRE KODEN.
-- Sidans hårdkodade innehåll är borta i samma ändring, så koden har inget att falla tillbaka
-- på: rullas den ut först saknas tabellerna, och /dokument-information visar rutan "Innehållet
-- kunde inte hämtas just nu" för varenda roll tills migreringen körts. Körs migreringen först
-- händer ingenting alls förrän koden kommer, vilket är den ofarliga ordningen.
--
-- ROLLER: alla inloggade läser, bara admin skriver. Samma form som news_items.
--
-- Funktionen nedan skapades av 20260402_document_publications.sql och finns redan i drift.
-- Den upprepas här som create or replace så filen går att köra mot en ny databas också -
-- utan den blir triggarna nedan ett fel mitt i migreringen.

create or replace function public.set_updated_at_timestamp()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.info_groups (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  sort_order integer not null default 0,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists info_groups_order_idx on public.info_groups(sort_order, created_at);

create table if not exists public.info_sections (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.info_groups(id) on delete cascade,
  title text not null,
  -- Blockmodellen från lib/domains/info-page/blocks.ts. Lagras som jsonb och INTE som html:
  -- redigeraren skickar en whitelistad struktur (stycke, lista, fet, länk) och sidan renderar
  -- den som React-element. Ingen rå html passerar någonsin genom databasen.
  body jsonb not null default '[]'::jsonb,
  sort_order integer not null default 0,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists info_sections_group_idx on public.info_sections(group_id, sort_order, created_at);

create table if not exists public.info_section_images (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.info_sections(id) on delete cascade,
  caption text,
  sort_order integer not null default 0,
  -- En bild har EN av två källor.
  --   storage_*   = uppladdad via admin, ligger i bucketen bakom en signerad url
  --   public_path = de gamla filerna under public/documents/ som redan låg i repot
  -- Två källor med flit: att flytta de gamla filerna till storage hade varit en datamigrering
  -- utan vinst, och de är redan publika. storage_bucket sparas per rad så en framtida flytt
  -- inte gör gamla rader oläsbara (samma resonemang som crm_work_order_files).
  storage_bucket text,
  storage_path text,
  public_path text,
  file_name text not null,
  created_at timestamptz not null default now(),
  constraint info_section_images_one_source check (
    (storage_bucket is not null and storage_path is not null and public_path is null)
    or (storage_bucket is null and storage_path is null and public_path is not null)
  )
);

create index if not exists info_section_images_section_idx on public.info_section_images(section_id, sort_order, created_at);

drop trigger if exists info_groups_set_updated_at on public.info_groups;
create trigger info_groups_set_updated_at
before update on public.info_groups
for each row execute function public.set_updated_at_timestamp();

drop trigger if exists info_sections_set_updated_at on public.info_sections;
create trigger info_sections_set_updated_at
before update on public.info_sections
for each row execute function public.set_updated_at_timestamp();

alter table public.info_groups enable row level security;
alter table public.info_sections enable row level security;
alter table public.info_section_images enable row level security;

-- Läs: alla inloggade. Sidan ligger i menyn för varje roll och innehållet är personalinfo.
drop policy if exists info_groups_select on public.info_groups;
create policy info_groups_select on public.info_groups
for select using (auth.role() = 'authenticated');

drop policy if exists info_sections_select on public.info_sections;
create policy info_sections_select on public.info_sections
for select using (auth.role() = 'authenticated');

drop policy if exists info_section_images_select on public.info_section_images;
create policy info_section_images_select on public.info_section_images
for select using (auth.role() = 'authenticated');

-- Skriv: bara admin.
drop policy if exists info_groups_admin_write on public.info_groups;
create policy info_groups_admin_write on public.info_groups
for all using (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
) with check (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
);

drop policy if exists info_sections_admin_write on public.info_sections;
create policy info_sections_admin_write on public.info_sections
for all using (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
) with check (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
);

drop policy if exists info_section_images_admin_write on public.info_section_images;
create policy info_section_images_admin_write on public.info_section_images
for all using (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
) with check (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
);


-- ---------------------------------------------------------------------------
-- Seedning av det som stod hårdkodat i sidan.
--
-- Idempotent: hela blocket hoppas över om någon grupp redan finns, så en omkörning varken
-- dubblerar innehållet eller skriver över ändringar som gjorts i /admin efteråt.
-- ---------------------------------------------------------------------------
do $$
declare
  v_bilder uuid;
  v_info uuid;
  v_section uuid;
begin
  if exists (select 1 from public.info_groups) then
    raise notice 'info_groups har redan rader - hoppar over seedningen';
    return;
  end if;

  insert into public.info_groups (title, sort_order) values ('Bilder', 0) returning id into v_bilder;
  insert into public.info_groups (title, sort_order) values ('Information', 1) returning id into v_info;

  insert into public.info_sections (group_id, title, sort_order, body)
  values (v_bilder, 'Mall Densitet', 0, '[]'::jsonb) returning id into v_section;
  insert into public.info_section_images (section_id, sort_order, public_path, file_name)
  values (v_section, 0, '/documents/mall-densitet-och-ytvikt.64f6f9f9d1fb36.45820158.png', 'Mall: Densitet och Ytvikt');

  insert into public.info_sections (group_id, title, sort_order, body)
  values (v_bilder, 'Lathund Isolering', 1, '[]'::jsonb) returning id into v_section;
  insert into public.info_section_images (section_id, sort_order, public_path, file_name)
  values (v_section, 0, '/documents/LATHUND ISOLERINGsdsdas-1.64dc66a5b38ea2.85087943.png', 'Lathund Isolering');

  insert into public.info_sections (group_id, title, sort_order, body)
  values (v_bilder, 'Rapportera tid i Blikk', 2, '[]'::jsonb) returning id into v_section;
  insert into public.info_section_images (section_id, sort_order, public_path, file_name) values
    (v_section, 0, '/documents/BLIKK rapportera tid LATHUND-1.png', 'Blikk Rapport Tid Lathund 1'),
    (v_section, 1, '/documents/BLIKK rapportera tid LATHUND-2.png', 'Blikk Rapport Tid Lathund 2'),
    (v_section, 2, '/documents/BLIKK rapportera tid LATHUND-3.png', 'Blikk Rapport Tid Lathund 3'),
    (v_section, 3, '/documents/BLIKK rapportera tid LATHUND-4.png', 'Blikk Rapport Tid Lathund 4'),
    (v_section, 4, '/documents/BLIKK rapportera tid LATHUND-5.png', 'Blikk Rapport Tid Lathund 5');

  insert into public.info_sections (group_id, title, sort_order, body)
  values (v_info, 'Försäkring Lastbil', 0, jsonb_build_array(
    jsonb_build_object('type', 'paragraph', 'children', jsonb_build_array(
      jsonb_build_object('type', 'text', 'text', 'Vid olycka med lastbil under Entreprenad så har vi försäkring på alla lastbilar som heter Protector försäkring och dom använder sig av Assistancekåren')
    )),
    jsonb_build_object('type', 'paragraph', 'children', jsonb_build_array(
      jsonb_build_object('type', 'text', 'text', 'Protector försäkring: '),
      jsonb_build_object('type', 'link', 'href', 'tel:0841063700', 'text', '08-410 637 00', 'bold', true)
    ))
  ));

  insert into public.info_sections (group_id, title, sort_order, body)
  values (v_info, 'Fallskydd', 1, jsonb_build_array(
    jsonb_build_object('type', 'paragraph', 'children', jsonb_build_array(
      jsonb_build_object('type', 'text', 'text', 'Vi innehar taksäkerhetsselar för våra anställdas säkerhet.')
    )),
    jsonb_build_object('type', 'paragraph', 'children', jsonb_build_array(
      jsonb_build_object('type', 'text', 'text', 'Det skall finnas ett sele-kit per bil. Dessa kit skall besiktigas en gång per år, Patrik har koll på när. Dock ansvarar varje team att se till att det kommer in till wurth som besiktigar våra selar och återhämtar dom när det är dax.')
    )),
    jsonb_build_object('type', 'paragraph', 'children', jsonb_build_array(
      jsonb_build_object('type', 'text', 'text', 'När detta är gjort så är det '),
      jsonb_build_object('type', 'text', 'text', 'extremt viktigt', 'bold', true),
      jsonb_build_object('type', 'text', 'text', ' att ni meddelar Patrik när ni har hämtat selen åter.')
    ))
  ));
end $$;
