-- Rättar LÅNADE kontaktadresser på befintliga arbetsordrar.
--
-- Bakgrund: fram till PR #127 lånade `resolveCrmContact` ut kundkortets e-post åt en kontaktrad
-- som saknade egen. Lånet frystes in i offertens snapshot och kopierades vidare till ordern, som
-- därför kan visa "Jonas" som kontaktperson med bolagets (eller Roberts) adress under. Nya ordrar
-- gör det inte längre. Det här skriptet rättar dem som redan finns.
--
-- ============================================================================================
-- ORDNING: KODEN FORST. Kor INTE detta innan PR #127 ligger i produktion.
--
-- Skalet ar planeringens bekraftelsemodal. Den prefillar sin mottagare ur samma uppslagning, och
-- det ar forst i #127 som kundens egen adress foljer med separat (`customerEmail`) att falla
-- tillbaka pa. Nollar vi adressen innan dess star planeraren med ett tomt faltet och ingenting
-- att valja i stallet.
-- ============================================================================================
--
-- Skriptet ar INTE en migrering: det andrar data, inte schema, och ar avsett att koras EN gang
-- for hand i Supabase SQL-editorn. Steg 1 ar en ren lasning. Steg 2 ar inlindat i en transaktion
-- som avslutas med rollback -- byt till commit forst nar steg 1:s utskrift ser rimlig ut.
--
-- Urvalet ar med flit SMALT. Bara rader dar bevisningen ar entydig:
--   * kunden ar ett FORETAG (privatkundens lan ar korrekt -- kontaktraden AR kunden)
--   * ordern namnger en kontaktperson (nagon att felaktigt tillskriva adressen)
--   * orderns adress ar EXAKT kundkortets (det ar sa lanet ser ut)
--   * ingen kontaktrad hos kunden ager den adressen (da vore den nagons egen, och riktig)


-- ============================================================================================
-- STEG 1 -- TORRKORNING. Andrar ingenting. Kor forst, las utskriften.
--
-- Kolumnen `atgard` visar vad steg 2 skulle gora med raden:
--   ERSATTS = personen star pa kundkortet med en EGEN adress, den skrivs in i stallet
--   TOMMAS  = personen har ingen egen adress, faltet nollas
-- ============================================================================================

select
  wo.order_number,
  wo.status,
  coalesce(c.company_name, wo.client_name)   as kund,
  wo.customer_snapshot ->> 'contact_name'    as kontaktperson,
  wo.customer_snapshot ->> 'email'           as adress_i_dag,
  c.email                                    as kundkortets_adress,
  egen.email                                 as personens_egna_adress,
  case when egen.email is null then 'TOMMAS' else 'ERSATTS' end as atgard
from public.crm_work_orders wo
join public.crm_customers c on c.id = wo.customer_id
left join lateral (
  select k.email
  from public.crm_customer_contacts k
  where k.customer_id = c.id
    and lower(btrim(k.name)) = lower(btrim(wo.customer_snapshot ->> 'contact_name'))
    and nullif(btrim(k.email), '') is not null
  limit 1
) egen on true
where c.customer_type = 'business'
  and nullif(btrim(wo.customer_snapshot ->> 'contact_name'), '') is not null
  and nullif(btrim(wo.customer_snapshot ->> 'email'), '') is not null
  and lower(btrim(wo.customer_snapshot ->> 'email')) = lower(btrim(c.email))
  and not exists (
    select 1
    from public.crm_customer_contacts k2
    where k2.customer_id = c.id
      and lower(btrim(coalesce(k2.email, ''))) = lower(btrim(wo.customer_snapshot ->> 'email'))
  )
order by wo.created_at desc;


-- ============================================================================================
-- STEG 1b -- DIAGNOSTIK, valfri. Andrar ingenting och rors INTE av steg 2.
--
-- Det bredare fallet: orderns adress tillhor en ANNAN namngiven kontakt hos samma kund an den
-- ordern namnger. Alltsa "Bjorn" med Annas adress, utan att adressen rakar vara kundkortets.
--
-- Med flit utanfor rattningen: har finns ingen entydig bevisning for att adressen ar felaktig
-- i stallet for medvetet vald. Kor den for att se OM fallet ens finns hos er. Gor det det, ta
-- ett beslut per rad i stallet for i klump.
-- ============================================================================================

select
  wo.order_number,
  coalesce(c.company_name, wo.client_name) as kund,
  wo.customer_snapshot ->> 'contact_name'  as ordern_namnger,
  wo.customer_snapshot ->> 'email'         as adress_i_dag,
  agare.name                               as adressen_tillhor
from public.crm_work_orders wo
join public.crm_customers c on c.id = wo.customer_id
join lateral (
  select k.name
  from public.crm_customer_contacts k
  where k.customer_id = c.id
    and lower(btrim(coalesce(k.email, ''))) = lower(btrim(wo.customer_snapshot ->> 'email'))
  limit 1
) agare on true
where c.customer_type = 'business'
  and nullif(btrim(wo.customer_snapshot ->> 'contact_name'), '') is not null
  and nullif(btrim(wo.customer_snapshot ->> 'email'), '') is not null
  and lower(btrim(agare.name)) <> lower(btrim(wo.customer_snapshot ->> 'contact_name'))
order by wo.created_at desc;


-- ============================================================================================
-- STEG 2 -- RATTNINGEN. Kor hela blocket, las radantalet, kor sedan rollback.
--
-- Ser radantalet ut som steg 1:s utskrift: byt sista raden till commit och kor om blocket.
-- ============================================================================================

begin;

update public.crm_work_orders wo
set customer_snapshot = jsonb_set(
      wo.customer_snapshot,
      '{email}',
      coalesce(
        (
          -- Star personen pa kundkortet med en EGEN adress skrivs den in. Battre an att nolla:
          -- ordern far da ratt adress i stallet for ingen alls.
          select to_jsonb(btrim(k.email))
          from public.crm_customer_contacts k
          where k.customer_id = wo.customer_id
            and lower(btrim(k.name)) = lower(btrim(wo.customer_snapshot ->> 'contact_name'))
            and nullif(btrim(k.email), '') is not null
          limit 1
        ),
        -- Annars json-null. INTE tom strang: lasytorna behandlar '' och null lika, men null ar
        -- det arliga vardet -- adressen finns inte, den ar inte tom.
        'null'::jsonb
      ),
      true
    )
from public.crm_customers c
where c.id = wo.customer_id
  and c.customer_type = 'business'
  and nullif(btrim(wo.customer_snapshot ->> 'contact_name'), '') is not null
  and nullif(btrim(wo.customer_snapshot ->> 'email'), '') is not null
  and lower(btrim(wo.customer_snapshot ->> 'email')) = lower(btrim(c.email))
  and not exists (
    select 1
    from public.crm_customer_contacts k2
    where k2.customer_id = c.id
      and lower(btrim(coalesce(k2.email, ''))) = lower(btrim(wo.customer_snapshot ->> 'email'))
  );

rollback;
-- commit;
