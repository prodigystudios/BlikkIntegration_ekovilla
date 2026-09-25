-- Index för uppslag "alla uppgifter på den här posten".
--
-- ADDITIV. Ingen policy, ingen kolumn, ingen rad ändras — bara ett index. Kan därför köras i
-- valfri ordning mot koden: allt fungerar utan den, bara långsammare.
--
-- Bakgrund: dashboard_work_items har hittills bara indexerats per ANVÄNDARE
-- (user_id, status, kind, created_at) — 20260520_dashboard_work_items.sql. Alla uppslag har
-- utgått från "mina rader". Offertpanelen frågar i stället "vilka uppgifter hör till den här
-- offerten", vilket utan index blir en seq scan över hela tabellen, alltså över allas privata
-- anteckningar och möten. Tabellen växer med varje anteckning varje användare skriver, och
-- frågan körs varje gång någon öppnar en offert.
--
-- Partiellt på `related_type is not null`: den absoluta merparten av raderna är personliga
-- anteckningar utan koppling, och de har inget här att göra. Indexet blir en bråkdel så stort.
--
-- Snabbar även upp de befintliga kund- och prospektfiltren i lib/domains/crm/tasks.ts, som
-- använder exakt samma kolumnpar.
create index if not exists dashboard_work_items_related_idx
  on public.dashboard_work_items (related_type, related_id)
  where related_type is not null;

-- ── Verifiering (kör efter applicering) ──────────────────────────────────────
-- Indexet finns (förväntat: en rad):
--
--   select indexname from pg_indexes
--   where tablename = 'dashboard_work_items' and indexname = 'dashboard_work_items_related_idx';
--
-- Och används (förväntat: "Index Scan using dashboard_work_items_related_idx", inte "Seq Scan").
-- Byt ut uuid:t mot en offert som faktiskt har en kopplad uppgift:
--
--   explain analyze
--   select id from public.dashboard_work_items
--   where kind = 'note' and related_type = 'crm_quote'
--     and related_id = '00000000-0000-0000-0000-000000000000';
--
-- OBS: på en liten tabell väljer planeraren seq scan ändå, helt korrekt. Kör gärna
-- `analyze public.dashboard_work_items;` först.
