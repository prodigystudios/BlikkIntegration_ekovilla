# Återförsäljarportalen: CRM:ets genomförandeplan och testmiljön

**Status:** plan, ingen kod byggd. Skriven 2026-09-27, läst mot CRM:et @ `2cea02c`.
**Kontraktet** står i `RESELLER_PORTAL_INTEGRATION_PLAN.md` (kopia av portalens `CRM_INTEGRATION.md`).
Det här dokumentet säger **hur** CRM:ets halva byggs, i vilken ordning, och hur det testas hela
vägen utan att röra prod. Kontrollera varje filhänvisning mot koden innan du bygger på den.

Portalen är ett eget repo (`prodigystudios/aterforsaljare-ekovilla`) med egen Supabase och Vercel.
Dess testmiljö är uppe på test.partner.ekovilla.se. Dess prodprojekt finns inte än.

---

## Beslut (William 2026-09-27)

1. **En driftsatt testmiljö för CRM:et, byggd som portalens:** grenen `testmiljo` →
   test.app.ekovilla.se, eget Supabase-projekt `ekovilla-crm-test`, Fortnox testbolaget 559341-9673.
   Lokalt räcker för det dagliga bygget, men test.partner.ekovilla.se kan inte nå ett CRM på localhost.
2. **Utkast, säljaren godkänner:** ett jobb från portalen blir en arbetsorder i `draft` hos rätt
   säljare, som får en notis. Portalen visar "Mottagen". När ordern finns i Fortnox skickas
   `job.confirmed`.
3. **Butiksbeställningar: väg B** i kontraktet, en egen tabell och ett eget `POST /orders`.
4. **Prislistan publiceras med en knapp i admin**, med giltighetsdatum. Varje publicering blir en ny
   lista i portalen.

---

## Del 1: Miljöerna

| Nivå | CRM:et | Portalen | Används till |
| --- | --- | --- | --- |
| Lokalt↔lokalt | `next dev` på :3000, Supabase 553xx | `DATA_SOURCE=supabase npm run dev -- -p 3001`, Supabase 543xx | Allt dagligt bygge. Båda apparna startar på 3000 som standard, så portalen flyttas till 3001 |
| Test | test.app.ekovilla.se (gren `testmiljo`), `ekovilla-crm-test`, Fortnox testbolaget | test.partner.ekovilla.se | Ände-till-ände på riktig Vercel, med riktig signatur och riktiga omförsök |
| Prod | app.ekovilla.se | partner.ekovilla.se | Koden går ut **mörk**. Utan `PORTAL_CRM_SHARED_SECRET` svarar portalens routes 503 och inget skickas |

### Testmiljön steg för steg

Inget av stegen skriver till prod. Den lokala `TEST_ENVIRONMENT_PLAN.md` (steg 4–6) har bakgrunden.

**T1. Spärren för utgående trafik, först och som egen PR.**
- `NODE_ENV` är `production` även i Vercels Preview. Då **kastar** `lib/email.ts` när Resend-nyckeln
  saknas, och sms och push kastar när de inte är konfigurerade.
- Ny `lib/env.ts` med `isProductionEnvironment()` = `VERCEL_ENV === 'production'`.
- Spärren läggs i transportlagret, `lib/email.ts`, `lib/sms.ts` och `lib/webPush.ts`, inte i
  anroparna. Utanför prod: mejl bara till `NONPROD_MAIL_ALLOWLIST`, sms och push loggas, och saknade
  nycklar ger "skipped" i stället för ett kast. Prods beteende ändras inte.
- Portalklienten får samma sorts spärr: utanför prod vägrar den skicka till `partner.ekovilla.se`, och
  i prod vägrar den allt annat.
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
- Vercel kör inga crons i Preview. Det hanteras i fas 4.

**T4. Fortnox.**
- En **separat Fortnox-app för testmiljön**, med redirect
  `https://test.app.ekovilla.se/api/fortnox/auth/callback` och samma scopes som prod. Då roterar den
  lokala kopplingen och testmiljöns inte varandras refresh-tokens.
- `FORTNOX_NONPROD_ALLOWED_ORG_NUMBERS=5593419673`. Spärren i `lib/domains/fortnox/connectionGuard.ts`
  räknar Preview som icke-prod och godtar då bara testbolaget.
- Koppla och synka artiklarna.
- **Lista 160 i testbolaget:** ett nytt skript, med samma spärrar och torrkörning som
  `scripts/fortnox/copy-articles-to-test-company.ts`, skapar prislistan 160 och dess priser. Källan är
  portalens handinlästa kopia, `lib/data/mock/seed.ts` i portalrepot (51 artiklar).
  ⚠️ Läs **aldrig** prods Fortnox från ett skript med prods tokens. En tokenförnyelse roterar
  refresh-token och kopplar ur prod.
- Testkunden "Testbygg AB" läggs upp i testbolaget och i CRM-testet. Dess kundnummer sätts på
  portalens testbutik.

**T5. Den delade hemligheten.**
- `PORTAL_CRM_SHARED_SECRET` genereras per miljö av William i egen terminal (`openssl rand -hex 32`)
  och läggs i båda Vercel-projekten, Preview för grenen `testmiljo`. Den skrivs aldrig i en chatt,
  en commit eller en logg.
- Lokalt: ett eget värde i CRM:ets `.env.development.local` och portalens `.env.local`, plus
  `RESELLER_PORTAL_URL=http://localhost:3001` i CRM:et och `EKOVILLA_CRM_URL=http://localhost:3000`
  i portalen.

**T6. Verifiera testmiljön.**
- Logga in på test.app.ekovilla.se med en testanvändare. Den finns bara i testprojektet, så lyckad
  inloggning bevisar rätt databas. Nätverksfliken ska visa testprojektets ref.
- Fortnox-kopplingen godtar bara testbolaget.
- En signerad ping går igenom åt båda hållen.

**Arbetssättet framåt:** en migrering går `npm run db:reset` lokalt → `supabase db push` mot test
(länkad) → `supabase db push --db-url "$PROD_DB_URL" --dry-run` och sedan skarpt mot prod.
`testmiljo` uppdateras genom att fast-forwardas till `main`, som i portalen.

---

## Del 2: Arkitekturen i CRM:et

### Domänen `lib/domains/portal/`

Ren logik som testas isolerat:

| Fil | Ansvar |
| --- | --- |
| `signature.ts` | HMAC-SHA256 över råkroppen. `timingSafeEqual` efter längdkontroll (den kastar vid olika längd). ±300 s. En tom eller kort hemlighet räknas som avstängd, alltså 503 |
| `config.ts` | Miljövariablerna och portalspärren |
| `client.ts` | Signerat anrop med `AbortSignal.timeout`, svaret klassat som 2xx, 4xx eller 5xx/timeout |
| `outbox.ts`, `idempotency.ts` | Utgående kö och inkommande svarscache |
| `pricelist.ts` | Prislistans payload |
| `jobIntake.ts` | Radmappning och snapshot för jobben |
| `assignment.ts`, `county.ts` | Fördelningen till en säljare |
| `jobState.ts` | Portalens tillstånd härlett ur arbetsordern och planeringen |

Det finns ingen HMAC-hjälpare, ingen idempotenstabell och ingen kö i CRM:et i dag. Fortnox-klienten
gör bara om vid 429 och har ingen timeout.

### Routes

- **Signerade, utan session**, under `app/api/portal/`: `jobs`, `jobs/[quoteId]/messages`,
  `store-orders`, `store-orders/[orderId]` (PUT), `store-orders/[orderId]/withdraw`, `ping`, och
  cron-routen `reconcile` (`CRON_SECRET`, jämförd i konstant tid).
- `middleware.ts` släpper prefixet `/api/portal/`. Middleware kör på Edge, så signaturen kontrolleras i
  routen: `runtime = 'nodejs'`, `req.text()` först, sedan `JSON.parse` och Zod `safeParse`.
- **Allt som kräver session ligger under `/api/crm/portal/`**: inställningar, publicering, svar till
  butiken, koppla kund och "skicka väntande". Då kan prefixet aldrig göra en sessionsroute publik.
- Ett vitest-vakttest går igenom `app/api/portal/**/route.ts` och kräver signatur- eller cronkontroll
  i varje route.
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
| `portal_idempotency_keys` | Nyckel, hash av kroppen, svaret. Bara en cache: dubbletter stoppas av affärsnycklarna nedan. Samma nyckel med en annan kropp ger 422 |
| `portal_outbound_events` | Utgående kö: unik nyckel, typ, osignerad kropp, status, antal försök, nästa försök, senaste fel |
| `crm_portal_resellers` | Portalens `resellerId` (butiken), namn, adress, `customer_id`, `seller_user_id`. Uppdateras vid varje inkommande anrop |
| `crm_portal_jobs` | `quote_id` (unik), `quote_number`, `reseller_id`, `work_order_id` (unik, `on delete set null`), kroppen, senast skickade tillstånd och när varje övergång först sågs |
| `crm_portal_job_messages` | Riktning, `portal_message_id` (unik), författare, text, tid |
| `crm_portal_article_fields` | Per artikelnummer: `customer_name`, `category` (check), `labor_share` (0–1), `note`, `sort_order`, `publish` |
| `crm_portal_pricelist_publications` | Varje publicering: giltig från, hash, kroppen, vem och när |
| `crm_store_orders` (+ rader) | Butiksbeställningarna, i fas 7 |

**Kön** hämtas med en RPC som använder `for update skip locked` och bara kan köras av service_role.
Den tar den **äldsta väntande händelsen per jobb**, så att händelserna för ett jobb kommer fram i
ordning, och en ny `job.scheduled` ersätter äldre väntande för samma jobb. Kroppen signeras vid varje
försök, eftersom signaturen bara gäller i 300 sekunder. PDF:er ligger i kön som referens, inte som
base64.

**Behörigheten:** en ny nyckel `crm.portal.manage` (admin) för portalens inställningssida, enligt
mallen `supabase/migrations/20260926122102_rbac_app_staff_key.sql`. `PERMISSION_KEYS` i
`lib/auth/permissions.ts` får nyckeln, och `tests/auth/permissions.test.ts` räknar 60 i stället för 59.
Artikelfälten redigeras under den befintliga `crm.article.manage`.

### Val som styrs av koden

**Arbetsordern skapas av en ny funktion.**
- `createStandaloneCrmWorkOrder()` passar inte: den tvingar tom radlista, kundens egen adress och
  `assigned_to = created_by`. `createCrmWorkOrderFromQuote()` kräver en vunnen offert i CRM:et.
- Den nya funktionen är idempotent och går att återuppta. Raden i `crm_portal_jobs` tas först, med
  ett förgenererat arbetsorder-id. Sedan skapas arbetsordern med det id:t, och `buildWorkOrderNumber`
  seedas med det. Ett omförsök fortsätter där det förra föll.
- `amount` och `pricing_summary` räknas med `lib/domains/crm/pricing.ts`, annars visar listorna 0 kr.

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
- Ordern skapas ändå, hos reservadmin, med butikens uppgifter i snapshoten.
- `reverse_vat` skrivs **inte** i snapshoten. Snapshotens värde vinner annars över kundkortet för
  alltid (`resolveReverseVat` i `lib/domains/fortnox/helpers.ts`).
- Ny route `POST /api/crm/portal/jobs/[id]/link-customer`, bara för portalutkast som inte finns i
  Fortnox. Den sätter kunden, bygger om snapshotens identitetsfält och momsen, och sparar kopplingen i
  `crm_portal_resellers`. I dag går det inte att byta kund på en arbetsorder, och Fortnox-pushen kastar
  utan kund.

**`confirmed` härleds ur tillståndet,** inte ur en knapp: `fortnox_order_number` är satt och ordern
är synkad. Att spara artiklar på ett utkast skapar också Fortnox-ordern
(`app/api/crm/work-orders/[id]/line-items/route.ts` → `updateWorkOrderInFortnox()` →
`pushWorkOrderToFortnox()`). `ekovillaOrderNumber` är Fortnox ordernummer, som butiken känner igen på
fakturan.

**Status tillbaka via avstämning, inte via krokar.**
- Arbetsorderns status skrivs från ett tiotal ställen: PATCH-routen, planeringens statusbyte, tre
  segmentroutes och tre fakturavägar. En missad krok ger tyst glidning, och framtida kod missar dem.
- `reconcilePortalJobs()` går igenom de öppna jobben (några dussin), härleder portalens tillstånd med
  en ren funktion och köar skillnaden mot det som senast skickades.
- `scheduledFor` = tidigaste `start_day` bland jobbets `ops_segments` som inte är `on_hold`. Att
  placera ett jobb i planeringen byter inte arbetsorderns status, så datumet måste komma därifrån.
- Aldrig `scheduled` före `confirmed`: utkast går att planera (`SCHEDULABLE_WORK_ORDER_STATUSES` i
  `lib/domains/planning/backlog.ts`).
- Ingen ändring i planeringens kod.

**Leveransen.**
- Säljarens routes köar bara, de väntar aldrig på portalen.
- Cron `/api/portal/reconcile` varje minut i prod gör avstämning och utskick.
- `waitUntil` ur `@vercel/functions` (ett litet nytt beroende) puffar utskicket direkt efter
  Fortnox-routen och svaret till butiken.
- I testmiljön finns ingen cron. Portalsidan får knappen "Stäm av och skicka nu".

**Meddelandena** ligger i en egen tabell och ett eget kort, "Butiken", på arbetsordern. De blandas
aldrig med de interna kommentarerna (`crm_work_order_comments`), så att inget internt kan läcka till
butiken.

---

## Del 3: Faserna

Små PR:er. Varje går ut mörk och går att stanna på.

| Fas | Innehåll | Kräver |
| --- | --- | --- |
| **0** | T1 (spärren, PR), sedan T2–T6 (konfiguration). Spikar i testbolaget: svarar `GET /3/prices/sublist/160` utan artikelnummer, och hur ser `FromQuantity` ut? Vad ger Nominatim för ISO-fält? | — |
| **1a** | `signature.ts` och `config.ts`, rena, med kontraktets exempel som fixturer | — |
| **1b** | Migreringen för idempotens, kö och kö-RPC (bara service_role). `idempotency.ts`, `outbox.ts`, `client.ts` | 1a |
| **1c** | Undantaget i middleware, signerad `ping`, vakttestet för `app/api/portal/**` | 1a |
| **2a** | `crm_portal_article_fields` och fälten på artikelsidan (`crm.article.manage`) | — |
| **2b** | Läsaren för lista 160 (bara `FromQuantity` 0, paginering, rate limit). Payloadbyggaren: enheten med gemener, en artikel utan enhet skickas inte, hashen byggs över sorterad JSON. Sidan Återförsäljarportalen (`crm.portal.manage`) med förhandsvisning och Publicera | 1b, 2a |
| **3a** | `crm_portal_resellers`, fördelningen, inställningarna butik → säljare och reservadmin | 1b |
| **3b** | `POST /api/portal/jobs`, skapandet av arbetsordern, notistypen `portal_job.received` (bygge i `lib/domains/notifications/payload.ts`, utskick med `deliverNotifications()`), brickan | 3a |
| **3c** | Koppla kund på ett portalutkast | 3b |
| **4** | `jobState.ts` och `reconcilePortalJobs()`, cron och utskick, puffen i Fortnox-routen, knappen i test | 1b, 3b |
| **5** | Meddelanden åt båda hållen och kortet "Butiken" | 4 |
| **6** | Dokumenten: orderbekräftelsen (`getFortnoxOrderPdf()`) efter bekräftelsen, egenkontrollen med en knapp. Storlekskontroll: base64 gör att en PDF får vara högst cirka 3,3 MB under Vercels 4,5 MB | 4 |
| **7** | Butiksbeställningar, väg B: intag med 409 efter bekräftelsen, sedan Fortnox (`buildOrderRows()`, fraktraden, momsen enligt beslutet), sedan status | Momsbeslutet |
| **8** | Prod, när portalens prodprojekt finns: hemligheten och `RESELLER_PORTAL_URL` i Production, första publiceringen, ett första riktigt jobb med en butik som vet om det | Allt ovan |

Stående regler: grenar heter `feature/…`, varje gren granskas före PR, merge med `--merge` efter
gröna kontroller, migreringarna är additiva och får gå före koden, `npm run lint` på varje ändrad
`.tsx`. Inga ändringar i `app/plannering/**` eller Blikks kod.

---

## Rättelser och luckor i kontraktet

Tas med till portalen och ändras i båda kopiorna av kontraktet.

1. **CRM:et har ingen pgTAP.** SQL vaktas med vitest-tester som läser migreringarna
   (`tests/supabase/*`) och med `supabase/checks/parity.sql`.
2. **De praktiska fälten** hamnar i `handoff_notes` och `end_contact_*`, inte som nycklar i
   `internal_handoff`.
3. **`job.scheduled`** kommer ur planeringen och kan flyttas eller tas bort. Portalen behöver tåla
   `scheduledFor: null`, "inte längre planerad".
4. **`ekovillaOrderNumber`** är Fortnox ordernummer.
5. **`job.invoiced`** skickas bara när faktureringen görs i CRM:et. Fakturerar någon direkt i Fortnox
   vet CRM:et inget om det.
6. **En avbruten eller borttagen arbetsorder** har ingen händelse än (kontraktets öppna fråga 5).
7. **`PUT store-orders`** behöver `updatedAt` i kroppen. Annars kan ett sent omförsök av en äldre
   ändring skriva över en nyare.
8. **`job.message.department`** behöver ett bestämt värde.
9. **Förslag:** `POST /api/ekovilla/ping` i portalen, så att CRM:et kan prova kopplingen från
   portalsidan.

## Öppna frågor

Ingen av dem stoppar fas 0–4.

- **Momsen** (kontraktets fråga 4). `reverse_vat` sitter på kunden och gäller alla kundens dokument,
  medan produkter normalt har vanlig moms. Blockerar fas 7 och ska vara besvarad före första riktiga
  jobbet i prod. Tas med ekonomi eller revisor.
- **Ett avbrutet jobb** (fråga 5): förslaget är en ny händelse `job.cancelled`.
- **Dokumenten** (fråga 7): förslaget är både orderbekräftelsen och egenkontrollen.
- **Att spara artiklar på ett portalutkast räknas som godkännande**, eftersom det skapar
  Fortnox-ordern. Förslaget är att acceptera det och säga det till säljarna.
- **Planeringens datumbekräftelse** föreslår kontakten på plats (`resolveDocumentContact()` i
  `lib/domains/crm/contacts.ts`), alltså butikens slutkund. Är det önskat?
- **Vem är reservadmin?**

---

## Verifiering

**Enhetstester** (vitest, `tests/portal/`):
- Signaturen: giltig, ändrad kropp, fel hemlighet, ±301 s, saknat `v1=`, tom hemlighet.
  Mutationstesta genom att tvinga jämförelsen till `true` och se testerna bli röda.
- Radmappningen och snapshoten, med kontraktets JSON-exempel som fixturer.
- Prislistans payload: enheterna, en artikel utan enhet, ören, stabil hash.
- Fördelningskedjan, steg för steg.
- `jobState.ts` tabelldrivet: `on_hold`, flera etapper, borttagna segment, `partially_invoiced` skickar
  inget, steg bakåt.
- Kön: 5xx och timeout görs om, 4xx ger upp, tre snabba flyttar blir en händelse.

**Lokalt↔lokalt:**
- Publicera prislistan två gånger: samma nyckel, samma svar.
- Samma jobb från portalen två gånger ger en arbetsorder. Samma `quoteId` med en ny nyckel ger den
  befintliga.

**I testmiljön, hela vägen:**
1. Testbygg AB skickar ett jobb på test.partner.ekovilla.se, och rätt säljare får en notis.
2. Säljaren skickar ordern till Fortnox testbolaget. `YourOrderNumber` är offertnumret, priserna är
   `unitCost` och det finns ingen ROT.
3. Portalen visar Bekräftad, sedan Planerad med datum, Utförd och Fakturerad.
4. Ett meddelande går åt båda hållen.
5. En butiksbeställning går att ändra före bekräftelsen och ger 409 efter.

**Prod, mörk:** `/api/portal/ping` svarar 503 utan hemlighet, och `/api/crm/*` utan session svarar
fortfarande 401.

**Varje kod-PR:** `npm run type-check`, `npm run lint`, `npm run build` (inte medan dev-servern kör),
`npm test` och `npm run db:reset`.
