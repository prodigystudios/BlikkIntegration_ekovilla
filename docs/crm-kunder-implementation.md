# CRM Kundregister — Implementationsstatus

## Vad som är byggt

### Databas (kör migration: `supabase/sql/20260602_crm_customers.sql`)
- `crm_customers` — kundregister med stöd för B2B och B2C, adresser, Fortnox-synkfält, ansvarig säljare
- `crm_customer_contacts` — flera kontaktpersoner per kund
- `customer_id` (nullable FK) tillagd på: `crm_opportunities`, `crm_quotes`, `crm_calls`, `crm_work_orders`
- `customer_type`, `customer_name`, `contact_name` tillagd på `crm_opportunities` — för direktinkommande leads utan prospekt/kund
- RLS-policyer på samma mönster som resten av CRM

### Domänlager (`lib/domains/crm/customers.ts`)
- CRUD för kunder och kontakter
- `convertProspectToCustomer()` — skapar kund från prospektdata, kopierar adress + primär kontakt, sätter prospekt till `won`

### API-routes (`app/api/crm/customers/`)
- `GET/POST /api/crm/customers`
- `GET/PATCH /api/crm/customers/[id]`
- `POST /api/crm/customers/[id]/contacts`
- `PATCH/DELETE /api/crm/customers/[id]/contacts/[contactId]`

### UI (`app/crm/kunder/`)
- Listsida med sökning, statusfilter (aktiv/inaktiv/churnad) och Fortnox-synkindikator
- Detaljpanel: redigering av kunddata, adresser, kontaktpersoner
- Länk tillagd i CRM-navigationen (`app/crm/_lib/nav.ts`)

### Automatisk konvertering (`app/api/crm/quotes/[id]/route.ts`)
- När offert markeras `won` och har `prospect_id` → prospektet konverteras automatiskt till kund

---

## Fortnox-integration — återstår

### Arkitektoniska beslut (redan fattade)
- Lokalt kundregister är source of truth för CRM
- Fortnox är master för fakturering/ekonomi
- Engångsimport av befintliga Fortnox-kunder vid uppstart
- Push från oss till Fortnox (inte nattlig sync), med manuell "synka nu"-knapp för admin
- Vid konflikt: Fortnox vinner på adress/faktureringsfält, vi vinner på CRM-fält

### Vad som behöver byggas för Fortnox

#### 1. Fortnox API-klient (`lib/integrations/fortnox/`)
- Auth mot Fortnox (OAuth2)
- `GET /customers` — hämta kundlista
- `GET /customers/{CustomerNumber}` — hämta specifik kund
- `POST /customers` — skapa ny kund
- `PUT /customers/{CustomerNumber}` — uppdatera kund

#### 2. Engångsimport
- Admin-vy (under Inställningar) för att köra engångsimport
- Söker mot Fortnox, matchar på org-nummer mot befintliga kunder/prospekt
- Skapar lokala kundposter med `fortnox_customer_id` och `sync_status = synced`

#### 3. Push vid offert vunnen
- I `convertProspectToCustomer()` eller separat service: `syncCustomerToFortnox()`
- Kontrollera om kunden redan finns i Fortnox (sök på org-nr) → länka istället för att duplicera
- POST till Fortnox → spara `fortnox_customer_id` + sätt `sync_status = synced`
- Om fel: sätt `sync_status = failed` för retry

#### 4. Manuell "Synka nu"-knapp
- Admin-funktion i kundkortet
- Kör `syncCustomerToFortnox()` manuellt
- Hanterar även pull (hämtar ev. uppdateringar från Fortnox på adress/kontaktfält)

#### 5. Retry-logik för misslyckade synkar
- Lista kunder med `sync_status = failed | pending` i admin-vyn
- Knapp för att köra om synken

---

## Övriga återstående implementationer

### UI — klart
- Affärsmöjlighets-formuläret stödjer identitetsläge: Prospekt / Befintlig kund / Ny direkt (med customer_type + customer_name)
- Kundprofilen visar kopplade affärsmöjligheter, offerter och arbetsorder
- Offerter visar "Kopplad kund" i kortet när customer_id finns
- Arbetsorder visar "Kundkort →"-länk i detaljvyn när customer_id finns

### Flöden att verifiera
- Konvertering: offert `won` → `convertProspectToCustomer()` → kund skapad och synlig i `/crm/kunder`
- Direkt inkommande lead: opportunity skapad med `customer_name` (utan prospekt)
- Återköp: opportunity skapad mot befintlig kund via `customer_id`
