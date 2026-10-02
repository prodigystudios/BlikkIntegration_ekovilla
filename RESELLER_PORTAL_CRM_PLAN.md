# Återförsäljarportalen: CRM:ets genomförandeplan och testmiljön

**Status:** fas 0–8 byggda och fas 5 klar. 10a byggs 2026-10-01; 10b och fas 9 återstår. Skriven 2026-09-27, läst mot CRM:et @ `2cea02c`, uppdaterad samma
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
  🧨 **Så var det (2026-09-30):** i `ekovilla-crm-test` fick `service_role` ingenting på nya objekt i `public`
  (prod och lokalt: allt). Efterkontrollen i `20260926134651_default_privileges_closed.sql` stoppade pushen. Filen
  grantar nu `service_role` uttryckligen; i prod och lokalt är det en no-op. Baslinjen bär prods grants per objekt,
  men förutsätter plattformens `usage on schema public` för API-rollerna — kontrollera den också.
  🧨 **Kedjan gick inte att bygga från noll:** `20260927080615_rls_read_policies_app_keys.sql` kräver nyckeln
  `crm.access`, som bara fanns som data (seeden kommer efter kedjan). Filen lägger nu in nyckeln själv (prods
  beskrivning, `on conflict do nothing`). Hela kedjan + seeden prövad i en tom databas med ett nytt projekts
  standard: alla 24 migreringar och seeden går igenom, och paritetskontrollen skiljer sig från den lokala bara i
  buckets och två identitetssekvenser (ofarligt, står i `supabase/checks/parity.sql`).
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

✅ **Löst 2026-09-30 (William: "kör på ditt förslag").** Lösningen är en lista över tillåtna databaser, inte prods värd
i koden. `isPortalDatabaseAllowed` i `lib/domains/portal/config.ts` kräver utanför prod att varje satt databasadress
(`SUPABASE_URL` och `NEXT_PUBLIC_SUPABASE_URL`) pekar på den här datorn eller testprojektet `TEST_DATABASE_HOST`
(`aquwuqnqzuxljzkfoinn.supabase.co`). Spärren gäller åt båda hållen:
- **Utåt:** `resolvePortalTarget` ger `wrong_environment`. Kön skickas då inte, prislistan köas inte och
  inställningssidan visar skälet.
- **Bakgrundsarbetet:** `runPortalCron` kör inget steg. "Skicka väntande nu" svarar 409 med skälet.
- **Inåt:** grinden i `app/api/portal/_shared.ts` svarar 503 `portal_not_configured`, som när integrationen är av.
  Det prövas efter signaturen, så bara portalens egna anrop loggas. Portalen försöker igen, och orsaken står bara i
  vår logg.

Ingen adress alls betyder ingen databas och alltså ingen kö; det nekas inte. Prod prövas inte.

**Känt, med flit:** köandet i användarens egna åtgärder, som ett svar till butiken eller ett dokument, spärras inte.
Med fel databas skriver varje åtgärd i appen till fel databas, också mot Fortnox, och det fångar T3 och T6. T6 är
inloggningen med en testanvändare som bara finns i testprojektet.

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
| `jobState.ts` ✅ | Portalens tillstånd härlett ur arbetsordern |
| `jobDocuments.ts` ✅, `jobDocumentsStore.ts` ✅, `jobDocumentsDecision.ts` ✅, `outboundContent.ts` ✅ | Dokumenten (fas 7). Den rena delen (sorterna, gränsen, filnamnet, köns händelse med en referens till filen, egenkontrollens prov mot orderns nummer) importeras av kortet och får aldrig dra in zod, databasen eller `node:crypto`. Frysningen, knappen, kortets läsning, "Öppna" och cron-sopningen ligger i `…Store.ts`; regeln "det senast beslutade vinner" i `…Decision.ts`; utskickets byte av referensen mot filens base64 i `outboundContent.ts` |
| `storeOrders.ts` ✅, `storeOrderIntake.ts` ✅, `storeOrdersStore.ts` ✅, `storeOrdersView.ts` ✅ | Butiksbeställningarna (fas 8). Den rena delen (statusarna, summorna i hela ören, notisens sammanfattning och regeln för vilken notis som gäller) importeras av sidorna och får aldrig dra in zod eller databasen. Kroppens schema och besluten om en ny, ändrad och tillbakadragen står i `storeOrderIntake.ts`; intaget, notisen med lån och cron-sopningen i `…Store.ts`; sidornas läsning med sessionen i `…View.ts` |
| `storeOrderState.ts` ✅, `storeOrderSync.ts` ✅ | Butiksbeställningens läge hos portalen (fas 8b3), härlett ur raden: vilka `store_order.*` som ska köas. Den rena delen bygger varje händelse helt ur raden, så att samma rad alltid ger samma nyckel och kropp; omräkningen mot databasen köar först och sparar läget sedan, villkorat på markeringen |
| `jobMessages.ts` ✅, `jobMessagesStore.ts` ✅ | Meddelandena (fas 6). Den rena delen (avdelningarna, `job.message`-kroppen och dess nyckel, tecken räknade som Postgres räknar dem) importeras av kortet "Butiken" och får aldrig dra in zod eller databasen. Intaget från portalen, notisen, svaret, trådens läsning och cron-sopningen ligger i `…Store.ts` |

Det finns ingen HMAC-hjälpare, ingen idempotenstabell och ingen kö i CRM:et i dag. Fortnox-klienten
gör bara om vid 429 och har ingen timeout.

### Routes

- **Signerade, utan session**, under `app/api/portal/`: `jobs`, `jobs/[quoteId]/messages`,
  `store-orders`, `store-orders/[orderId]` (PUT), `store-orders/[orderId]/withdraw` och `ping`.
- ✅ **Cron-routen `GET /api/reseller-portal/cron`** (fas 4b) ligger UTANFÖR `/api/portal/`: där kräver vakttestet
  portalens signatur, och Vercels cron kan inte signera. Grinden är `CRON_SECRET`, jämförd i konstant tid; middleware
  släpper exakt den sökvägen. 🧨 `fetchCache = 'force-no-store'`: en route med bara GET cachar annars varje fetch i
  Next 14, också supabase-js (se "Fas 4b: resultat").
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
| `crm_work_orders` (nya kolumner) ✅ | `planned_start_day`, `planned_end_day`, som bara databasen skriver (se "Planerat datum") |
| `portal_idempotency_keys` | Nyckel, hash av kroppen, svaret. Bara en cache: dubbletter stoppas av affärsnycklarna nedan. Samma nyckel med en annan kropp ger 422 |
| `portal_outbound_events` | Utgående kö: unik nyckel, typ, osignerad kropp, status, antal försök, nästa försök, senaste fel |
| `crm_portal_resellers` ✅ | Portalens `resellerId` (butiken), namn, adress, kundnumret portalen skickade, `customer_id`, `seller_user_id`, första och senaste kontakten. Läggs till och uppdateras av intaget (service-rollen, fas 3b). Sessionen ändrar bara säljaren (kolumngrant) |
| `crm_portal_settings` ✅ | En enda rad: reserven (`fallback_user_id`) |
| `crm_portal_jobs` ✅ | `quote_id` (nyckel), `quote_number`, `reseller_id`, `store_name`, kunden och den som fick jobbet, `reserved_work_order_id` (valt före arbetsordern), `work_order_id` (unik, samma som den reserverade, `on delete set null`) och `work_order_created_at`, kroppen, och när notiserna skickades. Sessionen läser bara brickans fyra kolumner och `quote_id` (kolumngrant). Fas 4b ✅: markeringen `sync_requested_at`, det senast köade läget `sync_state`, `sync_pending_events`, `sync_version`, `synced_at` och Fortnox-omförsöken (`fortnox_next_attempt_at`, `fortnox_attempts`, `fortnox_retry_until`) |
| `crm_portal_job_messages` ✅ | `quote_id` (FK till jobbet), riktning (`from_store`/`to_store`), `message_id` (unik per riktning: portalens id eller vårt), författarens namn när det skrevs och `author_user_id` (svar), avdelning (svar), text, `sent_at`, `created_at` (trådens ordning), härledd `outbound_key` (`job.message-<id>`), och markeringarna `queued_at`, `notify_claimed_at` (lånet) och `notified_at`, som bara service_role ser. Sessionen läser trådens kolumner och lägger till svar i eget namn (kolumngrant + RLS), men ändrar eller tar aldrig bort något. Vem som får svara står en gång, i `crm_portal_job_message_can_reply()` (invoker), som policyn och kortet delar. Skild från `crm_work_order_comments` |
| `crm_portal_job_documents` ✅ | Dokumenten till butiken (fas 7): `quote_id` (FK till jobbet), sort, läge (`building`/`ready`/`failed`), namnet butiken ser, storlek och sha256 för den frysta filen, källan (Fortnox-nr eller egenkontrollens sökväg), skälet när det inte gick, lånet och omförsöken (`attempts`, `next_attempt_at`), vem som skickade och namnet då (null = automatiskt), `ready_at` (händelsens tid), `queued_at` och härledd `outbound_key` (`job.document-<id>`). En automatisk orderbekräftelse per jobb (unikt index). Sessionen läser visningskolumnerna och lägger till ett beslut i eget namn genom svarsregeln; filen, hashen och kön är service-rollens. PDF:en fryses i den privata bucketen `portal-job-documents` (3 300 000 byte, bara PDF, inga policyer) |
| `crm_portal_article_fields` ✅ | Per artikelnummer: `customer_name`, `category` (check), `labor_share` (0–1, `numeric(4,3)` som portalens kolumn), `note`, `sort_order`, `publish`. En publicerad artikel kräver kundnamn och kategori. Ingen FK mot cachen, som favoriterna. Ifylld med portalens 51 artiklar (se "Fas 2a: resultat") |
| `crm_portal_pricelist_publications` ✅ | Varje publicering: giltig från, hash, löpnummer, Idempotency-Key (samma som händelsen i kön), kroppen, antalet artiklar, vem (id och namnet vid publiceringen) och när. Historik: sessionen får select och insert i eget namn, aldrig update eller delete. En tom lista kan inte sparas |
| `crm_store_orders` ✅ | Butiksbeställningarna (fas 8a): portalens `order_id` (unik), numret, butiken, kunden och den ansvarige (med namnet då), status (`received`, `withdrawn`, `confirmed`, `delivered`, `invoiced`, `cancelled`), den första kroppen som den kom (`intake_payload`, ändras aldrig) och den senast mottagna tolkade versionen (`payload`, med raderna), `store_version` och `portal_updated_at`, notisens lån och bokföring, och kolumnerna för 8b (frakten, bekräftelsen, Fortnox-ordern och fakturan med claim och omförsök, leveransen, makuleringen, utskickets markering). Raderna ligger i `payload`, som `line_items` på arbetsordern: en ändring är en enda villkorad UPDATE. Vakten `crm_store_orders_guard` låter statusen bara gå framåt, stänger innehållet och frakten efter bekräftelsen, skriver Fortnox-numren en gång och markerar raden för utskicket. Sessionen läser visningskolumnerna med `crm.access` och skriver aldrig; `crm_store_order_can_manage()` (invoker) säger vem som hanterar: den ansvarige och admin, med `crm.workorder.write` |

**Kön** hämtas med en RPC som använder `for update skip locked` och bara kan köras av service_role.
Den tar den **äldsta väntande händelsen per jobb**, så att händelserna för ett jobb kommer fram i
ordning, och en ny `job.scheduled` ersätter äldre väntande för samma jobb. Kroppen signeras vid varje
försök, eftersom signaturen bara gäller i 300 sekunder. ✅ PDF:er ligger i kön som referens, inte som
base64 (fas 7): kroppen bär `contentRef { documentId, sha256, bytes }`, och utskicket byter den mot filens base64 vid varje
försök (`outboundContent.ts`). Dokument använder inte `supersedeKey` (se "Fas 7: resultat").

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
- ~~`reverse_vat` skrivs **inte** i snapshoten.~~ **Ändrat 2026-09-29:** varje portaljobb har omvänd byggmoms, 0 %,
  och snapshoten bär `reverse_vat: true` med eller utan kort (`PORTAL_JOB_VAT` i `jobIntake.ts`). Att snapshoten vinner
  över kortet är nu avsikten.
- **Ett kort som inte är ett företag räknas som inget kort** (ändrat 2026-09-29, `readCustomer` i `jobIntakeStore.ts`),
  vare sig numret eller kopplingen för hand pekar på det: butiken är ett företag, kopplingen (3c) nekar ett sådant kort,
  och omvänd byggmoms gäller aldrig en privatperson. Ordern tas emot utan kund, och säljaren kopplar rätt kort.
- ✅ `POST /api/crm/portal/jobs/[workOrderId]/link-customer` (fas 3c), bara för portalordrar utan kund som
  inte finns i Fortnox. Den sätter kunden, bygger om snapshotens identitetsfält och momsen, sparar
  kopplingen i `crm_portal_resellers` och skapar Fortnox-ordern. Se "Fas 3c: resultat".

### Planerat datum (alla arbetsordrar) ✅

Byggt i fas 4a; beslut, prövning och det 4b behöver står i "Fas 4a: resultat".

- Två nya kolumner på `crm_work_orders`: `planned_start_day` och `planned_end_day`.
- **Definition:** första `start_day` och sista `end_day` bland arbetsorderns `ops_segments` som inte
  är `on_hold`. Ett endagsjobb har samma dag i båda. Båda är tomma när inget kort ligger kvar, eller
  när alla är pausade.
- **Bara databasen skriver dem:** triggern `ops_segments_sync_planned_days` räknar om arbetsorderns
  datum vid insert, delete och update av `work_order_id`, `start_day`, `end_day` eller `on_hold`, och
  skriver bara när datumen faktiskt ändras. Vakten `crm_work_orders_guard_planned_days` vägrar varje
  annan skrivning, från sessionen och service-rollen. Schemat är fortfarande sanningen, och fälten kan
  inte glida isär från det, oavsett vilken kodväg som flyttar ett kort.
- **Det här reviderar en princip från planering v2**, "det som ligger på schemat bor i `ops_segments`,
  aldrig på arbetsordern". Kopian är skrivskyddad, så principens skäl gäller fortfarande.
- **En dragning ändrar inte arbetsorderns `updated_at`** (William 2026-09-28): `updated_at` betyder
  "någon sparade ordern", och 3c:s koppling använder den som krockkontroll.
- Visas bara på arbetsorderns faktakort, under önskat datum (William 2026-09-28). Egenkontrollens
  uppslag av "planerad dag" läser fältet.

### Status tillbaka till portalen ✅

Byggt i fas 4b; beslut, prövning och det portalen behöver står i "Fas 4b: resultat".

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
- ✅ **Butiksbeställningarna** (fas 8b3) på samma sätt: vakten `crm_store_orders_guard` markerar, `storeOrderSync.ts`
  räknar om i samma cron-varv, och `store_order.*` går i en egen kö per beställning. Se "Fas 8b3: resultat".

### Dokumenten ✅

Byggt i fas 7; beslut, prövning och det portalen behöver står i "Fas 7: resultat".

Orderbekräftelsen går automatiskt en gång när butiken fått bekräftelsen, och sedan med knappen; egenkontrollen med
knappen. Båda i kortet "Butiken". PDF:en fryses en gång, så att samma nyckel alltid ger samma byte, och det senast
beslutade dokumentet av varje sort vinner.

### Meddelanden ✅

Byggt i fas 6; beslut, prövning och det portalen behöver står i "Fas 6: resultat".

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
| **4a** ✅ | Planerat datum på alla arbetsordrar: kolumnerna, triggern, ifyllnaden, visningen. Fristående från portalen. Beteendet prövas mot en databas med `supabase/checks/work_order_planned_days.sql`. Resultaten står under tabellen | — |
| **4b** ✅ | Status tillbaka: markeringen, `jobState.ts`, cron-routen och utskicket, omförsöken av Fortnox-pushen. Från 1b: en uppgiven händelse håller inte kvar resten av jobbets kö, så "planerad" köas först när "bekräftad" är LEVERERAD (inte bara köad). Portalsidan visar uppgivna händelser (404, 403, 409 m.fl.) och kan skicka om dem. Beteendet prövas mot en databas med `supabase/checks/portal_job_status.sql`. Resultaten står under tabellen | 1b, 3b, 4a |
| **5** ✅ | Testmiljön, T1–T6 i Del 1. När jobb in och status tillbaka fungerar lokalt, före första externa testare. Resultaten står under tabellen | 4b |
| **6** ✅ | Meddelanden åt båda hållen och kortet "Butiken": `POST /api/portal/jobs/{quoteId}/messages`, notisen `portal_job.message`, svaret som `job.message` direkt efter att det sparats och inte vid nästa cron. Beteendet prövas mot en databas med `supabase/checks/portal_job_messages.sql`. Resultaten står under tabellen | 4b |
| **7** ✅ | Dokumenten: orderbekräftelsen (`getFortnoxOrderPdf()`) automatiskt efter bekräftelsen och sedan med knappen, egenkontrollen med knappen, i kortet "Butiken". PDF:en fryses i en privat bucket och kön bär en referens. Storlekskontroll: högst 3 300 000 byte före base64, under Vercels 4,5 MB. Beteendet prövas mot en databas med `supabase/checks/portal_job_documents.sql`. Resultaten står under tabellen | 4b, 6 |
| **8a** ✅ | Butiksbeställningar, väg B, intaget: `crm_store_orders` med vakten, `POST`/`PUT`/`withdraw` under `/api/portal/store-orders`, 409 bara efter bekräftelsen, notisen till den ansvarige, sidorna (lista och en beställning, läsläge). Beteendet prövas mot en databas med `supabase/checks/portal_store_orders.sql`. Resultaten står under tabellen | Momsbeslutet |
| **8b1** ✅ | Ekovillas steg före bekräftelsen: koppla kund, frakten, Bekräfta med Fortnox-ordern (`buildOrderRows()`, 25 %) och dess omförsök. Ingen migrering. Resultaten står under tabellen | 8a |
| **8b2** ✅ | Levererad, Fakturera, Makulera, med svepet som makulerar kvarlämnade Fortnox-ordrar. Ingen migrering. Resultaten står under tabellen | 8b1 |
| **8b3** ✅ | Statusen tillbaka (`store_order.*`), i två grenar: den rena tillståndsberäkningen (`storeOrderState.ts`), sedan omräkningen mot databasen, cron-steget, "Skicka om" och utskicksfliken (`storeOrderSync.ts`). Ingen migrering. Prövad hela vägen mot den riktiga lokala portalen. Resultaten står under tabellen | 8b2 |
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
2. Kortets del av snapshoten byts (namn, org.nr, adress), och beloppet räknas om. Momsen är jobbets, 0 % och
   `reverse_vat: true`, vad kortet än säger (ändrat 2026-09-29; förut kortets). Kontakten och Er
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

### Fas 4a: resultat (2026-09-28)

**Williams beslut:**
- **En dragning ändrar inte arbetsorderns `updated_at`.** `updated_at` betyder "någon sparade ordern". Annars hade en
  dragning mitt i en koppling av butikens kund (3c, krockkontroll på `updated_at`) gett 409 `portal_job_changed`.
  `set_timestamp_crm_work_orders` lämnar den orörd när BARA `planned_*` ändrats; resten av raden jämförs. En sparning
  som inte ändrar något bumpar den fortfarande, som förut.
- **Vakttrigger, inte kolumngrants.** `crm_work_orders_guard_planned_days` vägrar (42501) varje ändring av datumen
  som inte kommer från tabellens ägare, alltså schemats trigger och migreringarna, också från service-rollen. En ny
  order har dem tomma. Grants på `crm_work_orders` rördes inte.
- **Visas bara på arbetsorderns faktakort**, under "Önskat installationsdatum": "12–14 okt. 2026", "30 sep. – 2 okt.
  2026" eller "Ej inplanerad". I redigeringsläget som text bredvid datumfältet, med "Följer korten i planeringen".
  Listan, kundkortet och fältvyn visar som förut önskat datum. Fältvyns rubrik säger fortfarande
  "Planerad <önskat datum>".

**Så fungerar triggern** (`20260928122049_work_order_planned_days.sql`):
- `security definer` med tomt `search_path`, ägd av tabellernas ägare, ingen EXECUTE för någon roll. En säljare får
  flytta alla kort (`planning.schedule.write`), men RLS på `crm_work_orders` släpper bara den ansvariga och admin: som
  invoker hade en flytt av en kollegas kort uppdaterat 0 rader utan fel. PostgREST exponerar inte funktionen (PGRST202).
- Ordern låses med `for no key update` innan datumen räknas, och räkningen görs i ett eget steg. Utan låset skrev
  två samtidiga flyttar på samma order ett gammalt värde (prövat: 5 okt i stället för 1 okt). Med `for update` låste två
  nya kort varandra, eftersom FK-kontrollen håller FOR KEY SHARE (prövat: deadlock). Kvar: raderas en order i samma
  sekund som någon flyttar ett av dess kort kan Postgres avbryta den ena; den görs om.
- Ordningen på dagen, jobbtypen, arbetsbeskrivningen och bekräftelserna rör aldrig ordern, och inte heller ett kort
  som läggs eller flyttas inom perioden.
- Kaskaden: när ordern raderas finns ingen order att låsa, och triggern gör ingenting. Ett kort som byter order räknar
  om båda. Platshållare räknas aldrig.
- Engångsifyllnaden körs i migreringen efter triggrarna, rör inte `updated_at`, och efterkontrollen räknar om varje
  order och avbryter pushen om något inte stämmer.

**Granskningen** (code-review high) fann två låsordningar som kunde ge deadlock, båda lagade:
- Migreringen låser `ops_segments` först. Tog den ordern först (ALTER TABLE) och korten sist (CREATE TRIGGER) låste den
  och ett kort som lades under pushen varandra (prövat med en långsam migrering: deadlock, pushen avbruten). Låset står
  i ett `do`-block: `supabase db push` kör filen utan transaktionsblock, och där vägrar `LOCK TABLE` (prövat). Filen
  körs ändå som en enda transaktion (prövat: ett fel i sista satsen rullade tillbaka den första).
- Ett kort som byter order låser båda ordrarna i id-ordning. Appen byter aldrig order på ett kort i dag.
Avfärdat: att vakten släpper varje funktion som tabellens ägare äger (en sådan funktion är en granskad migrering), att
faktakortet inte uppdateras live (samma som resten av sidan; ordern ligger inte i realtime), och att egenkontrollen
inte räknar pausade kort (beslutad definition).

**Egenkontrollen** (`lookupCrmWorkOrderByNumber`) läser `planned_start_day` i stället för sitt eget uppslag i
`ops_segments`, en fråga mindre. Skillnaden: ett pausat kort ger inte längre egenkontrollens datum. Svaret har samma form
(`scheduled_day`), så `projectSource.ts` är oförändrad.

⚠️ `SUPABASE_CONVENTIONS.md` säger "Keep `security definer` functions out of exposed schemas". Triggerfunktionen ligger
i `public` som de fem befintliga security definer-triggrarna (t.ex. `assign_offert_number`): repot har inget privat
schema, och en triggerfunktion går inte att anropa via PostgREST.

**Prövat:**
- Migreringen i en tom tillfällig databas med stubbar, tre körningar; 24 mutationer av databasen, var och en fångad av
  efterkontrollen. Lokalt två gånger i en transaktion som rullades tillbaka, sedan `supabase migration up`.
- `supabase/checks/work_order_planned_days.sql` med riktiga sessioner (13 steg), och 15 mutationer av funktionerna och
  triggrarna, var och en röd på rätt steg. 25 mutationer av koden och migreringstexten röda i vitest.
- Samtidigheten med två anslutningar i den tillfälliga databasen: två flyttar, två nya kort, och FK-låset före.
  Utan låset och med `for update` blev provet rött.
- I webbläsaren (headless, dev-servern på :3002): säljaren lade kort på en order som admin har, genom planeringens
  routes. Faktakortet visade "12–14 okt. 2026", en andra etapp gav "12–21 okt. 2026", en flytt gav "30 sep. – 21 okt.
  2026", en paus gav "20–21 okt. 2026", och `updated_at` stod kvar. Egenkontrollens uppslag gav 2026-10-20. Admin
  sparade önskat datum (updated_at bumpades, datumen stod kvar), och när korten togs bort stod det "Ej inplanerad".
  Ingen sidledsscroll på telefonbredd.

**Ordningen till prod:** migreringen FÖRE koden. Koden läser kolumnerna, så en deploy utan migreringen ger 500 på
arbetsordrarna.

**Till fas 4b:**
- `updated_at` säger inget om datumen. Markeringen "behöver synkas" ska vara en trigger på `crm_work_orders` som
  jämför `planned_start_day`/`planned_end_day` (och status, Fortnox-numret), som planen redan säger.
- `job.scheduled` med `scheduledFor` = `planned_start_day` och förslaget `scheduledUntil` = `planned_end_day`
  (punkt 5). Ett pausat sista kort ger null, alltså "inte längre planerad".

### Fas 4b: resultat (2026-09-28)

**Williams beslut:**
- **Bara framåt.** När Utförd eller Fakturerad köats skickas inget tidigare läge igen, och inga fler datum. En order som
  ångras från "Fakturera" till "Pågående" syns som Utförd hos butiken. "Inte längre planerad" (sista kortet borttaget
  eller pausat) skickas fram till Utförd, som beslutat i punkt 4.
- **`job.cancelled` nu**, `{ quoteId, reason: "", cancelledAt }`, när arbetsordern får status Avbruten eller raderas.
  Bara före Utförd, och efter den skickas ingenting mer. Kontraktstillägg, punkt 20 nedan.
- **Fortnox-omförsök bara efter tekniska fel** (Fortnox nere, anslutningen ute, en process som dog): efter 5 min,
  15 min, 1 h och sedan varje timme i 24 h, med kontrollerna före varje försök. Stoppar kontrollerna (något saknas på
  kundkortet) försöker den aldrig. Säljaren fick notisen vid första felet och får ingen ny per försök.
- **Visningen bara på portalsidan**: fliken "Utskick" med uppgivna och väntande händelser, felet och "Skicka om".
  Antalet som gett upp står på fliken. Ingen notis, inget på arbetsordern.

**Granskningen** (code-review high) fann tio saker, alla lagade:
- En avbruten order kunde få en Fortnox-order av ett omförsök. Nu hoppas den över, och omförsöken tar slut.
- "Skicka om" räknade inte en senare händelse som själv gett upp: av två uppgivna prislistor kunde den äldre skickas och
  ge butikerna de gamla priserna. Nu räknas allt senare utom en ersatt planerad dag.
- Ett varv till för en notis kunde pusha ett stoppat jobb om kortet rättats under tiden. Nu får ett stoppat jobb aldrig
  ett nytt varv.
- En koppling av kund mer än 24 h efter intaget fick inga omförsök. Nu börjar ett fel utan aktivt fönster ett nytt.
- **Delfakturerad räknas som utförd** när "Utförd" inte redan skickats. Första delfaktureringen kräver "Fakturera"
  (`partialInvoices.ts`), så ordern har varit utförd; annars hade butikens läge berott på om ett cron-varv hann se det
  korta "Fakturera". Delfakturerad har fortfarande inget eget läge hos butiken.
- Jobb som väntar på att "bekräftad" levereras flyttas sist i kön varje varv, så att de inte tränger undan nya.
- Knapparna ("Skicka väntande nu", "Skicka om") kör inga Fortnox-försök; de hör hemma i cron.
- Fliken läser uppgivna och väntande var för sig, så att en lång kö aldrig trycker ut en uppgiven, och "kan skickas om"
  prövas per rad (inte mot en lista som PostgREST kapar vid 1000).
- Utförd-dagen är aldrig senare än fakturadagen.

**Egna val som William inte sa emot:** cron-routen utanför `/api/portal/`; `ekovillaOrderNumber` = Fortnox-numret;
`scheduledUntil` = planerad slutdag; `completedAt` = den svenska dag CRM:et såg statusen (ingen tidsstämpel finns);
`invoicedAt` = den svenska dagen ur `fortnox_invoiced_at`; `confirmedAt` ur `fortnox_order_synced_at`, i UTC med `Z`.

**Så fungerar det** (`20260928134853_portal_job_status.sql`, `lib/domains/portal/{jobState,jobSync,jobFortnoxRetry,
cron,cronAuth,outboxView}.ts`):
- **Databasen markerar.** `crm_work_orders_mark_portal_job` (AFTER-trigger, security definer, tomt `search_path`, ingen
  EXECUTE) sätter `sync_requested_at` när en portalorder byter status, planerat datum (fas 4a:s trigger) eller
  Fortnox-nummer, och när den raderas. Den markerar på `reserved_work_order_id`, eftersom `work_order_id` nollas vid
  raderingen. Som invoker hade den fällt säljarens statusbyte helt (prövat: permission denied).
- **TypeScript räknar.** `derivePortalJobEvents` (ren) jämför ordern med det senast köade läget. Omräkningen sparar det
  nya läget och händelserna i en skrivning (`sync_pending_events`, krockkontroll på `sync_version`) och köar sedan, så en
  krasch mitt i varken tappar eller dubblerar en händelse. Markeringen nollas bara om ingen ny ändring kommit under tiden
  och "bekräftad" inte väntar på leverans.
- **Cron varje minut** (`vercel.json`): omräkning → utskick → (om något levererades) omräkning och utskick igen, så att
  "planerad" följer "bekräftad" i samma körning → Fortnox-omförsöken sist, inom 150 s. "Skicka väntande nu" kör samma
  varv. Testmiljön har ingen cron (Vercel kör cron bara i produktion); där är knappen det som skickar.
- **Fortnox-omförsöken**: när arbetsordern skapas sätts ett skyddsnät (ett försök om 5 min). Uppföljningen bokför sitt
  utfall och tar bort nätet när det inte behövs; ett nytt varv om 5 min också när en notis inte gick fram. Kopplingen av
  kund (3c) bokför sitt Fortnox-utfall på samma sätt. Varje försök tas med ett lån (10 min), så två körningar aldrig gör
  samma push.
- **"Skicka om"** bara för den senaste händelsen för sin nyckel: en gammal job.scheduled efter en levererad job.completed
  hade flyttat butiken bakåt, och en gammal prislista efter en nyare hade ersatt den nyare. En bekräftelse som skickas om
  markerar jobbet, så att resten följer.

🧨 **Next 14 cachar fetch i en route med bara GET** (också supabase-js POST med `Authorization`), trots
`dynamic = 'force-dynamic'`: routen får `revalidate = false`, och då blir det "auto cache". Lokalt fick claim-anropet
samma svar om och om igen, och fem händelser skickades varje körning. `fetchCache = 'force-no-store'` i cron-routen, med
ett test som vaktar raden. De två gamla cron-routerna klarar sig för att de också har POST, och routes som läser kakan
för att `cookies()` sätter `revalidate = 0`.

**Prövat:**
- Migreringen i en tom tillfällig databas med stubbar, fyra körningar; 20 mutationer av databasen, var och en stoppad av
  efterkontrollen. Lokalt två gånger i en transaktion som rullades tillbaka, sedan `supabase migration up`.
- `supabase/checks/portal_job_status.sql` med riktiga sessioner (7 steg): säljaren byter status, planeringens kort
  (också genom fas 4a:s trigger), Fortnox-numret, en vanlig order, läsningen, raderingen. 9 mutationer, alla röda.
- 33 mutationer av koden och migreringstexten, alla röda i vitest (med "Tests N"). En överlevde först (fakturadagen
  prövades samma dag som "nu"), och testet skärptes. Efter granskningen 16 till (de nya skydden och de omriktade),
  alla röda.
- Lokalt mot en fejkportal som kontrollerar signaturen (:3101), med cron-routen och `CRON_SECRET`: fem job.confirmed
  (Fortnox-order 22–26); ett kort gav "Planerad 12–14 okt", en flytt "20–21 okt", en ny ordning ingenting, borttaget
  "inte längre planerad", ett nytt kort "22 okt" i båda, "Fakturera" job.completed; en flytt och Pågående efter det
  ingenting; en avbruten order job.cancelled som fejkportalen nekade (404), fliken visade "Utskick 1" och raden med felet,
  "Skicka om" levererade den och fliken blev tom. Efter granskningen samma sak igen, och med två uppgivna för samma jobb
  hade bara den senaste "Skicka om". Fortnox-omförsöket på en order som redan fanns i Fortnox tog bort
  nätet; ett utgånget fönster gavs upp utan försök. Telefonbredd utan sidledsscroll.

⚠️ **Lokalt kvar:** fejkportalens logg, två kort på AO-20260928-B99B61 (q-lokal-3b-1, nu Utförd hos "portalen" och
status Pågående), AO-20260928-D90E8A (q-lokal-3b-2) är Avbruten.

**Till portalen** (rättelselistan, punkt 20–23): mottagaren `POST /api/ekovilla/events` med job.confirmed, job.scheduled
(med `scheduledUntil` och `scheduledFor: null`), job.completed, job.invoiced och job.cancelled.

### Fas 6: resultat (2026-09-28)

**Williams beslut:**
- **Avdelningen väljs vid svaret**: Försäljning, Planering eller Ekonomi, förvalt Försäljning. Ingen roll motsvarar
  Planering, så den kan inte härledas.
- **Notisen när butiken skriver** går till arbetsorderns ansvarige nu, och till reserven när ordern saknar en:
  "Meddelande från <butik>" och "<namn>: <början av meddelandet>", med länk till arbetsordern.
- **Svara får den som har ordern och admin**, samma personer som får redigera arbetsordern och koppla kund. Ett skickat
  svar är slutgiltigt, eftersom portalen sparar det en gång per `messageId`.
- **Kortet "Butiken" sitter överst i sidokolumnen**, med "Syns för butiken". Tråden läses av alla som ser ordern
  (säljare, admin, konsult och ekonomi i läsvyn). Svarsfältet visas bara för den som får svara, och fältvyn ser inget.
- **Kantfallen:** okänt jobb 404, arbetsordern skapas just nu 503, borttagen arbetsorder 409. En avbruten, utförd eller
  fakturerad order tar emot meddelanden som vanligt.

**Egna val som William inte sa emot:**
- Svarets `Idempotency-Key` är `job.message-<messageId>` (punkt 24). `messageId` är en uuid som klienten ger utkastet,
  så att ett dubbelklick eller ett omförsök blir samma svar och inte två.
- Svaret skickas direkt EFTER att routen svarat: utskicket (`dispatchPortalOutbox`) körs i `waitUntil`, och bara när
  svaret fortfarande väntar i kön. En upprepning av ett levererat svar startar ingenting. Knappen väntar alltså aldrig
  på portalen eller på andra jobbs händelser. Kortet läser om efter 3 och 10 s, och säger till med en notis på skärmen
  om svaret gavs upp. Kön är per jobb, så ett svar kommer aldrig före en tidigare händelse för samma jobb.
- Tråden visas i den ordning meddelandena kom fram (`created_at`), med avsändarens tid utskriven. Portalens klocka och
  ett sent omförsök därifrån hade annars kunnat lägga ett meddelande före ett svar som skrevs efter det.
- Samma `messageId` med ett annat innehåll (text, namn, tid eller jobb) ger 409 `message_conflict`.
- Namn och text trimmas och räknas i tecken som Postgres räknar dem, alltså kodpunkter: 5000 emoji går igenom.
- Kortet läser om tråden varje minut medan fliken syns, och när fönstret får fokus.

**Så fungerar det** (`20260928151026_portal_job_messages.sql`, `lib/domains/portal/{jobMessages,jobMessagesStore}.ts`,
`app/api/portal/jobs/[quoteId]/messages`, `app/api/crm/portal/jobs/[workOrderId]/messages`,
`WorkOrderPortalMessagesCard.tsx`):
- **In:** grinden och svarscachen, Zod och kontrollen av nolltecken, sedan jobbet (finns det, och har det kvar sin
  arbetsorder?). Meddelandet sparas en gång per `messageId` (unik per riktning). Notisen skickas efter svaret, med ett
  **lån** (`notify_claimed_at`, fem minuter). `notified_at` sätts först när notisen har gått iväg. Faller utskicket
  släpps lånet, och dör processen går det ut. I båda fallen gör cron om den: hellre en notis för mycket än en som
  tappas. Ett nytt anrop för samma meddelande gör också om en notis som föll.
- **Ut:** sessionen sparar svaret. Insert-policyn släpper, genom svarsregeln, bara den som har ordern eller en admin
  med `crm.workorder.write`, i eget namn och bara åt butiken. `sent_at` sätter databasen. Service-rollen köar kroppen
  byggd ur den **sparade raden** och bokför `queued_at`. Routen skickar sedan kön efter svaret. Kortet frågar
  svarsregeln om svarsfältet ska visas, och svarar den inte visas tråden ändå, utan svarsfält. Svarens status i kön läser servern med service-rollen, bara `status` och bara
  för svaren sessionen själv kunde läsa. Kön fick ingen ny läspolicy, eftersom en sådan hade gett varje läsare hela
  raden, med portalens feltext och kroppen.
- **Cron** (`sweepPortalJobMessages`, före utskicket): ett svar som sparats men inte köats köas (äldre än en minut,
  yngre än en vecka), och en notis som inte gick iväg görs om (äldre än två minuter, yngre än ett dygn, utan lån eller
  med utgånget lån). Ett lån som ännu gäller tar ingen plats i omgången. De två halvorna är oberoende, så ett fel i den
  ena stoppar inte den andra.
- **Skilt från de interna kommentarerna:** egen tabell, egna routes och eget kort. Ett vakttest kräver att ingen av
  meddelandenas filer läser eller skriver `crm_work_order_comments`, och att ingen av kommentarernas filer rör
  meddelandena. Kontrollen prövar att inget meddelande blev en kommentar.

**Granskningen** (code-review high) fann tio saker. Nio är lagade, och den tionde var bara en kommentar:
- Notisen kunde tappas om processen dog mellan markeringen och utskicket. Nu finns ett lån, och `notified_at` sätts
  efter utskicket.
- Utskicket gjordes inne i användarens klick, över hela kön och utan omräkningen. Nu körs portalens varv efter svaret.
- Ett fel i sopningens första halva stoppade den andra.
- En check i databasen (23514) gav 500 i stället för 400 på svaret.
- Kortet kunde läsa in två gånger samtidigt, och ett gammalt svar kunde ta bort ett nyss skickat ur tråden. Nu finns
  ett löpnummer och en läsning i taget.
- Utkastets id skapades vid varje tangenttryckning.
- Köns läspolicy gav varje läsare hela raden. Den är borttagen, och servern läser bara status.
- Svarsregeln stod både i TypeScript och i SQL. Nu står den i en funktion som båda använder.
- Tråden sorterades på avsändarens klocka. Nu sorteras den på när meddelandet togs emot.
- GET-grinden (`crm.workorder.read`) är densamma som arbetsordersidan kräver. Kommentaren är rättad.

**Den andra granskningen** (high, av rättelserna) fann nio saker. Sju är lagade:
- Varje svar startade hela portalvarvet, också en upprepning av ett levererat svar. Nu körs bara utskicket, och bara
  när svaret väntar.
- Ett fel i svarsregeln stoppade hela tråden.
- Ett uppgivet svar syntes bara i tråden. Nu kommer också en notis på skärmen.
- Ett skickat svar kastade en pågående omläsning utan att läsa om.
- Sopningen lade platser på aktiva lån.
- Timerlistan i kortet växte.
- Klar-markeringen loggar när lånet tagits över (en dubblett, med flit).

Två lämnades:
- Migreringen ändrades på plats. Den har bara körts lokalt, där den lades in på nytt.
- Tre databasanrop i stället för ett när lånet tas.

**Prövat:**
- Migreringen i en tom tillfällig databas med stubbar, två körningar, och 21 mutationer av efterkontrollen. Varje
  mutation stoppades av sitt eget meddelande. Lokalt kördes den två gånger i en transaktion som rullades tillbaka, och
  sedan med `supabase migration up`.
- `supabase/checks/portal_job_messages.sql` med riktiga sessioner (admin, säljare, konsult, ekonomi, montör, anon),
  bland annat svarsregeln per roll, och 32 mutationer av databasen. Alla gav rött utom en, med flit: policyns
  `direction = 'to_store'` överlappar tabellens check (butikens meddelande har ingen svarare). Tas båda bort blir
  kontrollen röd. Kontrollen av anon mot svarsregeln fångade först fel nej (tabellen i stället för funktionen) och är
  skärpt.
- 75 mutationer av koden. Alla gav rött i vitest, med "Tests N". En överlevde först: en notis som skickats för mer än
  fem minuter sedan hade skickats igen utan villkoret `notified_at is null`. Testet finns nu.
- Lokalt mot en fejkportal på :3101 som kontrollerar signaturen:
  - Butikens meddelanden: 201. En upprepning med en ny nyckel gav samma rad och ingen ny notis, ett annat innehåll
    gav 409 och ett okänt jobb 404.
  - Notisen gick till den ansvarige, och till admin på den avbrutna ordern.
- I webbläsaren (headless Playwright):
  - Säljaren svarade med Planering, och fejkportalen fick en signerad `job.message` direkt.
  - "Kom inte fram till butiken" när portalen nekade med 404.
  - Någon annans order visade inget svarsfält.
  - Ekonomi och konsult läste tråden utan svarsfält.
  - Admin svarade på en avbruten order.
  - Telefonbredd utan sidledsscroll.

⚠️ **Lokalt kvar:**
- Butikens meddelanden och våra svar på q-lokal-3b-1, -3b-2 och -3b-3, och tre notiser.
- Fyra `job.message` i kön. De två för q-lokal-3b-3 är uppgivna, eftersom fejkportalen nekade dem.
- Migreringen lades in lokalt två gånger, eftersom granskningen ändrade den före push. Den första versionen togs bort
  (tabellen, köns policy och raden i migreringshistoriken).

**Till portalen** (rättelselistan, punkt 24–27): kontraktets `job.message`-nyckel, svaren på butikens meddelande, hur
tecknen räknas, och att en avbruten order tar emot meddelanden. Vår kopia av kontraktet
(`RESELLER_PORTAL_INTEGRATION_PLAN.md`) är synkad med portalens `CRM_INTEGRATION.md` @ `f2a7984` och är ordagrann.
Punkterna 24–27 står därför bara här, tills portalen för in dem.

### Fas 7: resultat (2026-09-28)

**Williams beslut:**
- **Orderbekräftelsen i vår egen design** (`getFortnoxOrderPdf()`, `ORDER_PDF_MODE`), automatiskt EN gång när
  `job.confirmed` är levererad. Ändras ordern skickar den som har ordern, eller en admin, en ny med knappen.
- **Egenkontrollen med en knapp** i kortet "Butiken". Knappen syns när en egenkontroll finns och bekräftelsen är
  levererad, oavsett orderns status. Samma personer som svarar butiken (svarsregeln).
- **Ett avbrutet eller borttaget jobb får inga dokument.**
- **Arbetsordern visar per sort den senaste versionen:** namn, när, av vem eller "automatiskt", och Skickas, Skickad, Kom
  inte fram eller Ersatt. "Öppna" visar exakt den PDF butiken fick.
- **Filnamnet:** "Orderbekräftelse <Fortnox-nr> – <arbetsplats>.pdf" och "Egenkontroll <Fortnox-nr> – <arbetsplats>.pdf".
- **Migreringen har `set lock_timeout = '5s'`.**

**Egna val som William inte sa emot:**
- **PDF:en fryses en gång** i den privata bucketen `portal-job-documents/<quoteId>/<id>.pdf`, och kön bär en referens med
  hashen. Utskicket hämtar filen, kontrollerar storleken, `%PDF-` och sha256, och bygger kroppen i fast ordning vid varje
  försök. Samma nyckel ger alltid samma byte. pdf-lib stämplar tiden, så en ny rendering hade gett andra byte, och
  portalen svarar 422 på det. Kön och portalsidan bär aldrig filen.
- **Idempotency-Key är `job.document-<dokument-id>`**, som `job.message-<id>` (punkt 24). `occurredAt` är när filen
  frystes.
- **Egenkontrollen hämtas ur arkivet** genom länken i just den här orderns kommentarer. Filnamnet måste sluta på orderns
  Fortnox- eller AO-nummer, och samma namnfunktion används av egenkontrollens sida (`lib/domains/egenkontroll/filename.ts`).
  Klienten skickar bara sökvägen den visade, och den jämförs bara med den som servern själv hittar.
- **ROT:** orderbekräftelsen till en butik nekas om ordern har ROT, eftersom den då skriver ut ett personnummer. Provet står
  i `getFortnoxOrderPdf({ refuseRot })`, på samma läsning som renderingen, och offerten läses strikt: ett läsfel stänger.
- **Tidsgränsen** är 30 s per dokumentanrop (10 s för övriga).

**Så fungerar det** (`20260928163644_portal_job_documents.sql`,
`lib/domains/portal/{jobDocuments,jobDocumentsStore,jobDocumentsDecision,outboundContent}.ts`,
`app/api/crm/portal/jobs/[workOrderId]/documents`, `WorkOrderPortalDocuments.tsx`):
- **Tre lägen:** `building` (beslutat), `ready` (fryst) och `failed` (med skälet). Sessionen lägger till beslutet i eget
  namn (RLS: svarsregeln). Service-rollen hämtar PDF:en, fryser den och köar. En köad rad ändras aldrig mer.
- **Automatiken** körs i cron, efter utskicket. Den tar jobb vars `job.confirmed` levererats senaste veckan (hela fönstret,
  i sidor) och som saknar en orderbekräftelse: en automatisk, eller en manuell som byggs eller är fryst.
  - Ett beslut per jobb (unikt index) och ett lån på tio minuter.
  - Tre byggen per varv, ett från knapparna på portalsidan.
  - Fortnox nere: nya försök efter 5 min, 15 min och sedan varje timme, i ett dygn.
  - Har någon skickat en med knappen under tiden görs inget.
- **Det senast beslutade frysta dokumentet vinner** (`jobDocumentsDecision.ts`):
  - Utskicket prövar precis före sändningen och hoppar över ett dokument som ett senare ersatt.
  - Köandet sållar bort en äldre som frystes sent, och ersätter äldre beslut som ännu väntar.
  - Dokumenten använder inte köns `supersedeKey`. Den ersätter i den ordning händelserna kom, och en äldre som köades sent
    hade då ersatt en nyare.
  - Ett fryst dokument som inte kom fram räknas ändå som det senaste. Kortet säger "Kom inte fram till butiken. Skicka en
    ny.", och knappen köar alltid ett nytt beslut. Portalsidans "Skicka om" kan nekas när jobbet har senare händelser.
- **Storleken** prövas när filen fryses, av bucketens gräns och vid varje utskick. En för stor PDF köas aldrig, och kortet
  säger hur stor den är ("Egenkontrollen är 4,1 MB. Butiken kan ta emot högst 3,3 MB."). Fotona i en egenkontroll får vara
  2 MB var, så det kan hända.
- **Cron städar:** en knapptryckning som inte blivit en fil på tio minuter blir misslyckad. En fryst fil som inte hann köas
  köas, eller bokförs om den redan låg i kön.

**Granskningarna** (code-review high, fem rundor; varje runda granskade den förras rättelser):
- **Första:**
  - den senast beslutade vinner (en äldre som frystes sent hade ersatt en nyare);
  - ingen automatisk när en manuell redan skickats;
  - ROT via offertens reserv;
  - knapparnas 180 s;
  - egenkontrollens namn delat med sidan, och arkivets reservnamn;
  - kortet vid köfel;
  - `filename*` (RFC 5987).
- **Andra:**
  - prövningen flyttad till utskicket (kapplöpning mellan provet och köandet);
  - ROT i renderingen;
  - ett bygge per klick;
  - fönstret i sidor och de befintliga i omgångar (1000 rader);
  - en kund vars namn rensas bort helt.
- **Tredje:**
  - en manuell som bara byggs stoppar inte automatiken;
  - ersättning i beslutsordning;
  - en köad men inte bokförd rad markeras aldrig misslyckad;
  - offerten läses strikt;
  - fönstret läser bara köns nyckel.
- **Fjärde och femte:** regeln förenklad och gjord lika på alla tre ställen (se ovan), och räkningen av vad ett varv
  gjorde.
- **Lämnat:** push-vägarna i `orders.ts` behandlar ett läsfel på offerten som "ingen offert". Det är befintligt beteende,
  utanför fas 7, och hör hemma i en egen liten PR.

**Prövat:**
- **Migreringen:**
  - i en tom tillfällig databas med stubbar (`storage.buckets` och `storage.objects`, svarsregeln): två körningar och 26
    mutationer av efterkontrollen, var och en stoppad av sitt eget meddelande;
  - lokalt två gånger i en transaktion som rullades tillbaka, och sedan med `supabase migration up`.
- **`supabase/checks/portal_job_documents.sql`** med riktiga sessioner (admin, säljare, konsult, ekonomi, montör, anon).
  Varje nej måste vara rätt nej (grant, RLS eller rätt check, genom `sqlerrm`). 29 mutationer av databasen, alla röda med
  sitt eget meddelande.
- **Koden:** över 120 mutationer i fem rundor, alla röda i vitest med "Tests N". De som först överlevde var dubbletter,
  som togs bort, eller luckor i testerna, som fylldes.
- **Lokalt mot en fejkportal på :3101**, som prövar signaturen, portalens idempotens (samma nyckel med andra byte ger 422),
  strikt base64, `%PDF-` och storleken:
  - fyra automatiska orderbekräftelser (tre i första varvet, en i nästa), och ingen till det avbrutna jobbet;
  - den mottagna PDF:en var byte för byte samma som den frysta;
  - en som nekades (409) syns som "Kom inte fram";
  - portalen svarade aldrig 422.
- **I webbläsaren** (headless Playwright):
  - säljaren ser den automatiska, öppnar exakt den skickade kopian, skickar egenkontrollen (samma byte som i arkivet) och
    en ny orderbekräftelse;
  - ett dubbelklick blir ett dokument;
  - en för stor egenkontroll säger hur stor den är;
  - en annan orders egenkontroll märks och får ingen knapp;
  - ekonomi (läsvyn) och konsult läser utan knappar;
  - admin ser "avbrutet" och får skicka på säljarens order;
  - telefonbredd utan sidledsscroll.

⚠️ **Lokalt kvar:**
- automatiska och manuella dokument på q-lokal-3b-1, -3b-3, -3c-1 och -3c-2;
- egenkontroller i arkivet (`Egenkontroller/Egenkontroll_Ronnvagen_18_22*.pdf` och `Egenkontroll_Annan_kund_999.pdf`), med
  kommentarer på 3b-1 och 3b-3;
- filer i `portal-job-documents`;
- en uppgiven `job.document` för 3c-2 (fejkportalen nekade).

**Till portalen:** punkt 28–30.

### Fas 8: spiken om momsen (2026-09-29)

Prövat i Fortnox testbolaget med kund 14 (Boli, `SEREVERSEDVAT`) och kund 15 (SEHED, `SEVAT`). Spikdokumenten står kvar i
testbolaget: ordrar 27–31 och fakturor 14–18, alla obokförda.

- `VATType` finns inte på dokumenten: Fortnox nekar fältet (2001399 "Felaktigt fältnamn") på ordern och på fakturan, vid
  POST och PUT, som på offerten. Momstypen sitter bara på kundkortet.
- Radmoms 25 % till en kund med omvänd moms godtas och följer med `createinvoice` (rätt moms i kronor). **Men kontot och
  fakturatexten följer kundkortet:** raden bokförs på 3231 (försäljning med omvänd skattskyldighet), och Fortnox egen
  fakturautskrift skriver "Omvänd betalningsskyldighet" bredvid 25 % moms. Åt andra hållet, 0 % till en kund med vanlig
  moms, blir kontot 3004 (momsfri försäljning) och texten saknas.
- `AccountNumber: 3001` per rad godtas, ärvs positionellt vid en PUT utan fältet och följer med till fakturan, men
  fakturatexten står kvar.
- Orderbekräftelsen i Fortnox skriver ingen sådan text, och inte heller vår egen PDF-design (den följer `TotalVAT`).

**Williams beslut (2026-09-29):** momsen **som i CRM:et i dag**, per dokument: en butiksbeställning har 25 % (butiken är
slutkund), också frakten; ett portaljobb (arbete åt butiken mot en annan slutkund) har 0 % på hela ordern. Ingen spärr:
materialordrar till kunder med omvänd moms får i dag sin moms för hand på samma sätt.
Portaljobbets 0 % oavsett kort byggs i 8b eller en egen liten PR.

**Rättat samma dag (William, efter #258): kontot per rad.** "Konto blir fel vid moms-ordrar." Varje rad i varje dokument
(offert, order, delfaktura, och därmed butiksbeställningarna) bär nu `AccountNumber` efter dokumentets moms: moms → 3001
("3001 ska det vara när det är moms"; Etableringskostnad 1010 → 3017), omvänd byggmoms → 3231, 0 % utan omvänd moms →
3004 (`fortnoxSalesAccount` i `lib/domains/fortnox/helpers.ts`). ⚠️ Ett konto som saknas i kontoplanen fäller hela pushen
("Kunde inte hitta konto 3017", 2001303); 3017 lades upp i testbolaget 2026-09-29. Egen PR före 8b. Fakturatexten tas senare (William: "inte lika viktig som att siffrorna
går in på rätt konto").

Spik 2 i testbolaget (2026-09-29, kund 14 vänd till SEVAT en stund och tillbaka; ordrar 32–35, offerter 33–35, fakturor
19–21):
- **Dokumentet tar kortets momstyp när det skapas**, och `createorder`/`createinvoice` ärver den. Den styr fakturatexten
  och kontona på raderna som skapas med dokumentet. Kortet som ändras efteråt rör inte dokumentet.
- **En rad som läggs till vid en PUT tar kontot ur det levande kortet**, och en rad som finns kvar ärver sitt konto.
  `AccountNumber: null` ger konto 0. Därför kontot på varje rad, varje gång.
- `VatType` nekas som `VATType` (2001399).

Följder av kontot per rad:
- ⚠️ **Kontot följer `reverseVat`** (snapshoten, annars kundkortet), inte procentsatsen ensam. Portaljobbets 0 % oavsett
  kort sätter därför omvänd moms på dokumentet (✅ 2026-09-29, `PORTAL_JOB_VAT`; prövat: ett jobb till SEHED med
  vanlig moms på kortet blev order 36 i testbolaget, alla rader 0 % och 3231).
- **Öppna ordrar som synkades före ändringen behåller sina konton** tills de synkas om ("Synka om" eller en
  artikelredigering); `createinvoice` kopierar orderns rader som de står.
- CRM:et känner bara svensk moms: kundsynken skriver alltid SEVAT eller SEREVERSEDVAT på kortet. EU- och exportkonton
  väljs aldrig av oss.

### Fas 8a: resultat (2026-09-29)

**Williams beslut** (2026-09-29, "kör på förslagen"):
- En egen sida "Butiksbeställningar" i CRM:et, med en lista och en sida per beställning. Menyposten läggs till när
  integrationen slås på: menyn delas av hela appen (`AppSidebar.tsx`), och en ändring där rör det flöde som redan är
  aktivt. Till dess nås sidan från notisen och adressen `/crm/butiksbestallningar`.
- Se: alla med `crm.access`. Bekräfta, frakt, leverans, faktura och makulering (8b): den ansvarige och admin. Ekonomi får
  ingen vy nu.
- Notisen till den ansvarige, annars reserven: "Ny beställning från <butik>", "<butik> ändrade B-…", "<butik> drog
  tillbaka B-…", med "B-2026-003 · 2 rader · 4 414 kr exkl. moms · Vecka 41".
- Till 8b: frakten som artikel 1050 FRAKT (finns i prod, inte i testbolaget), pris från säljaren, antal 1, och bekräftelsen
  kräver en fraktrad eller "Ingen frakt"; Fortnox-ordern skapas vid Bekräfta; Levererad med en knapp (datum), Fakturerad
  med knappen Fakturera (`createinvoice`, en faktura som redan finns i Fortnox bokförs bara); makulering med ett skäl som
  butiken ser, bara före Levererad, och Fortnox-ordern makuleras först; `ekovillaOrderNumber` är Fortnox-numret; Ekovilla
  ändrar aldrig butikens rader.

**Egna val som William inte sa emot:**
- Raderna ligger i beställningens `payload` (jsonb), inte i en egen tabell: en ändring blir en enda villkorad UPDATE, och
  ingen kan läsa halva ändringar. Det är samma form som `line_items` på arbetsordern.
- `intake_payload` är den första kroppen som den kom (jämförs med en upprepning), `payload` den tolkade senaste versionen
  (trimmad, tomt kundnummer som null), som visas och blir Fortnox-ordern.
- Samma orderId med en annan första kropp ger 409 `store_order_conflict`, som jobbens `job_conflict`. En upprepning av
  POST jämförs alltid med den FÖRSTA kroppen, också när beställningen ändrats sedan.
- En ändring eller tillbakadragning av en makulerad eller redan tillbakadragen beställning ger 200 `ignored`, aldrig 409:
  portalen läser varje 409 på en ändring som "Ekovilla hann bekräfta" och hade visat fel. En annan butik eller ett annat
  nummer än beställningens ger 400 `store_order_mismatch`.
- **En beställning skriver aldrig över en befintlig butik**, bara dess senaste kontakt (`last_seen_at`): portalen fryser
  kroppen och håller beställningarna i kö tills integrationen slås på, så en beställning som är ny för CRM:et kan bära
  veckogamla uppgifter om butiken. Bara jobben uppdaterar butiken. En butik som hör av sig första gången med en
  beställning läggs till, med kortet som numret pekar på.
- **Kunden** räknas med jobbens regel (numret, annars kopplingen för hand) när beställningen kommer, och igen när en
  ändring kommer till en beställning utan kund. En kund som redan står på beställningen byts aldrig av butiken, och en
  som kopplats för hand medan ändringen sparas skrivs inte över.
- Fördelningen är jobbens utan länet: butikens säljare, kundansvarig, reserven.
- **En tillbakadragning ger alltid en notis**, också när ingen notis är bokförd: bokföringen kan ha fallit efter att
  "Ny beställning" kom fram.
- **Reserven får bara notisen om den kan skriva arbetsordrar** (fördelningens krav). Finns ingen mottagare står lånet
  kvar och notisen görs om efter fem minuter, så att en reserv som väljs under tiden får den.
- **Beloppen räknas i heltalsören**, och schemat kräver hela ören (högst två decimaler), som kontraktet säger.

**Så fungerar det** (`20260929065116_portal_store_orders.sql`, `lib/domains/portal/{storeOrders,storeOrderIntake,
storeOrdersStore,storeOrdersView}.ts`, `app/api/portal/store-orders/**`, `app/crm/butiksbestallningar/**`):
- **In:** grinden och svarscachen, `parsePortalBody` (JSON, nolltecken, Zod), orderId i kroppen måste vara sökvägens.
  Ny: sparas en gång per orderId. Ändrad: bara om mottagen och `updatedAt` strikt nyare, i en UPDATE som också kräver
  samma status och version som lästes; en samtidig ändring eller bekräftelse gör att beslutet tas om (högst tre gånger).
  Tillbakadragen: bara från mottagen.
- **Vakten** i databasen är skyddet som inte beror på koden: statusen bara framåt (mottagen → tillbakadragen,
  bekräftad eller makulerad; bekräftad → levererad eller makulerad; levererad → fakturerad), innehållet, versionen och
  frakten bara medan beställningen är mottagen, kunden byts bara före bekräftelsen (ett borttaget kort nollar den),
  identiteten och den första kroppen aldrig, Fortnox-numren en gång. Checkar: bekräftad kräver fraktbeslut, levererad
  kräver Fortnox-ordern, fakturerad kräver fakturanumret, makulerad kräver ett skäl.
- **Notisen:** vilken som gäller räknas ur raden (`v<version>` eller `withdrawn`), skickas med ett lån på fem minuter
  och bokförs först efter utskicket. Cron gör om det som inte gick iväg (äldre än två minuter, högst 20 per varv).
- **Sidorna** läser med sessionen. Listan läser alla pågående (att bekräfta, leverera, fakturera) sida för sida med nyckel,
  och de 500 senast mottagna av de avslutade; bara raderna och önskad leverans ur kroppen. Beställningssidan
  (`StoreOrderDetail.tsx`) visar kunden beställningen är kopplad till bredvid portalens kundnummer. Tiderna formateras på
  servern i svensk tid. Summan räknas ur butikens rader i heltalsören, aldrig ur butikens `costTotal`.
- **Svarscachen:** ett 404 `unknown_order` sparas inte (`cacheable: false`), så att samma nyckel körs igen när
  beställningen kommit fram; tillbakadragningens nyckel är fast. Samma sak för meddelandenas 404 `unknown_job` (fas 6).
- **Cron:** notiserna görs om efter utskicket, inom varvets startgräns och en egen tidsbudget (20 s, 5 s från knapparna),
  och frågorna efter nya och tillbakadragna som inte sagts är exakta.

🧨 **Next 14.2: en route med bara PUT cachar varje fetch** (`hasNonStaticMethods` räknar POST två gånger och glömmer
PUT). Ändringens route läste radens första version om och om igen och gav upp med 500 vid andra ändringen. Rättat med
`fetchCache = 'force-no-store'`, och vakttestet (`routeGuards.test.ts`) kräver raden för varje portalroute utan POST,
DELETE, PATCH och OPTIONS. Övriga PUT-routes i appen läser kakan (dynamiska) eller sätter `no-store` själva.

**Granskningarna** (code-review high, elva rundor; varje runda granskade den förras rättelser, och den elfte fann inget
nytt av vikt):
- **Första:** 404 i svarscachen (tillbakadragningens fasta nyckel), kunden vid en ändring, cron läste de 500 äldsta och hela
  kroppen, en notis utan mottagare gjordes om varje minut, summorna i sidan, jobbens routes med `parsePortalBody`, butikens
  schema delat.
- **Andra:** listan tappade äldre obekräftade, listan läste hela kroppen, exakt fråga efter nya som aldrig meddelats,
  sidans tider ur etiketter, databasens feltext till användaren.
- **Tredje:** beställningssidans fel, kunden på sidan, leveransdagen i svensk form, `isUuid`.
- **Fjärde:** en veckogammal beställning skrev över butiken, bekräftade och levererade kunde försvinna ur listan,
  förskjutning i stället för nyckel, notiserna före utskicket, tunn sida.
- **Femte:** en tillbakadragning bokfördes tyst fast "Ny" kommit fram, notiserna utan tidsbudget, gränsen plus en.
- **Sjätte:** lånet släpptes inte vid ett läsfel, meddelandenas 404 i svarscachen.
- **Sjunde:** halva ören, en upprepning som föll på kundläsningen, butikens senaste kontakt, dubbletter mellan läsningarna.
- **Åttonde:** vakten stängde inte butikens namn och ändringstiden efter bekräftelsen (migreringen ändrad på plats),
  notiserna efter varvets startgräns, en notis utan mottagare gavs upp för gott, reservens behörighet.
- **Nionde:** den ansvarige fick notisen utan behörighetskontroll (nu samma regel som reserven), notiserna efter
  dokumenten.
- **Tionde:** öresumman kunde gå över 2^53 vid schemats gränser (tak på priset), ett skriv för en ny butik, primitiverna
  `ErrorState`/`EmptyState`.
- **Elfte:** inget nytt av vikt. Nycklarnas namnrymd går till portalen (punkt 35).
- **Lämnat, med skäl:** reservens och kundnumrets uppslag och notisens lån finns i kopior hos jobben och meddelandena (en
  delad funktion hade rört fas 3b:s och 6:s prövade kod; egen PR), listan räknar summan ur raderna (i SQL hade
  öresregeln dubblerats), en äldre ändring efter en fryst första kropp (portalen skickar bara den senaste ändringen),
  vakten markerar också butikens tillbakadragning för utskicket (8b räknar fram "inget att skicka" och tar bort
  markeringen), `no-store` i hela Supabase-klienten (rör varje route, alltså det aktiva flödet; föreslaget till William).

**Prövat:**
- **Migreringen:** i en tom tillfällig databas med stubbar, två körningar, och 21 mutationer av efterkontrollen, var och
  en stoppad av sitt eget meddelande (en första runda var ogiltig: min kontroll av triggerns kolumner föll också på den
  omuterade, rättad); lokalt två gånger i en transaktion som rullades tillbaka, sedan `supabase migration up`. Efter
  åttonde granskningen ändrades vakten på plats (namnet och ändringstiden), prövades om på samma sätt och lades lokalt
  in genom att köra den idempotenta filen igen (versionen var redan registrerad).
- **`supabase/checks/portal_store_orders.sql`** med riktiga sessioner (admin, säljare, konsult, ekonomi, montör, anon):
  läsningen, de dolda kolumnerna, regeln per roll och vakten. 44 mutationer av databasen, alla röda med sitt eget
  meddelande (fem behövde först skärpta prov, där en annan spärr hann säga nej före den som prövades).
- **Koden:** över 130 mutationer i nio omgångar, alla röda i vitest med "Tests N". De som först överlevde var luckor i
  testerna (updatedAt utan millisekunder, summan med flyttalsfel, frågan efter ändringar, "kapad" utan obekräftade, en
  upprepning som läste kunden), och testerna finns nu. En var likvärdig: länet stängs av två gånger (deps och tom adress).
- **Lokalt** med en signerad avsändare: ny 201, upprepning ur cachen, ny nyckel 201 (samma), annan första kropp 409;
  ändring med samma, äldre och nyare `updatedAt` (ignored, ignored, updated); tillbakadragen 200 två gånger; ändring av en
  tillbakadragen ignored; okänd 404; bekräftad 409 på ändring och tillbakadragning; en notis per version; cron gjorde om
  en missad notis.
- **I webbläsaren** (headless Playwright): listan börjar på Att bekräfta, urvalen räknar rätt, beställningens läge,
  ändringar, meddelande och frakt; en tillbakadragen säger att den inte ska levereras; konsulten läser; ekonomi och
  utloggad når inte sidan; telefonbredd utan sidledsscroll.

⚠️ **Lokalt kvar:** butiksbeställningarna so-lokal-8-1 (mottagen, version 3), so-lokal-8-2 (tillbakadragen),
so-lokal-8-3 (satt till bekräftad för hand, utan Fortnox-order), so-lokal-8-4 (kunden kopplad vid en ändring) och
so-lokal-8-5, butiken res-lokal-8 och notiserna.

**Till portalen** (punkt 31–34 nedan).

Stående regler: grenar heter `feature/…`, varje gren granskas före PR, merge med `--merge` efter
gröna kontroller, migreringarna är additiva och får gå före koden, `npm run lint` på varje ändrad
`.tsx`. Inga ändringar i `app/plannering/**` eller Blikks kod. Portalens ordrar planeras bara i nya
planeringen (`/crm/planering`); gamla `/plannering` hämtar sina jobb från Blikk och ser dem inte.

### Fas 8b1: resultat (2026-09-29)

**Williams beslut:** Bekräfta låser beställningen först och skapar Fortnox-ordern sedan ("Ja du kan köra", 2026-09-29):
en Fortnox-order skapas aldrig för en version som butiken hunnit ändra. Butiken får "bekräftad" (8b3) först när numret
finns, eftersom kontraktet kräver det.

**Så fungerar det** (`lib/domains/portal/{storeOrderFortnox,storeOrderActions}.ts`,
`app/api/crm/portal/store-orders/[id]/{freight,customer,confirm,fortnox}`, `app/crm/butiksbestallningar/[id]/StoreOrderActions.tsx`):
- **Vem:** `crm.workorder.write`, en beställning som sessionen ser och `crm_store_order_can_manage()` (den ansvarige
  eller admin), samma regel som sidan frågar om kortet "Bekräfta beställningen" ska visas.
- **Kunden:** ett företagskort med kundnummer i Fortnox, läst med sessionen. Kom beställningen utan kund sparas
  kopplingen också på butiken (som 3c); ett byte gäller bara beställningen.
- **Frakten:** artikel 1050 med säljarens pris (högst två decimaler), eller Ingen frakt.
- **Bekräfta** jämför det säljaren såg: butikens version, frakten (sparad när) och kunden. En ändring som butiken eller
  någon annan hos Ekovilla gjort efter att sidan lästes bekräftas aldrig (409 `store_order_changed` /
  `store_order_changed_here`). Knappen är spärrad medan ett steg har en osparad ändring. Låset är en villkorad UPDATE
  som också sätter skyddsnätet (ett försök om 5 min, i 24 h).
- **Fortnox-ordern:** arbetsorderns radbyggare, 25 % och konto 3001, textraden "Butiksbeställning B-…  Leverans: …
  Mottagare: …", butikens meddelande i `Comments` (intern). Fortnox gränser uppmätta i testbolaget: Er referens över 50
  tecken nekar ordern, Ert ordernummer (30), leveransadressen (60) och textraden (255) kapas tyst, `Comments` tar 1024.
  Vi kapar själva och lägger det som inte ryms i textraden.
- 🧨 **Aldrig två ordrar:** /orders har ingen dubblettspärr. Ordern märks med `crm-store-order:<id>` i
  `ExternalInvoiceReference1` (skrivs inte ut, följer med till fakturan) och varje försök söker på den före POST:en;
  sökningen matchar på början av värdet, så träffen jämförs exakt. Går sökningen inte skickas ingenting. Prövat skarpt:
  ett försök som dog efter POST:en (order 57) togs över av nästa, en order med märkningen.
- **Omförsöken:** jobbens schema (5 min, 15 min, 1 h, i 24 h), i ett eget cron-steg före jobbens, ett per varv. Ett
  stopp som kräver en människa (kortet saknar kundnummer, ett 400 från Fortnox) ger inga omförsök; allt annat (nere,
  inte ansluten, 401/403/429, nätet, vårt eget fel) gör det. "Skicka till Fortnox" på sidan sätter också skyddsnätet.
- 🧨 **Två samtidiga försök** (claimen räknas som gammal efter två minuter, och ett Fortnox-anrop har ingen tidsgräns):
  får ett försök inte spara sitt nummer för att ett annat redan står där makuleras den egna ordern
  (`PUT /orders/{n}/cancel`, prövad i testbolaget).
- 🧨 **Leveransfälten:** Fortnox fyller i kundkortets `DeliveryName` och `DeliveryAddress2` när de inte skickas
  (uppmätt; tom sträng rensar inte, `null` gör). Beställningen skickar butikens namn och `DeliveryAddress2: null`.
- **Allt Ekovilla sparar görs mot det säljaren såg:** frakten (`expectedSetAt`), kunden (`expected_customer_id`) och
  Bekräfta (version, frakt, kund). Säger servern att sidan inte stämmer läses den om och ett öppet steg stängs.
- **Butikens koppling för hand** (`customer_linked_at`) sätts när beställningen kom utan kund och butiken saknar en;
  en beställning flyttar aldrig en befintlig koppling (jobben, 3c, gör det fortfarande). Ett byte flyttar den bara när
  den pekade på kortet som byts ut (ett felval som rättas).
- 🧨 **Tankstreck i huvudet nekar ordern** ("—" i Er referens, leveransadressen, Comments; uppmätt): all butikens
  fritext går genom `fortnoxRowText`. Postnummer 20, ort 100 och leveransnamn 200 tecken sparas hela (uppmätt).

**Granskningarna** (code-review high, tretton rundor; de sista gav mest upprepningar): dubbletter i Fortnox (märkningen och sökningen, sedan två samtidiga
försök), bekräfta det säljaren såg, 500 efter ett lås som gick igenom, texterna efter utfallet, felens klass (bara 400
är ett stopp), leveransnamnet och rad 2, makulerade ordrar tas inte över, enheten bara ur registret, osparade
ändringar, bytet och butikens koppling, cron före jobben, skyddsnätet och claimen vid knappen, tankstreck i huvudet,
sena försök och fönstret, ett långsamt försök som skriver över ett annats order. Lämnat med skäl: omförsöksloopen är en
kopia av jobbens, läsningarnas ordning i Bekräfta, `parsePrice` är strikt med flit, claimen är inte stämplad per
försök, regelanropet görs också för avslutade beställningar.

**Prövat:** vitest (storeOrderFortnox, storeOrderActions, storeOrderRoutes, cron), 93 mutationer, alla röda utom en
likvärdig (`exists`/`created` ger samma plan). Lokalt mot testbolaget: ordrar 53, 54, 55, 58 (Ingen frakt), felvägen
med frakt, övertagandet (57), och i webbläsaren säljare, admin, konsult, butikens ändring under tiden, osparad
ändring, telefonbredd.

**Frågor och kvar:**
- ⚠️ **Arbetsordrarna har samma leveransfel** (det aktiva flödet): `buildOrderDeliveryFields` skickar bara gata,
  postnummer och ort, så en kund med leveransadress på Fortnox-kortet får kortets leveransnamn och rad 2 på jobbets
  order. Egen liten PR, fråga William.
- ⚠️ **Arbetsorderns huvud tvättar inte tankstreck** (det aktiva flödet): `buildOrderHeader` skickar Er referens och
  leveransadressen som de står, och "—" där nekar hela pushen (2000359, uppmätt 2026-09-29 på en order). En kontakt med
  tankstreck i namnet (macOS autokorrektur) fäller alltså jobbets Fortnox-order. Egen liten PR, fråga William.
- ✅ **Artikel 1050 är en paketartikel i testbolaget** (besvarat 2026-09-29): 1050 FRAKT är nu en vanlig artikel i
  testbolaget, som i prod. Prövat: so-lokal-8b-14 blev order 74 med FRAKT 450 kr, 25 % och konto 3001.
- En bekräftad beställning vars kundkort tas bort innan Fortnox-ordern finns kan inte kopplas om (vakten tillåter kund
  bara före bekräftelsen). Vägen ut blir Makulera (✅ 8b2).
- Lämnat: omförsöksloopen är en kopia av jobbens (`retryPortalFortnox`); att dela den hade rört 4b:s prövade kod.
- ✅ **Till 8b2 (Makulera), löst i 8b2:** en makulering får aldrig landa medan en push pågår (claimen `pending`): pushen skriver då
  numret på en makulerad beställning och Fortnox-ordern står kvar. Makulera tar claimen, eller väntar ut den, och
  makulerar Fortnox-ordern om ett nummer finns.
- Lämnat: claimen är inte stämplad per försök (den delade `claimFortnoxPush`); två försök som båda hunnit skicka fångas
  av sökningen och av makuleringen av den extra ordern.

⚠️ **Lokalt kvar:** so-lokal-8-1 (bekräftad, Fortnox föll på 1050), 8-4/8-5/8-6/8b-12 (bekräftade, ordrar 53/54/55/58),
8b-11 (övertagen order 57), 8b-13 (mottagen), 8-7 (kopplad till Boli). Testbolaget: ordrar 37–58, faktura 22.


### Fas 8b2: resultat (2026-09-29)

**Williams beslut** (planens "Fas 8a: resultat", och 2026-09-29):
- Levererad: en knapp med datum. Knappen säger att varorna har kommit fram, så dagen ligger från dagen beställningen kom
  in till och med i dag (William: "självklart kan vi inte sätta ett leverans datum innan beställningen kom"). Kräver
  Fortnox-ordern.
- Fakturera: `createinvoice` på Fortnox-ordern; en faktura som redan finns i Fortnox kopplas bara.
- Makulera: den ansvarige och admin, bara före Levererad, skälet krävs (butiken ser det), Fortnox-ordern makuleras först.
  Pågår en push svarar Makulera direkt "försök igen om en stund" i stället för att vänta ut den (William: "gå på din
  rekommendation").

**Spiken i testbolaget** (2026-09-29, ordrar 71–73, fakturor 23–27, alla obokförda):
- `PUT /orders/{n}/createinvoice` svarar med **ordern** (InvoiceReference satt), inte med fakturan. Fakturan är ett utkast
  (Booked false) med orderns rader, konto och moms, `ExternalInvoiceReference1` och `OrderReference`.
- 🧨 En ofakturerad order har `InvoiceReference: "0"`, strängen noll. `fortnoxInvoiceReference` läser den som ingen
  faktura. Arbetsorderns `fetchInvoiceReference` gör inte det, se "Frågor och kvar".
- Nejen: `createinvoice` igen 400 2000496 "redan fakturerad", makulera en fakturerad 400 2001383 "Är låst", makulera igen
  400 2001279 "Är redan makulerad", `createinvoice` på en makulerad 400 2000397. Koden läser inte koderna: efter ett nej
  läses ordern, och dess läge avgör (`cancelFortnoxOrderByState`).
- Sökningen (`GET /orders?externalinvoicereference1=`) bär `Cancelled` men inte `InvoiceReference`.

**Så fungerar det** (`lib/domains/portal/{storeOrderFulfilment,storeOrderClaim,settle}.ts`,
`app/api/crm/portal/store-orders/[id]/{deliver,invoice,cancel}`, kortet i `StoreOrderActions.tsx`):
- **Levererad:** en bekräftad med Fortnox-order, med orderns claim. Fortnox-ordern läses först: en som makulerats för
  hand i Fortnox nekar (den hade inte gått att fakturera, och efter Levererad går beställningen inte att makulera). Ett
  orört datum skickas som `null`, och servern räknar i dag (svensk dag): en flik som stått öppen i dagar eller en
  webbläsare med fel klocka avgör inte dagen.
- **Fakturera:** en levererad, med fakturans egen claim. Pekar ordern redan på en faktura kopplas den. Annars
  `createinvoice`, och ett nej läses (fakturerad av ett annat försök kopplas, makulerad under tiden sägs). Ett nummer som
  inte kunde sparas kopplas vid nästa tryck: Fortnox ger ordern bara en faktura. `invoiced_on` är den svenska dagen.
- **Makulera:**
  - Mottagen: en villkorad UPDATE på statusen och versionen säljaren såg. Bekräfta kräver också "mottagen", så bara en går igenom.
  - Bekräftad: orderns claim först. Sökningen på märkningen görs alltid, också när raden har ett nummer (en dubblett
    följer med). Varje order läses innan något görs: en fakturerad nekar direkt, en redan makulerad hoppas över. Hittas
    en order på en rad utan nummer kopplas den och omförsöken stängs före första makuleringen, med claimen. Sist
    beställningen, bara med claimen. Ett svep planeras om 5 min.
- 🧨 **Claimen med stämpel** (`storeOrderClaim.ts`): den delade claimen (`claimFortnoxPush`) säger inte vems den är.
  Varje steg, också pushen, läser claimens tid direkt efter att det tagit den (ingen annan kan ta den förrän den är två
  minuter gammal), och släpper och skriver bara med den. Pushen skriver sitt nummer utan att röra claimen (bara på en
  bekräftad) och släpper den sist med stämpeln. En makulering som tagit över en gammal claim behåller den alltså medan
  den makulerar. Makulera och Fakturera har `maxDuration` 100, under claimens två minuter.
- 🧨 **Svepet:** ett planerat försök på en makulerad görs bara av cron, med lånet, aldrig av knapparna. Det makulerar
  varje order som bär märkningen, i ett pass. En som Fortnox nekar läses: redan makulerad är klar, fakturerad är ett
  stopp. Svepet följer jobbens schema och slutar efter fönstret. Det planeras av Makulera (en POST som skickades före
  makuleringen kan landa efter sökningen) och av pushen när den finner beställningen makulerad efter ett fel. Prövat
  skarpt: en kvarlämnad order 73 med märkningen makulerades av cron.
- **Pushen (8b1) mot en makulerad:** numret skrivs aldrig på en makulerad, och vår egen order makuleras. Fel och stopp
  skrivs inte på den, och planen (ett svep, eller ingen) rörs inte. En dubblett efter två samtidiga försök makuleras
  också i det nya försökets väg.
- **Sidan:**
  - Ett kort per läge, med stegets handling som rubrik: "Markera som levererad" och "Fakturera beställningen".
  - Makulera står längst ner så länge beställningen är mottagen eller bekräftad.
  - Makuleringens dialog är `CrmConfirmDialog` med en kropp (ett additivt tillägg i den delade komponenten). Skälet har
    fokus, står kvar om sidan läses om, och dialogen skickar det säljaren såg när den öppnades.
- ⚠️ **`store_order.*` till portalen är 8b3.** Dialogerna säger "Butiken får beskedet". Slå inte på
  `EKOVILLA_CRM_STORE_ORDERS` förrän 8b3 är klar.

**Granskningarna** (code-review high, elva rundor; de sista gav mest upprepningar):
1. Claimens ägare (stämpeln), pushen mot en makulerad, delade Fortnox-anrop.
2. Levererad läser Fortnox-ordern, rester efter en makulering, "upptagen" behåller skälet.
3. Svepet, synkläget, en fråga som kastar.
4. Numret kopplas före Fortnox, dubbletterna, svepets slut.
5. Svepet bara från cron, ordrarna läses först, det säljaren såg.
6. Pushen rör aldrig en makulerads plan.
7. Svepet läser ordern efter ett nej.
8. Roten: pushen släpper bara sin egen claim; Levererad "i dag" på servern.
9. Makulera planerar alltid svepet.
10. Dubbletten i det nya försökets väg.
11. Fakturan mot en order som makulerats under tiden.

**Lämnat, med skäl:**
- `claimFortnoxPush` returnerar inte sin stämpel. Den delas med det aktiva flödet, och en stämpel ur JS har ett annat
  format än databasens. En läsning till per claim.
- Makuleringens läsningar mot Fortnox görs i följd: Fortnox tak (25 anrop per 5 s) ger fler 429 parallellt.
- Racet där en av två ordrar faktureras i Fortnox under ett makuleringsanrop (under en sekund efter läsningen): det loggas.
- En krasch mellan pushens nummer och claimens släpp ger två minuters "upptagen", som en död push alltid gett.

**Prövat:**
- vitest: `storeOrderFulfilment` (72), `storeOrderActions` (77) och `storeOrderRoutes` (18).
- 129 mutationer, alla röda utom fem likvärdiga: numret kan inte försvinna före Levererad, ägarkontrollen i varvet tar
  claimen, makulerad är ett slutläge (två), och dialogens kropp prövas i webbläsaren.
- Lokalt mot testbolaget:
  - Levererad i dag och med valt datum.
  - Fakturera med ny faktura (26, 27) och med en befintlig (24, 25).
  - Makulera av en bekräftad (53, 66), en utan nummer och en mottagen.
  - Makulera av en fakturerad (nekas), och Makulera under en claim (upptagen, skälet står kvar).
  - Svepet (73).
- I webbläsaren: säljare, admin, konsult (inget kort) och telefonbredd.

**Frågor och kvar:**
- ✅ **Arbetsorderns fakturering läser "0" som en faktura** (det aktiva flödet): `fetchInvoiceReference` i
  `lib/domains/fortnox/orders.ts` gör `existing ? String(existing) : null`. Två grenar kan då markera en arbetsorder
  fakturerad med nummer "0" utan faktura: grenen när synken inte är klar, och catch-grenen efter ett nekat
  `createinvoice`. Egen liten PR, fråga William. Läsfråga mot prod:
  `select id, order_number, status from crm_work_orders where fortnox_invoice_number = '0'`.
  **Besvarat (William 2026-09-29):** det har hänt en gång i prod, på en testorder, med flit. Ingen åtgärd nu.
- ⚠️ **En levererad beställning vars Fortnox-order makuleras för hand i Fortnox efter leveransen** kan varken faktureras
  eller makuleras (Makulera gäller bara före Levererad). Affärsbeslut: fråga William.
  **Besvarat (William 2026-09-29):** tas efter portalarbetet, med fas 9-frågorna och arbetsorderns tankstreck och
  leveransfält.
- Nästa: 8b3, `store_order.confirmed/delivered/invoiced/cancelled` till portalen (mönstret i `jobSync.ts`/`jobState.ts`).
  "Bekräftad" skickas först när Fortnox-numret finns. Vakten markerar redan `sync_requested_at`. Se "Fas 8b3: resultat".

⚠️ **Lokalt kvar:**
- so-lokal-8-5, 8b-12, 8-6 och 8b-13 är fakturerade (26, 27, 24, 25).
- 8b-11 och 8b-17 är levererade.
- 8-1, 8-3, 8-4, 8b-15, 8b-16 och 8b-18 är makulerade. 8b-14 är bekräftad utan order (1050), och 8-7 är mottagen.
- Testbolaget: ordrar 71–73, fakturor 23–27.

### Fas 8b3: resultat (2026-09-29)

**Williams besked:** två grenar, först den rena tillståndsberäkningen, sedan omräkningen, cron-steget och utskicket. Allt
får prövas lokalt, också mot den riktiga lokala portalen med `EKOVILLA_CRM_STORE_ORDERS=on` där. "Slå inte på" gäller att
inget går till prod eller testmiljön påslaget innan vi är redo.

**Händelserna** (`lib/domains/portal/storeOrderState.ts`, gren 1):

| Händelse | När | `data` | `occurredAt` |
| --- | --- | --- | --- |
| `store_order.confirmed` | bekräftad, levererad eller fakturerad, **och** Fortnox-numret finns | `orderId`, `ekovillaOrderNumber`, `confirmedAt` = `confirmed_at` | `confirmed_at` |
| `store_order.delivered` | levererad eller fakturerad, efter att bekräftelsen är levererad | `orderId`, `deliveredAt` = `delivered_on` | `delivered_at` |
| `store_order.invoiced` | fakturerad, efter leveransen | `orderId`, `invoicedAt` = `invoiced_on` | `invoiced_at` |
| `store_order.cancelled` | makulerad, oavsett bekräftelsen | `orderId`, `reason` = `cancel_reason` | `cancelled_at` |
| inget | mottagen, tillbakadragen | | |

🧨 **Händelsen byggs helt ur raden, därför ingen migrering.** Jobben behöver `sync_pending_events` och `sync_version`
eftersom deras `occurredAt` är körningens tid. En beställning når varje läge en gång (vakten: statusen bara framåt, numret
en gång), och varje steg har en egen tid som knappen skriver. Samma rad ger alltså alltid samma nyckel och samma kropp.
Utskicket kan då köa först och spara läget sedan, i en villkorad UPDATE på `sync_requested_at` (vakten sätter en ny
`now()` vid varje ändring, så markeringen är krockkontrollen): en krasch mellan de två ger samma händelser nästa varv, och
kön känner igen nycklarna. Det gäller varje rad som databasen tar emot: `confirmed_at` och `cancelled_at` krävs av
tabellens checkar, och en leverans eller faktura utan sin tid (bara en rad skriven för hand) dateras med dagens början i
UTC, aldrig med körningens tid.

**Reglerna**, som jobbens:
- Inget efter "bekräftad" köas förrän den är levererad. Väntar den räknas beställningen om nästa varv, sist i kön; bara
  när något faktiskt väntar bakom den. Uppgiven står beställningen still tills "Skicka om".
- "Makulerad" behöver ingen bekräftelse, och efter den köas ingenting.
- Mottagen och tillbakadragen (butikens egen, som vakten också markerar) ger ingenting, och markeringen tas bort.
- En egen kö per beställning, `store_order:<orderId>`, och ingen händelse ersätter en annan.
- En händelse utan sin dag skickas inte (portalen hade nekat den). Vaktens checkar gör det omöjligt i dag. Statusen
  avgör, inte dagen: en levererad med en fakturadag är inte fakturerad.
- Ett läge med fakturan har också leveransen (den köas alltid först), så en leverans köas aldrig efter fakturan.

**Egna val som William inte sa emot:**
- `confirmedAt` är när någon tryckte Bekräfta, inte när Fortnox-numret kom: då låstes beställningen, och CRM:et svarar
  409 på butikens ändringar sedan dess (kontraktets "Låser beställningen").
- `occurredAt` är när CRM:et gjorde steget, inte körningens tid. För makuleringen är det datumet portalen visar.
- En beställning som makulerades innan "bekräftad" köats får bara makuleringen, också när den hann få ett Fortnox-nummer:
  butiken såg den aldrig bekräftad.

**Känt, inte jagat:**
- Makulera kopplar ett funnet Fortnox-nummer på en rad utan nummer innan den makulerar ordern. Går ett cron-varv precis
  däremellan får butiken "Bekräftad" och strax "Makulerad". Att kräva `fortnox_order_sync_status = 'synced'` hade
  undvikit det, men gjort butikens läge beroende av claimens släpp i flera kodvägar.
- Bara bekräftelsen spärrar, som för jobben. Ger en köad leverans upp (60 försök, portalen nere i över två dygn) går en
  senare fakturering ändå fram, och butiken ser Fakturerad utan leveransdag. Leveransen kan då inte skickas om, eftersom
  något senare finns för beställningen.

**Portalens mottagare** (läst @ `e9b55aa`): `store_order.cancelled` kräver `reason` (utan standardvärde, till skillnad från
`job.cancelled`), trimmad och högst 2000 tecken räknade i kodpunkter (zod 4, prövat). Makuleringens route tar högst 2000
UTF-16-enheter, alltså aldrig för långt. Portalen räknar statusen ur datumen och flyttar den aldrig bakåt, svarar 409
`cancelled` på allt efter en makulering och 404 `unknown_order` på ett id den inte har, också ett som inte är ett uuid: de
lokala `so-lokal-*` kan bara prövas mot en fejkportal.

**Granskningen av gren 1** (code-review high, en runda, sju fynd):
- Lagat: en leverans eller faktura utan sin tid fick körningens tid, alltså inte samma nyckel efter en krasch (nu dagens
  början); ett läge med fakturan men inte leveransen hade köat leveransen efter fakturan; statusen som typ, inga
  `as string`.
- Dokumenterat ovan: en uppgiven leverans före fakturan, och Makuleras race.
- Fel premiss: "ingenting markerar beställningen igen efter en uppgiven bekräftelse". "Skicka om" markerar den i gren 2,
  som jobben, och kön rensas aldrig, så "saknas" nås inte.
- Lämnat: tidshjälparen är inte längre en kopia av jobbens (den tar en dag att falla tillbaka på).

**Prövat (gren 1):** vitest (`storeOrderState.test.ts`, 34), med ett kontraktstest som speglar portalens schema för
`store_order.*` och kräver giltiga nycklar. 61 mutationer, alla röda utom två likvärdiga: en JSON-array kan inte bära
lägets fält, och en fakturering som redan köats når aldrig utskicket (`waiting` och "fakturan har leveransen").

**Gren 2** (`lib/domains/portal/storeOrderSync.ts`, `cron.ts`, `app/api/crm/portal/events/[id]/retry`, `outboxView.ts`,
fliken Utskick):
- **Omräkningen** läser de markerade beställningarna, äldst först, högst 100 per varv. Den köar händelserna i ordning
  och sparar läget och markeringen i EN UPDATE, villkorad på markeringen som lästes. Blir det noll rader (en ändring
  under tiden, eller ett annat varv som hann före) sparas inget läge, och nästa varv köar samma nycklar igen, vilket kön
  känner igen. En beställning som väntar på att bekräftelsen levereras får en ny markering (nu), sist i kön.
- **Cron:** omräkningen direkt efter jobbens, och igen efter utskicket när något levererades, så att "levererad" följer
  "bekräftad" i samma varv. Ett utskick till görs när jobben eller beställningarna köade något. Kön tar en händelse per
  beställning och dragning, så en fakturering bakom en leverans går nästa varv.
- **"Skicka om"** på en butikshändelse markerar beställningen (portalens orderId ur kön `store_order:<orderId>`), så att
  det som väntade bakom en uppgiven bekräftelse följer i samma klick. Kön tolkas i `queueMarks.ts`, med prefixen ur
  `jobState.ts` och `storeOrderState.ts`, och en beställning som inte finns ger en varning i loggen.
- **Fliken Utskick** visar `store_order.*` som Bekräftad, Levererad, Fakturerad och Makulerad, med numret, dagen eller
  början av skälet (80 grafem, så att en sammansatt emoji aldrig delas), och butiken och B-numret med länk till
  beställningen. Den läser beställningarna med sessionen (`crm.access`). "Skickas inte om" säger "samma beställning".
- `readConfirmedDelivery` delas med jobben (exporterad ur `jobSync.ts`, oförändrad).

**Granskningen av gren 2** (code-review high, en runda, åtta fynd):
- Lagat: kötolkningen låg i routen (nu `markPortalQueueForSync` i `queueMarks.ts`, prefixen på ett ställe);
  markeringen läste inte tillbaka raden; skälet kapades per kodpunkt och kunde dela en sammansatt emoji; räknarna
  (`queued` och `conflicts` kan gälla samma beställning) förklarade.
- Fel premiss: "en makulering efter en bekräftelse som köats men inte bokförts bryter regeln". Bekräftelsen hann köas,
  så butiken får Bekräftad och Makulerad, som fall D; regeln gäller en bekräftelse som aldrig köats. Och "omräkningen
  efter utskicket kostar 100 rader": när portalen är nere skickas inget och ingen omräkning görs, och när den kommer
  tillbaka är det den omräkningen som behövs.
- Känt, inte jagat: faller markeringen i "Skicka om" (ett databasfel mellan två anrop) ligger bekräftelsen i kön men det
  som väntar bakom den följer först vid nästa ändring av beställningen, och ett nytt klick säger "inte uppgiven". Jobben
  har samma mönster (4b). Att markera före återköandet hade öppnat ett race mot cron, som då kan ta bort markeringen.
  Bekräftelsens status läses en gång per markerad rad, som för jobben.

**Prövat (gren 2):**
- vitest: `storeOrderSync` (14), `queueMarks` (5), cron (18), routerna, fliken. 52 mutationer, alla röda (en överlevde
  först: ett trasigt läge prövades bara som en lista, och testet kräver nu att en nyckel av fel typ kastas bort). Efter
  granskningen 14 till, alla röda utom en likvärdig (en kö kan inte börja med båda prefixen).
- **Mot en fejkportal** (:3101) som kontrollerar signaturen och prövar varje kropp mot portalens eget schema
  (`crmEventSchema` ur portalrepot, zod 4, med `--conditions=react-server`): de 14 markerade lokala beställningarna gav
  24 händelser, alla godtagna. Sju bekräftade, sex makulerade (8-3, 8-4 och 8b-15 bara makuleringen, trots nummer på
  två av dem), sex levererade, fyra fakturerade. Tillbakadragen och mottagen gav ingenting, och markeringen togs bort.
  En uppgiven bekräftelse (404) höll leveransen stilla, och "Skicka om" i fliken skickade bekräftelsen och leveransen i
  samma klick.
- **Mot den riktiga lokala portalen** (:3001, `EKOVILLA_CRM_STORE_ORDERS=on` bara i processens miljö), butiken Norrbygg
  kopplad till kund 15 en stund:
  - A beställd i portalens formulär, frakt 450 kr, Bekräfta (order 75 i testbolaget), Levererad och Fakturera (faktura
    28). Portalen visade "Ekovillas order 75 · bekräftad · levererad · fakturerad 29 sep", och `confirmedAt` var
    Bekräftas tid.
  - B makulerad som mottagen: "Ekovilla makulerade beställningen 29 sep. Skäl: …", daterad vid makuleringen.
  - C tillbakadragen i portalen: inget skickades, och markeringen togs bort.
  - D bekräftad (order 76) och makulerad: båda kom fram, i ordning.
- I webbläsaren: fliken som admin, länken till beställningen och telefonbredd utan sidledsscroll.

⚠️ **Lokalt kvar:**
- Alla `so-lokal-*` har sitt läge köat och skickat till fejkportalen.
- `so-lokal-8b3-1` är levererad, lagd för hand med Fortnox-nummer 9901, som inte finns i Fortnox.
- Portalens beställningar B-2026-004 till 007 (A–D) finns i båda lokala databaserna. Butiken Norrbygg har åter inget
  kundnummer i portalen, men CRM:et har butiken med kund 15.
- Testbolaget: order 75 med faktura 28 (obokförd), och order 76, makulerad.

### Lokal genomkörning av hela kedjan (2026-09-29)

CRM:et (:3002) mot den **riktiga** portalen (:3001, egen git-worktree av portalens `main` @ `e9b55aa`, variablerna bara i
processens miljö, `EKOVILLA_CRM_STORE_ORDERS=on` bara lokalt), båda lokala databaserna och Fortnox testbolaget. Headless
(Playwright), ett cron-varv i taget i CRM:et och portalens utkorg puffad för hand (`/api/cron/utkorg`, egen
`CRON_SECRET`). Portalsessionen höll sig borta från databasen och portarna under tiden. Butiken Norrbygg hade kundnummer
15 (SEHED) under testet. **81 kontroller gröna; inget fel i CRM:et.**

1. **Prislistan:** Publicera (lista 160, 51 artiklar, giltig från 2026-09-29) blev en ny rad i portalens `pricelists`
   (`reseller_id` null) med 51 artiklar, enheterna med gemener, kategori och arbetsandel. Samma nyckel igen gav samma svar
   (201) och ingen ny lista; samma nyckel med en annan kropp gav 422 `idempotency_key_reused`. Nya beställningar låstes
   mot den nya listan.
2. **Jobbet (2026-011):** kunden godkände via kundlänken (namn, personnummer, fastighet, ritad signatur), butiken lämnade
   över. Portalens kropp saknade kundpris, påslag, personnummer och signatur och bar `ekovillaCustomerNumber` "15". CRM:et
   skapade AO-20260929-BB3B4E och Fortnox-order 77; `job.confirmed` gav portalen Bekräftad med 77 och arbetsorderns id.
3. **Planerat, utfört, fakturerat:** ett kort gav Planerad 12–14 okt, en flytt 20–21 okt, borttaget kort tillbaka till
   Bekräftad med tomma datum, ett nytt endagskort 22 okt i båda fälten. "Fakturera" gav Utförd, en flytt efter det köade
   inget (bara framåt), faktura 29 gav Fakturerad.
4. **Meddelanden:** butikens meddelande (med emoji och tankstreck) kom fram och gav notisen; svaret kom fram som
   "Test Admin · Planering" med `crm_message_id`. Också på ett fakturerat och ett avbrutet jobb.
5. **Dokumenten:** orderbekräftelsen gick automatiskt efter bekräftelsen; "skicka ny" ersatte rad och fil hos portalen;
   egenkontrollen (arkiverad med `/api/storage/save` och kommentaren, som egenkontrollsidan) gick med kortets route. Butiken
   laddade ner båda (PDF, `filename*` med svenska tecken och tankstreck).
6. **Butiksbeställningen (B-2026-008 och -009):** ändringen före bekräftelsen gav version 2. Med CRM:et nere köade portalen
   två ändringar; den första hade redan fryst sin kropp och gick fram när CRM:et kom tillbaka, och säljaren bekräftade den
   versionen (Fortnox-order 78). Butikens två senare ändringar låg då i portalens kö: den äldre blev `superseded`, den
   senaste fick 409, och portalen visade Ekovillas version med rutan "Ekovilla hann bekräfta …". Levererad och Fakturerad
   (faktura 30) kom fram. B-2026-009: tillbakadragningen efter bekräftelsen fick 409 (rutan "före tillbakadragningen"),
   sedan makulerad av Ekovilla (order 79 makulerad), och butiken såg skälet.
7. **Det avbrutna jobbet (2026-008):** AO-20260929-2C9335, Fortnox-order 80, Bekräftad; avbruten i CRM:et gav portalen
   Avbrutet med "Inget skäl angavs.", offerten stod kvar som överlämnad. En signerad `job.scheduled` efter det fick 409
   `cancelled`, en ny `job.cancelled` 200, och meddelanden gick fortfarande åt båda hållen.

**Iakttagelser till portalen** (inget av det rör CRM:ets flöde):
- En sen `job.scheduled` med ny nyckel efter `job.invoiced` flyttar inte statusen, men skriver över `scheduled_for` och
  `scheduled_until` (22 okt blev 12–14 okt). CRM:et skickar aldrig en sådan (rättelse 22), så det gäller bara uppspelade
  anrop. Rättelse 38.
- 409-svaret på en ändring eller tillbakadragning sparas i `last_error` och `last_error_code` (`store_order_confirmed`),
  inte i `response_body`.
- En ändring vars första försök redan gjorts (kroppen fryst) blir ändå `superseded` av en senare ändring i samma kö.

⚠️ **Lokalt kvar:** portalens lokala databas har testets offerter, jobb, meddelanden, dokument, beställningar
B-2026-008–009 och den nya prislistan; portalsessionen kör `npm run db:reset` där efter Williams ok (tillbaka till
seeden, Norrbygg utan kundnummer). CRM:et: AO-20260929-BB3B4E (fakturerad), AO-20260929-2C9335 (avbruten), B-2026-008
(fakturerad), B-2026-009 (makulerad), publiceringen av lista 160. Testbolaget: ordrar 77–80, fakturor 29 och 30 (obokförda),
order 79 makulerad; order 80 (det avbrutna jobbet) står kvar, som för varje avbruten arbetsorder.
Skript: scratchpad/8b3 (session 783c9315): lib.mjs, steg1–7.mjs, steg6lib.mjs, kedjan.log.

### Lokal genomkörning 2, i webbläsaren (2026-10-02)

Samma uppsättning som 2026-09-29, men varje steg klickades i gränssnittet som en inloggad användare, också på CRM-sidan
(förra gången gick planering, status, faktura, svar, dokument och avbryt via API-anrop). CRM:et (`main` @ `3085d4a1`)
kördes på :3002 och portalen (`main` @ `9244aca`) på :3001, båda i egna git-worktrees med `node_modules` som APFS-kloner,
eftersom en annan `next dev` på :3000 delar `.next/`. Båda lokala databaserna, Fortnox testbolaget, ett cron-varv i taget.
**Godkänd av William 2026-10-02.**

1. **Flöde 5:** admin gjorde kund 12 (Niclas Malmström Byggare AB) till återförsäljare och bjöd in den från kundkortet.
   Portalen skapade företaget med kundnummer 12 och bjöd in adminen. Efter "Glömt lösenord" valde adminen lösenord,
   loggade in och gick igenom "Kom igång", där org.nr, momsnummer, adress, telefon och e-post från CRM:et var förifyllda.
   Kortet A gav ingen egen lista (10b3).
2. **Prislistan:** lista 160 (48 artiklar, giltig från 2026-10-02) blev en ny gemensam lista. Båda butikerna såg den
   under Prislista.
3. **Jobben:**
   - A: Norrbygg gjorde en ny privatoffert med ROT. Skicka-sidan visade kundlänken, och kunden signerade i den.
     Norrbygg saknade kundnummer i portalen, så CRM:et spärrade Fortnox och skickade notisen. Butiken kopplades för hand
     på arbetsordern ("Koppla och skicka till Fortnox"), och då kom Fortnox-order 86 och Bekräftad.
   - B: den nya butiken gjorde en företagsoffert, med Företag förvalt och ingen ROT, och registrerade "Kunden har
     godkänt" per telefon. Fortnox-order 85 skapades direkt via kundnumret.
   - Kropparna saknade kundpris, påslag, personnummer, signatur och ROT, som kontraktet säger.
4. **Planeringen**, med drag i veckovyn: placera, dra i kanten, flytta, tillbaka till backloggen och placera igen gav
   portalen 12–13, 15–16, Bekräftad utan datum och sedan 14 okt. B fick 13 okt.
5. **Meddelanden och dokument:**
   - Butikens meddelande gav notisen, och svaret från rutan Butiken kom fram som "Test Admin · Planering".
   - Orderbekräftelsen gick av sig själv, och en ny ersatte den.
   - Egenkontrollen lämnades in av montören i fältvyn, med montören i bilens team (+ team), och skickades till butiken.
   - Butiken laddade ner båda PDF:erna.
6. **Utfört och fakturerat:** Fakturera i förloppet gav Utförd. "Fakturera allt" gav faktura 33 och Fakturerad.
7. **Butiksbeställningarna:**
   - B-2026-004 ändrades före bekräftelsen och blev version 2. Den fick frakt 450 kr och bekräftades (order 87). Efter
     det gick den inte att ändra. Den markerades levererad och fakturerades (faktura 34).
   - B-2026-005 bekräftades utan frakt och makulerades sedan med skäl (order 88). Butiken ser skälet.
   - B-2026-006 drogs tillbaka av butiken.
8. **Det avbrutna jobbet (2026-015):** kopplingen för hand gällde Norrbyggs nästa jobb. Fortnox föll på seedens artikel
   2410920, som inte finns i testbolaget; när raden togs bort i artikeleditorn skapades order 89. Jobbet planerades och
   avbröts sedan från planeringskortet, och portalen visade Avbrutet med "Inget skäl angavs.". Meddelanden gick
   fortfarande fram, både på det avbrutna och på det fakturerade jobbet.

**Ett fynd i CRM:et, lagat:** en avbruten arbetsorder makulerades aldrig i Fortnox (Williams fynd). Rättat i #279, som
makulerar Fortnox-ordern först och sparar Avbruten bara om Fortnox tar emot det. #280 hindrar att en delfakturerad
arbetsorder avbryts.

**Iakttagelser till portalen:**
- Lokalt når portalens auth inte sin mallserver (`kong:8088` vägrar anslutning). Inbjudan och återställningen får därför
  Supabase engelska standardmejl, med länken till `/auth/v1/verify`. Det gäller bara den lokala miljön.
- En admin räknas som aktiv så fort e-posten bekräftats, det vill säga när knappen "Välj lösenord" har klickats, även om
  inget lösenord valts. Ett omskick från CRM:et svarar då 200 `active` och skickar inget mejl. Vägen ut är "Glömt
  lösenord", och den fungerade.

**Lokala artefakter, inte fel:** seedens offerter har fasta id:n, så 2026-011 nekades med 422 `idempotency_key_reused`
(CRM-databasen såg den 29/9). Fyra Bergströms-butiker från fejkportalen gav 422 `unknown_reseller` vid publiceringen.

⚠️ **Lokalt kvar:**
- Portalens databas har testets företag, offerter, jobb, meddelanden, dokument och beställningar. Portalsessionen kör
  `npm run db:reset` där.
- Testbolaget har ordrarna 85–89 och fakturorna 33–35, obokförda. Ordrarna 21, 35, 80, 85, 88 och 89 är makulerade
  (de flesta i proven av #279/#280), och order 22 är delfakturerad.

Skript: scratchpad (session `fd93a9fd`): `lib.mjs`, `steg1*–steg12.mjs`, `kedjan.log`, `shots/`.

### Fas 5, T1: resultat (2026-09-30)

Spärren sitter i `lib/email.ts`, `lib/sms.ts` och `lib/webPush.ts` och avgörs av `isProductionDeployment`
(`lib/env.ts`), som faller stängt. Utanför prod gäller följande:

- **Mejl:** går bara till adresser i `NONPROD_MAIL_ALLOWLIST` (hela adresser, separerade med komma). Andra mottagare tas
  bort ur `to` och `bcc` och loggas. En mottagarsträng med mer än ett `@` spärras alltid. Blir ingen kvar i `to` skickas
  inget, och svaret är `skipped`.
- **Sms och push:** skickas aldrig, oavsett nycklar. Mottagaren och texten loggas (för push bara tjänstens värdnamn och
  rubriken), och svaret är `skipped`.
- **Saknade nycklar** ger `skipped`, inget kast. Det gäller också i Preview, där `NODE_ENV=production` förut fick
  `sendEmail` att kasta.
- **Push-prenumerationer** fungerar fortfarande. `isWebPushConfigured` är oförändrad, så testmiljön kan ha egna
  VAPID-nycklar.

Prod är oförändrat. `VERCEL_ENV` finns när prod kör, eftersom Vercel-projektet har `autoExposeSystemEnvs: true`
(kontrollerat 2026-09-30).

**Efter deployen:** Vercels produktionsloggar ska inte ha någon rad med `Utanför prod`. En sådan rad betyder att prod
tror att den inte är prod, och då går inget mejl, sms eller push ut.
✅ Kontrollerat 2026-09-30: inga sådana rader, och ett testmejl i prod kom fram.

**Känt, med flit:** planeringens bekräftelser, kundnotisen, tidpåminnelsen och pushens bokföring frågar inte efter
`skipped`. Utanför prod står det därför "skickat" för något som bara loggades. Det kan inte hända i prod, där `skipped`
aldrig förekommer.

### Fas 5: resultat (2026-09-30)

**Miljön, T2–T6:**

- **Supabase:** `ekovilla-crm-test` (ref `aquwuqnqzuxljzkfoinn`, eu-north-1). Schemat kom in med `supabase db push`, med
  CLI:t länkat mot test. Prod nås som förut bara med `--db-url` och länkas aldrig.
  - Kedjan hade aldrig byggts från noll, och två efterkontroller stoppade pushen. Båda är lagade i #268:
    - `service_role` fick inga default privileges i ett nytt projekt.
    - `crm.access` fanns bara som data, inte i någon migrering.
  - Paritet: test stämmer med lokalt. De enda skillnaderna är två identitetssekvenser och plattformens
    `protect_bucket_control_*`, båda väntade och beskrivna i `supabase/checks/parity.sql`.
  - Seed: `reference.sql` och `dev.sql` i en transaktion. Testanvändarna har ett eget lösenord, inte `dev.sql`:s.
    Buckets kom in med `seed buckets`.
- **Vercel:**
  - Grenen `testmiljo` uppdateras genom att fast-forwardas till `main`. Ignored Build Step bygger prod och `testmiljo`
    och inget annat.
  - Domänen test.app.ekovilla.se pekar på `testmiljo`. Vercel Authentication är avstängd för projektet: läget "alla
    utom egna domäner" skyddade också grenens domän, och då fick portalens anrop Vercels inloggningssida.
  - De 13 Preview-variablerna gäller alla grenar, eftersom grenen inte gick att välja innan den hade en deploy. Det är
    ofarligt: värdena är testvärden, bara `testmiljo` byggs, och ingen variabel delas med Production.
- **Fortnox:** testmiljön har en egen app mot testbolaget.
  - 🧨 Samma app i två databaser fungerar inte. Den nyaste kopplingen gör den äldres refresh-token ogiltig: lokalt kom
    `invalid_grant` direkt efter att testmiljön kopplats med den lokala appen.
  - Efter bytet förnyades tokens i båda miljöerna, med tvingad förnyelse.
- **T5 och T6:**
  - Hemligheten finns i båda projekten. CRM:et har `RESELLER_PORTAL_URL=https://test.partner.ekovilla.se`, portalen
    `EKOVILLA_CRM_URL=https://test.app.ekovilla.se` och `EKOVILLA_CRM_STORE_ORDERS=on`.
  - En signerad ping går igenom åt båda hållen med 200, och fel hemlighet ger 401.
  - Inloggningen med en testanvändare lyckas, och sidans kod pekar på testprojektet, inte prod.

**Kedjan i testmiljön** kördes med Playwright i Williams inloggade webbläsarprofil, utan lösenord i filer. Ett svep
mellan test.app och test.partner gav 42 gröna kontroller. De röda var mina egna skriptfel och förberedelser som
saknades, plus felet nedan, och alla gick igenom när de kördes om.

1. **Prislistan:** publicerad. Portalen visar 48 artiklar som gäller från 2026-09-30.
2. **Jobbet:** offert 2026-005 → kundlänk och signering → överlämning → arbetsorder AO-20260930-71DD2F. Notiserna
   "Nytt jobb" och "Fortnox-ordern kunde inte skapas" kom, eftersom butiken saknade kundnummer.
3. **Koppla kund (3c):** Testbygg AB kopplades till Testbolaget Bygg AB.
   - Kortet fick först skickas till Fortnox, där det blev kund 18. Felet var "Ingen Fortnox-kundkoppling hittades".
   - Därefter gick det: Fortnox-order 81, och portalen visar Bekräftad med "Ekovillas order 81".
4. **Status:** planerad 12–14 okt, flyttad 20–21, borttagen (tillbaka till Bekräftad), planerad 22 okt, Utförd och
   Fakturerad, plus en Fortnox-faktura. En flytt efter Utförd skickade ingenting.
5. **Meddelanden:** fungerar åt båda hållen, med notisen och "Test Admin · Planering".
6. **Dokument:** egenkontrollen och orderbekräftelsen, den senare efter #269.
7. **Beställningar:**
   - B-2026-002: frakt 450, Fortnox-order 82 med 25 % moms, levererad, faktura 32.
   - B-2026-003: Fortnox-order 83, makulerad med skäl.
   - Alla statusar syns i portalen.

William testade själv 2026-10-01, och allt fungerade.

**Hittat och lagat (#269):** orderbekräftelsen till butiken gick inte att skapa på Vercel, med felet "Något gick fel".
- De fyra routes som kör portalens bakgrundsvarv eller bygger dess dokument fick inte med typsnitten och loggan, eftersom
  `outputFileTracingIncludes` gäller per route.
- Lokalt syns felet aldrig. I prod hade det slagit till vid påslaget.
- `tests/shared/pdfTracing.test.ts` letar nu själv upp varje route som anropar `runPortalCron` eller
  `portalDocumentSources`.

**Så används testmiljön:**
- **Ingen cron:** statusen skickas med "Skicka väntande nu" under Återförsäljarportalen → Utskick.
- **Reserven** är Test Admin.
- **Testbygg AB** är kopplad till Testbolaget Bygg AB, Fortnox-kund 18.
- **Kundlänken** visas bara på Skicka-sidan i samma ögonblick som offerten skickas. Databasen har bara hashen.

**Öppet:**
- **Förhandsvisningen av lista 160** på portalsidan föll ibland med "Något gick fel mot Fortnox": ett `FortnoxApiError`
  utan felkod. Publiceringen påverkades inte.
  - **Trolig orsak** (utredd 2026-10-01, inte bevisad med loggar): skyddet mot dubbla tokenförnyelser
    (`inflightRefresh` i `lib/domains/fortnox/client.ts`) gäller bara inom en process. Fortnox byter refresh-token vid
    varje förnyelse, så när två Vercel-instanser förnyar samtidigt vid utgången får den ena `invalid_grant`.
  - Tokenen hade gått ut ungefär 19:30, och felet kom 19:54 när publiceringen och sidans omladdning körde samtidigt.
    Förhandsvisningen gör bara ett anrop, så Fortnox gräns för antal anrop är uteslutet.
  - Det gäller alla Fortnox-anrop i prod. Ett enstaka anrop kan fela precis vid tokenbytet, och ett nytt försök fungerar.
  - **William 2026-10-01: vänta.** Förslaget om det kommer igen: vid `invalid_grant`, läs om raden och använd en token
    som en annan instans redan sparat, i stället för att kasta. Logga också det råa felet i förhandsvisningen.
- **Portalens Vault** i testmiljön (`crm_outbox_url`, `crm_outbox_secret`) är inte satt. Portalens omförsök körs därför
  inte, men direktförsöken fungerar. Williams överlämning från 2026-09-27 ligger kvar i portalens kö.
- **Inför fas 9:** varje butiks kundkort i CRM:et måste ha ett Fortnox-nummer, annars skapas ingen Fortnox-order.
  Portalens `ekovillaCustomerNumber` ska vara det numret.

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

20. **`job.cancelled`** (fas 4b, William 2026-09-28): `{ "quoteId", "reason": "", "cancelledAt" }` (tidpunkt i UTC)
    när Ekovilla avbryter jobbet eller tar bort arbetsordern. Skickas bara före "Utförd", och efter den skickas inget
    mer för jobbet. Tar portalen inte emot den (4xx) syns den som uppgiven på CRM:ets portalsida.
    **Rättat 2026-09-28:** `reason` saknades först. Portalens kontrakt har fältet (fritext till butiken, får vara tom),
    och portalens schema krävde det tills portalens PR #40, som gör fältet valfritt ("får saknas"). Före den hade varje
    `job.cancelled` nekats med 400 och getts upp. CRM:et har inget skäl att skicka och skickar alltid en tom sträng,
    som båda versionerna av portalen tar emot.
21. **`job.scheduled` har `scheduledUntil`** (punkt 5, byggt i fas 4b): planerad slutdag, samma dag som `scheduledFor`
    för ett endagsjobb. `scheduledFor` och `scheduledUntil` är båda `null` när jobbet inte längre är planerat.
22. **Bara framåt** (William 2026-09-28): efter job.completed skickas inga fler job.scheduled, och efter job.completed
    eller job.invoiced aldrig ett tidigare läge. job.invoiced kommer alltid efter job.completed. Inget efter
    job.confirmed skickas förrän den är mottagen (2xx).
23. **Tider och nycklar** (fas 4b): `occurredAt` och `confirmedAt` är ISO 8601 i UTC med `Z`; `completedAt` och
    `invoicedAt` är svenska kalenderdagar `YYYY-MM-DD`. Idempotency-Key är `<event>-<quoteId>-<occurredAt>`, alltså
    unik per händelse även när datumen går X → Y → X.
24. **`job.message` från CRM:et** (fas 6): `messageId` är CRM:ets id, en uuid. `Idempotency-Key` är
    `job.message-<messageId>` utan tidpunkt, eftersom id:t redan är unikt per meddelande och databasen härleder
    nyckeln ur det. `occurredAt` och `sentAt` är samma tid, i UTC med `Z`. `department` är alltid `Försäljning`,
    `Planering` eller `Ekonomi`, aldrig tom. `authorName` är svararens namn, eller "Ekovilla" när profilen saknar
    namn. Ett svar ändras eller tas aldrig bort. Svaren ligger i jobbets kö (`job:<quoteId>`) och kommer efter jobbets
    tidigare händelser.
25. **Svaren på butikens meddelande** (fas 6):
    - 201 `{ messageId }` när det är mottaget, också när samma `messageId` redan finns med samma innehåll.
    - 400 `invalid_json`, `invalid_text` och `validation_error`, den sista med `details.issues`.
    - 404 `unknown_job`.
    - 409 `work_order_removed`.
    - 409 `message_conflict` när samma `messageId` redan är mottaget med en annan text, ett annat namn, en annan
      `sentAt` eller för ett annat jobb.
    - 503 `job_not_ready` med `Retry-After: 30` medan jobbet tas emot.

    Ett omförsök måste alltså skicka samma `sentAt`. Det gör portalen, eftersom kroppen byggs ur det sparade
    meddelandet.
26. **Namn och text trimmas** åt båda hållen och räknas i tecken som Postgres räknar dem: ett emoji är ett tecken.
    Namnet får vara högst 200 tecken och texten högst 5000.
27. **En avbruten, utförd eller fakturerad order tar emot meddelanden** (William 2026-09-28), på samma sätt som
    portalen tar emot `job.message` efter `job.cancelled`.

28. **`job.document` från CRM:et** (fas 7):
    - `Idempotency-Key` är `job.document-<dokument-id>` (en uuid), utan tidpunkt, som `job.message` (punkt 24).
      `occurredAt` är när PDF:en frystes, i UTC med `Z`.
    - Kroppen är `{ type, occurredAt, data: { quoteId, kind, name, contentBase64 } }`, med strikt base64 av högst
      3 300 000 byte. Samma nyckel ger alltid samma byte.
    - `name` är "Orderbekräftelse <Fortnox-nr> – <arbetsplats>.pdf" eller "Egenkontroll …", högst 200 tecken, med svenska
      tecken.
    - Orderbekräftelsen skickas automatiskt en gång när `job.confirmed` är mottagen, och igen när Ekovilla skickar en ny.
      Egenkontrollen skickas när Ekovilla skickar den.
    - Av två av samma sort gäller den senast mottagna, och CRM:et skickar aldrig en äldre efter en nyare.
    - Inga dokument efter `job.cancelled`.
29. **Portalens kod tar emot `job.document` efter `job.cancelled`**, medan kontraktet säger 409 `cancelled` på allt utom
    `job.message`. Det gäller route-kommentaren i `app/api/ekovilla/events/route.ts` och `saveJobDocument` i
    `lib/data/supabase/crm.ts`. CRM:et skickar inga dokument efter ett avbrott, så båda fungerar, men kontraktet och koden
    bör säga samma sak.
30. **`filename*` i portalens dokumentroute** (`app/(portal)/jobb/[id]/dokument/[kind]/route.ts`): `encodeURIComponent`
    lämnar `' ( ) *` okodade, och de får inte stå i ett RFC 5987-värde. En arbetsplats som "Storgatan 1 (bakgård)" ger ett
    felaktigt `filename*`. CRM:ets "Öppna" kodar dem.

31. **Butiksbeställningarnas svar** (fas 8a):
    - `POST /api/portal/store-orders`: 201 `{ "crmStoreOrderId" }`, också när samma orderId med samma kropp redan är
      mottaget; 409 `store_order_conflict` när den första kroppen var en annan (under en annan nyckel; samma nyckel med
      en annan kropp ger 422 `idempotency_key_reused`); 503 `no_assignee` med `Retry-After: 300`.
    - `PUT /api/portal/store-orders/{orderId}`: 200 `{ "status": "updated" }` eller `{ "status": "ignored" }`; 409
      `store_order_confirmed`; 404 `unknown_order`; 400 `store_order_mismatch` (en annan butik eller ett annat nummer).
    - `POST …/{orderId}/withdraw`: 200 `{ "status": "withdrawn" }`, också när den redan är tillbakadragen, eller
      `{ "status": "ignored" }`; 409 `store_order_confirmed`; 404 `unknown_order`.
    - Alla: 400 `invalid_json`, `invalid_text` och `validation_error` med `details.issues`, och orderId i kroppen måste
      vara sökvägens (400). Ett 404 `unknown_order` sparas inte i svarscachen: samma nyckel körs igen när beställningen
      kommit fram. Samma gäller nu meddelandenas 404 `unknown_job`.
32. **409 bara efter bekräftelsen** (kontraktet), också när Ekovilla makulerat: en ändring eller tillbakadragning av en
    makulerad beställning får 200 `ignored`, och makuleringen kommer som `store_order.cancelled`.
33. **Kroppens krav:** hela antal (heltal över noll), `unitCost` i hela ören (högst två decimaler), ingen rad i `m3`
    (inblåsning är jobb), leveransadressens gata,
    postnummer och ort ifyllda, högst 200 rader. `updatedAt` skrivs `YYYY-MM-DDTHH:MM:SS.mmmZ` och måste vara en tid som
    finns. `ekovillaCustomerNumber` som tom sträng räknas som `null`, som för jobben.
34. **Momsen** (William 2026-09-29): en butiksbeställning har 25 % (butiken är slutkund), också frakten; ett jobb har 0 %.
    Portalens `DOMAIN.md` antar omvänd skattskyldighet på allt och behöver rättas för beställningarna.
35. **Nycklarnas namnrymd:** svarscachen är unik på `Idempotency-Key` över alla portalens anrop, och kontraktets nycklar
    kan i teorin krocka: `store-order-<id>-withdraw` är samma sträng som `store-order-<id2>` när id2 är `<id>-withdraw`,
    och likadant för en ändrings `store-order-<id>-<updatedAt>`. Portalens id:n är uuid, så det händer inte i dag, men
    kontraktet bör säga att id:n är uuid, eller nycklarna få ett eget prefix per anrop (`store-order-withdraw-<id>`).
    **Besvarat av portalen (@ `e9b55aa`):** portalens id:n är uuid, eftersom databasen ger dem, och nycklarnas format
    ändras inte.
36. **Kontot i portalens kopia är inaktuellt** (fas 8b3, 2026-09-29): "Kvar hos ekonomi" säger att en beställning till en
    butik med omvänd moms bokförs på 3231. Sedan CRM-PR #259 bär varje rad sitt konto efter dokumentets moms, alltså 3001
    för en beställning (25 %). Fakturatexten "Omvänd betalningsskyldighet" följer fortfarande kundkortet (öppen fråga,
    före fas 9).
37. **Butiksbeställningarnas status tillbaka** (fas 8b3): Idempotency-Key är `<type>-<orderId>-<occurredAt>`, och
    `occurredAt` är när Ekovilla gjorde steget (Bekräfta, Levererad, Fakturera, Makulera), i UTC med `Z`, inte när
    händelsen köades. `confirmedAt` är samma tid som `occurredAt`: när beställningen låstes, inte när Fortnox-numret kom.
    `store_order.confirmed` skickas först när Fortnox-numret finns, och inget efter den förrän den är mottagen (2xx).
    `store_order.cancelled` kan komma till en beställning som aldrig fått `store_order.confirmed`, också när portalen
    redan fått 409 på en ändring. `reason` är aldrig tom.
38. **En sen `job.scheduled` skriver över datumen efter Utförd** (portalen, lokal genomkörning 2026-09-29): statusen står
    kvar, men `scheduled_for` och `scheduled_until` byts. CRM:et skickar ingen `job.scheduled` efter `job.completed`
    (rättelse 22), så bara ett uppspelat anrop kan göra det. Förslag: portalen ignorerar datumen när jobbet är utfört.

## Nästa: partner från CRM:et och egna priser (beslut 2026-10-01)

Fas 5 är klar, och fas 9 (påslaget i prod) väntar på portalens prodprojekt. Under tiden har William svarat på hur fler
bygghandlare och andra partner ska komma in. Designfrågorna avgjordes 2026-10-01, se "Besluten" nedan. **10a byggs på
grenen `feature/reseller-portal-10a`.**

**Williams svar:**
1. **Inbjudan sker från CRM:et, inte med skript.** En kund flaggas som partner eller återförsäljare, och kundkortet får
   knappen **"Bjud in till portalen"**. Det hör hemma där, eftersom en partner måste vara kund hos Ekovilla med
   kundnummer.
2. **En gemensam vy för en kedja**, till exempel Beijer i flera län, kan behövas. Den tas **senare**.
3. **Egna priser per partner: ja.** En partner kan vara en återförsäljare, men också till exempel ett
   ventilationsföretag som säljer in isoleringen åt sina kunder när de gör ventilationsarbete.

**Läget i dag** (portalen och CRM:et):
- Varje butik är ett eget företag i portalen, med egna användare, offerter, jobb, beställningar, logga, villkor och
  påslag. Portalens RLS (`private.current_reseller_id()`) spärrar allt till det egna företaget.
- Ett konto hör till exakt en butik. Butiker i samma kedja är separata företag, även när de delar kundnummer (beslut
  2026-09-26).
- Ett nytt företag och dess första admin skapas i dag med skript (`scripts/testmiljo.mjs` i portalen). Det finns ingen
  yta för det. `resellers.ekovilla_customer_number` sätts bara av Ekovilla. Därefter bjuder butikens admin in sina
  kollegor under Inställningar.
- I CRM:et dyker en butik upp under "Butiker och säljare" först när den skickar sitt första jobb. Saknar den
  kundnummer måste den kopplas för hand (3c), annars skapas ingen Fortnox-order. Det såg vi i testmiljön 2026-09-30.
- Prislistan är gemensam: lista 160, med `reseller_id` null. Portalens `pricelists.reseller_id` har stöd för en lista
  per butik, men CRM:et publicerar bara den gemensamma.

**Fakta som styrde besluten** (läst i båda repona 2026-10-01):
- Kundkortets typ är bara `business` eller `private`, och `customer_type` styr moms och ROT. Partnerskapet kan alltså
  inte bli en ny kundtyp.
- Sessionen har **tabellgrant** på `crm_customers`. En ny kolumn där hade varit skrivbar för varje säljare som får ändra
  kortet, och en kolumnspärr gör ingenting mot en tabellgrant.
- I portalen är `reseller_users.user_id` primärnyckel: **ett konto hör till exakt ett företag**. Samma e-postadress kan
  inte bli admin i två butiker.
- Portalens inbjudan är Supabase `inviteUserByEmail`. Länken gäller i **24 timmar och en gång**, så CRM:et måste kunna
  skicka inbjudan igen.
- Portalen läser prislistan med "egen lista före gemensam, sedan senaste datum"
  (`lib/data/supabase/pricelist.ts`). **En butik som en gång fått en egen lista ser alltså aldrig en nyare gemensam.**
- CRM:ets utskick går via kön och läser aldrig portalens svarskropp. Bara status och början av ett felsvar sparas.
- Massynken av kunder läser Fortnox lista över kunder och skriver `price_list` ur den. Att listanropet har `PriceList`
  är inte bekräftat, så kolumnen kan vara inaktuell.

### Besluten (William 2026-10-01)

1. **Samma portal för alla partner.** Typen, Återförsäljare eller Partner, finns bara i CRM:et. Ett
   ventilationsföretag ser också Beställningar och butikstexterna. Typen kan skickas till portalen senare.
2. **Partnerns prislista är den som står på kundkortet i Fortnox** (`PriceList`). Står standardlistan `A`, `160` eller
   inget där gäller lista 160. Priser och lista ändras i Fortnox, som i dag.
3. **En partnerlista har bara de avvikande priserna.** Övriga artiklar får sitt pris från 160.
4. **Alla listor publiceras samtidigt.** Publicera-knappen skickar 160 och varje partnerlista med samma giltighetsdatum.
5. **Bara admin** (`crm.portal.manage`) flaggar och bjuder in, eftersom inbjudan skapar konton i ett annat system.
   Säljarna kan inte (antagande, inte invänt mot).

### 10a: partnern bjuds in från kundkortet

**I CRM:et:**
- **Flaggan** är en egen tabell, `crm_portal_partners` (`customer_id` som nyckel och `partner_type` `reseller` eller
  `partner`). Bara `crm.portal.manage` läser och skriver den. Den ger ingen åtkomst i sig, men knappen kräver den.
- **Rutan "Återförsäljarportalen"** sitter i kundkortets högerspalt. Den syns bara när integrationen är påslagen i
  miljön och användaren har `crm.portal.manage`, och bara på företagskort. I prod syns den alltså inte förrän fas 9.
  - Saknar kortet Fortnox-nummer säger rutan det, och knappen saknas.
  - Där väljer admin typen och trycker på **"Bjud in till portalen"**. Butikens namn och adress är förifyllda från
    kortet. Admin fyller i den första adminens namn och e-post.
  - Rutan listar kortets företag i portalen, både inbjudna och de som kopplats på annat sätt, med inbjudans status och
    **"Skicka inbjudan igen"**. Ett kort kan bli flera företag, eftersom en kedja kan dela kundnummer mellan butiker.
- **CRM:et väljer företagets id själv**, ett uuid. Inbjudan sparar först raden i `crm_portal_resellers`, med
  kundkopplingen som en koppling för hand (`customer_linked_by` och `customer_linked_at`), och sedan inbjudan i
  `crm_portal_reseller_invites`. Därefter köas anropet och skickas direkt, som publiceringen av prislistan. Det
  första jobbet har alltså alltid kund, och kön sköter omförsöken.
- Intaget kopplar redan om butiken efter kundnumret när ett jobb kommer, och låter en koppling för hand stå kvar när
  numret saknas. Inget i intaget behöver ändras.

**Kontraktet, flöde 5: partner bjuds in (CRM → portal).** William för det vidare till portalen.

`POST /api/ekovilla/resellers`, signerat som de andra anropen.
`Idempotency-Key: reseller-invite-<resellerId>-<n>`, där `n` är CRM:ets försöksnummer för företaget: 1 för inbjudan,
2 för första "Skicka inbjudan igen" och så vidare. Kön gör om samma försök med samma nyckel.

```json
{
  "resellerId": "6f1c2a9e-4b7d-4f0e-9a51-0c3d2e8b7a64",
  "name": "Beijer Bygg Gävle",
  "organizationNumber": "556123-4567",
  "address": { "street": "Industrigatan 4", "postalCode": "802 22", "city": "Gävle" },
  "phone": "026-12 34 56",
  "email": "gavle@exempel.se",
  "ekovillaCustomerNumber": "1234",
  "admin": { "name": "Anna Berg", "email": "anna.berg@exempel.se" }
}
```

- `resellerId` är ett uuid med gemener, valt av CRM:et. Portalen använder det som företagets `id`.
- `organizationNumber`, `phone` och `email` gäller företaget och kan vara tomma strängar.
  `ekovillaCustomerNumber` är alltid satt: CRM:et bjuder bara in kort med Fortnox-nummer.
- Längder enligt CRM:ets tabell: `name` 1–200 tecken, `street` högst 200, `postalCode` högst 20, `city` högst 100.
  `admin.name` 1–200 tecken och `admin.email` högst 254.

Svaren har kontraktets kuvert (punkt 18). Framgång är `{ "ok": true, "data": { "resellerId": "…", "admin": "invited" } }`,
där `admin` är `invited` eller `active`. CRM:et läser inte kroppen vid framgång. Ett fel bär koden i
`errorDetails.code`.
- **201**, när företaget inte fanns: portalen skapar företaget med uppgifterna och kundnumret, och bjuder in admin med
  rollen admin.
- **200**, när företaget redan finns (ett omförsök, eller "Skicka inbjudan igen"). Företagets uppgifter och kundnummer
  ändras inte, eftersom butiken kan ha ändrat dem under Inställningar. För admin gäller:
  - en användare i företaget som inte valt lösenord får inbjudan igen;
  - en användare i företaget som redan valt lösenord får ingenting;
  - en adress som inte finns i portalen bjuds in som admin i företaget.
- **409 med koden `admin_email_taken`**, när adressen hör till ett konto i ett **annat** företag. Portalen prövar det
  innan den skapar något. CRM:et visar felet, och admin kan försöka igen med en annan adress.
- **422** för en ogiltig kropp. Texten i `error` visas för admin på kundkortet.

Allt annat följer kontraktet: 5xx görs om, övriga 4xx ges upp och visas på kortet.

### 10a: resultat (2026-10-01)

**Byggt:**
- **Migreringen** `20261001083346_portal_partners.sql` skapar två tabeller:
  - `crm_portal_partners`, flaggan. Sessionen läser och skriver den bakom RLS (`crm.portal.manage`, bara i eget namn).
  - `crm_portal_reseller_invites`, försöken med kroppen som skickades. Sessionen läser, service_role skriver.

  Den är additiv och kan gå till prod före koden. Den prövades två gånger i en transaktion och sedan per roll:
  säljaren ser och skriver ingenting, admin bara i eget namn, och sessionen kan inte skriva inbjudningar.
- **Domänen:** `partners.ts` är ren (reglerna, kroppen och portalens nej i klartext). `partnersStore.ts` har rutan,
  flaggan och inbjudan. Läsningen av en händelses status i kön är utbruten till `outboxDelivery.ts`, som publiceringen
  av prislistan också använder.
- **Routerna:** `GET` och `PUT /api/crm/portal/partners/[customerId]`, och `POST …/invites` med `mode` `new` eller
  `resend`.
- **Rutan** `app/crm/kunder/PortalPartnerCard.tsx` i kundkortets högerspalt. Sidan visar den bara för
  `crm.portal.manage` och bara när integrationen är påslagen.
  - Den syns alltså inte i prod förrän fas 9.
  - Fliken Utskick visar en inbjudan som "Inbjudan", med företaget och adminen.

**Så beter sig inbjudan:**
- Ett dubbelklick blir samma inbjudan, eftersom formuläret väljer företagets id när det öppnas.
- "Skicka igen" kräver det försök admin såg. Ett försök som fortfarande väntar ersätts av det nya.
- Ett nekat första försök följs av ett nytt försök som skapar företaget, med förra försökets uppgifter.
- Ett företag som kom till portalen på annat sätt (skript, jobb) får "Bjud in en admin", byggt ur butikens rad och
  kortet.

**Prövat lokalt mot en fejkportal** (signaturen prövad som portalen gör, 409 `admin_email_taken` för en viss adress):
Playwright som admin gav tolv gröna kontroller:
- flaggan, och formuläret förifyllt ur kortet;
- inbjudan skickad, med adressen i gemener;
- portalens nej på kortet, och "Skicka igen" med en ny adress;
- ett kort med företag från jobb, och ett kort utan kundnummer;
- fliken Utskick;
- säljaren ser ingen ruta.

Fejkportalen fick tre signerade anrop med kontraktets exakta fält. Fjorton skydd är mutationsprövade.

**Granskningen** (en runda, tio fynd, åtta lagade):
- Ett nytt tryck efter att köandet föll köar nu den sparade inbjudan.
- En kvarlämnad rad får formulärets uppgifter.
- Kortets e-post följer bara med som förval om den är giltig.
- Rutan läses om när kortet sparas, till exempel efter "Skapa i Fortnox".
- Ett fel vid omläsningen visas.
- Id:t byggs med `getRandomValues`, som finns också utanför https.

Två fynd lagades inte: den fjärde kopian av fetch-hjälparen, och företaget som står kvar efter ett nej (nedan).

**Känt:**
- Ett företag vars första inbjudan nekas står kvar på kortet och under "Butiker och säljare" tills en inbjudan går
  fram. Rutan visar varför det nekades och erbjuder "Skicka inbjudan igen". Att kunna ta bort det byggs om det behövs.
- "Senast hörd av" under "Butiker och säljare" visar inbjudans tid för en butik som ännu inte hört av sig.
- Portalens mottagare finns inte än. Tills den finns ger varje inbjudan 404 i portalen och ges upp. Kör därför inte
  inbjudan mot test.partner.ekovilla.se förrän portalen byggt flöde 5.

### 10b: egna prislistor

- Publiceringen läser kortets `PriceList` **direkt från Fortnox** (`GET /customers/{nummer}`) för varje kort som har
  butiker i portalen, inte ur CRM:ets kolumn.
- Ett kort med en egen lista ger varje butik på kortet en egen lista: 160 med kortets avvikande priser ovanpå. Allt
  publiceras i ett svep med samma datum. Faller en lista att läsa publiceras ingenting.
- **Förslag till portalen inför 10b:** välj den senaste listan efter datum, och vid samma datum egen före gemensam.
  - Med den regeln får en butik som gått tillbaka till 160 den gemensamma listan vid nästa publicering.
  - Med dagens regel behåller en sådan butik sin gamla egna lista för alltid. CRM:et skulle då behöva skicka en egen
    kopia av 160 till varje butik som en gång haft en egen lista.
- **CRM:et väntar inte på portalens svar.** 10b2 skickar en egen lista till varje butik som en gång haft en, med 160:s
  innehåll om kortet gått tillbaka. Det blir rätt med båda reglerna, så portalens ändring är en förenkling, inget krav.
- **Två PR:er:**
  - 10b1 är förhandsvisningen. Den behöver ingen migrering och ändrar inte publiceringen.
  - 10b2 publicerar alla listor samtidigt, med historik per butik. Den behöver en migrering.

### 10b1: resultat (2026-10-01)

**Byggt:**
- **`partnerPricelists.ts`** (ren) har reglerna:
  - kortets lista, där A, 160 eller inget betyder den gemensamma;
  - 160 med partnerns grundpris ovanpå;
  - priserna som skiljer sig;
  - butikerna grupperade per lista.
- **`partnerPricelistSources.ts`** läser butikerna med kort (sessionen), kortets `PriceList` och partnerlistans priser.
  - Fortnox läses en gång per kort och en gång per lista.
  - Ett kort eller en lista som inte går att läsa blir ett synligt problem för just sina butiker.
- **`getFortnoxCustomerPriceList`** i `lib/domains/fortnox/customers.ts` läser kortet direkt.
  `loadPricelistInputs` lämnar ut källorna, så att partnerlistorna räknas på samma portalfält och register som 160.
- **Portalsidan** har kortet "Butikernas egna prislistor" under förhandsvisningen.
  - Kortet visar varje egen lista med butikerna och priserna som skiljer sig från 160, och vilka butiker som får 160.
  - Det syns bara när någon butik har ett kundkort, alltså inte i prod före påslaget.
  - Det säger att bara lista 160 publiceras än.

**Prövat lokalt mot testbolaget:**
- Testbolaget har listorna A, B och 160, och alla lästa kunder står på A.
- Kund 13 (Bergströms, två butiker) sattes på B. Kortet visade då lista B med 48 artiklar och sex avvikande priser
  bland de markerade artiklarna. Kund 13 står på A igen.
- På mobil rymdes kortet först inte (grid-fällan); det är rättat med `grid-cols-1` och `min-w-0`.
- Nio skydd är mutationsprövade.

**Granskningen** (en runda, nio fynd, fyra lagade):
- Ett kundkort som sessionen inte ser blir ett problem, aldrig tyst lista 160.
- Fortnox läses parallellt med lista 160, högst fyra anrop åt gången: `readPartnerPricelists` läser,
  `buildPartnerPricelists` är ren.
- Problemens React-nyckel är kortets id eller listans kod.
- Testets Fortnox-mock släpps i `finally`.

Fem lagades inte:
- **Två läsningar av butikstabellen på sidan:** 10b2:s publicering behöver läsningen utan sidan.
- **Koder som bara skiljer sig i versaler:** Fortnox äger koden, och två läsningar av samma lista är ofarliga.
- **Felöversättningen två gånger:** fyra rader med olika prefix.
- **Hashen "i onödan":** fel premiss, `buildPricelistDraft` räknar den alltid, och 10b2 behöver den.
- **Partnerlistornas hash** används först av 10b2.

### 10b2: resultat (2026-10-01)

**William 2026-10-01:** en ny partner med egen lista får sin lista automatiskt när inbjudan gått fram, med samma
giltighetsdatum som den senaste publiceringen. Det byggs i 10b3.

**Byggt:**
- **Migreringen** `20261001102248_portal_pricelist_per_store.sql` lägger till `reseller_id` och `price_list_code` på
  `crm_portal_pricelist_publications` (båda får vara null). Nyckelns check godtar nu också `…-<löpnummer>-<id>`.
  - Den är additiv, och en rad utan butik har samma form som förut.
  - Den prövades två gånger i en transaktion. Fel nyckel, ett id av bara punkter och en butik som saknas i nyckeln nekas.
- **`pricelistBatch.ts`** (ren) avgör vad en publicering består av:
  - lista 160;
  - en egen lista per butik vars kort har en;
  - lista 160 som egen lista till butiker som haft en egen;
  - ingen lista till en butik vars inbjudan inte gått fram.

  Ett kort eller en lista som inte går att läsa stoppar allt. Med bara lista 160 är hashen listans egen, så
  publiceringen är exakt som förut: samma förhandsvisning, nyckel, kropp och ordning. Det gäller prod.
- **`pricelistBatchSources.ts`** läser allt samtidigt: lista 160, butikernas listor och historiken. Historiken är vilka
  butiker som haft en egen lista och vilka inbjudningar som gått fram. Publiceringarna och inbjudningarna läses sida för
  sida, eftersom PostgREST kapar vid 1000 rader.
- **`publishPricelist`:**
  - Den får läsningen injicerad (`loadBatch`) och sparar alla rader i ett anrop.
  - Varje butiks lista köas i butikens ordning, `pricelist:<id>`, så att "Skicka om" fungerar per butik.
  - Samma listor till samma butiker, med samma datum och utan nej, räknas som samma publicering.
- **Historiken** visar en publicering per löpnummer, med varje lista och den sämsta statusen.
- **Sidan:** förhandsvisningen bär hela publiceringens hash. Kortet för butikernas listor visar kopiorna av 160 och
  butikerna som väntar på sin inbjudan, och publiceringen räknar listorna. Fliken Utskick visar en butiks lista som
  "Prislistan, butikens egen lista".

**Prövat lokalt mot testbolaget och en fejkportal:**
- Med kund 13 på B gick tre listor ut: 160 till alla, och B till Bergströms två butiker (650 kr i stället för 560 kr på
  artikel 16767).
- Med kund 13 tillbaka på A gick tre listor ut igen. Den här gången var det 160 som egen lista till de två butikerna.
- Alla anrop var signerade och mottagna, och historiken visade listorna per butik.
- Femton skydd är mutationsprövade.

**Granskningen** (en runda, tio fynd, nio lagade):
- En butik som väntar på sin inbjudan kan inte stoppa publiceringen.
- Publiceringens tak höjdes till 120 s.
- Historiken läser hela publiceringar och klipper dem aldrig.
- Löpnumret är unikt per butik (unikt index): en samtidig publicering får "ändrad".
- En väntande butik står bara under "väntar".
- Sidindelningen och de uppdelade läsningarna använder `planning/pagedRead.ts`.
- Nyckeln för "samma publicering" är delad (`pricelistBatchKey`).
- Den döda koden är borta.
- Notisen visar det senaste felet igen.

Lagades inte: läsningen av vilka butiker som haft en egen lista växer med publiceringarna. Det blir några tusen små rader
per år, som sidindelningen klarar. En vy med `distinct` hade krävt nya grants för liten vinst.

**Lärdom:** en sidladdning föll en gång med "Något gick fel mot Fortnox", direkt efter att ett skript i en annan process
förnyat den lokala Fortnox-tokenen. Det är samma race mellan processer som under "Fas 5: resultat". Nästa laddning
fungerade.

### 10b3: listan efter inbjudan (2026-10-01)

**Williams beslut 2026-10-01** (alla enligt förslaget):
- **När:** ett steg i portalens cron, efter att inbjudan gått fram. Steget körs också av "Skicka väntande nu", eftersom
  testmiljön saknar cron. Det körs en gång per butik, så kortet läses i Fortnox en gång.
  - Listan köas inte vid inbjudan i `reseller:<id>`, som planen först sa. Det hade gett samma butik två ordningar i kön,
    och då kan en sen lista gå fram efter en nyare. "Skicka om" ser dessutom bara senare händelser i samma ordning.
  - Listan går i butikens egen ordning, `pricelist:<id>`, som publiceringens listor.
- **Raden:** listan läggs till i den **senaste** publiceringen, med samma löpnummer och datum. En publicering är
  fortfarande alla listor.
- **Innehållet:** den **publicerade** lista 160 med kortets grundpriser ovanpå, inte 160 som den ser ut nu. Det som
  ändrats i Fortnox eller i portalfälten sedan publiceringen går ut först vid nästa Publicera.

**Byggt:**
- **Migreringen** `20261001152140_portal_invite_pricelist.sql` ger `crm_portal_reseller_invites` tre kolumner:
  `pricelist_settled_at`, `pricelist_attempted_at` och `pricelist_error` (högst 500 tecken).
  - Den är additiv. Sessionen läser kolumnerna men skriver dem aldrig; servern skriver.
  - Efterkontrollen prövar det, och den prövades med tre mutationer.
- **`invitePricelist.ts`** (ren): `listFromPublished` byter 160:s grundpris mot kortets, avrundat till ören.
  - Med en oförändrad 160 blir listan exakt den en publicering hade byggt, med samma hash.
  - En artikel som saknar pris på 160 men har ett på kortets lista kommer med först vid nästa publicering.
- **`invitePricelistStore.ts`** (`sweepInvitePricelists`) tar butiker vars inbjudan gått fram och som inte är klara:
  - Klar utan lista: ingen publicering än, butiken redan med i den senaste, kortet på den gemensamma listan (A, 160,
    ingen) eller inget kundnummer.
  - En butik som haft en egen lista får 160 som egen lista.
  - Ordningen tål ett avbrott var som helst. Först läggs raden in, sedan kontrolleras att ingen nyare publicering kommit,
    sedan köas listan och sist markeras butiken klar.
  - En rad som lagts in men inte köats köas nästa varv. En nyare publicering emellan tar bort raden. Ett annat varv i
    samma stund ger en rad och en händelse.
  - Ett fel görs om tidigast efter 15 minuter. En avstängd integration köar ingenting.
  - Från knapparna tas en butik per klick, i cron högst tio, och bara inom samma startgräns som dokumenten: två
    Fortnox-anrop per butik, och Fortnox-klienten har ingen tidsgräns.
- **Publiceringen** nollar markeringen för butikerna som väntade på sin inbjudan när listorna lästes, så att steget
  prövar dem igen.
- **Cron:** steget körs efter utskicket, där inbjudan går fram. Köades en lista skickas kön en gång till i samma varv.
- **Sidan:** en butik vars inbjudan inte gått fram får texten "När inbjudan gått fram får det sin lista av sig själv,
  med den senaste publiceringens datum."

**Prövat lokalt mot testbolaget och fejkportalen** (inbjudan med admin@example.test, sedan två varv av
`runPortalCron` som "Skicka väntande nu"):
- Kund 13 sattes på B och ett nytt företag bjöds in på kortet. Inbjudan gick fram (201).
- Varv 1 markerade Bergströms två befintliga butiker som klara utan att läsa Fortnox; de var redan med i publicering 3.
- Varv 2 lade den nya butikens lista i publicering 3 (2026-10-01, lista B, 48 artiklar). Den köades i `pricelist:<id>`
  och gick fram (201) i samma varv; artikel 16767 kostade 650 kr i stället för 560 kr.
- En förhandsvisning efteråt gav butiken samma hash (`9cd4903e…`), med 160 oförändrad.
- Kund 13 står på A igen.
- Efter granskningen kördes kedjan en gång till, med ett nytt företag: listan gick fram redan i det första varvet.

**Granskningen** (två rundor). Runda 1 gav nio fynd, varav sju lagades:
- Kontrollen av en nyare publicering görs **efter** köandet. En publicering som köar butikens lista före vår syns
  då, och vår lista står bakom den i butikens ordning. Vår lista stoppas medan den väntar, och raden tas bort om steget
  lade in den.
- Den nyare publiceringen kan sakna butiken, om dess förhandsvisning lästes innan inbjudan gick fram. Butiken prövas
  därför mot den, och listan läggs där.
- Har vår lista redan börjat gå får den gå, eftersom den går före den nyare.
- En krock med ett annat varv läser om publiceringen i stället för att kasta.
- Leveranserna läses i portioner om hundra.
- De nyaste inbjudningarna läses först. En inbjudan som aldrig går fram blir aldrig klar, och de äldsta först hade
  låtit sådana tränga ut en ny.
- En butik utan kort som haft en egen lista får 160 som egen lista, som i publiceringen.

Lagades inte:
- **En rad som aldrig köades i en äldre publicering** blir kvar i historien som "inte köad". Det kräver att varvet dör
  mellan raden och köandet, några millisekunder, och att någon publicerar innan nästa varv.
- **Publiceringen läses för varje butik.** Premissen "varje cron-varv" stämmer inte: ett varv utan kandidater läser
  ingenting, och kandidater finns bara efter en ny inbjudan.

Runda 2 gav tre fynd, och alla lagades:
- **En publicering som läste sina listor innan inbjudan gick fram och sparas efter steget.** Den saknar butiken, som
  steget redan markerat klar. Publiceringen nollar därför markeringen för butikerna i sin egen förhandsvisnings
  "väntar", så att steget prövar dem igen och lägger listan i den nya publiceringen.
- **Ingen tidsgräns i knappvarvet.** Steget följer dokumentens startgräns och tar en butik per klick.
- **`published_by` pekar på `profiles`, men inbjudarens id gör det inte.** En borttagen profil hade fällt varje
  försök. Raden får därför bara inbjudarens namn.

**Senare:** kedjevyn. Modellen låser den inte: ett kort med flera butiker kan bli grunden.

**Fortfarande öppet inför fas 9** (Williams beslut behövs; se också "Öppna frågor" nedan):
- vem är reserven i prod?
- ska köparens momsnummer krävas vid omvänd moms (hela CRM:et)?
- fakturatexten vid 0 % till en butik med vanlig moms på kortet;
- vem planeringens datumbekräftelse går till;
- menyposten "Butiksbeställningar" vid påslaget.

## Öppna frågor

Ingen av dem stoppar fas 0–7.

- ✅ **Momsen** (kontraktets fråga 4): besvarad av William 2026-09-29, se "Fas 8: spiken om momsen" och punkt 34.
- ✅ **Kontot vid moms som avviker från kundkortet**: konto per rad, se "Fas 8: spiken om momsen".
- **Köparens momsregistreringsnummer vid omvänd moms** (före fas 9, gäller hela CRM:et): en faktura med omvänd
  byggmoms ska bära köparens momsregistreringsnummer, men fullständighetskontrollen kräver det inte, varken för
  portaljobben eller för CRM:ets egna byggmomsordrar. Fortnox skriver "Ert VAT-nummer" ur kundkortets `VATNumber`.
- **Fakturatexten vid moms som avviker från kundkortet** (senare, men **före fas 9**: då får varje portaljobb till en
  butik med vanlig moms på kortet en faktura med 0 % utan texten, som en faktura med omvänd moms måste ha): Fortnox faktura skriver "Omvänd
  betalningsskyldighet" vid 25 % till en kund med omvänd moms, och texten saknas vid 0 % till en kund med vanlig moms.
  Texten följer kortets momstyp när dokumentet skapas; enda vägen är att kortet har dokumentets momstyp i det ögonblicket
  (vända kortet kring skapandet: risk att ett dokument som skapas för samma kund i Fortnox samtidigt får fel momstyp).
- ✅ **Ett avbrutet jobb** (fråga 5): `job.cancelled`, byggt i fas 4b (punkt 20).
- ✅ **Dokumenten** (fråga 7): orderbekräftelsen och egenkontrollen, byggt i fas 7 (punkt 28–30).
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
- ✅ `jobState.ts` tabelldrivet: bekräftad före planerad, datum som flyttas och tas bort, pausade kort,
  flera etapper, `partially_invoiced` skickar inget, steg bakåt, avbruten.
- ✅ Planerat datum: triggern prövad mot den lokala databasen (lägg, flytta, pausa, ta bort, radera
  arbetsordern) och ett SQL-texttest för grants och `security definer`.
- Kön: 5xx och timeout görs om, 4xx ger upp, tre snabba flyttar blir en händelse.

**Lokalt↔lokalt** (✅ hela kedjan mot den riktiga portalen 2026-09-29, och i webbläsaren 2026-10-02, se "Lokal genomkörning av hela kedjan" och "Lokal genomkörning 2"):
- ✅ Publicera prislistan två gånger: samma nyckel, samma svar (mot fejkportalen, fas 2b; mot portalen 2026-09-29).
- Samma jobb från portalen två gånger ger en arbetsorder och en Fortnox-order. Samma `quoteId` med en
  ny nyckel ger den befintliga.
- ✅ Ett jobb från portalen blir "Bekräftad" utan att någon hos Ekovilla gör något. Ett kort i
  planeringen ger "Planerad" med start- och slutdag; att flytta kortet uppdaterar datumen, att ta bort
  det ger "inte längre planerad" (mot fejkportalen, fas 4b).

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
