alter table public.crm_quotes
	add column if not exists quote_type text not null default 'business',
	add column if not exists customer_snapshot jsonb not null default '{}'::jsonb,
	add column if not exists pricing_summary jsonb not null default '{}'::jsonb,
	add column if not exists rot_details jsonb not null default '{}'::jsonb,
	add column if not exists internal_handoff jsonb not null default '{}'::jsonb,
	add column if not exists vat_percent numeric(5,2),
	add column if not exists valid_until date;

do $$
begin
	if not exists (
		select 1
		from pg_constraint
		where conname = 'crm_quotes_quote_type_check'
	) then
		alter table public.crm_quotes
			add constraint crm_quotes_quote_type_check
			check (quote_type in ('private', 'business'));
	end if;
end $$;

update public.crm_quotes
set
	customer_snapshot = jsonb_strip_nulls(
		jsonb_build_object(
			'customer_name', customer_name
		)
	),
	pricing_summary = jsonb_strip_nulls(
		jsonb_build_object(
			'amount', amount,
			'currency_code', currency_code
		)
	),
	vat_percent = coalesce(vat_percent, 25),
	valid_until = coalesce(valid_until, quote_date + integer '14')
where customer_snapshot = '{}'::jsonb
	 or pricing_summary = '{}'::jsonb
	 or vat_percent is null
	 or valid_until is null;
