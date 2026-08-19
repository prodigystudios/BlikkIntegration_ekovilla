-- REVISION, LÄSER BARA. Kör den FÖRE koden som gör om labor_cost till ett à-pris.
--
-- Bakgrund: "Varav arbetskostnad (ROT)" tolkades förut som ett KLUMPBELOPP för hela raden. Det var
-- fel — 500 kr arbete gav 500 kr vare sig raden var 10 m³ eller 30 m³, så ROT-avdraget frös vid
-- samma krontal hur stort jobbet blev. Fältet är nu ett À-PRIS (kr per m³/styck) som räknas mot
-- antalet, precis som A-priset.
--
-- ⚠️ DÄRFÖR BYTER BEFINTLIG DATA INNEBÖRD. En sparad rad med labor_cost = 8000 och A-pris 200
-- lästes förr som 8 000 kr arbete på hela raden. Efter ändringen kapas 8000 mot A-priset 200 och
-- HELA raden blir arbete — vilket betyder att ROT skulle begäras på materialet också. Det är inte
-- tillåtet, så raderna nedan måste rättas för hand innan de pushas om.
--
-- Kolumnen `arbete_efter_andringen` visar exakt vad varje rad blir med den nya tolkningen, och
-- `foreslaget_a_pris` vad beloppet borde skrivas om till för att betyda samma sak som förut.

with rader as (
  select
    'offert'                       as dokument,
    q.id,
    q.quote_number                 as nummer,
    q.status,
    q.created_at,
    li.ord                         as radnr,
    li.item
  from crm_quotes q
  cross join lateral jsonb_array_elements(q.line_items) with ordinality as li(item, ord)
  where q.rot_details ->> 'enabled' = 'true'

  union all

  select
    'arbetsorder',
    w.id,
    w.work_order_number,
    w.status,
    w.created_at,
    li.ord,
    li.item
  from crm_work_orders w
  cross join lateral jsonb_array_elements(w.line_items) with ordinality as li(item, ord)
  where w.rot_details ->> 'enabled' = 'true'
),
-- Svenska kommadecimaler och tusentalsmellanslag måste bort innan talen går att räkna på.
tal as (
  select
    r.*,
    nullif(regexp_replace(coalesce(r.item ->> 'labor_cost', ''), '[^0-9,.-]', '', 'g'), '') as labor_raw,
    nullif(regexp_replace(coalesce(r.item ->> 'unit_price', ''), '[^0-9,.-]', '', 'g'), '') as pris_raw,
    nullif(regexp_replace(coalesce(r.item ->> 'm2', ''), '[^0-9,.-]', '', 'g'), '')         as m2_raw,
    nullif(regexp_replace(coalesce(r.item ->> 'thickness_mm', ''), '[^0-9,.-]', '', 'g'), '') as tjocklek_raw,
    nullif(regexp_replace(coalesce(r.item ->> 'quantity', ''), '[^0-9,.-]', '', 'g'), '')   as antal_raw
  from rader r
),
parsat as (
  select
    t.dokument, t.id, t.nummer, t.status, t.created_at, t.radnr,
    t.item ->> 'article_name'                                   as artikel,
    coalesce((t.item ->> 'is_rot_work')::boolean, false)         as hela_raden_ar_arbete,
    coalesce(replace(t.labor_raw, ',', '.')::numeric, 0)         as arbete_inskrivet,
    coalesce(replace(t.pris_raw, ',', '.')::numeric, 0)          as a_pris,
    case
      when coalesce(t.item ->> 'pricing_mode', 'm3') = 'item'
        then coalesce(replace(t.antal_raw, ',', '.')::numeric, 0)
      else coalesce(replace(t.m2_raw, ',', '.')::numeric, 0)
           * coalesce(replace(t.tjocklek_raw, ',', '.')::numeric, 0) / 1000
    end                                                          as antal
  from tal t
)
select
  dokument,
  nummer,
  status,
  created_at::date               as skapad,
  radnr,
  artikel,
  a_pris,
  round(antal, 3)                as antal,
  arbete_inskrivet,
  -- Förr: beloppet rakt av, kapat mot radtotalen.
  round(least(arbete_inskrivet, a_pris * antal), 2)        as arbete_fore_andringen,
  -- Nu: beloppet som à-pris, kapat mot A-priset, gånger antalet.
  round(least(arbete_inskrivet, a_pris) * antal, 2)        as arbete_efter_andringen,
  -- Skriv om fältet till det här talet så raden betyder samma sak som förut.
  case when antal > 0 then round(least(arbete_inskrivet, a_pris * antal) / antal, 2) end
                                                           as foreslaget_a_pris,
  case
    when antal > 0 and least(arbete_inskrivet, a_pris) * antal
         >= a_pris * antal - 0.005 then 'HELA RADEN BLIR ARBETE — ROT skulle begäras på material'
    else 'ändrar belopp'
  end                                                      as folj
from parsat
where arbete_inskrivet > 0
  and not hela_raden_ar_arbete          -- ikryssade ROT-rader rör inte fältet
order by dokument, created_at desc, radnr;
