-- Tid & lön (fas 4) — behörighetsnycklar: katalog + roll-seed.
--
-- Fas 4.0 av flytten av tidrapporteringen från Blikk till CRM. Nycklarna är helt nya: tid har
-- aldrig varit med i behörighetsmodellen (crm_work_order_time_entries är rent ägarbaserad, se den
-- medvetna anteckningen i 20260608_permissions_model.sql). ADDITIV och idempotent — inget
-- befintligt rörs.
--
-- ⚠️ DEPLOY-ORDNING: kör DENNA FÖRE app-koden och före RLS-filerna som anropar has_permission på
-- de här nycklarna. getEffectivePermissions() failar closed, så en nyckel som inte finns i
-- databasen ger 403 åt alla — inte "öppet tills vidare".
--
-- Speglar lib/auth/permissions.ts PERMISSION_KEYS (antalstestet vaktar pariteten: 39 → 44).
-- Körs EFTER 20260608_permissions_model.sql. Kör i Supabase SQL-editorn.

insert into public.permissions (key, description) values
  ('time.entry.write',       'Tid: rapportera egen tid'),
  ('time.entry.read.all',    'Tid: se alla anställdas tidrader'),
  ('time.approve',           'Tid: attestera, låsa och öppna en löneperiod'),
  ('time.payroll.read',      'Tid: läsa och exportera löneunderlaget'),
  ('time.reference.manage',  'Tid: hantera tidkoder, internprojekt och frånvarotyper')
on conflict (key) do nothing;

-- Roll-seed (William 2026-08-11):
--   member  → rapporterar sin egen tid (installatörerna)
--   sales   → rapporterar också sin egen tid; beslutet är att ALLA anställda tidrapporterar i CRM,
--             till skillnad från idag där /tidrapport bara visas för member och admin
--   admin   → allt: rapportera, se allas tid, attestera, läsa löneunderlaget, sköta referensdatan
--   konsult → INGET. Extern och readonly; tid är personuppgift och lön är inte deras att se
--
-- Attest ligger bara på admin med flit. Skulle en arbetsledare (som är `member`) behöva attestera
-- räcker ett per-användar-undantag i Admin → Behörigheter:
--   select public.set_user_permission('<uuid>', 'time.approve', 'grant');
-- Bygg inte en ny roll för det.
insert into public.role_permissions (role, permission_key) values
  ('member','time.entry.write'),
  ('sales','time.entry.write'),
  ('admin','time.entry.write'),
  ('admin','time.entry.read.all'),
  ('admin','time.approve'),
  ('admin','time.payroll.read'),
  ('admin','time.reference.manage')
on conflict do nothing;

-- ── Verifiering (kör efter applicering) ──────────────────────────────────────
-- Förväntat: 5 rader i katalogen, och exakt den fördelning som står ovan.
--
--   select key, description from public.permissions where key like 'time.%' order by key;
--
--   select rp.role, rp.permission_key
--   from public.role_permissions rp
--   where rp.permission_key like 'time.%'
--   order by rp.role, rp.permission_key;
--
-- Kontrollera också att ingen befintlig yta tappade åtkomst (nycklarna är additiva, så inget
-- SKA ha ändrats — men verifiera hellre än att anta):
--
--   select role, count(*) from public.role_permissions group by role order by role;
