-- Behörighetsnycklar för appens egna ytor — RBAC-passet, steg 2a.
--
-- BAKGRUND
-- Backenden gatar redan på nycklar (has_permission / requirePermission), men sidomenyn och de flesta
-- sidor utanför CRM gatar fortfarande på ROLL. Det är två lager som inte känner till varandra. De här
-- nycklarna gör att menyn och sidgrindarna kan flyttas till nycklar i nästa steg (2b), och att
-- ogrindade rutter kan få en riktig grind (2c). Den här filen ändrar INGEN åtkomst i dag: ingen kod
-- läser nycklarna ännu.
--
-- ⚠️ DEPLOY-ORDNING: KÖR DENNA FÖRE koden som läser nycklarna (2b/2c). getEffectivePermissions()
-- failar closed — en nyckel som saknas i databasen hade stängt ytan för alla.
--
-- ADDITIV och idempotent — inget befintligt rörs. En omkörning lägger bara tillbaka rader som saknas.
-- Speglar lib/auth/permissions.ts PERMISSION_KEYS (48 → 58); tests/auth/permissionCatalog.test.ts
-- vaktar att katalogen och koden har samma nycklar, och att seeden nedan är menyns rollmängd.
--
-- ── SEEDREGELN ─────────────────────────────────────────────────────────────────────────────────
-- Seed = rollerna på raden i app/_lib/appNav.ts  ∪  {konsult om 'sales' står bland dem}.
--
-- ⚠️ Varför konsult läggs till: menyn kör toEffectiveRole() INNAN den filtrerar, så konsult ses som
-- sales och strängen 'konsult' står inte i en enda `roles`-lista. Seedar man radens roller ordagrant
-- tappar konsult arkivet, nyheterna, materialkvaliteten, Mina dokument, Kontakt & adresser m.fl.
--
-- `ekonomi` (lönebyrån, extern) får INGEN av nycklarna. Hon ser i dag bara rader som nämner henne vid
-- namn (EXPLICIT_ONLY_ROLES) — alltså inga av de här ytorna.
--
-- Rader UTAN roller i menyn (Dokument & information, Felanmälan, Kontakt & adresser) är "alla
-- anställda": member, sales, admin — och konsult enligt regeln. Därav `app.access`.
--
-- Medvetet INGA nycklar för: /tid (raden och nyckeln time.entry.write har olika rollmängd med flit),
-- /admin (ligger kvar på roll tills hela adminytan tas samlat), /crm/dokument (dokumentdomänen tas
-- samlad), gamla /plannering (låses och tas bort), /crm/korjournal (ligger under /crm och gatas redan
-- av crm.access).

insert into public.permissions (key, description) values
  ('app.access',             'App: anställdas gemensamma ytor (Dokument & information, Felanmälan)'),
  ('app.contacts.read',      'App: Kontakt & adresser'),
  ('app.news.read',          'App: Nyheter'),
  ('app.material.read',      'App: Materialkvalitet'),
  ('app.documents.read',     'App: Mina dokument'),
  ('app.archive.read',       'App: sparade egenkontroller (arkivet)'),
  ('app.jobs.read',          'App: Mina jobb'),
  ('app.egenkontroll.write', 'App: skapa egenkontroll'),
  ('app.clothing.order',     'App: beställ arbetskläder'),
  ('crm.settings.manage',    'CRM: inställningsnavet och kalkylinställningarna')
on conflict (key) do nothing;

insert into public.role_permissions (role, permission_key) values
  -- Rader utan roller = alla anställda (+ konsult)
  ('member','app.access'), ('sales','app.access'), ('admin','app.access'), ('konsult','app.access'),
  ('member','app.contacts.read'), ('sales','app.contacts.read'), ('admin','app.contacts.read'), ('konsult','app.contacts.read'),
  -- ['member','sales','admin'] (+ konsult)
  ('member','app.news.read'), ('sales','app.news.read'), ('admin','app.news.read'), ('konsult','app.news.read'),
  ('member','app.material.read'), ('sales','app.material.read'), ('admin','app.material.read'), ('konsult','app.material.read'),
  ('member','app.documents.read'), ('sales','app.documents.read'), ('admin','app.documents.read'), ('konsult','app.documents.read'),
  ('member','app.archive.read'), ('sales','app.archive.read'), ('admin','app.archive.read'), ('konsult','app.archive.read'),
  -- ['member','admin'] (ingen sales ⇒ ingen konsult)
  ('member','app.jobs.read'), ('admin','app.jobs.read'),
  ('member','app.egenkontroll.write'), ('admin','app.egenkontroll.write'),
  ('member','app.clothing.order'), ('admin','app.clothing.order'),
  -- /crm/installningar och /crm/installningar/kalkyl kräver i dag role = 'admin'
  ('admin','crm.settings.manage')
on conflict do nothing;

-- Efterkontroll: varje förväntad nyckel och rollrad finns. Nycklarna är nya, så inga rollrader kan ha
-- funnits före pushen (role_permissions har FK mot permissions) — vid första körningen är seeden alltså
-- exakt den här. Kontrollen kräver därför bara att raderna FINNS och tillåter fler: en omkörning efter
-- att någon gett en roll en nyckel i admin ska inte avbrytas. Att lönebyrån aldrig får en appnyckel
-- prövas för sig.
do $$
declare
  expected constant jsonb := '{
    "app.access":             ["admin","konsult","member","sales"],
    "app.contacts.read":      ["admin","konsult","member","sales"],
    "app.news.read":          ["admin","konsult","member","sales"],
    "app.material.read":      ["admin","konsult","member","sales"],
    "app.documents.read":     ["admin","konsult","member","sales"],
    "app.archive.read":       ["admin","konsult","member","sales"],
    "app.jobs.read":          ["admin","member"],
    "app.egenkontroll.write": ["admin","member"],
    "app.clothing.order":     ["admin","member"],
    "crm.settings.manage":    ["admin"]
  }';
  k text;
  r text;
begin
  for k in select jsonb_object_keys(expected) loop
    if not exists (select 1 from public.permissions where key = k) then
      raise exception 'permissions saknar %', k;
    end if;
    for r in select jsonb_array_elements_text(expected -> k) loop
      if not exists (select 1 from public.role_permissions where permission_key = k and role::text = r) then
        raise exception 'rollen % saknar %', r, k;
      end if;
    end loop;
    if exists (select 1 from public.role_permissions where permission_key = k and role::text = 'ekonomi') then
      raise exception 'ekonomi (lönebyrån) har %', k;
    end if;
  end loop;
end $$;
