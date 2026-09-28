# Återförsäljarportalen: CRM:ets genomförandeplan och testmiljön

**Status:** fas 0–3c byggda, resten plan. Skriven 2026-09-27, läst mot CRM:et @ `2cea02c`, uppdaterad samma
dag efter genomgången med William.
**Kontraktet** står i `RESELLER_PORTAL_INTEGRATION_PLAN.md` (kopia av portalens `CRM_INTEGRATION.md`).
Det här dokumentet säger **hur** CRM:ets halva byggs, i vilken ordning, och hur det testas hela
vägen utan att röra prod. Kontrollera varje filhänvisning mot koden innan du bygger på den.

Portalen är ett eget repo (`prodigystudios/aterforsaljare-ekovilla`) med egen Supabase och Vercel.
Dess testmiljö är uppe på test.partner.ekovilla.se. Dess prodprojekt finns inte än.

---

## Beslut (William 2026-09-27)

1. **Godkännandet sker i portalen.** Butikens säljare godkänner offerten och skickar ordern till oss.
   CRM:et skapar då både arbetsordern och Fortnox-ordern automatiskt, utan granskning hos Ekovilla.
   Arbetsordern hamnar hos rätt säljare på Ekovilla som "Ej planerad" (`draft`), och Ekovillas säljare
   planerar in jobbet. Portalen pratar aldrig med Fortnox.
2. **Planerat datum på alla arbetsordrar.** Två nya fält, planerad startdag och slutdag, som
   databasen själv håller i takt med planeringen. Ett endagsjobb har samma dag i båda. När datumen
   ändras på en portalorder får butiken veta det. Lösningen ses över igen när just den delen byggs.
3. **Bygget sker lokalt↔lokalt.** Testmiljön sätts upp när någon utanför oss ska testa, eller senast
   före prod.
4. **Testmiljön byggs som portalens:** grenen `testmiljo` → test.app.ekovilla.se, ett eget
   Supabase-projekt `ekovilla-crm-test` och Fortnox testbolaget 559341-9673. Den befintliga
   Fortnox-testappen återanvänds med en återkomstadress till.
5. **Butiksbeställningar: väg B** i kontraktet, en egen tabell och ett eget `POST /orders`.
6. **Prislistan publiceras med en knapp i admin**, med giltighetsdatum. Varje publicering blir en ny
   lista i portalen.

---

## Del 1: Miljöerna

| Nivå | CRM:et | Portalen | Används till |
| --- | --- | --- | --- |
| Lokalt↔lokalt | `next dev` på :3000, Supabase 553xx, Fortnox testbolaget | `DATA_SOURCE=supabase npm run dev -- -p 3001`, Supabase 543xx | Allt bygge. Båda apparna startar på 3000 som standard, så portalen flyttas till 3001 |
| Test | test.app.ekovilla.se (gren `testmiljo`), `ekovilla-crm-test`, Fortnox testbolaget | test.partner.ekovilla.se | Externa testare och en sista prövning på riktig Vercel före prod |
| Prod | app.ekovilla.se | partner.ekovilla.se | Koden går ut **mörk**. Utan `PORTAL_CRM_SHARED_SECRET` svarar portalens routes 503 och inget skickas |

### Lokalt↔lokalt (från start)

- Den lokala CRM:en är redan kopplad till Fortnox testbolaget, så hela kedjan går att bygga och prova
  lokalt: prislistan, jobb in, Fortnox-ordern, status och meddelanden tillbaka.
- Utgående mejl, sms och push är redan avstängda lokalt genom `.env.development.local`.
- Hemligheten: ett eget lokalt värde av `PORTAL_CRM_SHARED_SECRET` i CRM:ets
  `.env.development.local` och portalens `.env.local`, plus `RESELLER_PORTAL_URL=http://localhost:3001`
  i CRM:et och `EKOVILLA_CRM_URL=http://localhost:3000` i portalen.
- **Lista 160 måste in i testbolaget tidigt (fas 0),** eftersom den lokala CRM:en läser prislistan
  därifrån. Ett nytt skript, med samma spärrar och torrkörning som
  `scripts/fortnox/copy-articles-to-test-company.ts`, skapar prislistan 160 och dess priser. Källan är
  portalens handinlästa kopia, `lib/data/mock/seed.ts` i portalrepot (51 artiklar).
  ⚠️ Läs **aldrig** prods Fortnox från ett skript med prods tokens. En tokenförnyelse roterar
  refresh-token och kopplar ur prod.

Det lokala kan inte visa Vercel-inställningarna (miljövariabler, inloggningsskydd, riktiga adresser),
Vercels eget beteende (tidsgränser, `waitUntil`) eller släppa in externa testare. Det är testmiljöns jobb.

### Testmiljön, när någon utanför ska testa (fas 5)

Inget av stegen skriver till prod. Den lokala `TEST_ENVIRONMENT_PLAN.md` (steg 4–6) har bakgrunden.
Räkna med ungefär en halv dag, och börja lite innan någon ska testa.

**T1. Spärren för utgående trafik, först och som egen PR.**
- `NODE_ENV` är `production` även i Vercels Preview. Då **kastar** `lib/email.ts` när Resend-nyckeln
  saknas, och sms och push kastar när de inte är konfigurerade.
- `lib/env.ts` finns sedan fas 1a: `isProductionDeployment()` kräver `NODE_ENV=production`,
  `VERCEL_ENV=production` och en databas som inte är lokal, och faller alltså stängt. Spärren
  använder den.
- Spärren läggs i transportlagret, `lib/email.ts`, `lib/sms.ts` och `lib/webPush.ts`, inte i
  anroparna. Utanför prod: mejl bara till `NONPROD_MAIL_ALLOWLIST`, sms och push loggas, och saknade
  nycklar ger "skipped" i stället för ett kast. Prods beteende ändras inte.
- Portalklienten har redan sin spärr (fas 1a, `resolvePortalTarget` i `lib/domains/portal/config.ts`):
  en lista över tillåtna värdar per miljö. Prod skickar bara till `partner.ekovilla.se`, alla andra
  miljöer bara till `test.partner.ekovilla.se` eller den här datorn.
- Mutationstesta spärren: byt den tillfälligt mot `return true` och se testerna bli röda.

**T2. Supabase-projektet `ekovilla-crm-test`.**
- Samma organisation och region som prod (eu-north-1), Postgres 17, ett **nytt** databaslösenord.
- Supabase CLI länkas **bara** mot test. Prod nås som i dag, bara med `--db-url`.
- `supabase db push` mot test, buckets ur `config.toml`.
- Auth: Site URL och redirect `https://test.app.ekovilla.se`, och mejlmallen för
  lösenordsåterställning (#158), annars slutar återställningen fungera utan felmeddelande.
- Seed: `reference.sql` ja. Testanvändarna får **andra lösenord** än `dev.sql`, som ligger i repot.
  Ingen `articles.local.sql` (inköpspriser); artiklarna kommer från testbolaget via artikelsynken.
- Kör `supabase/checks/parity.sql` mot test. Ett nytt projekt kan ha andra default privileges än prod.
- Kontrollera vad projektet kostar.

**T3. Vercel.**
- **Ignored Build Step:** i dag byggs bara prod. Byt till ett eget kommando som bygger `main` och
  `testmiljo` och inget annat (Vercel bygger vid exit 1):
  ```bash
  [ "$VERCEL_ENV" = production ] || [ "$VERCEL_GIT_COMMIT_REF" = testmiljo ] && exit 1 || exit 0
  ```
- **Domänen** test.app.ekovilla.se tilldelas grenen `testmiljo`, som portalens testdomän.
- 🧨 **Allmänna Preview-variabler gäller också `testmiljo`**, om ingen grenvariabel med samma namn
  skuggar dem, och de kan innehålla prods nycklar. Gå igenom `vercel env ls preview`. Varje variabel
  ska antingen vara scopad till grenen `testmiljo` eller få Preview-målet borttaget. **Redigera aldrig
  en variabel vars mål innehåller Production**; dela upp den först.
- `NEXT_PUBLIC_APP_URL` och `NEXT_PUBLIC_SITE_URL` = `https://test.app.ekovilla.se`. De får inte vara
  tomma: `getRedirectUri()` i `lib/domains/fortnox/auth.ts` kastar då under `NODE_ENV=production`.
  `NEXT_PUBLIC_*` bakas in vid bygget, så deploya om efter varje ändring.
- **Deployment Protection av för previews**, som i portalen. Annars får portalens serveranrop Vercels
  inloggningssida. Det är ofarligt när bara `testmiljo` byggs och appen har egen inloggning.
- Blikk, tic.io, Coach AI och Twilio får inga nycklar i test.
- Vercel kör inga crons i Preview. Portalsidan får därför knappen "Skicka väntande nu".

**T4. Fortnox.**
- **Den befintliga testappen återanvänds.** En Fortnox-app kan ha flera återkomstadresser; lägg till
  `https://test.app.ekovilla.se/api/fortnox/auth/callback` bredvid localhost.
- ⚠️ **Obeprövat:** förr delade lokalt och prod samma databas och alltså en enda koppling. Nu får
  lokalt och testmiljön var sin databas med var sin refresh-token för samma app och bolag, och Fortnox
  dokumentation säger inte om den nya kopplingen slår ut den gamla. Koppla testmiljön och gör sedan
  ett Fortnox-anrop lokalt, till exempel en artikelsynk. Har den lokala kopplingen fallit får
  testmiljön en egen app.
- `FORTNOX_NONPROD_ALLOWED_ORG_NUMBERS=5593419673`. Spärren i `lib/domains/fortnox/connectionGuard.ts`
  räknar Preview som icke-prod och godtar då bara testbolaget.
- Testkunden "Testbygg AB" läggs upp i testbolaget och i CRM-testet. Dess kundnummer sätts på
  portalens testbutik.

**T4b. Kön får inte tömmas från fel databas.** Om testmiljön ärver prods Supabase-nycklar genom en
allmän Preview-variabel (T3) och har testportalens adress, godtar portalspärren den (testmiljö →
testportal). Då tar knappen "Skicka väntande nu" händelser ur PRODS kö och skickar dem till
testportalen, där de går förlorade. Innan hemligheten sätts i testmiljön: knyt portalen till
databasen. Antingen står prods Supabase-värd i koden och nekas utanför prod, eller så får varje miljö
en variabel med sin egen databasvärd som måste stämma med `SUPABASE_URL`. Prods värd finns i dag med
flit inte i repot, så valet görs då. (Granskningen av fas 1b, 2026-09-28.)

**T5. Den delade hemligheten.** `PORTAL_CRM_SHARED_SECRET` för testmiljön genereras av William i egen
terminal (`openssl rand -hex 32`) och läggs i båda Vercel-projekten, Preview för grenen `testmiljo`.
Den skrivs aldrig i en chatt, en commit eller en logg.

**T6. Verifiera testmiljön.**
- Logga in på test.app.ekovilla.se med en testanvändare. Den finns bara i testprojektet, så lyckad
  inloggning bevisar rätt databas. Nätverksfliken ska visa testprojektets ref.
- Fortnox-kopplingen godtar bara testbolaget, och den lokala kopplingen fungerar fortfarande (T4).
- En signerad ping går igenom åt båda hållen.

**Arbetssättet efteråt:** en migrering går `npm run db:reset` lokalt → `supabase db push` mot test
(länkad) → `supabase db push --db-url "$PROD_DB_URL" --dry-run` och sedan skarpt mot prod.
`testmiljo` uppdateras genom att fast-forwardas till `main`, som i portalen.

---

## Del 2: Arkitekturen i CRM:et

### Domänen `lib/domains/portal/`

Ren logik som testas isolerat:

| Fil | Ansvar |
| --- | --- |
| `signature.ts` ✅ | HMAC-SHA256 över tidsstämpel, metod, sökväg och råkropp, skilda med radbrytning (punkt 14 nedan). `timingSafeEqual` efter längdkontroll (den kastar vid olika längd). ±300 s. En tom eller kort hemlighet räknas som avstängd, alltså 503 |
| `config.ts` | Miljövariablerna och portalspärren |
| `client.ts` | Signerat anrop med `AbortSignal.timeout`, svaret klassat som 2xx, 4xx eller 5xx/timeout |
| `outbox.ts`, `idempotency.ts` | Utgående kö och inkommande svarscache |
| `articleFields.ts` ✅, `articleFieldsStore.ts` ✅ | Portalfälten per artikel. Den rena delen (kategorierna, arbetsandelen i procent, `portalPublishBlockers`) importeras av artikelsidans kort och får aldrig dra in zod eller databasklienten. Zod-schemat och läsningarna och skrivningarna ligger i `…Store.ts` |
| `pricelist.ts` ✅, `pricelistPublish.ts` ✅ | Prislistans payload (ren: grundpriset, enheten med gemener, vad som hoppas över och varför, hashen, nyckeln) och publiceringen (källorna, sparandet, kön och ett första utskick). Sidans klient importerar bara typer ur dem |
| `jobIntake.ts` ✅, `jobIntakeStore.ts` ✅, `jobBadge.ts` ✅ | Jobbets kropp (Zod), radmappningen och snapshoten (ren), och intaget mot databasen: butiken, jobbets rad, arbetsordern och, efter svaret, notiserna och Fortnox-ordern. Brickan på arbetsordern läses med sessionen |
| `assignment.ts` ✅, `county.ts` ✅, `resellers.ts` ✅ | Fördelningen till en säljare (kedjan, behörighetskravet, stegen mot databasen), länet ur postnummer och ort via Nominatim, och butikerna och reserven på portalsidan |
| `jobState.ts` | Portalens tillstånd härlett ur arbetsordern |

Det finns ingen HMAC-hjälpare, ingen idempotenstabell och ingen kö i CRM:et i dag. Fortnox-klienten
gör bara om vid 429 och har ingen timeout.

### Routes

- **Signerade, utan session**, under `app/api/portal/`: `jobs`, `jobs/[quoteId]/messages`,
  `store-orders`, `store-orders/[orderId]` (PUT), `store-orders/[orderId]/withdraw`, `ping`, och
  cron-routen `dispatch` (`CRON_SECRET`, jämförd i konstant tid).
- `middleware.ts` släpper prefixet `/api/portal/`. Middleware kör på Edge, så signaturen kontrolleras i
  routen: `runtime = 'nodejs'`, `req.text()` först, sedan `JSON.parse` och Zod `safeParse`.
- **Allt som kräver session ligger under `/api/crm/portal/`**: inställningar, publicering, svar till
  butiken, koppla kund och "skicka väntande nu". Då kan prefixet aldrig göra en sessionsroute publik.
- Ett vitest-vakttest (`tests/portal/routeGuards.test.ts`) går igenom VARJE route i `app/`, räknar ut
  adressen (genom routegrupper och catch-all) och kräver för allt under `/api/portal/` att varje handler
  börjar med grinden, importerad från `app/api/portal/_shared.ts`, och använder svaret.
- ⚠️ Grinden stoppar inte ett anrop som spelas upp igen inom 300 sekunder, eftersom signaturen är
  densamma. **Varje route som ändrar något går därför genom svarscachen** (`claimIdempotencyKey`)
  och sin affärsnyckel, så att ett upprepat anrop inte gör något nytt.
- Mall för en tunn route: `app/api/crm/planering/material-orders/[id]/send/route.ts`. Domänanropet
  returnerar en diskriminerad union som routen översätter med `ok`/`routeError` ur
  `lib/api/responses.ts`.
- Skrivningar från portalens anrop har ingen användare bakom sig och görs med `getSupabaseAdmin()`.
  De routerna läggs i "Reviewed elevations" i `SUPABASE_CONVENTIONS.md`.

### Tabellerna

Additiva migreringar. Varje tabell får RLS, `revoke all` och uttryckliga grants i samma migrering
(default privileges är stängda sedan `20260926134651`). Policyer skrivs i formen
`(select has_permission('…'))`.

| Tabell | Innehåll |
| --- | --- |
| `crm_work_orders` (nya kolumner) | `planned_start_day`, `planned_end_day`, som bara databasen skriver (se "Planerat datum") |
| `portal_idempotency_keys` | Nyckel, hash av kroppen, svaret. Bara en cache: dubbletter stoppas av affärsnycklarna nedan. Samma nyckel med en annan kropp ger 422 |
| `portal_outbound_events` | Utgående kö: unik nyckel, typ, osignerad kropp, status, antal försök, nästa försök, senaste fel |
| `crm_portal_resellers` ✅ | Portalens `resellerId` (butiken), namn, adress, kundnumret portalen skickade, `customer_id`, `seller_user_id`, första och senaste kontakten. Läggs till och uppdateras av intaget (service-rollen, fas 3b). Sessionen ändrar bara säljaren (kolumngrant) |
| `crm_portal_settings` ✅ | En enda rad: reserven (`fallback_user_id`) |
| `crm_portal_jobs` ✅ | `quote_id` (nyckel), `quote_number`, `reseller_id`, `store_name`, kunden och den som fick jobbet, `reserved_work_order_id` (valt före arbetsordern), `work_order_id` (unik, samma som den reserverade, `on delete set null`) och `work_order_created_at`, kroppen, och när notiserna skickades. Sessionen läser bara brickans fyra kolumner (kolumngrant). Fas 4b lägger till senast skickade tillstånd och markeringen "behöver synkas" |
| `crm_portal_job_messages` | Riktning, `portal_message_id` (unik), författare, text, tid |
| `crm_portal_article_fields` ✅ | Per artikelnummer: `customer_name`, `category` (check), `labor_share` (0–1, `numeric(4,3)` som portalens kolumn), `note`, `sort_order`, `publish`. En publicerad artikel kräver kundnamn och kategori. Ingen FK mot cachen, som favoriterna. Ifylld med portalens 51 artiklar (se "Fas 2a: resultat") |
| `crm_portal_pricelist_publications` ✅ | Varje publicering: giltig från, hash, löpnummer, Idempotency-Key (samma som händelsen i kön), kroppen, antalet artiklar, vem (id och namnet vid publiceringen) och när. Historik: sessionen får select och insert i eget namn, aldrig update eller delete. En tom lista kan inte sparas |
| `crm_store_orders` (+ rader) | Butiksbeställningarna, i fas 8 |

**Kön** hämtas med en RPC som använder `for update skip locked` och bara kan köras av service_role.
Den tar den **äldsta väntande händelsen per jobb**, så att händelserna för ett jobb kommer fram i
ordning, och en ny `job.scheduled` ersätter äldre väntande för samma jobb. Kroppen signeras vid varje
försök, eftersom signaturen bara gäller i 300 sekunder. PDF:er ligger i kön som referens, inte som
base64.

**Behörigheten ✅ (fas 2b):** en ny nyckel `crm.portal.manage` (admin) för portalens inställningssida, enligt
mallen `supabase/migrations/20260926122102_rbac_app_staff_key.sql`. `PERMISSION_KEYS` i
`lib/auth/permissions.ts` får nyckeln, och `tests/auth/permissions.test.ts` räknar 60 i stället för 59.
Artikelfälten redigeras under den befintliga `crm.article.manage`.

### Jobbet in: arbetsordern och Fortnox-ordern

**Arbetsordern skapas av en ny funktion.**
- `createStandaloneCrmWorkOrder()` passar inte: den tvingar tom radlista, kundens egen adress och
  `assigned_to = created_by`. `createCrmWorkOrderFromQuote()` kräver en vunnen offert i CRM:et.
- Den nya funktionen är idempotent och går att återuppta. Raden i `crm_portal_jobs` tas först, med
  ett förgenererat arbetsorder-id. Sedan skapas arbetsordern med det id:t, och `buildWorkOrderNumber`
  seedas med det. Ett omförsök fortsätter där det förra föll.
- `amount` och `pricing_summary` räknas med `lib/domains/crm/pricing.ts`, annars visar listorna 0 kr.
- Status `draft`, som i CRM:et heter "Ej planerad". Ordern syns i planeringens backlog
  (`SCHEDULABLE_WORK_ORDER_STATUSES` i `lib/domains/planning/backlog.ts`).

**Fortnox-ordern skapas automatiskt, direkt efter.**
- Portalen får `201 { crmWorkOrderId }` så snart arbetsordern finns. Fortnox-anropet väntar den
  aldrig på, så ett Fortnox-avbrott kan inte ge butiken ett fel eller få den att skicka ordern två
  gånger.
- Direkt efter svaret skapar CRM:et Fortnox-ordern med `pushWorkOrderToFortnox()`, puffat med
  `waitUntil` ur `@vercel/functions` (ett litet nytt beroende). Lokalt, utan Vercel, görs det i
  samma process efter svaret.
- Samma sak som redan sker när en vunnen offert blir arbetsorder
  (`app/api/crm/quotes/[id]/work-order/route.ts`). `pushWorkOrderToFortnox()` är idempotent på
  `fortnox_order_number` och har en claim, så ett omförsök skapar aldrig en andra order.
- Före anropet samma hårda kontroller som för våra egna ordrar: kundkoppling, fullständig arbetsadress,
  telefon, org.nr på kunden. Stoppar en kontroll görs inget Fortnox-anrop; säljaren (eller
  reservadmin) får en notis om vad som saknas.
- Misslyckas anropet (Fortnox nere, en artikel som inte finns i Fortnox) försöker cron-routen igen ett
  begränsat antal gånger. Därefter får säljaren en notis och kan synka om, som i dag.
- `confirmed` betyder att `fortnox_order_number` är satt och ordern synkad. Butiken ser alltså
  "Mottagen" och normalt inom någon minut "Bekräftad". `ekovillaOrderNumber` är Fortnox
  ordernummer, som butiken känner igen på fakturan.

**Raderna.**
- `volume` → `pricing_mode: 'm3'` med `m2` och `thickness_mm`. `count` → `pricing_mode: 'item'` med
  `quantity`.
- `article_price = unit_price = unitCost`. Ingen rabatt och ingen ROT.
- Konstruktion: `vind`, `snedtak` och `vagg` rakt av. `ovrigt` blir `''`, eftersom CRM:et saknar det
  värdet (`lib/domains/crm/constructions.ts`).

**Referensen och arbetsplatsen.**
- `customer_snapshot.label = quoteNumber`. Med ROT av blir märkningen `YourOrderNumber` i Fortnox.
- Kontaktpersonen på plats → `customer_snapshot.end_contact_name/phone`. Installatörerna ser dem först.
- Fastighetsbeteckning, vindslucka, önskad period och fritext skrivs som text i
  `internal_handoff.handoff_notes`. De får **inte** bli egna nycklar i `internal_handoff`: schemat har
  bara tre nycklar och arbetsorderns Spara skriver över hela kolumnen. Den strukturerade kopian ligger i
  `crm_portal_jobs`.
- `desired_installation_date` lämnas tom. Perioden är fritext, inget datum.

**`created_by` är säljaren som får ordern.** Kolumnen är NOT NULL mot en riktig profil, och
insert-policyn kräver `created_by = auth.uid()`, som är null under service role. En systemanvändare
hade krävt ett auth-konto per miljö och synts i alla väljare. Ursprunget syns i stället genom
`crm_portal_jobs` och en bricka "Från återförsäljarportalen · <butik>" på ordern.

**Fördelningen,** första som finns:
1. Butikens säljare (`crm_portal_resellers.seller_user_id`).
2. `crm_customers.account_manager_id`.
3. Länet där jobbet utförs, via `crm_routing_rules` och `resolveRoutingUser()` i
   `lib/domains/crm/routingRules.ts`. Inget i CRM:et tar i dag fram ett län ur en adress. Förslaget är
   Nominatim med `addressdetails`, där `ISO3166-2-lvl4` (`SE-X`) översätts med en fast tabell till
   routingreglernas namn ("Gävleborg" osv.). 3 sekunders timeout; ett fel går vidare till nästa steg
   och ger aldrig 5xx.
4. Reservadmin, en inställning på portalsidan.

Varje kandidat måste fortfarande ha `crm.workorder.write`, annars prövas nästa.

**Kunden saknas** (numret är `null` eller okänt):
- Ordern skapas ändå, hos reservadmin, med butikens uppgifter i snapshoten. Fortnox-ordern kan inte
  skapas utan kund, så butiken ser "Mottagen" tills kunden är kopplad.
- `reverse_vat` skrivs **inte** i snapshoten. Snapshotens värde vinner annars över kundkortet för
  alltid (`resolveReverseVat` i `lib/domains/fortnox/helpers.ts`).
- ✅ `POST /api/crm/portal/jobs/[workOrderId]/link-customer` (fas 3c), bara för portalordrar utan kund som
  inte finns i Fortnox. Den sätter kunden, bygger om snapshotens identitetsfält och momsen, sparar
  kopplingen i `crm_portal_resellers` och skapar Fortnox-ordern. Se "Fas 3c: resultat".

### Planerat datum (alla arbetsordrar)

- Två nya kolumner på `crm_work_orders`: `planned_start_day` och `planned_end_day`.
- **Definition:** första `start_day` och sista `end_day` bland arbetsorderns `ops_segments` som inte
  är `on_hold`. Ett endagsjobb har samma dag i båda. Båda är tomma när inget kort ligger kvar.
- **Bara databasen skriver dem:** en trigger på `ops_segments` räknar om arbetsorderns datum vid varje
  insert, update och delete. Ingen kod och inget formulär skriver i fälten. Schemat är fortfarande
  sanningen, och fälten kan inte glida isär från det, oavsett vilken kodväg som flyttar ett kort.
- **Det här reviderar en princip från planering v2**, "det som ligger på schemat bor i `ops_segments`,
  aldrig på arbetsordern". Kopian är skrivskyddad, så principens skäl gäller fortfarande. William har
  godkänt riktningen; lösningen ses över igen när den byggs.
- **Fällor att pröva när den byggs:**
  - Triggerfunktionen måste få skriva på arbetsordern även när planeraren saknar rätt att redigera
    ordrar: `security definer` med fast `search_path`, ingen EXECUTE utifrån.
  - Varje dragning ändrar arbetsorderns `updated_at`. Arbetsorderns PATCH använder den inte för
    krockkontroll (kontrollerat), men sidor som lyssnar på ändringar laddar om oftare.
  - `ops_segments.work_order_id` är `on delete cascade`. Triggern måste tåla att arbetsordern redan är
    på väg bort.
- Migreringen fyller i datumen på befintliga ordrar en gång. Den är additiv och kan gå före koden.
- Visas bredvid önskat datum på arbetsordern, i listorna och på kundkortet. Egenkontrollens egna
  uppslag av "planerad dag" (`lib/domains/crm/work-orders.ts`, `scheduled_day`) byter till fältet, så
  att det finns en enda definition.

### Status tillbaka till portalen

- **Databasen markerar, TypeScript räknar.** En trigger på `crm_work_orders` markerar raden i
  `crm_portal_jobs` som "behöver synkas" när en portalorders `status`, `planned_start_day`,
  `planned_end_day` eller `fortnox_order_number` ändras. Det täcker varje kodväg, också sådana som
  skrivs senare. Statusen skrivs i dag från ett tiotal ställen: PATCH-routen, planeringens
  statusbyte, tre fakturavägar och fler.
- **Cron `/api/portal/dispatch`** varje minut i prod tar de markerade jobben, härleder portalens
  tillstånd med den rena funktionen i `jobState.ts`, köar skillnaden mot det som senast skickades och
  skickar kön. Den gör också om misslyckade utskick och Fortnox-pushar.
- Planeringens kod rörs inte. Vill vi att butiken ser ett nytt datum på sekunder i stället för inom
  en minut räcker en puff från planeringens route.
- **Mappningen:**
  - `confirmed`: Fortnox-ordern finns och är synkad.
  - `scheduled`: `planned_start_day` är satt. Skickas igen när datumen ändras, och med
    `scheduledFor: null` när sista kortet tas bort. Aldrig före `confirmed`.
  - `completed` och `invoiced`: arbetsorderns status. `partially_invoiced` skickas inte.
- I testmiljön finns ingen cron. Portalsidan får knappen "Skicka väntande nu".

### Meddelanden

Meddelandena ligger i en egen tabell och ett eget kort, "Butiken", på arbetsordern. De blandas aldrig
med de interna kommentarerna (`crm_work_order_comments`), så att inget internt kan läcka till
butiken. Säljarens svar köas och puffas iväg direkt.

---

## Del 3: Faserna

Små PR:er. Varje går ut mörk och går att stanna på.

| Fas | Innehåll | Kräver |
| --- | --- | --- |
| **0** ✅ | Skriptet som lägger lista 160 i testbolaget. Spikar mot testbolaget: svarar `GET /3/prices/sublist/160` utan artikelnummer, och hur ser `FromQuantity` ut? Vad ger Nominatim för ISO-fält? Resultaten står under tabellen | — |
| **1a** ✅ | `signature.ts` och `config.ts`, rena, med kontraktets exempel som fixturer | — |
| **1b** ✅ | Migreringen för idempotens, kö och kö-RPC (bara service_role). `idempotency.ts`, `outbox.ts`, `client.ts`. Ett 401 från portalen görs om med backoff, som 5xx (punkt 15). Köns beteende prövas mot en databas med `supabase/checks/portal_outbox.sql` (bara lokalt, rullar tillbaka) | 1a |
| **1c** ✅ | Undantaget i middleware (prefixet `/api/portal/`), signerad `POST /api/portal/ping`, grinden `verifyPortalRequest` i `app/api/portal/_shared.ts`, och vakttestet `tests/portal/routeGuards.test.ts`: varje handler under prefixet måste BÖRJA med grinden och använda svaret | 1a |
| **2a** ✅ | `crm_portal_article_fields` och fälten på artikelsidan (`crm.article.manage`): eget kort med eget Spara (`PUT /api/crm/portal/article-fields/[articleNumber]`), kolumnen "Portal" och ett filter i listan. Beteendet prövas mot en databas med `supabase/checks/portal_article_fields.sql`. Resultaten står under tabellen | — |
| **2b** ✅ | Läsaren för lista 160 (bara `FromQuantity` 0, paginering, rate limit). Payloadbyggaren: enheten med gemener, en artikel utan enhet skickas inte, hashen byggs över sorterad JSON. Sidan Återförsäljarportalen (`crm.portal.manage`) med förhandsvisning och Publicera, historiken och "Skicka väntande nu". Beteendet prövas mot en databas med `supabase/checks/portal_pricelist.sql`. Resultaten står under tabellen | 0, 1b, 2a |
| **3a** ✅ | `crm_portal_resellers`, fördelningen, inställningarna butik → säljare och reservadmin (fliken "Butiker och säljare" på portalsidan). Beteendet prövas mot en databas med `supabase/checks/portal_resellers.sql`. Resultaten står under tabellen | 1b |
| **3b** ✅ | `POST /api/portal/jobs`, skapandet av arbetsordern, den automatiska Fortnox-ordern med kontrollerna, notistypen `portal_job.received` (bygge i `lib/domains/notifications/payload.ts`, utskick med `deliverNotifications()`), brickan. Beteendet prövas mot en databas med `supabase/checks/portal_jobs.sql`. Resultaten står under tabellen | 3a |
| **3c** ✅ | Koppla kund på en portalorder utan kund. Beteendet prövas mot en databas med `supabase/checks/portal_customer_link.sql`. Resultaten står under tabellen | 3b |
| **4a** | Planerat datum på alla arbetsordrar: kolumnerna, triggern, ifyllnaden, visningen. Fristående från portalen | — |
| **4b** | Status tillbaka: markeringen, `jobState.ts`, cron-routen och utskicket, omförsöken av Fortnox-pushen. Från 1b: en uppgiven händelse håller inte kvar resten av jobbets kö, så "planerad" köas först när "bekräftad" är LEVERERAD (inte bara köad). Portalsidan visar uppgivna händelser (404, 403, 409 m.fl.) och kan skicka om dem | 1b, 3b, 4a |
| **5** | Testmiljön, T1–T6 i Del 1. När jobb in och status tillbaka fungerar lokalt, före första externa testare | 4b |
| **6** | Meddelanden åt båda hållen och kortet "Butiken" | 4b |
| **7** | Dokumenten: orderbekräftelsen (`getFortnoxOrderPdf()`) efter bekräftelsen, egenkontrollen med en knapp. Storlekskontroll: base64 gör att en PDF får vara högst cirka 3,3 MB under Vercels 4,5 MB | 4b |
| **8** | Butiksbeställningar, väg B: intag med 409 efter bekräftelsen, sedan Fortnox (`buildOrderRows()`, fraktraden, momsen enligt beslutet), sedan status | Momsbeslutet |
| **9** | Prod, när portalens prodprojekt finns: **reserven vald** på portalsidan (annars tas ett jobb utan säljare inte emot), hemligheten och `RESELLER_PORTAL_URL` i Production, första publiceringen, ett första riktigt jobb med en butik som vet om det | Allt ovan |

### Fas 0: resultat (2026-09-27)

**Fortnox prislista, provat mot testbolaget:**
- `GET /3/prices/sublist/{lista}` fungerar **utan** artikelnummer. 100 rader per sida som standard;
  `limit` och `page` fungerar (läsaren använder 500, som artikellistan), och
  `MetaInformation.@TotalPages` anger antalet sidor.
- Varje rad: `ArticleNumber`, `FromQuantity` (tal), `PriceList`, `Price` (tal). Grundpriset är raden
  med `FromQuantity` 0. En artikel med mängdrabatt har fler rader, som läsaren i fas 2b ska hoppa över.
- Läsaren finns nu: `listFortnoxPriceListPrices()` i `lib/domains/fortnox/priceLists.ts`, med test.
  Fas 2b återanvänder den.

**Lista 160 i testbolaget:**
- Skapad som "Byggvaruhandel", med 44 grundpriser ur portalens kopia (giltig från 2026-09-25):
  `npx -y tsx scripts/fortnox/copy-price-list-160-to-test-company.ts --source <portalrepot>/lib/data/mock/seed.ts`
  (torrkörning; `--apply` skriver). En ny torrkörning gav "stämmer redan: 44".
- ✅ **Alla 51 artiklar har pris på lista 160.** Sju av dem syntes först inte för API:t:
  `GET /articles/{nr}` gav 404, men att skapa dem gav `Artikelnummer "…" används redan` (kod 2000013).
- **Orsaken: de var satta som paketartiklar i testbolaget**, och `/articles` visar inte paket. Det
  bekräftades på 13400: ett vanligt sparande räckte inte, men att ändra den till vanlig artikel gjorde
  den synlig direkt. Typen och lagerföringen är inte orsaken; varor och lagerförda artiklar syns.
- 🧨 Vid ändringen kan artikeln tappa sin enhet (13400 gjorde det). Kontrollera enheten, eftersom
  publiceringen hoppar över artiklar utan enhet.
- ⏸️ 40 andra av prods artiklar är fortfarande paket i testbolaget, bland dem **1050 FRAKT** (behövs i
  fas 8) och ROT-artiklarna 1024 och 10060. De ändras när de behövs. Torrkörningen av
  `copy-articles-to-test-company.ts` visar hur många som är kvar.

**Nominatim, för länet i fördelningen (fas 3a):**
- `addressdetails=1` ger både `county` ("Gävleborgs län") och `ISO3166-2-lvl4` ("SE-X"). Koden
  översätts med en fast tabell till namnen i `SWEDISH_COUNTIES` (`lib/domains/crm/routingRules.ts`):
  AB Stockholm, AC Västerbotten, BD Norrbotten, C Uppsala, D Södermanland, E Östergötland,
  F Jönköping, G Kronoberg, H Kalmar, I Gotland, K Blekinge, M Skåne, N Halland, O Västra Götaland,
  S Värmland, T Örebro, U Västmanland, W Dalarna, X Gävleborg, Y Västernorrland, Z Jämtland.
- Fråga med **postnummer och ort**, inte gatan. En gatufråga träffade en annan husadress med ett
  annat postnummer; länet blev rätt, men postnummer och ort räcker för länet och ger mindre att gissa.
- `crm_routing_rules` är tom lokalt. Fördelningen på län går inte att prova förrän regler finns.

### Fas 2a: resultat (2026-09-28)

**Williams beslut:**
- **Tabellen fylls från början** med de 51 artiklarna portalen visar i dag (`ARTICLES` i portalens
  `lib/data/mock/seed.ts`, prods lista 160 läst 25 september): kundnamn, kategori och arbetsandel, en tom
  anteckning, ordningen 10, 20 … 510 i portalens ordning och publiceras = ja. Första publiceringen ändrar
  då inget för butikerna. Migreringen gör ifyllnaden med `on conflict do nothing`.
- **Fälten ligger i ett eget kort** under "Priser" på artikelns sida, med eget Spara, eftersom fälten
  sparas i CRM:et och inte i Fortnox. Kortet visar grundpriset på lista 160 och enheten, men de går inte
  att ändra där. Listan har kolumnen "Portal" och filtret "Bara portalens prislista".
- **Vilken artikel som helst kan markeras.** Publiceringen hoppar över en artikel som är inaktiv, saknar
  enhet eller saknar pris på lista 160, och kortet varnar för samma sak. Regeln finns på ett ställe,
  `portalPublishBlockers()`, som fas 2b använder. 0 kr räknas som ett pris.

⚠️ **Före första publiceringen:** arbetsandelarna för inblåst lösull är portalens antaganden (0,45 på
vinden, 0,5 annars; 14 artiklar) och ger ROT. Ekovilla behöver bekräfta dem.

**Till fas 2b:** en markerad rad kan sakna artikel, till exempel när artikeln raderats i Fortnox, för
raden ligger kvar. Den kommer inte med, eftersom den saknar pris på lista 160, men den syns inte heller
på någon sida. Förhandsvisningen ska därför visa markerade rader som inte finns i artikelcachen, så att
de går att se och avmarkera. Tabellens policyer frågar bara efter `crm.article.manage`. Publiceringen under
`crm.portal.manage` får en egen läspolicy i sin migrering. `numeric(4,3)` avrundar en fjärde decimal
utan att säga något, och därför nekar appen fler än tre decimaler innan värdet når databasen.

### Fas 2b: resultat (2026-09-28)

**Williams beslut:**
- **Sidan ligger under CRM → Inställningar** (`/crm/installningar/aterforsaljarportalen`), bredvid
  Artiklar och Enheter, med nyckeln `crm.portal.manage`. Butik → säljare, reservadmin och uppgivna
  händelser (3a, 4b) hamnar på samma sida.
- **Giltig från är i dag eller senare.** Förvalet är i dag (svensk dag). Ett datum bakåt nekas både
  på sidan och i routen.
- **Publicera är avstängd där integrationen är av**, alltså i prod tills hemligheten sätts. Då köas
  ingenting som skulle gå iväg den dag integrationen slås på. Förhandsvisningen fungerar ändå.

**Så fungerar publiceringen:**
- Servern bygger om listan ur källorna och jämför hashen med förhandsvisningen. Har något ändrats
  svarar den 409 och sparar ingenting.
- Publiceringen sparas med sessionen, händelsen köas med service-rollen, och ett första utskick görs
  direkt (högst 5 händelser och 15 s).
- Nyckeln är `pricelist-<giltig från>-<hash>-<löpnummer>`. Samma innehåll och datum som den
  **senaste** publiceringen, som portalen inte nekat, är samma publicering. Då blir det ingen ny rad
  och ingen ny händelse, och portalen får inget nytt anrop. Allt annat blir en ny publicering med nästa
  löpnummer. Det gäller också samma lista som en tidigare (X, sedan Y, sedan X igen), för annars hade
  butikerna fortsatt räkna på Y. En nekad lista kan skickas igen på samma sätt.
- Det som inte går fram ligger kvar i kön. "Skicka väntande nu" skickar det som är dags, och en
  händelse som misslyckats görs om tidigast efter 30 s. Cron-utskicket kommer i 4b.

**Prövat mot en fejkportal på :3101**, som kontrollerar signaturen enligt punkt 14:
- 51 artiklar gick fram med enheten med gemener och kontraktets fält;
- en andra publicering av samma lista gav inget nytt anrop;
- X, sedan Y, sedan X igen: X gick fram en andra gång (#3, samma hash som #1);
- en lista som nekades (404) gick fram när den publicerades igen;
- 503 gav "Väntar, försöker igen" med felet, och sedan "Mottagen" efter "Skicka väntande nu";
- säljaren fick 403 på båda routerna och skickades bort från sidan.

⚠️ **Lokala provpubliceringar tas bort efteråt**, både publiceringen och händelsen med
`ordering_key = 'pricelist'`. Ligger de kvar räknas en publicering med samma innehåll och datum mot
den riktiga lokala portalen som "redan publicerad", och ingenting skickas.

**Till senare faser:**
- En nekad prislista skickas om genom att den publiceras igen. Andra uppgivna händelser skickas om
  från sidan i 4b.
- Portalen har ingen mottagare än (`/api/ekovilla/pricelists`), se punkt 17 nedan.

### Fas 3a: resultat (2026-09-28)

**Williams beslut:**
- **En butik dyker upp när den hör av sig första gången.** Intaget i 3b lägger till den med namn,
  adress och kundnummer. Därefter kan en säljare väljas. Det första jobbet fördelas genom kedjan.
- **Reserven kan vara säljare eller admin**, så länge den kan skriva arbetsordrar.
- **Ett jobb som inte hittar någon tas inte emot än.** Portalen får 503 och försöker igen, och
  portalsidan visar en röd varning så länge ingen reserv är vald.

**Fördelningen** (`resolvePortalAssignee` i `lib/domains/portal/assignment.ts`) tar den första som
finns och kan skriva arbetsordrar:
1. butikens säljare;
2. kundansvarig på butikens kundkort;
3. säljaren för länet;
4. reserven.

En kandidat som inte kan skriva arbetsordrar hoppas över och redovisas i svaret. Länet slås upp hos
Nominatim bara när steg 1 och 2 inte gav någon. Frågan ställs med postnummer och ort, har 3 s
timeout, och ett fel ger `null`. Ett databasfel kastas, så att intaget svarar 5xx.

**Behörighetsfrågan om en annan användare** (`userCanWriteWorkOrders`) går med service-rollen, med
samma regel som `effective_permissions()`: ett borttag vinner. Den står under "Reviewed elevations".
Säljarlistan på sidan kommer från den befintliga `/api/crm/sellers`, så ingen ny namnelevation.

**Prövat i webbläsaren som admin**, med två provbutiker lokalt som tagits bort efteråt:
- reserven sparades och varningen försvann;
- butikens säljare sparades och stod kvar efter omladdning;
- en säljare vars `crm.workorder.write` dragits tillbaka gav 422, och valet gick tillbaka;
- länsuppslaget bekräftades mot Nominatim: Gävle (806 28 och 802 91) gav SE-X, Gävleborg.

**Till fas 3b:**
- Intaget upserter butiken med service-rollen: namn, adress, `customer_number` och `last_seen_at`,
  men aldrig `seller_user_id`.
- `customer_id` hittas ur `ekovillaCustomerNumber` (`crm_customers.fortnox_customer_id`). Butiker
  kan dela kundnummer.
- Fördelningen anropas med `portalAssignmentDeps(admin, …)`. `none` blir 503, och den som får jobbet
  blir `created_by` och ansvarig.
- `crm_routing_rules` är tom lokalt. Steg 3 prövas genom att lägga en regel under Ringlistor.
- Länsuppslaget har ingen cache. Nominatim tillåter ett anrop i sekunden, och steg 3 behövs bara när
  butiken saknar både säljare och kundansvarig. Ett misslyckat uppslag loggas som
  `[portal-county]`, utan adressen. Blir det många behövs en cache per postnummer.
- Ett id av bara punkter (`.`, `..`) skrivs om av webbläsaren i en adress, och butikens id nekar det
  därför. Samma sak gäller portalens andra id:n i sökvägar (`quoteId` med flera), så pröva det i 3b.

### Fas 3b: resultat (2026-09-28)

**Williams beslut:**
- **Två notiser vid behov.** "Nytt jobb från <butik>" med arbetsplatsen, perioden och "Fyll i densiteten" när jobbet
  har lösull, till den som fick jobbet. En andra notis bara när Fortnox-ordern inte kan skapas, med orsaken, till
  samma person (reserven när butiken saknar kund).
- **Brickan** "Från återförsäljarportalen · <butik> · offert <nr>" i arbetsorderns sidhuvud, bara där. Den syns
  också i ekonomiytans läsvy, som är samma sida.
- **Titeln är arbetsplatsens adress** ("Rönnvägen 18, Gävle"). Den står i listorna och på Fortnox-ordern som
  "Projekt: …  Märkning: <offertnr>".
- **Densiteten lämnas tom.** Portalen skickar ingen, och säckantalet är 0 tills säljaren fyllt i den.

**Egna val som William inte sa emot:**
- Samma quoteId med en ny nyckel ger den befintliga arbetsordern om innehållet är detsamma (nycklarnas ordning spelar
  ingen roll), annars 409 `job_conflict`. En arbetsorder som tagits bort skapas inte igen (409 `work_order_removed`).
- Namn och enhet ur artikelregistret när artikeln finns där: säckberäkningen känner igen materialet på registrets
  namn, och Fortnox vill ha registrets enhetskod. Annars portalens.
- Ett Fortnox-försök direkt efter svaret. Omförsöken kommer i 4b.

**Så fungerar intaget** (`receivePortalJob`, i anropet):
1. Kroppen prövas: JSON, ingen text som Postgres inte kan spara (nolltecken, ensamt surrogat: 400 `invalid_text`
   i stället för ett 500 som portalen gjort om i två dygn), och kontraktet med Zod. En volymrad måste ha enheten m³.
2. Finns jobbet redan jämförs innehållet, och butiken rörs inte. Ett nytt jobb lägger till eller uppdaterar butiken
   (namn, adress, kundnummer, kortet numret pekar på, `last_seen_at`; aldrig säljaren) och fördelas (fas 3a). Ingen kan
   ta det: 503 med `Retry-After: 300`, inget jobb och ingen arbetsorder, men butiken finns och kan få en säljare.
3. Jobbets rad sparas med ett arbetsorder-id valt i förväg. Arbetsordern skapas med det id:t och ett ordernummer ur
   det och dagen jobbet kom. Ett omförsök efter ett avbrott, också efter midnatt, fortsätter där det förra föll och
   skapar aldrig en andra order. Den som fick jobbet är både `created_by` och ansvarig. Togs den bort innan ordern
   fanns fördelas jobbet om (ett samtidigt omförsök tar den första omfördelningen).
4. 201 `{ ok: true, data: { crmWorkOrderId } }`.

**Efter svaret** (`followUpPortalJob`, med `waitUntil`; routen har `maxDuration = 90` som utskicket): "Nytt jobb", sedan samma fullständighetskontroll som våra
egna ordrar mot kundkortet som det ser ut nu, sedan `pushWorkOrderToFortnox()`. Varje notis skickas en gång: raden
tas före utskicket och släpps om det misslyckas. En push som redan pågår ger ingen notis.

**Prövat lokalt↔lokalt** (signerade anrop mot dev-servern, Fortnox testbolaget):
- utan säljare och reserv: 503, butiken tillagd och kopplad till kund 15, nyckeln släppt;
- med butikens säljare: samma anrop gav 201, arbetsorder AO-20260928-B99B61 hos säljaren, Fortnox-order 22 i
  testbolaget med `YourOrderNumber` = offertnumret, leveransadressen = arbetsplatsen, priserna = unitCost,
  registrets namn och enheter, ingen ROT, netto 14 270 kr, och textraden "Projekt: Rönnvägen 18, Gävle  Märkning:
  2026-901";
- samma nyckel igen: samma svar ur cachen; en ny nyckel: samma arbetsorder; ett ändrat innehåll: 409; samma nyckel med
  en annan kropp: 422;
- en butik utan kundnummer, med admin som reserv: arbetsordern hos reserven utan kund och utan moms i snapshoten,
  ingen Fortnox-order, och två notiser till reserven;
- i webbläsaren som säljaren: notisen i klockan ledde till ordern, brickan i sidhuvudet, arbetsbeskrivningen,
  märkningen och kontakten på plats. På telefonbredd kortas brickan med ellips;
- efter granskningen: en upprepning rörde inte butiken, ett nolltecken gav 400 `invalid_text`, och ett nytt jobb
  blev Fortnox-order 23.

⚠️ **Lokala provjobb** (`q-lokal-3b-1` till `-3`), deras arbetsordrar, notiser och butiker (`res-sehed-gavle`,
`res-okopplad`), reserven (admin) och Fortnox-order 22 och 23 i testbolaget ligger kvar tills de tas bort.

**Till senare faser:**
- ✅ 3c: kopplingen av kund, se nedan.
- 4b: omförsöken av Fortnox-pushen, och en push som dog med processen (efter svaret men före Fortnox). Tills dess
  syns det som "Ej synkad" på arbetsordern och lagas med "Skicka till Fortnox".
- Portalen läser `data.crmWorkOrderId` (appens kuvert, punkt 18 nedan).

### Fas 3c: resultat (2026-09-28)

**Williams beslut:**
- **Den som har ordern, eller en admin, kopplar**: samma som får redigera arbetsordern (RLS på `crm_work_orders`),
  med `crm.workorder.write`.
- **Kopplingen gäller butikens nästa jobb** när portalens nummer saknas eller inte finns i CRM:et. Ett nummer som finns
  i CRM:et vinner alltid, och ersätter kopplingen.
- **Saknar kortet något som kontrollen kräver nekas kopplingen** med listan, och ingenting sparas. Kopplingen och
  Fortnox-ordern görs i ett steg, så en portalorder når aldrig Fortnox förbi kontrollen.
- **Bara på arbetsordern.** Ett kort "Butiken är inte kopplad till någon kund" överst i översikten, med kundväljaren
  från "Ny order" och knappen "Koppla och skicka till Fortnox".
- **Butiken är kunden** (William): det är butiken Ekovilla fakturerar, och butiken fakturerar sin kund. Ett
  privatkundskort nekas (422).

**Så fungerar kopplingen** (`lib/domains/portal/linkCustomer.ts`):
1. Sessionen läser ordern och kortet; service-rollen läser jobbet (sessionen ser bara brickans kolumner). En vanlig
   order, en order som redan har kund eller finns i Fortnox, och ett kort som inte finns ger var sitt svar.
2. Kortets del av snapshoten byts (namn, org.nr, adress, moms), och momsen och beloppet räknas om. Kontakten och Er
   referens fylls bara där ordern saknar dem: har säljaren fyllt i dem står de kvar. Märkningen, arbetsplatsen och
   kontakten på plats står kvar.
3. Samma fullständighetskontroll som våra egna ordrar, på ordern som den blir. Saknas något: 409 med listan.
4. Sessionen sparar ordern, bara om den fortfarande saknar kund och Fortnox-order och inte sparats sedan den lästes
   (`updated_at`). Noll rader betyder att någon hann före (409 `portal_job_already_linked`, `portal_job_in_fortnox`
   eller `portal_job_changed`) eller att sessionen inte får ändra ordern (403). Kortet läser då om ordern.
5. Service-rollen sparar kunden på jobbet och kopplingen på butiken (`customer_linked_by/at`, ny migrering), och sedan
   skapas Fortnox-ordern. Ett Fortnox-fel ändrar inte kopplingen; det sägs.

**Intaget (3b) läser kopplingen:** ett nummer som finns i CRM:et ger det kortet och nollar kopplingen; annars får
jobbet kortet som kopplats på butiken. Kortet skrivs i ett eget, villkorat steg, så att en koppling som sparas medan
ett intag pågår inte nollas. Tas kortet bort nollas bara id:t, och butiken räknas som okopplad.

**Kundväljaren** är nu en delad hjälpare (`app/crm/lib/customerSearch.ts`), som "Ny order" och uppgiftsformuläret
också använder. Portalkortet visar bara företag.

**Prövat lokalt↔lokalt** (dev-servern på :3002, eftersom portalen körde på :3000 och :3001; en egen headless
Chromium, så att Chrome-kakorna för portalen inte rördes):
- säljaren, som inte hade ordern: kortet syns, kopplingen nekas med "Bara den som har ordern, eller en admin …";
- admin med ett kort utan org.nr: listan "En uppgift saknas innan kunden kan kopplas", med länk till kundkortet;
- admin med BRIX Sverige AB: kopplad, Fortnox-order 24, sidhuvudet visar kunden och "Fortnox: Synkad";
- ett nytt jobb från samma butik, fortfarande utan nummer: fick BRIX direkt och blev Fortnox-order 25 utan att
  någon gjorde något;
- på telefonbredd ingen sidledsscroll, knappen i full bredd;
- efter granskningen: väljaren visade bara företag, och en koppling med krockkontrollen mot riktig PostgREST blev
  Fortnox-order 26.

⚠️ **Lokalt kvar:** portalorderna `q-lokal-3c-1` och `-2`, butikerna `res-okopplad` (kopplad till BRIX för hand) och
`res-okopplad-2` (kopplad till Boli Bygg), och Fortnox-order 24–26 i testbolaget.

Stående regler: grenar heter `feature/…`, varje gren granskas före PR, merge med `--merge` efter
gröna kontroller, migreringarna är additiva och får gå före koden, `npm run lint` på varje ändrad
`.tsx`. Inga ändringar i `app/plannering/**` eller Blikks kod. Portalens ordrar planeras bara i nya
planeringen (`/crm/planering`); gamla `/plannering` hämtar sina jobb från Blikk och ser dem inte.

---

## Rättelser och luckor i kontraktet

Tas med till portalen och ändras i båda kopiorna av kontraktet.

1. **CRM:et har ingen pgTAP.** SQL vaktas med vitest-tester som läser migreringarna
   (`tests/supabase/*`) och med `supabase/checks/parity.sql`.
2. **Ordern granskas inte hos Ekovilla.** Fortnox-ordern skapas automatiskt, så "Bekräftad" kommer
   normalt inom någon minut efter "Mottagen". Undantaget är en butik som inte är kopplad till en kund i
   CRM:et; då står jobbet som "Mottagen" tills Ekovilla kopplat den.
3. **De praktiska fälten** hamnar i `handoff_notes` och `end_contact_*`, inte som nycklar i
   `internal_handoff`.
4. **`job.scheduled`** kommer ur planeringen och kan flyttas eller tas bort. Portalen behöver tåla
   `scheduledFor: null`, "inte längre planerad".
5. **Förslag: `scheduledUntil`** i `job.scheduled`, planerad slutdag, så att butiken kan se hela
   perioden. Samma dag som `scheduledFor` för ett endagsjobb.
6. **`ekovillaOrderNumber`** är Fortnox ordernummer.
7. **`job.invoiced`** skickas bara när faktureringen görs i CRM:et. Fakturerar någon direkt i Fortnox
   vet CRM:et inget om det.
8. **En avbruten eller borttagen arbetsorder** har ingen händelse än (kontraktets öppna fråga 5).
9. **`PUT store-orders`** behöver `updatedAt` i kroppen. Annars kan ett sent omförsök av en äldre
   ändring skriva över en nyare.
10. **`job.message.department`** behöver ett bestämt värde.
11. **Förslag:** `POST /api/ekovilla/ping` i portalen, så att CRM:et kan prova kopplingen från
    portalsidan.
12. **En gemensam testvektor för signaturen**, så att båda sidor prövar samma sak. Räknad med Pythons
    `hmac`, inte med någon av apparnas kod (`tests/portal/helpers/contractFixtures.ts`, där också
    Python-kommandot står):
    - hemlighet `portal-kontraktsvektor-0123456789abcdef0123456789abcdef`, tidsstämpel `1790000000`
    - metod `POST`, sökväg `/api/portal/jobs/q-2026-015/messages`
    - kropp `{"messageId":"msg-1","authorName":"Sara Ek","body":"Hej från Gävle – vindsluckan sitter ute.","sentAt":"2026-09-27T12:00:00Z"}`
      (126 tecken, 130 byte i UTF-8)
    - signatur `v1=0a23a52e4a620ea087da88e218f347248f4003d0fcfecd56649ef08e670bcac6`
13. **Hemligheten ska vara minst 32 tecken.** CRM:et räknar en kortare som saknad, svarar 503 och
    signerar inget. Den trimmas på båda sidor.
14. **Beslutat (William 2026-09-28): signaturen gäller också metod och sökväg.** Det som signeras är
    `tidsstämpel + "\n" + METOD + "\n" + sökväg + "\n" + råkropp`:
    - metoden med versaler;
    - sökvägen som den står i URL:en (procentkodad), utan värd och frågesträng.

    Utan dem gällde en signatur för vilken route som helst, åt båda hållen, i 300 sekunder. En
    signerad `ping` med tom kropp hade också dugt till `store-orders/{orderId}/withdraw` för en annan
    beställning. Fälten skiljs med radbrytning, eftersom en punkt hade varit tvetydig: `/a.b` + `c`
    och `/a` + `b.c` ger samma sträng. Prefixet är fortfarande `v1=`, eftersom ingen sida hade byggt
    transporten.
15. **Beslutat (William 2026-09-28): ett nej på signaturen (401) görs om, som 5xx.** Annars tappas
    varje händelse för gott medan hemligheten byts, eftersom den byts i en app i taget, eller om en
    klocka går fel mer än 300 sekunder. Andra 4xx ges fortfarande upp. Byt hemligheten i båda apparna
    i samma stund, en lugn stund.
16. **Sökvägarna har bara tecken som aldrig procentkodas:** A–Z, a–z, 0–9 och `- _ . ~`. Det gäller
    alltså också id:n i sökvägen (`quoteId`, `orderId`, `messageId`). Då är sökvägen samma för
    avsändaren och mottagaren, och ingen server på vägen kan koda om den och få signaturen att falla.
    CRM:et svarar 400 på andra tecken. (Granskningen av fas 1c, 2026-09-28.)

17. **Portalens mottagare för prislistan** (fas 2b, 2026-09-28) finns inte än. CRM:et skickar
    `POST /api/ekovilla/pricelists` med kontraktets kropp och **`Idempotency-Key:
    pricelist-<validFrom>-<sha256>-<löpnummer>`**. Löpnumret är ett tillägg till kontraktet: utan det
    hade samma lista publicerad igen efter en annan (X, Y, X) fått första X:ets nyckel, och portalen
    hade svarat som på den och behållit Y. Portalen ska behandla nyckeln som en ogenomskinlig sträng.
    Hashen är sha256 i hex över artiklarna som JSON med sorterade nycklar. CRM:et räknar 2xx som
    mottaget och gör om 5xx och 401. Övriga 4xx ges upp och visas på sidan. Två publiceringar samma
    dag ger två listor med samma `validFrom`, och portalen behöver då använda den senast mottagna.

18. **Svaren har appens kuvert** (fas 3b, 2026-09-28). Framgång är `{ "ok": true, "data": … }`, jobbet alltså
    `201 { "ok": true, "data": { "crmWorkOrderId": "…" } }`, och ett fel är `{ "ok": false, "error": "<text>",
    "errorDetails": { "code": "…", "message": "…", "details": … } }`. Samma form som `ping` redan svarar med.
19. **Jobbets felsvar** (fas 3b): 400 `invalid_json`; 400 `invalid_text` (ett nolltecken eller ett ensamt surrogat
    någonstans i kroppen, med sökvägen); 400 `validation_error` med `details.issues` (`path` som
    `lines.1.unitCost`, och `message`); 400 `invalid_idempotency_key`; 409 `job_conflict` när samma quoteId redan är
    mottaget med ett annat innehåll (en ny nyckel med samma innehåll ger 201 och den befintliga arbetsordern); 409
    `work_order_removed` när Ekovilla tagit bort jobbets arbetsorder; 422 `idempotency_key_reused`; 503 `no_assignee`
    med `Retry-After: 300` när ingen hos Ekovilla kan ta jobbet än. `ekovillaCustomerNumber` måste finnas i kroppen
    (null eller en sträng; en tom sträng räknas som null). En `volume`-rad måste ha enheten `m3`.

## Öppna frågor

Ingen av dem stoppar fas 0–6.

- **Momsen** (kontraktets fråga 4). `reverse_vat` sitter på kunden och gäller alla kundens dokument,
  medan produkter normalt har vanlig moms. Blockerar fas 8 och ska vara besvarad före första riktiga
  jobbet i prod, eftersom Fortnox-ordern nu skapas automatiskt. Tas med ekonomi eller revisor.
- **Ett avbrutet jobb** (fråga 5): förslaget är en ny händelse `job.cancelled`.
- **Dokumenten** (fråga 7): förslaget är både orderbekräftelsen och egenkontrollen.
- **Planeringens datumbekräftelse** föreslår kontakten på plats (`resolveDocumentContact()` i
  `lib/domains/crm/contacts.ts`), alltså butikens slutkund. Är det önskat?
- **Vem är reservadmin?** Reserven väljs på portalsidan (fas 3a) och måste vara vald före fas 9.
  Vem det ska vara är fortfarande öppet.

---

## Verifiering

**Enhetstester** (vitest, `tests/portal/`):
- Signaturen: giltig, ändrad kropp, fel hemlighet, ±301 s, saknat `v1=`, tom hemlighet.
  Mutationstesta genom att tvinga jämförelsen till `true` och se testerna bli röda.
- Radmappningen och snapshoten, med kontraktets JSON-exempel som fixturer.
- Prislistans payload: enheterna, en artikel utan enhet, ören, stabil hash.
- Fördelningskedjan, steg för steg.
- `jobState.ts` tabelldrivet: bekräftad före planerad, datum som flyttas och tas bort, pausade kort,
  flera etapper, `partially_invoiced` skickar inget, steg bakåt.
- Planerat datum: triggern prövad mot den lokala databasen (lägg, flytta, pausa, ta bort, radera
  arbetsordern) och ett SQL-texttest för grants och `security definer`.
- Kön: 5xx och timeout görs om, 4xx ger upp, tre snabba flyttar blir en händelse.

**Lokalt↔lokalt:**
- ✅ Publicera prislistan två gånger: samma nyckel, samma svar (mot fejkportalen, fas 2b).
- Samma jobb från portalen två gånger ger en arbetsorder och en Fortnox-order. Samma `quoteId` med en
  ny nyckel ger den befintliga.
- Ett jobb från portalen blir "Bekräftad" utan att någon hos Ekovilla gör något. Ett kort i
  planeringen ger "Planerad" med start- och slutdag; att flytta kortet uppdaterar datumen, att ta bort
  det ger "inte längre planerad".

**I testmiljön, hela vägen:**
1. Testbygg AB skickar ett jobb på test.partner.ekovilla.se, och rätt säljare får en notis.
2. Fortnox-ordern skapas i testbolaget av sig själv. `YourOrderNumber` är offertnumret, priserna är
   `unitCost` och det finns ingen ROT. Portalen visar Bekräftad.
3. Säljaren planerar jobbet: portalen visar Planerad med datum, sedan Utförd och Fakturerad.
4. Ett meddelande går åt båda hållen.
5. En butiksbeställning går att ändra före bekräftelsen och ger 409 efter.

**Prod, mörk:** `/api/portal/ping` svarar 503 utan hemlighet, och `/api/crm/*` utan session svarar
fortfarande 401.

**Varje kod-PR:** `npm run type-check`, `npm run lint`, `npm run build` (inte medan dev-servern kör)
och `npm test`. En migrering prövas i en tillfällig databas (två körningar) och läggs lokalt med
`supabase migration up`. Kör inte `npm run db:reset`: den raderar den lokala Fortnox-kopplingen.
