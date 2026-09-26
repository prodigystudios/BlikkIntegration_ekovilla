-- app.staff — "intern personal", till skillnad från externa parter. RBAC-passet, PR 3.
--
-- BAKGRUND
-- Två grindar i koden frågade fortfarande efter ROLLEN via isReadonlyRole() (konsult, ekonomi,
-- legacy readonly = extern):
--   * forbidIfReadonly() — skrivspärren på planeringens service-role-rutter (truck-assignments
--     create/update/delete, day-notes, consume-bags) och egenkontrollens orderuppslag
--     (work-orders/lookup);
--   * assignee-contact — personalens egna telefonnummer lämnas inte ut till en extern part.
-- Ingen befintlig nyckel uttrycker "intern": app.access har konsult (hen ser de anställdas ytor i
-- menyn). Därav en egen nyckel, och grindarna frågar efter den i stället för rollen.
--
-- Seed = de roller som INTE är externa i dag: member, sales, admin. konsult och ekonomi får den inte.
-- Samma svar som isReadonlyRole för alla fem roller.
--
-- ⚠️ DEPLOY-ORDNING: KÖR DENNA FÖRE koden (getEffectivePermissions failar closed — utan nyckeln
-- hade varje montör, säljare och admin nekats på rutterna ovan).
--
-- ADDITIV och idempotent. Tvillingen i databasen, public.is_konsult_user() (write-policyerna på
-- planning_*), rörs INTE: den skyddar bara gamla planeringens tabeller, som låses och tas bort.
-- Speglar lib/auth/permissions.ts PERMISSION_KEYS (58 → 59).

insert into public.permissions (key, description) values
  ('app.staff', 'App: intern personal (inte externa parter) — skriva i planeringen, se personalens kontaktuppgifter')
on conflict (key) do nothing;

insert into public.role_permissions (role, permission_key) values
  ('member','app.staff'), ('sales','app.staff'), ('admin','app.staff')
on conflict do nothing;

-- Efterkontroll: de tre rollerna har nyckeln, och ingen extern roll har den.
do $$
declare
  r text;
begin
  foreach r in array array['member', 'sales', 'admin'] loop
    if not exists (select 1 from public.role_permissions where permission_key = 'app.staff' and role::text = r) then
      raise exception 'rollen % saknar app.staff', r;
    end if;
  end loop;
  if exists (select 1 from public.role_permissions where permission_key = 'app.staff' and role::text in ('konsult', 'ekonomi')) then
    raise exception 'en extern roll (konsult/ekonomi) har app.staff';
  end if;
end $$;
