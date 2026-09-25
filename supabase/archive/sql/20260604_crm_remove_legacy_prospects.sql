-- Ta bort legacy crm_prospects-tabellen och flytta alla FK-refs till crm_customers.
-- Alla CRM-tabeller innehåller enbart testdata och kan rensas.
-- Prospekt hanteras numera som crm_customers med customer_stage = 'prospect'.

-- ─── 1. Rensa testdata (barn-tabeller först pga FK-constraints) ──────────────

truncate table public.crm_ai_prospect_suggestions cascade;
truncate table public.crm_calls cascade;
truncate table public.crm_quotes cascade;
truncate table public.crm_work_orders cascade;
truncate table public.crm_opportunities cascade;
truncate table public.crm_customer_contacts cascade;
truncate table public.crm_customers cascade;
truncate table public.crm_goals cascade;
truncate table public.crm_prospects cascade;

-- ─── 2. Drop RLS-policies som refererar crm_prospects ────────────────────────

do $$
begin
  -- crm_calls
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'crm_calls' and policyname = 'crm_calls_select_visible') then
    drop policy "crm_calls_select_visible" on public.crm_calls;
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'crm_calls' and policyname = 'crm_calls_insert_visible') then
    drop policy "crm_calls_insert_visible" on public.crm_calls;
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'crm_calls' and policyname = 'crm_calls_update_visible') then
    drop policy "crm_calls_update_visible" on public.crm_calls;
  end if;
  -- crm_quotes
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'crm_quotes' and policyname = 'crm_quotes_insert_sales_or_admin') then
    drop policy "crm_quotes_insert_sales_or_admin" on public.crm_quotes;
  end if;
end
$$;

-- ─── 3. Peka om crm_opportunities.prospect_id → crm_customers ────────────────

alter table public.crm_opportunities
  drop constraint if exists crm_opportunities_prospect_id_fkey;

alter table public.crm_opportunities
  add constraint crm_opportunities_prospect_id_fkey
  foreign key (prospect_id) references public.crm_customers(id) on delete set null;

-- ─── 4. Peka om crm_quotes.prospect_id → crm_customers ──────────────────────

alter table public.crm_quotes
  drop constraint if exists crm_quotes_prospect_id_fkey;

alter table public.crm_quotes
  add constraint crm_quotes_prospect_id_fkey
  foreign key (prospect_id) references public.crm_customers(id) on delete set null;

-- ─── 5. Peka om crm_calls.prospect_id → crm_customers ───────────────────────

alter table public.crm_calls
  drop constraint if exists crm_calls_prospect_id_fkey;

alter table public.crm_calls
  add constraint crm_calls_prospect_id_fkey
  foreign key (prospect_id) references public.crm_customers(id) on delete set null;

-- ─── 6. Peka om crm_work_orders.prospect_id → crm_customers ─────────────────

alter table public.crm_work_orders
  drop constraint if exists crm_work_orders_prospect_id_fkey;

alter table public.crm_work_orders
  add constraint crm_work_orders_prospect_id_fkey
  foreign key (prospect_id) references public.crm_customers(id) on delete set null;

-- ─── 7. Peka om tasks.prospect_id → crm_customers ───────────────────────────

alter table public.tasks
  drop constraint if exists tasks_prospect_id_fkey;

alter table public.tasks
  add constraint tasks_prospect_id_fkey
  foreign key (prospect_id) references public.crm_customers(id) on delete set null;

-- ─── 8. crm_ai_prospect_suggestions: döp om kolumn + peka om FK ──────────────

alter table public.crm_ai_prospect_suggestions
  drop constraint if exists crm_ai_prospect_suggestions_approved_prospect_id_fkey;

alter table public.crm_ai_prospect_suggestions
  rename column approved_prospect_id to approved_customer_id;

alter table public.crm_ai_prospect_suggestions
  add constraint crm_ai_prospect_suggestions_approved_customer_id_fkey
  foreign key (approved_customer_id) references public.crm_customers(id) on delete set null;

-- ─── 9. Ta bort source_prospect_id från crm_customers ────────────────────────

alter table public.crm_customers
  drop constraint if exists crm_customers_source_prospect_id_fkey;

drop index if exists crm_customers_source_prospect_id_unique;

alter table public.crm_customers
  drop column if exists source_prospect_id;

-- ─── 10. Drop crm_prospects ──────────────────────────────────────────────────

drop table if exists public.crm_prospects;

-- ─── 11. Index för RLS-predikat (SUPABASE_CONVENTIONS.md §Policy Design Rules) ─

create index if not exists crm_customers_assigned_to_idx on public.crm_customers (assigned_to);
create index if not exists crm_customers_customer_stage_idx on public.crm_customers (customer_stage);
create index if not exists crm_calls_prospect_id_idx on public.crm_calls (prospect_id);
create index if not exists crm_quotes_prospect_id_idx on public.crm_quotes (prospect_id);
create index if not exists crm_opportunities_prospect_id_idx on public.crm_opportunities (prospect_id);
create index if not exists crm_work_orders_prospect_id_idx on public.crm_work_orders (prospect_id);

-- ─── 12. Återskapa RLS-policies mot crm_customers ────────────────────────────

create policy "crm_calls_select_visible"
  on public.crm_calls
  for select
  using (
    user_id = auth.uid()
    or exists (
      select 1
      from public.crm_customers c
      where c.id = prospect_id
        and c.assigned_to = auth.uid()
    )
    or exists (
      select 1
      from public.profiles profile
      where profile.id = auth.uid()
        and profile.role = 'admin'
    )
  );

create policy "crm_calls_insert_visible"
  on public.crm_calls
  for insert
  to authenticated
  with check (
    (
      user_id = auth.uid()
      and exists (
        select 1
        from public.profiles profile
        where profile.id = auth.uid()
          and profile.role in ('sales', 'admin')
      )
      and (
        prospect_id is null
        or exists (
          select 1
          from public.crm_customers c
          where c.id = prospect_id
            and c.assigned_to = auth.uid()
        )
      )
    )
    or exists (
      select 1
      from public.profiles admin_profile
      where admin_profile.id = auth.uid()
        and admin_profile.role = 'admin'
    )
  );

create policy "crm_calls_update_visible"
  on public.crm_calls
  for update
  using (
    user_id = auth.uid()
    or exists (
      select 1
      from public.profiles profile
      where profile.id = auth.uid()
        and profile.role = 'admin'
    )
  )
  with check (
    (
      user_id = auth.uid()
      and exists (
        select 1
        from public.profiles profile
        where profile.id = auth.uid()
          and profile.role in ('sales', 'admin')
      )
      and (
        prospect_id is null
        or exists (
          select 1
          from public.crm_customers c
          where c.id = prospect_id
            and c.assigned_to = auth.uid()
        )
      )
    )
    or exists (
      select 1
      from public.profiles admin_profile
      where admin_profile.id = auth.uid()
        and admin_profile.role = 'admin'
    )
  );

create policy "crm_quotes_insert_sales_or_admin"
  on public.crm_quotes
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
    and (
      prospect_id is null
      or exists (
        select 1
        from public.crm_customers c
        where c.id = prospect_id
          and c.assigned_to = auth.uid()
      )
    )
  );
