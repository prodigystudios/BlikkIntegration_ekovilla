# supabase/archive — historik, körs aldrig

Schemahistoriken från tiden då produktionen var den enda miljön (fram till 2026-09-25):

- `sql/` — 188 filer som kördes för hand i Supabase SQL-editorn.
- `migrations/` — 13 CLI-migreringar från maj 2026 (`crm_*`). Prod hade dem aldrig registrerade i
  CLI:ts migreringshistorik.

Sanningen om schemat är i dag baslinjen i `supabase/migrations/`, dumpad från produktionen.
Filerna här går inte att spela upp i ordning och ge samma resultat. **Kör dem inte.**

De ligger kvar för att de förklarar *varför*: huvudena bär resonemang som kommentarer i koden
pekar på, och flera tester läser dem fortfarande.

## Väntande — inte körd i prod

- `sql/manual/20260822_push_subscriptions_dedupe_legacy_origin.sql` — städning som väntar på
  domänbytet. Villkoret står i filens huvud. När det är uppfyllt skrivs den som en riktig
  migrering i `supabase/migrations/`; den körs inte härifrån.
