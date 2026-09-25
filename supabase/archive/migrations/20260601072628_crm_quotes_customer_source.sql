alter table public.crm_quotes
	add column if not exists customer_source jsonb not null default '{}'::jsonb;

update public.crm_quotes
set customer_source = jsonb_build_object(
	'kind', case when prospect_id is not null then 'prospect' else 'local' end,
	'sync_intent', 'local_only'
)
where customer_source = '{}'::jsonb
	or customer_source is null;
