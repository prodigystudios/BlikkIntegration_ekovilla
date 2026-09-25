-- Delfakturering: lägg tillbaka `index` bredvid `line_id` på rundor som redan migrerats.
--
-- VARFÖR EN EGEN FIL. 20260812_invoice_rounds_line_ids.sql bytte ut `index` mot `line_id`. Det gjorde
-- ordningen mellan migrering och deploy farlig: körs SQL:en först matchar koden i drift bara på
-- `index`, hittar ingenting, och läser fakturerat som 0 — hela ordern kan då faktureras en gång
-- till. Det läget uppstod skarpt 2026-08-12.
--
-- Filen fick därför en rad som behåller `index` för framtida migreringar. Men den räddar inte
-- posterna som redan skrivits: deras villkor (`q.value ? 'index'`) är falskt, eftersom de bär
-- `legacy_index` och inget `index`. En omkörning hoppar över dem helt och är en ren no-op.
--
-- Den här filen är den kompletteringen. Den är rent ADDITIV: den lägger till `index` på poster som
-- har `line_id` + `legacy_index` men saknar `index`. Inget antal, inget line_id och ingen ordning
-- rörs.
--
-- EFTER DEN HÄR läser båda kodgenerationerna rätt:
--   • nuvarande kod matchar på `line_id` (förstahandsvalet i invoicedOnLine)
--   • en tillbakarullad version matchar på `index`
-- Ordningen deploy/migrering kan därmed aldrig öppna läsfönstret igen.
--
-- Idempotent på riktigt: WHERE-satsen utesluter rader där varje post redan har `index`, så en andra
-- körning skriver ingenting. Kör den två gånger innan du litar på den.

begin;

update public.crm_work_order_invoices inv
set line_quantities = (
  select jsonb_agg(
    case
      when q.value ? 'line_id' and q.value ? 'legacy_index' and not (q.value ? 'index')
        -- `||` slår ihop objekten: posten behålls exakt som den är, med `index` tillagt.
        then q.value || jsonb_build_object('index', (q.value ->> 'legacy_index')::int)
      else q.value
    end
    order by q.ordinality
  )
  from jsonb_array_elements(inv.line_quantities) with ordinality as q(value, ordinality)
)
-- Bara rader som faktiskt har något att komplettera. Utan den här skulle varje körning skriva om
-- alla rader i onödan, och en tom line_quantities-array bli null i stället för [].
where exists (
  select 1
  from jsonb_array_elements(coalesce(inv.line_quantities, '[]'::jsonb)) as e(value)
  where e.value ? 'line_id' and e.value ? 'legacy_index' and not (e.value ? 'index')
);

commit;

-- ── Verifiering (kör efter applicering) ──────────────────────────────────────
--
-- 1. Varje migrerad post ska nu bära BÅDA nycklarna. `saknar_index` ska vara false överallt.
--
--      select wo.order_number, inv.round_number,
--             q.value ->> 'line_id'  as line_id,
--             q.value ->> 'index'    as index,
--             q.value ->> 'quantity' as antal,
--             (q.value ? 'line_id' and not (q.value ? 'index')) as saknar_index
--      from public.crm_work_order_invoices inv
--      join public.crm_work_orders wo on wo.id = inv.work_order_id
--      cross join lateral jsonb_array_elements(coalesce(inv.line_quantities, '[]'::jsonb)) as q(value)
--      order by wo.order_number, inv.round_number;
--
-- 2. Antalen ska vara ORÖRDA — filen lägger bara till en nyckel. Jämför mot rundans belopp.
--
--      select wo.order_number, inv.round_number, inv.amount,
--             (select sum((x.value ->> 'quantity')::numeric)
--              from jsonb_array_elements(inv.line_quantities) as x(value)) as summa_antal
--      from public.crm_work_order_invoices inv
--      join public.crm_work_orders wo on wo.id = inv.work_order_id
--      order by wo.order_number, inv.round_number;
--
-- 3. `index` ska peka på samma rad som `line_id`. Noll rader tillbaka = allt stämmer.
--
--      select wo.order_number, inv.round_number, q.value
--      from public.crm_work_order_invoices inv
--      join public.crm_work_orders wo on wo.id = inv.work_order_id
--      cross join lateral jsonb_array_elements(coalesce(inv.line_quantities, '[]'::jsonb)) as q(value)
--      where q.value ? 'line_id' and q.value ? 'index'
--        and coalesce(wo.line_items -> (q.value ->> 'index')::int ->> 'id', '') <> (q.value ->> 'line_id');
