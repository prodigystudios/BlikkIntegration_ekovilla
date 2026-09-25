-- Attestens påminnelse: egen nyckel för SMS-delen.
--
-- BAKGRUND
-- Attesten kan påminna den som inte fyllt i sin tid. Notisen i appen är gratis och oomstridd och
-- ligger kvar på `time.approve`. SMS är något annat: 200 fria tecken från företagets Twilio-nummer
-- till varje anställds PRIVATA mobil, på företagets kostnad.
--
-- `time.approve` innehas av rollen `ekonomi` — lönebyrån, en EXTERN part (20260831_ekonomi_role_seed.sql).
-- Att attestera en löneperiod och att kunna sms:a hela personalen är två olika saker, och repot har
-- redan gjort exakt den distinktionen en gång: `time.entry.write.all` bröts ut ur `time.approve`
-- eftersom "godkänna det någon skrivit" inte är "skriva i deras ställe". Det här är samma sorts
-- gräns.
--
-- ⚠️ DEPLOY-ORDNING: KÖR DENNA FÖRE APP-KODEN.
-- `getEffectivePermissions()` failar closed, så en nyckel som inte finns i databasen ger 403 åt
-- alla — inte "öppet tills vidare". Körs koden först försvinner SMS-rutan för samtliga tills
-- filen körts. (Att den försvinner är det säkra felet, men det är ändå ett fel.)
--
-- ADDITIV och idempotent — inget befintligt rörs, ingen befintlig behörighet ändras.
-- Speglar lib/auth/permissions.ts PERMISSION_KEYS (antalstestet vaktar pariteten: 45 → 46).
-- Körs EFTER 20260811_time_permissions.sql.

insert into public.permissions (key, description) values
  ('time.reminder.sms', 'Tid: skicka påminnelser till personalen som SMS')
on conflict (key) do nothing;

-- Roll-seed: BARA admin.
--
-- ⛔ Ge den INTE till `ekonomi`. Hon ska kunna påminna — notisen i appen går på `time.approve` och
-- kräver ingenting härifrån — men utskick till privata mobilnummer på företagets bekostnad är
-- Ekovillas eget beslut, inte byråns.
--
-- Behöver en arbetsledare (som är `member`) kunna sms:a påminnelser räcker ett per-användarundantag,
-- precis som för attesträtten. Uppfinn ingen ny roll:
--   select public.set_user_permission('<uuid>', 'time.reminder.sms', 'grant');
insert into public.role_permissions (role, permission_key) values
  ('admin','time.reminder.sms')
on conflict do nothing;

-- ── Verifiering (kör efter applicering) ──────────────────────────────────────
-- 1. Katalogen har nyckeln, och EXAKT en roll har den:
--
--   select rp.role
--   from public.role_permissions rp
--   where rp.permission_key = 'time.reminder.sms'
--   order by rp.role;          -- förväntat: bara `admin`
--
-- 2. Lönebyrån attesterar men sms:ar inte — båda raderna ska stämma:
--
--   select rp.permission_key
--   from public.role_permissions rp
--   where rp.role = 'ekonomi' and rp.permission_key in ('time.approve','time.reminder.sms')
--   order by rp.permission_key;   -- förväntat: BARA time.approve
