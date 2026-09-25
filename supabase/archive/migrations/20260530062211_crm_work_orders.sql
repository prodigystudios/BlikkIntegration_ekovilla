create table if not exists public.crm_work_orders (
	id uuid primary key default gen_random_uuid(),
	quote_id uuid not null unique references public.crm_quotes(id) on delete restrict,
	prospect_id uuid references public.crm_prospects(id) on delete set null,
	order_number text not null unique,
	project_name text not null,
	client_name text not null,
	quote_type text not null check (quote_type in ('private', 'business')),
	customer_snapshot jsonb not null default '{}'::jsonb,
	work_address jsonb not null default '{}'::jsonb,
	pricing_summary jsonb not null default '{}'::jsonb,
	line_items jsonb not null default '[]'::jsonb,
	rot_details jsonb not null default '{}'::jsonb,
	internal_handoff jsonb not null default '{}'::jsonb,
	currency_code text not null default 'SEK',
	amount numeric(12, 2) not null default 0 check (amount >= 0),
	vat_percent numeric(5, 2) not null default 25,
	desired_installation_date date,
	source_status text not null default 'won',
	status text not null default 'draft' check (status in ('draft', 'scheduled', 'ready', 'in_progress', 'completed', 'cancelled')),
	notes text,
	created_by uuid not null references public.profiles(id) on delete restrict,
	assigned_to uuid not null references public.profiles(id) on delete restrict,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now()
);

create index if not exists crm_work_orders_assigned_status_idx on public.crm_work_orders(assigned_to, status, desired_installation_date);
create index if not exists crm_work_orders_created_at_idx on public.crm_work_orders(created_at desc);
create index if not exists crm_work_orders_prospect_idx on public.crm_work_orders(prospect_id);

alter table public.crm_quotes
	add column if not exists work_order_id uuid references public.crm_work_orders(id) on delete set null,
	add column if not exists work_order_number text,
	add column if not exists converted_to_work_order_at timestamptz,
	add column if not exists converted_to_work_order_by uuid references public.profiles(id) on delete set null;

create index if not exists crm_quotes_work_order_id_idx on public.crm_quotes(work_order_id);

alter table public.crm_work_orders enable row level security;

grant select, insert, update, delete on table public.crm_work_orders to authenticated;

drop policy if exists crm_work_orders_select_visible on public.crm_work_orders;
create policy crm_work_orders_select_visible
	on public.crm_work_orders
	for select
	using (
		auth.uid() = assigned_to
		or exists (
			select 1
			from public.profiles p
			where p.id = auth.uid()
				and p.role = 'admin'
		)
	);

drop policy if exists crm_work_orders_insert_sales_or_admin on public.crm_work_orders;
create policy crm_work_orders_insert_sales_or_admin
	on public.crm_work_orders
	for insert
	to authenticated
	with check (
		created_by = auth.uid()
		and assigned_to = auth.uid()
		and exists (
			select 1
			from public.profiles p
			where p.id = auth.uid()
				and p.role in ('sales', 'admin')
		)
	);

drop policy if exists crm_work_orders_insert_admin_manage on public.crm_work_orders;
create policy crm_work_orders_insert_admin_manage
	on public.crm_work_orders
	for insert
	to authenticated
	with check (
		created_by = auth.uid()
		and exists (
			select 1
			from public.profiles p
			where p.id = auth.uid()
				and p.role = 'admin'
		)
	);

drop policy if exists crm_work_orders_update_visible on public.crm_work_orders;
create policy crm_work_orders_update_visible
	on public.crm_work_orders
	for update
	using (
		auth.uid() = assigned_to
		or exists (
			select 1
			from public.profiles p
			where p.id = auth.uid()
				and p.role = 'admin'
		)
	)
	with check (
		auth.uid() = assigned_to
		or exists (
			select 1
			from public.profiles p
			where p.id = auth.uid()
				and p.role = 'admin'
		)
	);

drop policy if exists crm_work_orders_delete_assigned_or_admin on public.crm_work_orders;
create policy crm_work_orders_delete_assigned_or_admin
	on public.crm_work_orders
	for delete
	using (
		auth.uid() = assigned_to
		or exists (
			select 1
			from public.profiles p
			where p.id = auth.uid()
				and p.role = 'admin'
		)
	);

create or replace function public.set_timestamp_crm_work_orders()
returns trigger
language plpgsql
as $$
begin
	new.updated_at = now();
	return new;
end;
$$;

drop trigger if exists set_timestamp_crm_work_orders on public.crm_work_orders;
create trigger set_timestamp_crm_work_orders
before update on public.crm_work_orders
for each row execute procedure public.set_timestamp_crm_work_orders();
