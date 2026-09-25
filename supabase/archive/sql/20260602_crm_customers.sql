-- Skapa crm_customers-tabellen
create table if not exists public.crm_customers (
	id uuid primary key default gen_random_uuid(),
	customer_type text not null default 'business' check (customer_type in ('business', 'private')),

	-- B2B-fält
	company_name text,
	organization_number text,

	-- B2C-fält
	first_name text,
	last_name text,
	personal_number text,

	-- Adresser
	visit_address jsonb,   -- { street, postal_code, city }
	invoice_address jsonb, -- { street, postal_code, city }

	-- Ursprung
	source_prospect_id uuid references public.crm_prospects(id) on delete set null,

	-- Fortnox-synk
	fortnox_customer_id text unique,
	sync_status text not null default 'not_synced' check (sync_status in ('not_synced', 'pending', 'synced', 'failed')),
	last_synced_at timestamptz,

	-- Status
	status text not null default 'active' check (status in ('active', 'inactive', 'churned')),

	-- Ägarskap
	assigned_to uuid not null references auth.users(id),
	created_by uuid not null references auth.users(id),

	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),

	-- Minst ett av dessa måste vara ifyllt
	constraint crm_customers_identity_check check (
		company_name is not null or (first_name is not null and last_name is not null)
	)
);

-- Skapa crm_customer_contacts-tabellen
create table if not exists public.crm_customer_contacts (
	id uuid primary key default gen_random_uuid(),
	customer_id uuid not null references public.crm_customers(id) on delete cascade,
	name text not null,
	role text,
	phone text,
	email text,
	is_primary boolean not null default false,
	created_at timestamptz not null default now()
);

-- Lägg till customer_id på befintliga tabeller
alter table public.crm_opportunities
	add column if not exists customer_id uuid references public.crm_customers(id) on delete set null;

-- Fält för direktskapade affärsmöjligheter utan prospekt/kund (t.ex. direkta inkommande leads)
alter table public.crm_opportunities
	add column if not exists customer_type text check (customer_type in ('business', 'private'));

alter table public.crm_opportunities
	add column if not exists customer_name text;

alter table public.crm_opportunities
	add column if not exists contact_name text;

-- Constraint: antingen prospect_id, customer_id eller customer_name måste finnas
-- (kontrolleras i applikationslagret, inte som DB-constraint, för att undvika bakåtkompabilitetsproblem)

alter table public.crm_quotes
	add column if not exists customer_id uuid references public.crm_customers(id) on delete set null;

alter table public.crm_calls
	add column if not exists customer_id uuid references public.crm_customers(id) on delete set null;

alter table public.crm_work_orders
	add column if not exists customer_id uuid references public.crm_customers(id) on delete set null;

-- Unique index på source_prospect_id för att förhindra duplicerade kundposter vid parallella requests
create unique index if not exists crm_customers_source_prospect_id_unique
  on public.crm_customers (source_prospect_id)
  where source_prospect_id is not null;

-- Trigger för updated_at
create or replace function public.set_crm_customers_updated_at()
returns trigger language plpgsql as $$
begin
	new.updated_at = now();
	return new;
end;
$$;

drop trigger if exists crm_customers_set_updated_at on public.crm_customers;
create trigger crm_customers_set_updated_at
	before update on public.crm_customers
	for each row execute function public.set_crm_customers_updated_at();

-- Aktivera RLS
alter table public.crm_customers enable row level security;
alter table public.crm_customer_contacts enable row level security;

-- RLS-policyer för crm_customers
do $$
begin
	if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'crm_customers' and policyname = 'crm_customers_select_visible') then
		drop policy "crm_customers_select_visible" on public.crm_customers;
	end if;
	if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'crm_customers' and policyname = 'crm_customers_insert_sales_or_admin') then
		drop policy "crm_customers_insert_sales_or_admin" on public.crm_customers;
	end if;
	if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'crm_customers' and policyname = 'crm_customers_update_assigned_or_admin') then
		drop policy "crm_customers_update_assigned_or_admin" on public.crm_customers;
	end if;
	if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'crm_customers' and policyname = 'crm_customers_delete_admin') then
		drop policy "crm_customers_delete_admin" on public.crm_customers;
	end if;
end
$$;

create policy "crm_customers_select_visible"
	on public.crm_customers
	for select
	using (
		auth.uid() = assigned_to
		or exists (
			select 1 from public.profiles p
			where p.id = auth.uid() and p.role = 'admin'
		)
	);

create policy "crm_customers_insert_sales_or_admin"
	on public.crm_customers
	for insert
	to authenticated
	with check (
		created_by = auth.uid()
		and exists (
			select 1 from public.profiles p
			where p.id = auth.uid() and p.role in ('sales', 'admin')
		)
	);

create policy "crm_customers_update_assigned_or_admin"
	on public.crm_customers
	for update
	using (
		auth.uid() = assigned_to
		or exists (
			select 1 from public.profiles p
			where p.id = auth.uid() and p.role = 'admin'
		)
	)
	with check (
		auth.uid() = assigned_to
		or exists (
			select 1 from public.profiles p
			where p.id = auth.uid() and p.role = 'admin'
		)
	);

create policy "crm_customers_delete_admin"
	on public.crm_customers
	for delete
	using (
		exists (
			select 1 from public.profiles p
			where p.id = auth.uid() and p.role = 'admin'
		)
	);

-- RLS-policyer för crm_customer_contacts (ärver kundens synlighet)
do $$
begin
	if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'crm_customer_contacts' and policyname = 'crm_customer_contacts_select_visible') then
		drop policy "crm_customer_contacts_select_visible" on public.crm_customer_contacts;
	end if;
	if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'crm_customer_contacts' and policyname = 'crm_customer_contacts_insert_sales_or_admin') then
		drop policy "crm_customer_contacts_insert_sales_or_admin" on public.crm_customer_contacts;
	end if;
	if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'crm_customer_contacts' and policyname = 'crm_customer_contacts_update_sales_or_admin') then
		drop policy "crm_customer_contacts_update_sales_or_admin" on public.crm_customer_contacts;
	end if;
	if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'crm_customer_contacts' and policyname = 'crm_customer_contacts_delete_sales_or_admin') then
		drop policy "crm_customer_contacts_delete_sales_or_admin" on public.crm_customer_contacts;
	end if;
end
$$;

create policy "crm_customer_contacts_select_visible"
	on public.crm_customer_contacts
	for select
	using (
		exists (
			select 1 from public.crm_customers c
			where c.id = customer_id
			and (
				c.assigned_to = auth.uid()
				or exists (
					select 1 from public.profiles p
					where p.id = auth.uid() and p.role = 'admin'
				)
			)
		)
	);

create policy "crm_customer_contacts_insert_sales_or_admin"
	on public.crm_customer_contacts
	for insert
	to authenticated
	with check (
		exists (
			select 1 from public.crm_customers c
			where c.id = customer_id
			and (
				c.assigned_to = auth.uid()
				or exists (
					select 1 from public.profiles p
					where p.id = auth.uid() and p.role = 'admin'
				)
			)
		)
	);

create policy "crm_customer_contacts_update_sales_or_admin"
	on public.crm_customer_contacts
	for update
	using (
		exists (
			select 1 from public.crm_customers c
			where c.id = customer_id
			and (
				c.assigned_to = auth.uid()
				or exists (
					select 1 from public.profiles p
					where p.id = auth.uid() and p.role = 'admin'
				)
			)
		)
	);

create policy "crm_customer_contacts_delete_sales_or_admin"
	on public.crm_customer_contacts
	for delete
	using (
		exists (
			select 1 from public.crm_customers c
			where c.id = customer_id
			and (
				c.assigned_to = auth.uid()
				or exists (
					select 1 from public.profiles p
					where p.id = auth.uid() and p.role = 'admin'
				)
			)
		)
	);
