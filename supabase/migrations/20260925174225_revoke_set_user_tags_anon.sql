-- set_user_tags får inte vara körbar för anon.
--
-- Funktionen är SECURITY DEFINER och kontrollerar inte vem som anropar; dess egen kommentar säger att
-- den "rely on GRANTs to restrict usage". Men default privileges gav anon EXECUTE, och ingen fil tog
-- någonsin bort det — med bara den publika anon-nyckeln (den finns i webbläsarens kod) gick det att
-- skriva om taggarna på vilken profil som helst via POST /rest/v1/rpc/set_user_tags, givet ett uuid.
-- Taggar styr bl.a. vilka dokument som publiceras till vem.
--
-- Ingen kod i app/, lib/ eller components/ anropar funktionen (2026-09-25), så ingenting i appen
-- påverkas. service_role behåller EXECUTE, som funktionen är avsedd för. authenticated har den redan
-- inte. PUBLIC tas med för säkerhets skull (idempotent — prod har den redan inte).

revoke execute on function public.set_user_tags(uuid, text[]) from anon, public;

-- Efterkontroll. REVOKE tar bara bort rättigheter som den körande rollen (eller ägaren) har delat ut;
-- går det inte blir det bara en WARNING, och pushen hade registrerats som körd med hålet kvar. Då ska
-- den i stället avbrytas.
do $$
begin
  if has_function_privilege('anon', 'public.set_user_tags(uuid, text[])', 'execute')
     or has_function_privilege('authenticated', 'public.set_user_tags(uuid, text[])', 'execute') then
    raise exception 'set_user_tags är fortfarande körbar för anon eller authenticated — revoke tog inte';
  end if;
end $$;
