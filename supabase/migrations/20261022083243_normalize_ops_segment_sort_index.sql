-- Ordningen på dagen: numrera om ops_segments.sort_index per bil, i den ordning tavlan redan visar.
--
-- VARFÖR
-- Planeringens "ordning på dagen" räknar nu alla jobb som TÄCKER dagen, inte bara de som BÖRJAR den
-- (lib/domains/planning/order.ts). Ett jobb ons–tor och ett jobb på torsdagen jämförs alltså med varandra
-- på torsdagen. Men sort_index har hittills numrerats per startdag: varje dag börjar om från 0. Ett
-- flerdagarsjobb som var fyra på sin startdag (3) hamnade därför SIST på torsdagen bakom torsdagens
-- 0, 1, 2 — fast tavlan i dag ritar det överst och regeln är att ett pågående jobb går först.
--
-- VAD
-- Per bil numreras alla placeringar 0..n i ordningen (start_day, sort_index, id). Det är exakt den ordning
-- tavlan visar i dag: veckotavlan och månadsvyn sorterar på startdag först, sedan sort_index, sedan id.
-- Efteråt är numren jämförbara över dagar, och jämförelsen (sort_index, start_day, id) ger samma ordning
-- som förut på varje dag — med det pågående jobbet först.
--
-- ⚠️ id-avgöraren: Postgres jämför uuid bytevis och JavaScript (compareBoardOrder) med localeCompare på
-- strängen. För gemena hex-uuid:er ger de samma ordning — siffror före bokstäver, bindestrecken på samma
-- platser. Efter omnumreringen finns inga lika nummer på samma bil, så avgöraren spelar ingen roll längre.
--
-- SÄKER FÖRE KODEN
-- Ordningen INOM varje startdag är oförändrad, och det är bara den den gamla koden läser (dayGroup på
-- start_day). Den gamla placeringen (max inom startdagen + 1) fortsätter fungera. Ingen schemaändring,
-- inga grants. Triggers på ops_segments som lyssnar på UPDATE av sort_index: bara set_timestamp_ops_segments
-- (updated_at), som ingen läser. Statussynken och planerade dagar lyssnar på andra kolumner.
--
-- Idempotent: en andra körning hittar inga rader att ändra.

set lock_timeout = '5s';

with ranked as (
  select id,
         (row_number() over (partition by truck_id order by start_day, sort_index, id) - 1)::integer as rn
    from public.ops_segments
)
update public.ops_segments s
   set sort_index = r.rn
  from ranked r
 where r.id = s.id
   and s.sort_index is distinct from r.rn;
