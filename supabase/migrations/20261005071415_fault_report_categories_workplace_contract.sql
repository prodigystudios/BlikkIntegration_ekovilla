-- Felanmälan: två nya val i rullistan, Arbetsplats och Entreprenad.
--
-- Kategorin lagras som text med en CHECK (nycklarna i lib/domains/fault-reports/types.ts, FAULT_CATEGORIES).
-- Här vidgas CHECK:en med 'arbetsplats' och 'entreprenad'; de fem gamla värdena står kvar oförändrade.
--
-- ÅTKOMST
-- Oförändrad. Ingen ny tabell, kolumn eller funktion, alltså inga nya grants.
--
-- Additiv: varje rad som klarade den gamla CHECK:en klarar den nya. Kan gå till prod före koden, och MÅSTE göra det:
-- koden skickar de nya nycklarna, som den gamla CHECK:en nekar. Idempotent, kan köras om.

set lock_timeout = '5s';

alter table public.fault_reports drop constraint if exists fault_reports_category_chk;
alter table public.fault_reports
  add constraint fault_reports_category_chk check (
    category in ('truck', 'lager', 'lastbil', 'isoleringsmaskin', 'maskiner', 'arbetsplats', 'entreprenad')
  );
