-- Komplement till baslinjen: de behörigheter prod har TAGIT BORT, och som pull:en tappade.
--
-- En tabell eller funktion som skapas i Supabase får projektets default privileges: allt till anon
-- och authenticated. Prod har för de här objekten revoke:at det (t.ex. KMA-rättelsen #215,
-- skyddsronderna, materialbeställningens funktioner). Baslinjen (20260925081734) fick med prods
-- GRANT-satser men inga REVOKE mot default privileges — så en databas byggd ur den var MER öppen än
-- prod. `db diff` visade det inte; paritetskontrollen (supabase/checks/parity.sql) gjorde det.
--
-- Listan är exakt skillnaden mellan prod och en lokal databas byggd ur baslinjen, 2026-09-25.
-- Mot prod är filen en no-op: där saknas behörigheterna redan. Den körs aldrig där — den markeras
-- som körd tillsammans med baslinjen.

-- Tabeller där prod inte ger anon någonting.
revoke all on table public.crm_work_order_kma_plans from anon;
revoke all on table public.ops_depot_stock_counts from anon;
revoke all on table public.safety_checklist_categories from anon;
revoke all on table public.safety_checklist_items from anon;
revoke all on table public.safety_round_actions from anon;
revoke all on table public.safety_round_items from anon;
revoke all on table public.safety_round_participants from anon;
revoke all on table public.safety_round_photos from anon;
revoke all on table public.safety_rounds from anon;

-- Funktioner som prod inte låter anon (och i några fall authenticated) anropa.
revoke execute on function public._material_order_create_expected(p_order_id uuid, p_lines jsonb) from anon, authenticated;
revoke execute on function public._material_order_lines_valid(p_lines jsonb) from anon, authenticated;
revoke execute on function public.add_safety_round_photo(p_round_id uuid, p_item_id uuid, p_storage_path text, p_print_path text, p_size_bytes integer, p_print_size_bytes integer) from anon;
revoke execute on function public.claim_material_order_send(p_order_id uuid, p_revision integer, p_attempt integer) from anon;
revoke execute on function public.finalize_material_order(p_order_id uuid, p_provider_message_id text) from anon;
revoke execute on function public.is_user_on_segment_between(p_uid uuid, p_segment uuid, p_from date, p_to date) from anon, authenticated;
revoke execute on function public.release_material_order_send(p_order_id uuid, p_attempt integer, p_error_code text, p_error text) from anon;
revoke execute on function public.resolve_material_order_send(p_order_id uuid, p_delivered boolean) from anon;
revoke execute on function public.safety_round_is_draft(p_round_id uuid) from anon;
revoke execute on function public.safety_round_order_header(p_work_order_id uuid) from anon;
revoke execute on function public.safety_round_order_lookup(p_query text) from anon;
revoke execute on function public.set_user_tags(target uuid, new_tags text[]) from authenticated;
revoke execute on function public.start_safety_round(p_work_order_id uuid, p_held_on date, p_site_address text, p_employer text, p_work_type text) from anon;
