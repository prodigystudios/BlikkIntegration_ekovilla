-- REVISION, LÄSER BARA. Kör den FÖRE koden som gör om labor_cost till ett à-pris.
--
-- Bakgrund: "Varav arbetskostnad (ROT)" tolkades förut som ett KLUMPBELOPP för hela raden. Det var
-- fel — 500 kr arbete gav 500 kr vare sig raden var 10 m³ eller 30 m³, så ROT-avdraget frös vid
-- samma krontal hur stort jobbet blev. Fältet är nu ett À-PRIS (kr per m³/styck) som räknas mot
-- antalet, precis som A-priset.
--
-- ⚠️ DÄRFÖR BYTER BEFINTLIG DATA INNEBÖRD. En sparad rad med labor_cost = 8000 och A-pris 200
-- lästes förr som 8 000 kr arbete på hela raden. Läst som à-pris är 8000 större än A-priset 200 —
-- arbetet skulle äta hela raden och begära ROT på materialet, vilket inte är tillåtet. Koden bryter
-- därför ut NOLL på en sådan rad: materialet går ut orört och ROT-avdraget försvinner tyst.
--
-- Kolumnerna visar vad varje rad är värd före och efter, och `foreslaget_a_pris` vad beloppet ska
-- skrivas om till för att betyda samma sak som förut. Rabatten är inräknad: den gamla tolkningen
-- rabatterade inte arbetet, den nya gör det, så en rabatterad rad behöver ett högre à-pris för att
-- landa på samma kronor.

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
    w.order_number,
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
    nullif(regexp_replace(coalesce(r.item ->> 'quantity', ''), '[^0-9,.-]', '', 'g'), '')   as antal_raw,
    nullif(regexp_replace(coalesce(r.item ->> 'discount_percent', ''), '[^0-9,.-]', '', 'g'), '') as rabatt_raw
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
    end                                                          as antal,
    -- Andelen av priset som blir kvar efter rabatt, 0–1.
    1 - least(100, greatest(0, coalesce(replace(t.rabatt_raw, ',', '.')::numeric, 0))) / 100
                                                                 as kvar_efter_rabatt
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
  -- FÖRR: beloppet rakt av som klumpsumma, kapat mot radens RABATTERADE total.
  round(least(arbete_inskrivet, a_pris * antal * kvar_efter_rabatt), 2) as arbete_fore_andringen,
  -- NU: beloppet som à-pris. Äter det hela A-priset bryts ingenting ut (se splitRowLabor).
  case
    when arbete_inskrivet >= a_pris then 0
    else round(arbete_inskrivet * kvar_efter_rabatt * antal, 2)
  end                                                                  as arbete_efter_andringen,
  -- Skriv om fältet till det här à-priset så raden är värd samma kronor som förut. Divisionen med
  -- kvar_efter_rabatt är avsiktlig: den nya tolkningen rabatterar arbetet, den gamla gjorde inte det.
  case
    when antal > 0 and kvar_efter_rabatt > 0
      then round(least(arbete_inskrivet, a_pris * antal * kvar_efter_rabatt)
                 / (antal * kvar_efter_rabatt), 2)
  end                                                                  as foreslaget_a_pris,
  case
    when arbete_inskrivet >= a_pris
      then 'ROT-AVDRAGET FÖRSVINNER — arbetet äter hela A-priset, inget bryts ut'
    else 'ändrar belopp'
  end                                                                  as folj
from parsat
where arbete_inskrivet > 0
  and not hela_raden_ar_arbete          -- ikryssade ROT-rader rör inte fältet
order by dokument, created_at desc, radnr;
