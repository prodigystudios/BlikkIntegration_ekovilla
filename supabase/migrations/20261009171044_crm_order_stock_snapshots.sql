-- Orderstockens ögonblicksbild, en rad per svensk dag.
--
-- Orderstocken är ett läge, inte en händelse: en order sparar bara sin nuvarande status, så hur stocken såg ut
-- en söndag i september går inte att räkna fram per läge i efterhand. Ägarnas veckorapport (Excel-exporten)
-- behöver den per vecka (William 2026-10-09). Ett schemalagt jobb (/api/crm/reports/order-stock-snapshot,
-- varje timme) skriver om dagens rad; dagens sista körning blir dagens läge, och veckans sista dag veckans.
--
--   day          den svenska dagen läget gäller
--   stages       per läge: [{"key": "draft", "count": 3, "value": 45874.00}, ...] — samma lägen och samma
--                belopp (det som återstår att fakturera, ex moms) som rapportens "Orderstock efter läge"
--   total_count  antal order i stocken
--   total_value  summan av stages värden
--   taken_at     när raden senast skrevs
--
-- Additiv: en ny tabell som ingen befintlig kod läser. Kan köras före koden.
--
-- Behörighet: bara servern. Jobbet skriver och exporten läser med service-rollen; ingen session behöver
-- tabellen. Därför RLS utan policyer och inga grants till anon/authenticated. Default privileges är stängda sedan
-- 20260926134651; revoke står ändå här, så att tabellen inte blir öppen i en databas där standarden inte är
-- stängd. service_role grantas uttryckligen av samma skäl.

create table if not exists public.crm_order_stock_snapshots (
  day date primary key,
  stages jsonb not null,
  total_count integer not null,
  total_value numeric(14,2) not null,
  taken_at timestamptz not null default now(),
  constraint crm_order_stock_snapshots_stages_is_array check (jsonb_typeof(stages) = 'array'),
  constraint crm_order_stock_snapshots_total_count_check check (total_count >= 0),
  constraint crm_order_stock_snapshots_total_value_check check (total_value >= 0)
);

comment on table public.crm_order_stock_snapshots is
  'Orderstocken per svensk dag och läge, skriven av /api/crm/reports/order-stock-snapshot. Läses av ägarnas Excel-export.';

alter table public.crm_order_stock_snapshots enable row level security;
revoke all on table public.crm_order_stock_snapshots from anon, authenticated;
grant select, insert, update, delete on table public.crm_order_stock_snapshots to service_role;
