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
-- Revoke all först, sedan exakt det som behövs:
--   * SELECT ges tillbaka till anon och authenticated oförändrat — självläsningen bär inloggningen, och
--     vad anon läser (RLS ger den noll rader) är inte den här filens fråga.
--   * UPDATE bara på SELF_EDITABLE_PROFILE_FIELDS i lib/profileDetails.ts — det enda som skrivs med
--     användarens egen session: /api/profile (vitlistan) och full_name från /auth/create-account.
--     tests/supabase/migrationGrants.test.ts håller listorna ihop.
--   * INSERT, DELETE, TRUNCATE m.fl. tas bort. Ingen kod skriver så med en session: profilen skapas av
--     handle_new_user (SECURITY DEFINER), admin-rutterna (/api/admin/users, users-sync) skriver med
--     service-role. set_user_role och set_user_tags är SECURITY DEFINER. Inget av det påverkas.
--
-- Stramar åt ⇒ koden först: /auth/create-account slutar skriva `role` i samma PR.
-- Policyerna rörs inte — profiles-RLS är skör, se PROFILES_DIRECTORY_PLAN.md.

revoke all on public.profiles from anon, authenticated;

grant select on public.profiles to anon, authenticated;

grant update (full_name, phone, private_email, address_line1, postal_code, city, emergency_contact_name, emergency_contact_phone, clothing_size)
  on public.profiles to authenticated;

-- Efterkontroll, med PUBLIC inräknat (has_*_privilege svarar sant även för en grant på tabellnivå eller till
-- PUBLIC). REVOKE tar bara bort det den körande rollen har delat ut; går det inte blir det bara en WARNING,
-- och pushen hade registrerats som körd med hålet kvar. Då ska den i stället avbrytas. Läsningen prövas
-- också: utan SELECT kan ingen läsa sin egen profil, och då faller inloggningen.
-- Listan nedan ska vara densamma som i granten ovan (testet jämför dem).
do $$
declare
  editable constant text[] := array[
    'full_name', 'phone', 'private_email', 'address_line1', 'postal_code', 'city',
    'emergency_contact_name', 'emergency_contact_phone', 'clothing_size'
  ];
  who text;
  priv text;
  col text;
begin
  foreach who in array array['anon', 'authenticated'] loop
    if not has_table_privilege(who, 'public.profiles', 'SELECT') then
      raise exception 'profiles: % har tappat SELECT', who;
    end if;
    foreach priv in array array['INSERT', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
      if has_table_privilege(who, 'public.profiles', priv) then
        raise exception 'profiles: % har fortfarande %', who, priv;
      end if;
    end loop;
  end loop;

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
