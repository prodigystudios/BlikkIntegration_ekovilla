alter table if exists public.planning_depot_usage
  add column if not exists order_number text;

create index if not exists planning_depot_usage_order_number_idx
  on public.planning_depot_usage(order_number);
