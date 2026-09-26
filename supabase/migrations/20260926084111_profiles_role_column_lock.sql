-- En användare får inte kunna ändra sin egen roll.
--
-- profiles_update_self (USING auth.uid() = id, ingen WITH CHECK) släpper igenom varje uppdatering av den
-- egna raden, och authenticated har UPDATE på HELA tabellen via default privileges. Ingen trigger skyddar
-- kolumnen. Alltså kunde varje inloggat konto skriva sin egen `role` — och därmed få varje nyckel den rollen
-- bär (has_permission läser rollen). Verifierat mot baslinjen, som är pull:ad ur prod.
--
-- Lagningen byter tabellgranten mot en kolumngrant. ⚠️ `revoke update (role) ...` ensam hade varit en no-op:
-- en kolumnoperation rör aldrig en grant på tabellnivå (prövat lokalt 2026-09-26).
--
-- Kolumnerna är exakt SELF_EDITABLE_PROFILE_FIELDS i lib/profileDetails.ts — det enda som skrivs med
-- användarens egen session: /api/profile (vitlistan) och full_name från /auth/create-account.
-- tests/supabase/migrationGrants.test.ts håller listorna ihop. Admin-rutterna (/api/admin/users,
-- users-sync) skriver med service-role och påverkas inte; set_user_role och set_user_tags är SECURITY
-- DEFINER och påverkas inte heller. anon har inget att uppdatera i profiles.
--
-- Stramar åt ⇒ koden först: /auth/create-account slutar skriva `role` i samma PR.
-- Policyn rörs inte — profiles-RLS är skör, se PROFILES_DIRECTORY_PLAN.md.

revoke update on public.profiles from anon, authenticated;

grant update (full_name, phone, private_email, address_line1, postal_code, city, emergency_contact_name, emergency_contact_phone, clothing_size)
  on public.profiles to authenticated;

-- Efterkontroll, per kolumn och med PUBLIC inräknat (has_column_privilege svarar sant även för en grant på
-- tabellnivå). REVOKE tar bara bort det den körande rollen har delat ut; går det inte blir det bara en
-- WARNING, och pushen hade registrerats som körd med hålet kvar. Då ska den i stället avbrytas.
do $$
declare
  editable constant text[] := array[
    'full_name', 'phone', 'private_email', 'address_line1', 'postal_code', 'city',
    'emergency_contact_name', 'emergency_contact_phone', 'clothing_size'
  ];
  col text;
begin
  for col in
    select attname::text from pg_attribute
    where attrelid = 'public.profiles'::regclass and attnum > 0 and not attisdropped
  loop
    if has_column_privilege('anon', 'public.profiles', col, 'UPDATE') then
      raise exception 'profiles.% går fortfarande att uppdatera för anon', col;
    end if;
    if has_column_privilege('authenticated', 'public.profiles', col, 'UPDATE') <> (col = any(editable)) then
      raise exception 'profiles.%: authenticated UPDATE = %, väntat %',
        col, has_column_privilege('authenticated', 'public.profiles', col, 'UPDATE'), col = any(editable);
    end if;
  end loop;
end $$;
