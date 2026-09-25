-- Apply due deliveries migration (Option A)
-- Adds processed_at flag and function to apply (materialize) deliveries into depot stock once.

alter table public.planning_depot_deliveries
  add column if not exists processed_at timestamptz;

create index if not exists idx_planning_depot_deliveries_unprocessed
  on public.planning_depot_deliveries(delivery_date)
  where processed_at is null;

-- Function: apply all deliveries with delivery_date <= current_date and not yet processed
create or replace function public.apply_due_deliveries()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  applied int := 0;
begin
  for r in
    select id, depot_id, material_kind, amount
    from public.planning_depot_deliveries
    where processed_at is null
      and delivery_date <= current_date
    order by delivery_date, id
  loop
    if r.material_kind = 'Ekovilla' then
      update public.planning_depots
        set material_ekovilla_total = coalesce(material_ekovilla_total, material_total, 0) + r.amount
      where id = r.depot_id;
    elsif r.material_kind = 'Vitull' then
      update public.planning_depots
        set material_vitull_total = coalesce(material_vitull_total, 0) + r.amount
      where id = r.depot_id;
    end if;
    update public.planning_depot_deliveries
      set processed_at = now()
      where id = r.id;
    applied := applied + 1;
  end loop;
  return applied;
end;
$$;

revoke all on function public.apply_due_deliveries() from public;
grant execute on function public.apply_due_deliveries() to authenticated;
