alter table public.crm_quotes
	add column if not exists line_items jsonb not null default '[]'::jsonb;

update public.crm_quotes
set line_items = '[]'::jsonb
where line_items is null;
