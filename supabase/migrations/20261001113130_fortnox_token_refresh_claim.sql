-- Låset för Fortnox-tokenens förnyelse, över alla instanser.
--
-- BAKGRUND
-- Testmiljöns Fortnox-kedja bröts 2026-10-01: databasen låg kvar med en refresh-token som Fortnox redan ogiltigförklarat,
-- och varje anrop fick invalid_grant tills kopplingen gjordes om. Återskapat lokalt mot testbolaget samma dag: två
-- processer som förnyar med SAMMA refresh-token i samma ögonblick får BÅDA nya tokens, men bara det senast utdelade paret
-- gäller. Vilket par som hamnar i databasen avgör ordningen på sparandena — i provet blev det det döda. Förnyar de inte
-- exakt samtidigt nekas den andra direkt (invalid_grant) och kedjan överlever.
--
-- Låset i processen (inflightRefresh i lib/domains/fortnox/client.ts) räcker alltså inte; den här kolumnen är låset
-- mellan instanserna, med samma mönster som dokumentens push-anspråk (claimFortnoxPush, *_claimed_at).
--
--   refresh_claimed_at   när en instans tog anspråket på att förnya raden. Anspråket tas bara på den token som står i
--                        raden (versionen är expires_at), och räknas som övergivet efter 20 sekunder (instansen dog). Den som tog det
--                        nollar det när den nya tokenen sparas, eller släpper det om förnyelsen misslyckas.
--
-- ÅTKOMST
-- Oförändrad. Bara servern (service_role) läser och skriver raden; den har grant på hela tabellen, och det gäller den nya
-- kolumnen också. Efterkontrollen nedan prövar det.
--
-- Additiv: en ny kolumn som får vara null. Kan gå till prod före koden; koden förnyar som förut om kolumnen saknas.
-- Idempotent, kan köras om.

set lock_timeout = '5s';

alter table public.fortnox_integrations add column if not exists refresh_claimed_at timestamptz;

comment on column public.fortnox_integrations.refresh_claimed_at is
  'Anspråket på att förnya Fortnox-tokenen (en instans i taget). Övergivet efter 20 s. Se lib/domains/fortnox/client.ts.';

reset lock_timeout;

-- ------------------------------------------------------------------------------------------------ efterkontroll

do $$
begin
  if not has_column_privilege('service_role', 'public.fortnox_integrations', 'refresh_claimed_at', 'SELECT')
     or not has_column_privilege('service_role', 'public.fortnox_integrations', 'refresh_claimed_at', 'UPDATE') then
    raise exception 'tokenlåset: service_role kan inte läsa eller skriva refresh_claimed_at';
  end if;
end $$;
