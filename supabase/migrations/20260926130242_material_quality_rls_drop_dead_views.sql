-- material_quality_samples: RLS på, anon och authenticated ut. Två oanvända vyer bort.
--
-- Båda flaggades som ERROR av Supabase advisor i prod (2026-09-26).
--
-- 1. material_quality_samples hade RLS avslaget och, via default privileges, ALLA rättigheter för anon och
--    authenticated, även TRUNCATE. Med bara den publika anon-nyckeln (den finns i webbläsarens kod) gick det att
--    läsa, ändra och tömma tabellen direkt via /rest/v1/material_quality_samples, förbi appen.
--    All kod når tabellen med service-role: /api/material-quality/list och /ingest via
--    getMaterialQualityAdminOrThrow() (2026-09-26). service_role har BYPASSRLS, så varken RLS utan policyer eller
--    revoke påverkar den. Ingen trigger, vy, funktion eller realtime-publicering rör tabellen.
--
-- 2. current_user_role och current_user_dashboard_notes är SECURITY DEFINER-vyer (ägare postgres, utan
--    security_invoker), alltså läser de förbi RLS. Båda filtrerar på auth.uid() och visar bara anroparens egna
--    rader, så de läckte inget i praktiken, men ingenting använder dem:
--      * current_user_role lästes senast av lib/getUserRole.ts, som togs bort i #227 (live 2026-09-26). Den hade
--        profiles som reserv och körde på servern, så inget gammalt klientpaket kan fråga efter vyn.
--      * current_user_dashboard_notes har aldrig lästs av koden; den skapades bredvid tabellen 2025-10-01.
--    Inget i databasen beror på någon av dem (ingen vy, funktion eller returtyp).
--
-- Stramar åt och tar bort, men koden är redan först: inget i app/, lib/ eller components/ läser något av detta
-- med en session. Idempotent, kan köras om.

alter table public.material_quality_samples enable row level security;

revoke all on public.material_quality_samples from anon, authenticated;

drop view if exists public.current_user_role;
drop view if exists public.current_user_dashboard_notes;

-- Efterkontroll. REVOKE tar bara bort det den körande rollen har delat ut; går det inte blir det bara en WARNING,
-- och pushen hade registrerats som körd med hålet kvar. Då ska den i stället avbrytas. has_table_privilege räknar
-- även med en grant till PUBLIC. service_role prövas också: utan SELECT och INSERT slutar listan och inmatningen
-- att fungera. Varje rättighet prövas för sig, eftersom en kommaseparerad lista svarar sant om NÅGON finns.
do $$
declare
  who text;
  priv text;
begin
  if not (select relrowsecurity from pg_class where oid = 'public.material_quality_samples'::regclass) then
    raise exception 'material_quality_samples: RLS är fortfarande av';
  end if;

  foreach who in array array['anon', 'authenticated'] loop
    foreach priv in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
      if has_table_privilege(who, 'public.material_quality_samples', priv) then
        raise exception 'material_quality_samples: % har fortfarande %', who, priv;
      end if;
    end loop;
  end loop;

  foreach priv in array array['SELECT', 'INSERT'] loop
    if not has_table_privilege('service_role', 'public.material_quality_samples', priv) then
      raise exception 'material_quality_samples: service_role har tappat %', priv;
    end if;
  end loop;

  if to_regclass('public.current_user_role') is not null
     or to_regclass('public.current_user_dashboard_notes') is not null then
    raise exception 'current_user_role eller current_user_dashboard_notes finns kvar';
  end if;
end $$;
