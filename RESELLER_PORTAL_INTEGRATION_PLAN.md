# Partnerportalen ↔ CRM:et: integrationen (fas 5 och 6)

**Status:** kontrakt, beslutat med William 2026-09-27. Signaturen och omförsöken ändrades
2026-09-28, och samma dag fördes CRM:ets rättelser 16–19 in (sökvägarna, prislistans nyckel,
svarens kuvert och jobbets felkoder), 20–23 från CRM:ets fas 4b (avbrutet jobb utan skäl,
planeringens slutdag, bara framåt, tider och nycklar), 24–27 från fas 6 (meddelandena), 28–30 från
fas 7 (dokumenten), 31–35 från fas 8a (butiksbeställningarnas intag och momsen) och 36–38 från fas
8b3 och den lokala genomkörningen 29 september (kontot, beställningarnas status tillbaka och en sen
planering). Båda halvorna är byggda, och CRM:et kördes mot portalen lokalt 29 september, alla
flöden. Flöde 5, inbjudan från kundkortet, kom från CRM:ets 10a 1 oktober och är byggt i båda.
Se "Det här finns i portalen".
**Källa:** `prodigystudios/aterforsaljare-ekovilla`, filen `CRM_INTEGRATION.md`. En kopia ligger i
CRM-repot som `RESELLER_PORTAL_INTEGRATION_PLAN.md`. Ändras kontraktet ändras det i båda.
**Hur CRM:et bygger sin halva** står i CRM-repots `RESELLER_PORTAL_CRM_PLAN.md`, läst mot CRM:et
@ `f77d0cb` (PR #265). Rättelserna står där under "Rättelser och luckor i kontraktet".
Kontrollera varje filhänvisning mot koden innan du bygger på den. CRM:et byggs om (RBAC, SSR,
säkerhetsmigreringar).

Det här dokumentet är skrivet för dig som arbetar i CRM-repot (`BlikkIntegration_ekovilla`, alltså
app.ekovilla.se), och för portalen. Det säger vad portalen är, vad den skickar och vad den vill ha
tillbaka. Affärsreglerna bakom finns i portalens `DOMAIN.md`.

---

## Portalen i korthet

partner.ekovilla.se är en egen app med egen Supabase och egen Vercel. Återförsäljare, alltså butiker
som K-Bygg Sandviken, loggar in där och gör två saker som berör Ekovilla:

1. **Offerter till sina kunder.** Butiken räknar på Ekovillas prislista 160 (Byggvaruhandel),
   lägger på sin marginal och skickar offerten. Kunden signerar i mobilen. Sedan skickar butiken
   **ordern till Ekovilla**, som utför jobbet och fakturerar butiken.
2. **Butiksbeställningar.** Butiken köper produkter (skivor, dukar, tejp, lösull i säck) till
   inpris för att sälja i sin egen butik. Ekovilla levererar och fakturerar butiken.

Portalen följer sedan jobbets och beställningens status, och butiken skriver med Ekovilla på varje
jobb. Allt det kommer från CRM:et.

### Gränser som inte får brytas

- **Ekovilla får aldrig slutkundens pris, butikens påslag eller marginal.** Portalen skickar bara
  inpris. Lägg inte till fält i CRM:et som förutsätter något annat.
- **Slutkundens personnummer och signatur lämnar aldrig portalen.** ROT sköts mellan butiken och
  kunden. Ekovilla fakturerar butiken, inte slutkunden.
- **Systemen delar ingen databas och ingen lagring.** Allt går via signerade HTTP-anrop i båda
  riktningarna.
- **Portalen pratar aldrig med Fortnox.** CRM:et äger Fortnox-kopplingen. Fortnox byter
  refresh-token vid varje förnyelse, så två system kan inte dela den.
- **En återförsäljare i portalen är en butik.** Två butiker kan dela kundnummer i Ekovillas Fortnox.
  Kundnumret identifierar alltså inte en butik. Portalens `resellerId` gör det.

---

## Besluten (William, 27–28 september 2026)

| Fråga | Beslut |
| --- | --- |
| Testmiljön | CRM:et får test.app.ekovilla.se: grenen `testmiljo`, eget Supabase-projekt och Fortnox testbolaget. Den sätts upp när någon utanför ska testa. Tills dess byggs och testas allt lokalt↔lokalt. |
| Granskning | **Ekovilla granskar inte ordern.** Butikens godkännande i portalen räcker. CRM:et skapar arbetsordern och Fortnox-ordern automatiskt. |
| Butiksbeställningar | **Väg B:** en egen tabell i CRM:et och ett eget `POST /orders` till Fortnox. |
| Prislistan | Fälten redigeras per artikel i CRM:et. En admin publicerar med en knapp och väljer `validFrom`. |
| Avbrutet jobb | En ny händelse, `job.cancelled`. Portalen visar jobbet som **Avbrutet**, med skälet. |
| Dokument | Butiken får **orderbekräftelsen och egenkontrollen**. |
| Avsändare på meddelanden | **Namn och avdelning**, till exempel "Anna Berg · Planering". Avdelningen är en fast lista, se `job.message`. |
| Signaturen (28 september) | **Metoden och sökvägen signeras med kroppen**, så att en signatur bara gäller för sitt eget anrop. Ett 401 görs om med backoff. Se "Transporten". |
| Moms mellan Ekovilla och butiken (29 september) | **Per dokument, som i CRM:et i dag:** ett jobb har 0 % (omvänd skattskyldighet), en butiksbeställning 25 %, också på frakten. Se sist. |

---

## Fem flöden

| # | Flöde | Riktning | Vad CRM:et gör |
| --- | --- | --- | --- |
| 1 | Prislistan | CRM → portal | Läser lista 160 ur Fortnox, lägger till Ekovillas egna fält per artikel och publicerar till portalen. |
| 2 | Jobb | portal → CRM, status tillbaka | Tar emot ordern, hittar butikens kund, fördelar till en säljare, skapar arbetsordern och Fortnox-ordern, och skickar status, meddelanden och dokument tillbaka. |
| 3 | Butiksbeställning | portal → CRM, status tillbaka | Tar emot, ändrar eller drar tillbaka en beställning före bekräftelsen. Lägger på frakt, bekräftar och skickar status tillbaka. |
| 4 | Meddelanden på jobb | båda håll | Visar butikens meddelanden på arbetsordern och skickar säljarens svar tillbaka. |
| 5 | Partner bjuds in | CRM → portal | Bjuder in en partner från kundkortet. Portalen skapar företaget och bjuder in dess första admin. |

---

## Transporten (gemensamt för alla flöden)

CRM:et har transporten i `lib/domains/portal/` och grinden i `app/api/portal/_shared.ts`. Portalen
har den i `lib/crm/`. Båda följer reglerna nedan och prövar samma testvektor.

### Signatur

Varje anrop, i båda riktningarna, signeras med HMAC-SHA256 och en delad hemlighet per miljö.
Metoden och sökvägen signeras med kroppen (beslutat 2026-09-28). Utan dem gällde en signatur för
vilken route som helst, åt båda hållen, i 300 sekunder. En signerad ping med tom kropp hade då
räckt för att dra tillbaka en annan beställning.

- **Hemligheten** heter `PORTAL_CRM_SHARED_SECRET` i båda apparna.
  - Den är minst 32 tecken och trimmas på båda sidor innan den används.
  - Den är olika lokalt, i testmiljön och i produktionen.
  - Den ligger aldrig i koden.
- **Headers:**
  - `X-Ekovilla-Timestamp`: unix-sekunder.
  - `X-Ekovilla-Signature`: `v1=` följt av hex av `HMAC_SHA256(hemlighet, det som signeras)`.
- **Det som signeras** är fyra fält åtskilda med radbrytning (`\n`):

  ```
  tidsstämpel + "\n" + METOD + "\n" + sökväg + "\n" + råkropp
  ```

  - **`METOD`** skrivs med versaler, till exempel `POST` eller `PUT`.
  - **`sökväg`** skrivs som den står i URL:en, procentkodad, utan värd och frågesträng. Ett exempel
    är `/api/portal/jobs/q-2026-015/messages`.
  - **`råkropp`** är kroppen exakt som den skickas, i UTF-8.
  - **Radbrytningen skiljer fälten entydigt.** Med en punkt hade `/a.b` + `c` och `/a` + `b.c`
    gett samma sträng.
- **Sökvägarna** har bara tecken som aldrig procentkodas: A–Z, a–z, 0–9 och `- _ . ~` (rättelse 16).
  Det gäller också id:n i sökvägen (`quoteId`, `orderId`). Då är sökvägen densamma för avsändaren
  och mottagaren, och ingen server på vägen kan koda om den så att signaturen faller. Mottagaren
  svarar 400 `invalid_path` på andra tecken. Portalens id:n är uuid.
- **Mottagaren:**
  - Räknar med metoden och sökvägen i anropet den tog emot.
  - Nekar med 401 om tidsstämpeln avviker mer än 300 sekunder, om signaturen inte stämmer eller om
    `v1=` saknas.
  - Jämför i konstant tid.
  - Läser den råa kroppen som byte, prövar signaturen över dem och parsar JSON:en efteråt. Ett
    inledande BOM behålls i det som signeras.
  - Prövar i den här ordningen, billigast först: hemligheten (503 `not_configured`), sökvägen (400),
    signaturens headers (401), storleken (413 över 5 MB), kroppen, signaturen (401), UTF-8 (400
    `invalid_encoding`), JSON (400 `invalid_json`) och kontraktet (400 `validation_error`).
- **Avsändaren** signerar vid varje försök, eftersom en signatur bara gäller i 300 sekunder.
- **Utan hemlighet** svarar mottagarens routes 503 och inget skickas. Koden kan därför gå ut mörk.
- **Miljöspärren:** prod skickar bara till den andra appens prodadress. Alla andra miljöer skickar
  bara till den andra appens testmiljö eller till den egna datorn. Portalen avgör prod med
  `NODE_ENV`, `VERCEL_ENV` och Supabase-adressen, och faller stängt, som CRM:et.

**Testvektor.** Båda sidornas kod ska ge den här signaturen. Den är räknad med Pythons `hmac` och
kontrollerad med `node:crypto`.

| Fält | Värde |
| --- | --- |
| Hemlighet | `portal-kontraktsvektor-0123456789abcdef0123456789abcdef` |
| Tidsstämpel | `1790000000` |
| Metod | `POST` |
| Sökväg | `/api/portal/jobs/q-2026-015/messages` |
| Signatur | `v1=0a23a52e4a620ea087da88e218f347248f4003d0fcfecd56649ef08e670bcac6` |

Kroppen är 126 tecken och 130 byte i UTF-8:

```
{"messageId":"msg-1","authorName":"Sara Ek","body":"Hej från Gävle – vindsluckan sitter ute.","sentAt":"2026-09-27T12:00:00Z"}
```

### Idempotens

- **Header:** `Idempotency-Key`, satt av avsändaren. Formatet står per anrop nedan. Mottagaren
  behandlar nyckeln som en ogenomskinlig sträng av synliga ASCII-tecken, högst 200. Saknas den eller
  har andra tecken blir det 400 `invalid_idempotency_key`.
- **Mottagaren sparar varje behandlad nyckel** med en hash av förfrågan och svaret som gavs. Hashen
  tas över metod, sökväg och råkropp, med samma radbrytningar som signaturen. Ett upprepat anrop får
  samma svar och gör ingenting nytt.
  - **Samma nyckel med en annan förfrågan** ger 422 `idempotency_key_reused`.
  - **Samma nyckel medan ett anrop med den körs** ger 503 `request_in_progress` med `Retry-After`.
  - **Svar som sparas** är 2xx och de 4xx som blir likadana vid ett omförsök, alltså alla utom 401,
    408, 425 och 429. Ett 5xx sparas inte, så omförsöket körs på nytt.
  - Dubbletter stoppas dessutom av affärsnycklarna: samma `quoteId` eller `orderId` ger alltid samma
    arbetsorder eller beställning.
- **Svar:**
  - 2xx: mottaget.
  - 401: signaturen godtogs inte. Avsändaren försöker igen med backoff, som vid 5xx. Annars
    tappas varje händelse för gott medan hemligheten byts, eller om en klocka går fel.
  - 408, 425, 429 och 3xx görs också om. En omdirigering följs aldrig, eftersom den hade kunnat leda
    förbi miljöspärren.
  - Andra 4xx: fel i anropet, och det görs inte om. 409 betyder "går inte längre", till exempel
    ett jobb vars arbetsorder tagits bort. För en ändring eller tillbakadragning av en
    butiksbeställning betyder 409 bara att den redan är bekräftad (rättelse 32).
- **Portalens id:n är uuid** (`quoteId`, `orderId`, `messageId`), eftersom databasen ger dem
  (rättelse 35). Då kan två nycklar aldrig bli samma sträng: `store-order-<uuid>-withdraw` är aldrig
  `store-order-<uuid2>`, eftersom ett uuid inte slutar på `-withdraw`. Nycklarnas format ändras inte.
  - 5xx eller timeout: avsändaren försöker igen med backoff.
- **Omförsöken** börjar efter 30 sekunder och dubblas upp till en timme. Efter 60 försök, drygt två
  dygn, ges anropet upp. Skickar mottagaren `Retry-After` väntar portalen minst så länge, men aldrig
  mer än en timme.

### Svarens form

Svaren har samma kuvert åt båda hållen (rättelse 18), så att båda apparna tolkar ett enda format:

- **Framgång:** `{ "ok": true, "data": … }`.
- **Fel:** `{ "ok": false, "error": "<text>", "errorDetails": { "code": "…", "message": "…", "details": … } }`.
  `code` är det maskinläsbara, `error` en text för en människa. `details` finns bara ibland, till
  exempel `details.issues` med sökvägen till varje fält (`lines.1.unitCost`) vid 400
  `validation_error`.

Avsändaren räknar på statuskoden. Kroppen läses bara där ett anrop nedan säger det.

### Kroppen

- JSON och UTF-8.
- Belopp i kronor exkl. moms, avrundade till hela ören.
- Datum `YYYY-MM-DD`, tidpunkter ISO 8601 i UTC.
- **`unitCost` är priset.** Det står som i prislistan och är det CRM:et skickar som `Price` till
  Fortnox.
- **`lineCost` och `costTotal` är bara information.** CRM:et räknar själv med
  `lib/domains/crm/pricing.ts`.

### Ping

- `POST {EKOVILLA_CRM_URL}/api/portal/ping` och `POST {RESELLER_PORTAL_URL}/api/ekovilla/ping`.
- Kroppen är `{}`, signerad som allt annat, utan `Idempotency-Key`. Ping ändrar ingenting.
- Svaret är `200 { "ok": true, "data": { "pong": true } }`, 401 om signaturen inte stämmer, eller
  503 utan hemlighet.

Den provar kopplingen åt båda hållen, från respektive admin- eller inställningssida.

### I CRM:et

- **Alla signerade routes** ligger under `app/api/portal/`. `middleware.ts` släpper prefixet, och
  routen kontrollerar signaturen med `runtime = 'nodejs'`.
- **Allt i CRM:et som kräver session för portalens del** ligger under `/api/crm/portal/`, så att
  prefixet aldrig kan göra en sessionsroute publik.
- **Skrivningar** från portalens anrop görs med service role och syns som portalens.

### Miljöerna

| Nivå | CRM:et | Portalen |
| --- | --- | --- |
| Lokalt↔lokalt | `next dev` på :3000, Fortnox testbolaget | `DATA_SOURCE=supabase npm run dev -- -p 3001` |
| Test | test.app.ekovilla.se (gren `testmiljo`), Supabase `ekovilla-crm-test`, Fortnox testbolaget. Sätts upp när någon utanför ska testa. | test.partner.ekovilla.se (gren `testmiljo`), Supabase `aterforsaljare-test` |
| Prod | app.ekovilla.se | partner.ekovilla.se. Prodprojektet finns inte än. |

**Variablerna:**

- **Portalen:** `EKOVILLA_CRM_URL`, `PORTAL_CRM_SHARED_SECRET` och `CRON_SECRET`, som skyddar
  utkorgens omförsök. I portalens Supabase-projekt ligger dessutom två värden i Vault:
  `crm_outbox_url` (portalens `/api/cron/utkorg`) och `crm_outbox_secret` (samma värde som
  `CRON_SECRET`). Utan dem görs inga omförsök, men det första försöket görs ändå.
- **CRM:et:** `RESELLER_PORTAL_URL` och samma hemlighet.
- **Testmiljöerna:** portalens testmiljö pratar med CRM:ets testmiljö, aldrig med app.ekovilla.se.

### Så körs det lokalt

- **Portarna:** CRM:et kör på :3000 och portalen på :3001: `DATA_SOURCE=supabase npm run dev -- -p
  3001`.
- **Portalens `.env.local`:** `EKOVILLA_CRM_URL=http://localhost:3000` och ett lokalt
  `PORTAL_CRM_SHARED_SECRET`, samma värde som i CRM:ets `.env.development.local`. Mot låtsas-CRM:et
  också `EKOVILLA_CRM_STORE_ORDERS=on`, som skickar butiksbeställningarna.
- **CRM:ets `.env.development.local`:** `RESELLER_PORTAL_URL=http://localhost:3001` och samma
  hemlighet.
- **Kunden:** butikens `ekovilla_customer_number` i portalens lokala databas måste finnas som kund
  (`fortnox_customer_id`) i CRM:ets lokala databas. Annars står jobbet som Mottagen, precis som det
  ska för en okopplad butik.
- **Utan det riktiga CRM:et:** `npm run latsas-crm` startar portalens låtsas-CRM på :3000, med
  samma hemlighet i miljön. Det kontrollerar signaturen, idempotensen och affärsnyckeln och svarar
  som CRM:et. `npm run latsas-crm -- ping` skickar en signerad ping till portalen, och
  `serve --jobb 503` låter ordrar få `503 no_assignee` för att prova omförsöken. Kommandona växer
  med portalens PR:er och står överst i scriptet.
- **Omförsöken lokalt:** starta portalen med ett `CRON_SECRET` och lägg samma värde och
  `http://host.docker.internal:3001/api/cron/utkorg` i den lokala Vault
  (`select vault.create_secret(…, 'crm_outbox_url')` och `'crm_outbox_secret'`). Då puffar pg_cron
  utkorgen varje minut, som i test och prod. Utan dem gör `npm run latsas-crm -- puffa` samma
  sak för hand. `db:reset` tömmer Vault.
- **Vercels inloggningsskydd** ska vara avstängt på portalens testmiljö. CRM:ets testmiljö anropar
  den från servern. test.partner.ekovilla.se svarar i dag utan skydd (kontrollerat 27 september).

---

## Flöde 1: prislistan (CRM → portal)

**Varför:** butikernas inpris är lista 160 i Fortnox. Portalen har i dag en kopia inläst för hand 25
september. Fortnox har artikelnummer, namn, enhet och pris, men inte det portalen också behöver:

| Fält | Vad | Värden |
| --- | --- | --- |
| `customerName` | Namnet slutkunden ser på offerten, t.ex. "Lösull på vinden". Nämner aldrig Ekovilla. | text |
| `category` | Grupperingen i portalen. | `losull`, `skivor`, `tatskikt`, `verktyg`, `etablering`, `ovrigt` |
| `laborShare` | Andel av priset som är arbete och ger ROT. | 0–1 |
| `note` | Kort förtydligande i prislistan. | text, får vara tom |
| `sortOrder` | Ordningen i listan. | heltal |

**I CRM:et:**

- **Fälten redigeras per artikel**, under `crm.article.manage`. Priset och enheten kommer från
  Fortnox: `GET /3/prices/sublist/160` och `fortnox_articles_cache.unit`.
- **En admin publicerar** med en knapp och väljer `validFrom`.

**Publiceringen:**

- `POST {RESELLER_PORTAL_URL}/api/ekovilla/pricelists`
- `Idempotency-Key: pricelist-<validFrom>-<sha256>-<löpnummer>` (rättelse 17). Hashen är sha256 i hex
  över artiklarna som JSON med sorterade nycklar. Löpnumret skiljer en ny publicering av samma lista
  (X, sedan Y, sedan X igen) från ett omförsök av samma publicering. Portalen behandlar nyckeln som en
  ogenomskinlig sträng.

```json
{
  "validFrom": "2026-10-01",
  "resellerId": null,
  "articles": [
    {
      "articleNumber": "2410509",
      "name": "EKOVILLA cellulosa 0,038W/mK vind",
      "customerName": "Lösull på vinden",
      "note": "",
      "category": "losull",
      "unit": "m3",
      "unitCost": 342,
      "laborShare": 0.45,
      "sortOrder": 10
    }
  ]
}
```

**Regler:**

- **Enheten skickas med gemener**, som Fortnox-koden: `m3`, `st`, `pkt`, `rle`, `pll`, `brk`, `förp`.
  Portalen räknar bara `m3` ur yta och tjocklek, allt annat anges i antal.
- **En artikel utan enhet skickas inte.** Vid läsningen 25 september gällde det tre Steico-skivor.
- **Varje publicering blir en ny prislista i portalen.** En prislistas rader ändras aldrig, eftersom
  offerter och beställningar är låsta mot sin lista. Ett nytt pris gäller därför bara nya offerter.
- **Två listor med samma `validFrom`** kan komma, till exempel två publiceringar samma dag. Då gäller
  den som portalen tog emot sist.
- **`resellerId: null` betyder att listan gäller alla butiker.** Om en butik ska ha en egen lista är
  en öppen fråga.

---

## Flöde 2: jobb (portal → CRM, status tillbaka)

### Butiken skickar ordern

Butiken skickar ordern själv när kunden har godkänt och de praktiska uppgifterna är ifyllda: önskad
period, kontaktperson på plats och vindslucka.

- `POST {EKOVILLA_CRM_URL}/api/portal/jobs`
- `Idempotency-Key: job-<quoteId>`

Kroppen är `EkovillaOrder`, byggd av `toEkovillaOrder()` i portalens
`lib/domains/quotes/handover.ts`. Avsändaren lägger till `store.ekovillaCustomerNumber`. Exemplet
nedan är genererat ur portalens egen kod, med en rad mindre, och kundnumret är påhittat:

```json
{
  "quoteId": "q-2026-015",
  "quoteNumber": "2026-015",
  "store": {
    "resellerId": "res-norrbygg",
    "name": "Norrbygg AB",
    "address": { "street": "Verkstadsgatan 8", "postalCode": "802 91", "city": "Gävle" },
    "ekovillaCustomerNumber": "1043"
  },
  "workplace": {
    "address": { "street": "Rönnvägen 18", "postalCode": "806 28", "city": "Gävle" },
    "propertyDesignation": "Gävle Rönnen 3:2",
    "desiredPeriod": "Vecka 42",
    "atticHatch": "inside",
    "contactName": "Ingrid Palm",
    "contactPhone": "070-555 12 34",
    "notes": ""
  },
  "lines": [
    {
      "articleNumber": "2410509",
      "name": "EKOVILLA cellulosa lösull 0,038 – vind",
      "construction": "vind",
      "unit": "m3",
      "quantity": { "kind": "volume", "areaM2": 95, "thicknessMm": 400 },
      "unitCost": 310,
      "lineCost": 11780
    },
    {
      "articleNumber": "1010",
      "name": "Etablering",
      "construction": "ovrigt",
      "unit": "st",
      "quantity": { "kind": "count", "value": 1 },
      "unitCost": 2490,
      "lineCost": 2490
    }
  ],
  "costTotal": 14270
}
```

**Fälten:**

- **`quantity`:** `volume` är lösull. Mängden i m³ är `areaM2 × thicknessMm / 1000`. `count` är antal i
  artikelns enhet.
- **`construction`:** vind, snedtak, vägg eller övrigt.
- **`atticHatch`:** om vindsluckan sitter inne eller ute. Installatören behöver veta det.
- **`desiredPeriod`:** fritext, till exempel "Vecka 42". Det är inget datum.
- **`ekovillaCustomerNumber`:** kan vara `null`, om Ekovilla inte har kopplat butiken till en kund
  än.

### Det CRM:et gör med ordern

Ingen granskning hos Ekovilla. Butikens godkännande räcker.

1. **Kontrollera signaturen och idempotensen.**

2. **Hitta butikens kund:** `crm_customers.fortnox_customer_id = store.ekovillaCustomerNumber`.

3. **Fördela till en säljare.** Det avgörs i CRM:et, aldrig i portalen. Den första som finns och har
   `crm.workorder.write` väljs:
   1. Butikens säljare, satt per butik (`crm_portal_resellers.seller_user_id`).
   2. Kundansvarig: `crm_customers.account_manager_id`.
   3. Säljaren för länet där jobbet utförs, via `crm_routing_rules`. Länet tas fram ur
      arbetsadressen. Ett fel där går vidare till nästa steg och ger aldrig 5xx.
   4. Reservadmin, en inställning i CRM:et.

   Ordern går till en person, inte till en avdelning eller ett team (portalens `DOMAIN.md`, "Vem hos
   Ekovilla som får ordern").

4. **Skapa arbetsordern.** Säljaren står som skapare, och arbetsordern får status `draft` ("Ej
   planerad") i planeringens backlog.
   - **Kund:** butiken, inte slutkunden.
   - **Rader:**
     - `volume` blir `pricing_mode: 'm3'` med `m2` och `thickness_mm`.
     - `count` blir `pricing_mode: 'item'` med `quantity`.
     - `article_price = unit_price = unitCost`. Ingen rabatt och ingen ROT.
     - Konstruktionen går rakt över, utom `ovrigt`, som blir `''`.
   - **Referensen:** `customer_snapshot.label = quoteNumber`, som blir `YourOrderNumber` i Fortnox.
     Då känner butiken igen fakturan. Numret kan ha ett versionstillägg, `2026-012-1`, när
     offerten ändrats före överlämningen (portalens DOMAIN.md, besked 28 september 2026). Varje
     version har ett eget `quoteId`, och bara versionen som lämnas över når CRM:et. Fältet är
     fritext och ska inte tolkas som `ÅÅÅÅ-NNN`.
   - **Kontakten på plats:** `customer_snapshot.end_contact_name` och `end_contact_phone`.
   - **Resten av arbetsplatsen:** fastighetsbeteckning, vindslucka, önskad period och fritext skrivs
     som text i `internal_handoff.handoff_notes`, inte som egna nycklar.
     `desired_installation_date` lämnas tom.
   - **Spårbarhet:** kopplingen sparas i `crm_portal_jobs`, och ordern får brickan "Från
     partnerportalen · <butik>" (förut "Från återförsäljarportalen", namnbytet 4 oktober 2026).

5. **Svara** med `201 { "ok": true, "data": { "crmWorkOrderId": "…" } }` så snart arbetsordern
   finns. Portalen läser `data.crmWorkOrderId` och skapar jobbet i läget **Mottagen av Ekovilla**.

6. **Skapa Fortnox-ordern automatiskt, direkt efter svaret**, med `pushWorkOrderToFortnox()`.
   - Portalen väntar aldrig på Fortnox.
   - Misslyckas anropet gör CRM:et om det ett begränsat antal gånger, och sedan får säljaren en
     notis.
   - När Fortnox-ordern finns skickas `job.confirmed`, normalt inom någon minut.

**Om kunden saknas** (numret är `null` eller okänt) skapas arbetsordern ändå, hos reservadmin. Fortnox-ordern kan inte skapas utan kund, så jobbet står som
**Mottagen** tills Ekovilla har kopplat kunden. Då skapas Fortnox-ordern och `job.confirmed`
skickas.

**Felsvaren på ordern** (rättelse 19):

| Svar | Kod | Betyder | Portalen |
| --- | --- | --- | --- |
| 400 | `invalid_json`, `invalid_text`, `validation_error`, `invalid_idempotency_key` | Kroppen följer inte kontraktet. `invalid_text` är ett nolltecken eller ett ensamt surrogat någonstans i kroppen. | Ger upp. Butiken ser att ordern inte kom fram. |
| 409 | `job_conflict` | Samma `quoteId` är redan mottaget med ett annat innehåll. En ny nyckel med samma innehåll ger 201 och den befintliga arbetsordern. | Ger upp, som ovan. |
| 409 | `work_order_removed` | Ekovilla har tagit bort jobbets arbetsorder. | Ger upp, som ovan. |
| 422 | `idempotency_key_reused` | Nyckeln är redan använd för en annan förfrågan. | Ger upp, som ovan. |
| 503 | `no_assignee` | Ingen hos Ekovilla kan ta jobbet än, inte ens reserven. Kommer med `Retry-After: 300`. | Försöker igen, tidigast efter fem minuter. |

CRM:et kräver dessutom att `ekovillaCustomerNumber` finns i kroppen (`null` eller en sträng, där en tom
sträng räknas som `null`), att arbetsplatsens gata, postnummer och ort är ifyllda, och att en
`volume`-rad har enheten `m3`.

### Status tillbaka (CRM → portal)

- `POST {RESELLER_PORTAL_URL}/api/ekovilla/events`
- `Idempotency-Key: <type>-<id>-<occurredAt>`
- Kropp: `{ "type": "...", "occurredAt": "...", "data": { ... } }`

Händelserna för ett och samma jobb kommer i ordning.

| `type` | `data` | Portalens status |
| --- | --- | --- |
| `job.confirmed` | `quoteId`, `ekovillaOrderNumber`, `confirmedAt` | Bekräftad |
| `job.scheduled` | `quoteId`, `scheduledFor`, `scheduledUntil` (datum, eller båda `null`) | Planerad, eller tillbaka till Bekräftad |
| `job.completed` | `quoteId`, `completedAt` (datum) | Utförd |
| `job.invoiced` | `quoteId`, `invoicedAt` (datum) | Fakturerad |
| `job.cancelled` | `quoteId`, `reason` (får saknas), `cancelledAt` | **Avbrutet**, med skälet om det finns |
| `job.message` | `quoteId`, `messageId`, `authorName`, `department`, `body`, `sentAt` | Meddelande från Ekovilla |
| `job.document` | `quoteId`, `kind`, `name`, `contentBase64` (PDF) | Dokument på jobbet |

**Regler för händelserna:**

- **`ekovillaOrderNumber`** är Fortnox ordernummer, som butiken känner igen på fakturan.
- **`job.scheduled`:**
  - Kommer ur planeringen, aldrig före `job.confirmed`.
  - Skickas igen när datumen ändras.
  - `scheduledFor` och `scheduledUntil` är första och sista planerade dag. För ett endagsjobb är de
    samma dag.
  - Båda `null` betyder att jobbet inte längre ligger på schemat. Portalen visar det då som
    Bekräftat igen.
- **`job.invoiced`** skickas bara när faktureringen görs i CRM:et. En faktura som skapas direkt i
  Fortnox ger ingen händelse. `partially_invoiced` skickas inte.
- **`job.cancelled`** skickas när arbetsordern avbryts eller tas bort, och bara före Utförd.
  `reason` är fritext till butiken, och får vara tom eller saknas. CRM:et har inget skäl att skicka
  (rättelse 20). Sedan CRM-PR #255 skickar CRM:et `"reason": ""`, och butiken ser "Inget skäl
  angavs.". `cancelledAt` är en tidpunkt i UTC.
  Inget kommer efter den.
- **Bara framåt** (rättelse 22): efter `job.completed` kommer inga fler `job.scheduled`, och efter
  `job.completed` eller `job.invoiced` aldrig ett tidigare läge. `job.invoiced` kommer alltid efter
  `job.completed`. CRM:et skickar inget efter `job.confirmed` förrän den är mottagen. Portalen
  räknar ändå statusen ur datumen och flyttar aldrig jobbet bakåt. Kommer en `job.scheduled` efter
  Utförd, till exempel ett uppspelat anrop, svarar portalen 200 och låter datumen stå (rättelse
  38).
- **Tider** (rättelse 23): `occurredAt`, `confirmedAt` och `cancelledAt` är ISO 8601 i UTC med `Z`.
  `completedAt` och `invoicedAt` är svenska kalenderdagar, `YYYY-MM-DD`. Nyckeln är unik per
  händelse, också när datumen går X → Y → X, eftersom `occurredAt` ingår i den.
- **`job.message`:**
  - `messageId` är CRM:ets uuid, och nyckeln är `job.message-<messageId>`, utan tid. `occurredAt`
    är samma som `sentAt` (rättelse 24).
  - `authorName` är svararens namn, eller `Ekovilla` när profilen saknar namn.
  - `department` är en av `Försäljning`, `Planering` och `Ekonomi`. CRM:et skickar aldrig en tom,
    men portalen tar emot tom sträng också. Andra värden nekas med 400.
  - Namn och text trimmas och räknas i kodpunkter: högst 200 respektive 5000 tecken (rättelse 26).
    Portalen räknar likadant.
  - Portalen visar det som "Anna Berg · Planering".
  - Portalen sparar meddelandet en gång per `messageId`, också om det kommer igen med en ny nyckel.
  - Ett meddelande tas emot också efter `job.cancelled`. Det är samtal, ingen status.
- **`job.document`** (rättelse 28):
  - `kind` är `order_confirmation` eller `self_inspection`. Orderbekräftelsen skickas en gång när
    `job.confirmed` är mottagen, och igen när Ekovilla skickar en ny. Egenkontrollen skickas när
    Ekovilla skickar den.
  - Nyckeln är `job.document-<dokumentets uuid>`, utan tid, och samma nyckel ger alltid samma byte.
    `occurredAt` är när PDF:en frystes.
  - `name` är till exempel "Orderbekräftelse 20417 – Storgatan 1.pdf", högst 200 tecken.
  - Ett nytt dokument av samma sort ersätter det gamla. CRM:et skickar aldrig ett äldre efter ett
    nyare.
  - Portalen tar emot dokument också efter `job.cancelled`, men CRM:et skickar inga då (rättelse
    29).
  - PDF:en skickas i kroppen, och portalen sparar den i sin egen lagring. Vercel tar emot högst
    4,5 MB per anrop, så PDF:en får vara högst 3,3 MB före base64.
  - Portalen nekar med 400 det som inte är strikt base64, inte börjar som en PDF (`%PDF-`) eller är
    större än så. `name` är filnamnet butiken ser och laddar ner.

**Portalens svar på händelserna:**

| Svar | Kod | När |
| --- | --- | --- |
| 200 | – | Händelsen är mottagen, eller var redan mottagen. |
| 404 | `unknown_quote`, `unknown_order` | Portalen har ingen överlämnad offert eller beställning med det id:t. |
| 409 | `cancelled` | Jobbet är redan avbrutet, och ingen status kommer efter `job.cancelled`. `job.message` och `job.document` tas emot ändå. |
| 503 | `job_not_ready` | Offerten är överlämnad, men portalen har inte hunnit skapa jobbet ur svaret på ordern. Kommer med `Retry-After: 30`. CRM:et läser den inte, men gör om varje 5xx efter 30 s, 60 s, 120 s och så vidare, upp till en timme. |

Plus felen under "Transporten" och "Idempotens".

### Meddelanden från butiken (portal → CRM)

- `POST {EKOVILLA_CRM_URL}/api/portal/jobs/{quoteId}/messages`
- `Idempotency-Key: message-<messageId>`
- Kropp: `{ "messageId", "authorName", "body", "sentAt" }`

CRM:et visar meddelandet på arbetsordern, på ett eget kort som är skilt från de interna
kommentarerna, och meddelar säljaren. Säljarens svar går tillbaka som `job.message`.

**CRM:ets svar** (rättelse 25):

| Svar | Kod | När |
| --- | --- | --- |
| 201 | – | `{ messageId }`, också när samma meddelande redan är mottaget. |
| 400 | `invalid_json`, `invalid_text`, `validation_error` | Kroppen håller inte. |
| 404 | `unknown_job` | CRM:et har inget jobb för offerten. |
| 409 | `work_order_removed` | Ekovilla har tagit bort arbetsordern. |
| 409 | `message_conflict` | Samma `messageId` med ett annat innehåll. `sentAt` räknas som innehåll. Portalen bygger kroppen vid första försöket och skickar samma byte vid varje omförsök. |
| 503 | `job_not_ready` | Med `Retry-After: 30`. Portalen försöker igen. |

Namn och text räknas i kodpunkter, högst 200 och 5000 (rättelse 26). En avbruten, utförd eller
fakturerad arbetsorder tar emot meddelanden (rättelse 27).

---

## Flöde 3: butiksbeställningar (portal → CRM, status tillbaka)

### Butiken beställer

**Portalen håller beställningarna i utkorgen tills CRM:et tar emot dem** (William 28 september
2026). Utan `EKOVILLA_CRM_STORE_ORDERS=on` skickar portalen jobben och meddelandena som vanligt,
men beställningarna ligger kvar i kö, med en ny titt var femtonde minut, utan att ett försök räknas.
Kroppen byggs först när beställningen skickas. CRM:et tar emot beställningar sedan fas 8a (PR #258),
och bekräftar dem, lägger på frakten och skickar statusen tillbaka sedan 8b (PR #261–#264). Slå på variabeln när William bestämt
det, så går kön iväg.

Butiken beställer produkter ur prislistan: allt utom inblåsning (`m3`) och etablering. Antalet är
alltid hela enheter. Leveransen går till butiken, och **frakten sätter Ekovilla** som en rad i
CRM:et eller i Fortnox. Portalen räknar ingen frakt. Butiken kan **ändra och dra tillbaka
beställningen tills Ekovilla har bekräftat den.** Efter bekräftelsen är den låst i portalen.

**Anropen:**

| Vad | Anrop | Idempotency-Key |
| --- | --- | --- |
| Ny beställning | `POST {EKOVILLA_CRM_URL}/api/portal/store-orders` | `store-order-<orderId>` |
| Ändrad | `PUT {EKOVILLA_CRM_URL}/api/portal/store-orders/{orderId}` | `store-order-<orderId>-<updatedAt>` |
| Tillbakadragen | `POST {EKOVILLA_CRM_URL}/api/portal/store-orders/{orderId}/withdraw` | `store-order-<orderId>-withdraw` |

**Ändringen:**

- Kroppen är densamma som för en ny beställning, plus `updatedAt`, tidpunkten då butiken ändrade,
  i UTC med hela millisekunder (`2026-09-28T10:15:00.123Z`). Samma text står i nyckeln.
- CRM:et sparar det senaste `updatedAt`.
- En ändring med ett äldre eller samma `updatedAt` är ett sent omförsök. Den ignoreras med
  `200 { "status": "ignored" }`, så att den inte skriver över en nyare ändring.
- **409** betyder bara att beställningen redan är bekräftad. Det gäller både ändringen och
  tillbakadragningen. Portalen gör då beställningen Bekräftad och visar Ekovillas version: vid en
  ändring raderna och leveransen i den senaste kropp CRM:et tog emot, vid en tillbakadragning
  beställningen som den var. En ruta säger att Ekovilla hunnit före (besked 28 september 2026).
- **Tillbakadragningens kropp** är `{ "orderId": "…" }`.
- Ligger flera ändringar i portalens kö innan de hunnit skickas, skickas bara den senaste. De äldre
  står som `superseded` i utkorgen.

**Kroppens krav** (rättelse 33): antalet är ett heltal över noll, `unitCost` är hela ören, ingen rad
i `m3`, leveransadressens gata, postnummer och ort är ifyllda, och beställningen har högst 200 rader.
`orderId` i kroppen är sökvägens. Portalen kontrollerar samma sak innan beställningen skickas.

**CRM:ets svar** (rättelse 31 och 32):

| Anrop | Svar |
| --- | --- |
| Ny beställning | 201 `{ "crmStoreOrderId" }`, också när samma `orderId` med samma kropp redan är mottagen. 409 `store_order_conflict` när den första kroppen var en annan. 503 `no_assignee` med `Retry-After: 300`, och portalen gör om. |
| Ändrad | 200 `{ "status": "updated" }` eller `{ "status": "ignored" }`. 409 `store_order_confirmed`. 404 `unknown_order`. 400 `store_order_mismatch` för en annan butik eller ett annat nummer. |
| Tillbakadragen | 200 `{ "status": "withdrawn" }`, också när den redan är tillbakadragen, eller `{ "status": "ignored" }`. 409 `store_order_confirmed`. 404 `unknown_order`. |
| Alla | 400 `invalid_json`, `invalid_text` och `validation_error` med `details.issues`. |

- **409 kommer bara efter Ekovillas bekräftelse.** En ändring eller tillbakadragning av en makulerad
  beställning får 200 `ignored`, och makuleringen kommer som `store_order.cancelled`.
- Ett 404 `unknown_order` sparas inte i CRM:ets svarscache, så samma nyckel prövas på nytt när
  beställningen kommit fram. Portalen ger ändå upp på 404, eftersom den nya beställningen alltid går
  före i samma kö.

Kroppen är `EkovillaStoreOrder`, byggd av `toEkovillaStoreOrder()` i portalens
`lib/domains/storeOrders/ekovilla.ts`, plus `store.ekovillaCustomerNumber`. Exemplet är genererat
ur portalens kod, med en rad mindre, och kundnumret är påhittat:

```json
{
  "orderId": "so-b-2026-003",
  "orderNumber": "B-2026-003",
  "store": {
    "resellerId": "res-norrbygg",
    "name": "Norrbygg AB",
    "address": { "street": "Verkstadsgatan 8", "postalCode": "802 91", "city": "Gävle" },
    "ekovillaCustomerNumber": "1043"
  },
  "delivery": {
    "address": { "street": "Verkstadsgatan 8", "postalCode": "802 91", "city": "Gävle" },
    "desiredPeriod": "Vecka 41",
    "reference": "Inköp 4471",
    "contactName": "David Kron",
    "contactPhone": "070-234 56 78",
    "message": ""
  },
  "lines": [
    { "articleNumber": "13003", "name": "EKOVILLA LEVY 70MM 3,93M2/PKT", "unit": "pkt", "quantity": 12, "unitCost": 335.3, "lineCost": 4023.6 },
    { "articleNumber": "13102", "name": "ISOLERINGSSÅG EKOVILLA LEVY", "unit": "st", "quantity": 2, "unitCost": 195.3, "lineCost": 390.6 }
  ],
  "costTotal": 4414.2
}
```

### Det CRM:et gör

Väg B: en egen tabell för butiksbeställningarna (`crm_store_orders` med rader) och ett eget
`POST /orders` till Fortnox, som återanvänder radbyggaren och huvudets fält. Fortnox-ordern får:

| Fortnox | Kommer från |
| --- | --- |
| `CustomerNumber` | butikens kund |
| `DeliveryAddress1`, `DeliveryZipCode`, `DeliveryCity` | `delivery.address` |
| `YourOrderNumber` | `delivery.reference`, butikens eget ordernummer |
| `YourReference` | `delivery.contactName` |
| En textrad eller `Remarks` | `delivery.contactPhone`, `desiredPeriod` och `message` |
| `Price` per rad | `unitCost` |
| Fraktraden | Ekovilla lägger till den innan beställningen bekräftas |

Fördela beställningen till en säljare som jobben, men utan länet, eftersom leveransen går till
butiken. Beställningen har 25 % moms, också frakten (William 29 september 2026).

### Status tillbaka

| `type` | `data` | Portalens status |
| --- | --- | --- |
| `store_order.confirmed` | `orderId`, `ekovillaOrderNumber`, `confirmedAt` | Bekräftad. Låser beställningen. |
| `store_order.delivered` | `orderId`, `deliveredAt` (datum) | Levererad |
| `store_order.invoiced` | `orderId`, `invoicedAt` (datum) | Fakturerad |
| `store_order.cancelled` | `orderId`, `reason` | Makulerad, Ekovillas beslut. Portalen daterar den med `occurredAt`. |

**Regler för händelserna** (rättelse 37):

- **Nyckeln** är `<type>-<orderId>-<occurredAt>`. `occurredAt` är när Ekovilla gjorde steget
  (Bekräfta, Levererad, Fakturera, Makulera), i UTC med `Z`, inte när händelsen köades.
- **`confirmedAt`** är samma tid som `occurredAt`, alltså när beställningen låstes och inte när
  Fortnox-numret kom. `store_order.confirmed` skickas först när Fortnox-numret finns, och inget
  efter den skickas förrän den är mottagen (2xx).
- **`store_order.cancelled`** kan komma till en beställning som aldrig fått
  `store_order.confirmed`, också när portalen redan fått 409 på en ändring. Portalen gör den
  Makulerad ändå.
- **`reason`** är aldrig tom. Portalen tar ändå emot en tom och visar då "Inget skäl angavs.".

Butikens egen tillbakadragning heter Tillbakadragen i portalen. Den är skild från Makulerad, som
är Ekovillas.

---

## Flöde 5: partner bjuds in (CRM → portal)

**Varför:** fler bygghandlare och andra partner ska in i portalen. Förut skapades ett företag och
dess första admin med skript (`scripts/testmiljo.mjs`). Nu bjuder Ekovilla in från kundkortet i
CRM:et (CRM:ets 10a, beslut William 1 oktober 2026).

**I CRM:et:**

- **En kund flaggas** som återförsäljare eller partner. Typen finns bara i CRM:et, och portalen är
  densamma för båda.
- **Rutan "Partnerportalen"** sitter på företagskortet. Den hette "Återförsäljarportalen" tills
  portalen bytte namn 4 oktober 2026. Där finns "Bjud in till portalen" och "Skicka inbjudan
  igen". Bara `crm.portal.manage` ser den, och bara kort med Fortnox-nummer kan bjudas in.
- **CRM:et väljer företagets id själv**, ett uuid, och skickar inbjudan genom kön.

**Inbjudan:**

- `POST {RESELLER_PORTAL_URL}/api/ekovilla/resellers`
- `Idempotency-Key: reseller-invite-<resellerId>-<n>`, där `n` är CRM:ets försöksnummer för
  företaget: 1 för inbjudan, 2 för första "Skicka inbjudan igen" och så vidare. Kön gör om samma
  försök med samma nyckel.

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

**Fälten:**

- `resellerId` är ett uuid med gemener. Portalen använder det som företagets `id`.
- `organizationNumber`, `phone` och `email` gäller företaget och kan vara tomma strängar.
- `ekovillaCustomerNumber` är alltid satt, eftersom CRM:et bara bjuder in kort med Fortnox-nummer.
  Det blir `resellers.ekovilla_customer_number`.
- Längderna är CRM:ets:
  - `name` 1–200 tecken
  - `street` högst 200, `postalCode` högst 20 och `city` högst 100
  - `phone` högst 50
  - `admin.name` 1–200 tecken och `admin.email` högst 254
- Båda adresserna skrivs med gemener.

**Portalens svar** har kontraktets kuvert. Vid framgång är `data` `{ "resellerId": "…", "admin":
"invited" }`, där `admin` är `invited` eller `active`. CRM:et läser inte kroppen vid framgång.

| Status | När |
| --- | --- |
| 201 | Företaget fanns inte. Det skapas med uppgifterna och kundnumret, och admin bjuds in med rollen admin. |
| 200 | Företaget finns redan, efter ett omförsök eller "Skicka inbjudan igen". Uppgifterna och kundnumret ändras inte, eftersom butiken kan ha ändrat dem under Inställningar. Admin hanteras så här: <ul><li>en användare i företaget som inte valt lösenord får inbjudan igen, eller länken för att välja lösenord om hen redan öppnat inbjudan (`invited`);</li><li>en användare i företaget som valt lösenord får ingenting (`active`);</li><li>en adress som inte finns i portalen bjuds in som admin i företaget (`invited`).</li></ul> |
| 409 `admin_email_taken` | Adressen hör till ett konto i ett annat företag. Portalen prövar det innan den skapar något. CRM:et visar felet, och admin kan försöka igen med en annan adress. |
| 400 `validation_error` | Kroppen följer inte kontraktet. `error` säger vilket fält, och CRM:et visar texten på kundkortet. |

Allt annat följer transporten: 5xx görs om, och övriga 4xx ges upp och visas på kortet.

**Så tolkar portalen kontraktet:**

- **Ett ogiltigt fält ger 400 `validation_error`**, som på portalens andra routes. CRM:ets plan säger
  422. CRM:et gör likadant med båda: ger upp och visar `error`.
- **"Valt lösenord" betyder att lösenordet valts i portalen** (`reseller_users.password_set_at`,
  sedan 2 oktober 2026). Förut räknades ett bekräftat konto som aktivt. Men Supabase bekräftar kontot
  redan när mottagaren trycker på knappen i inbjudan, så den som sedan stängde sidan för att välja
  lösenord fick inget mejl vid "Skicka inbjudan igen" (CRM:ets test 2 oktober).
  - En ny inbjudan går inte att skicka till ett bekräftat konto. Den som öppnat inbjudan men inte
    valt lösenord får därför i stället länken för att välja lösenord, samma mejl som "Glömt
    lösenord", och svaret är `invited`. Mejlets text passar båda fallen.
  - Konton som var bekräftade före ändringen räknas som att de valt lösenord.
- **Lösenordet väljs inom en timme efter knappen i mejlet** (sedan 5 oktober 2026). Efter det visar
  portalen "Länken har gått ut" och vägen till "Glömt lösenordet?". Inget ändras för CRM:et:
  "Skicka inbjudan igen" ger då länken för att välja lösenord, som ovan, och svaret är `invited`.
- **En användare som redan finns i företaget behåller sin roll.** Den görs alltså inte till admin.
- **Adressen jämförs utan hänsyn till stora och små bokstäver.** Adresser från Inställningar sparas
  som de skrevs.
- **Gränserna är CRM:ets och inte Inställningarnas.** Postnumret får vara 20 tecken och telefonen 50,
  medan Inställningarna tillåter 10 och 40. Vid "Skicka inbjudan igen" skickar CRM:et förra försökets
  företagsuppgifter igen, så ett nej för ett sådant fält hade blivit samma nej varje gång. Butiken
  rättar fältet i Inställningar, nästa gång den sparar.
- **Ett aktivt konto utan företag** ska inte finnas, men kan bli kvar om kopplingen föll efter en
  inbjudan i Inställningar. Det ger också 409 `admin_email_taken`, och portalen loggar det. Det
  märks först vid inbjudan, så företaget hinner skapas, och nästa försök får 200.
- **Ett nytt företag får portalens standard:** 25 % påslag, 30 dagars giltighet och inga villkor.
  Butikens admin fyller i resten i guiden på `/kom-igang` och under Inställningar. Prislistan är den
  gemensamma tills CRM:et skickar en egen.
- **Mejlet är portalens vanliga inbjudan** (`supabase/templates/invite.html`). Länken gäller i 24
  timmar och fungerar en gång.

---

## Det här finns i CRM:et i dag

Läst mot `f77d0cb` (PR #265, 29 september). CRM:ets plan säger vilken fas som är klar.

- **Transporten** (fas 1a–1c): signaturen, miljöspärren, utkorgen med omförsök, svarscachen för
  idempotens, grinden för `/api/portal/` och `POST /api/portal/ping`.
- **Prislistan** (fas 2a–2b): portalfälten per artikel och publiceringen med en knapp, som köar
  `POST /api/ekovilla/pricelists`. Prövad mot den riktiga portalen lokalt 29 september.
- **Butikerna och fördelningen** (fas 3a): butik → säljare, reserven och länet ur postnummer och ort.
- **Jobbet in** (fas 3b–3c, PR #251–#252): `POST /api/portal/jobs`, arbetsordern hos rätt säljare,
  butikens kundkort på ordern och Fortnox-ordern direkt efter svaret.
- **Status tillbaka** (fas 4a–4b, PR #253–#254): planerat datum på alla arbetsordrar, och
  `job.confirmed`, `job.scheduled`, `job.completed`, `job.invoiced` och `job.cancelled` till
  portalen (`lib/domains/portal/jobState.ts`). `job.cancelled` har `"reason": ""` sedan PR #255.
- **Meddelandena** (fas 6, PR #256): `POST /api/portal/jobs/{quoteId}/messages` och svaren som
  `job.message` (`lib/domains/portal/jobMessages.ts`).
- **Dokumenten** (fas 7, PR #257): orderbekräftelsen och egenkontrollen som `job.document`
  (`lib/domains/portal/jobDocuments.ts`).
- **Butiksbeställningarnas intag** (fas 8a, PR #258): ny, ändrad och tillbakadragen, med en notis
  till den ansvarige och sidan `/crm/butiksbestallningar` (`lib/domains/portal/storeOrderIntake.ts`).
- **Butiksbeställningarna hos Ekovilla** (fas 8b1–8b3, PR #261–#264): koppla kund, frakten, Bekräfta
  med Fortnox-ordern, Levererad, Fakturera, Makulera och `store_order.*` tillbaka. Portalen håller
  beställningarna i kö tills `EKOVILLA_CRM_STORE_ORDERS=on`, se "Flöde 3".
- **Kontot per rad** efter dokumentets moms (PR #259), se "Momsen".
- **Lokal genomkörning** 29 september: CRM:et mot den riktiga portalen, alla flöden, med 81
  kontroller gröna ("Lokal genomkörning av hela kedjan" i CRM:ets plan).
- **Inbjudan från kundkortet** (10a, läst mot `35472e5` 1 oktober): flaggan, rutan och
  `POST /api/ekovilla/resellers` genom kön (`lib/domains/portal/partners.ts`). Se "Flöde 5".
- **Kvar i CRM:et:** fas 9, prod.
- **`crm_work_orders`**, i `supabase/migrations/20260925081734_baseline.sql`:
  - Nummer: `order_number`, med formatet `AO-YYYYMMDD-XXXXXX`.
  - Kund och innehåll: `customer_id`, `customer_snapshot`, `work_address`, `line_items`,
    `rot_details`, `internal_handoff`.
  - Planering och status: `status` (`draft` till `cancelled`), `assigned_to`.
  - Fortnox: `fortnox_order_number` med sina synkfält.
- **`pushWorkOrderToFortnox()`** i `lib/domains/fortnox/orders.ts`. Den skickar alltid `Price` per
  rad, är idempotent på `fortnox_order_number` och har en claim.
- **SQL testas med vitest-tester** som läser migreringarna, och med `supabase/checks/*.sql`.
  CRM:et har ingen pgTAP.

## Det här finns i portalen

- **Affärsflödet för båda flödena är byggt:**
  - skicka ordern (`hand_over_quote()`)
  - skapa, ändra och dra tillbaka en butiksbeställning
  - jobbens och beställningarnas statusar i databasen.
- **Typerna som är kontraktet:** `EkovillaOrder` och `EkovillaStoreOrder`, med tester.
- **Butikens kundnummer** ligger i `resellers.ekovilla_customer_number`. Det sätts bara av Ekovilla.
- **Transporten** i `lib/crm/`:
  - `signature.ts`: signaturen, med kontraktets testvektor som enhetstest.
  - `config.ts`: hemligheten, `EKOVILLA_CRM_URL` och miljöspärren.
  - `client.ts`: det signerade anropet, tolkningen av svaret och omförsökens väntetid.
  - `inbound.ts`: grinden för `/api/ekovilla/*`, kroppen mot kontraktet och svarens kuvert.
  - `ping.ts`: "Prova kopplingen".
  - `idempotency.ts`: svarscachen för `Idempotency-Key`, med tabellen `crm_idempotency_keys`.
  - `pricelist.ts`: prislistans kropp mot kontraktet.
  - `resellers.ts`: inbjudans kropp mot kontraktet.
- **Utkorgen** `crm_outbound_events`, med utskicket i `lib/crm/outbox.ts`:
  - `hand_over_quote()` köar ordern i samma transaktion som överlämningen.
  - Kroppen byggs vid första försöket med `toEkovillaOrder()` och butikens kundnummer
    (`lib/crm/outbound.ts`), och sparas sedan så att varje omförsök skickar samma byte.
  - Första försöket görs direkt i överlämningen. Omförsöken puffas av pg_cron varje minut via
    pg_net och `/api/cron/utkorg` (`CRON_SECRET`), eftersom Vercels cron inte körs på testmiljöns
    preview.
  - En händelse i taget per order, 60 försök med växande väntan, `Retry-After` respekteras, och
    en uppgiven händelse håller inte kvar resten.
  - När CRM:et svarat 201 skapas jobbet som Mottaget, med `data.crmWorkOrderId` och beloppen
    räknade med `pricing.ts`. Offertsidan visar om ordern skickas, har tagits emot eller inte kom
    fram.
- **Mottagaren** `app/api/ekovilla/*`, med `POST /api/ekovilla/ping`, `POST /api/ekovilla/events`,
  `POST /api/ekovilla/pricelists` och `POST /api/ekovilla/resellers`. Prislistan sparas med
  `receive_pricelist()` i en transaktion, och den senast mottagna gäller vid samma `validFrom`.
- **Inbjudan från CRM:et** (flöde 5) skapar företaget med secret key och bjuder in admin på samma
  sätt som Inställningar gör (`receiveResellerInvite` i `lib/data/supabase/crm.ts`). Låtsas-CRM:et
  har `npm run latsas-crm -- bjud-in`. Prövat mot lokal Supabase 1 oktober:
  - Inbjudan gav 201, och samma försök igen gav samma svar utan ett nytt mejl.
  - "Skicka inbjudan igen" gav 200 och ett nytt mejl, och företaget ändrades inte.
  - En admin som valt lösenord gav 200 `active`, utan mejl.
  - En adress i ett annat företag gav 409 `admin_email_taken`, också med versaler, och inget skapades.
  - Admin loggade in och kom till guiden i sitt nya företag, och såg bara det.
- **Jobbens händelser:** `job.confirmed`, `job.scheduled`, `job.completed`, `job.invoiced` och
  `job.cancelled`, med svaren i tabellen under "Portalens svar på händelserna". Varje händelse
  sätter sitt datum, och statusen räknas fram ur datumen (`lib/domains/jobs/events.ts`). En sen
  händelse flyttar alltså aldrig jobbet bakåt, och en sen planering efter Utförd ändrar inte
  datumen (rättelse 38). Jobbet har planeringens första och sista dag och
  statusen Avbrutet med skälet.
- **Meddelandena åt båda hållen:**
  - Butikens meddelande sparas, köas i jobbets kö i utkorgen av triggern `job_messages_enqueue`, och
    syns direkt i tråden. Första försöket görs efter svaret med `after()`, och under meddelandet
    står det om det ligger i kö, skickas eller inte kom fram.
  - Meddelandet går aldrig före jobbets order, eftersom de ligger i samma kö.
  - `job.message` sparas med `crm_message_id` och visas som "Anna Berg · Planering".
- **Butiksbeställningarna ut:** ny, ändrad och tillbakadragen köas av triggern `store_orders_enqueue`,
  men bara det butiken själv gör, inte serverns egna skrivningar. Ändringen har `changed_at` som
  `updatedAt`. En ny beställning skickas efter svaret, en ändring och en tillbakadragning direkt,
  så att ett 409 syns på en gång. Beställningssidan säger om Ekovilla tagit emot den senaste.
  Utan `EKOVILLA_CRM_STORE_ORDERS=on` ligger de kvar i kö tills William slår på den
  (`storeOrdersToCrmEnabled` i `lib/crm/config.ts`).
- **Dokumenten** (`job.document`): PDF:en läggs i bucketen `job-documents` med secret key, och ett
  nytt dokument av samma sort ersätter det gamla, både raden och filen. Under Dokument på jobbet
  står det som kommit, och det som väntas med när det kommer. Butiken hämtar dem genom
  `/jobb/{id}/dokument/{sort}`, som läser bucketen med sin session. Filnamnet står i
  `filename*`, kodat enligt RFC 5987 också för `' ( ) *` (rättelse 30). Prefixet står i
  `lib/auth/publicPaths.ts`, så att proxyn släpper det utan session, och
  `tests/app/ekovillaRoutes.test.ts` kräver att varje handler under det börjar med grinden.
- **"Prova kopplingen"** under Inställningar, för butikens admin: en signerad ping till CRM:et.
- **Låtsas-CRM:et** `scripts/latsas-crm.mjs` (`npm run latsas-crm`), efter det här kontraktet, med
  en egen implementation av signaturen. Se "Så körs det lokalt".
- **Butiksbeställningarnas status tillbaka:** `store_order.confirmed`, `store_order.delivered`,
  `store_order.invoiced` och `store_order.cancelled`. Statusen räknas fram ur datumen och flyttas
  aldrig bakåt (`lib/domains/storeOrders/events.ts`). Kommer Ekovillas bekräftelse till en
  beställning som butiken dragit tillbaka, hann Ekovilla före: den blir Bekräftad och får rutan om
  det. `store_order.cancelled` dateras med `occurredAt`. Beställningssidan visar Ekovillas
  ordernummer, datumen och skälet till en makulering.
- **Kvar i portalen**, mot det här kontraktet: inget. Det som återstår är CRM:ets halva, och att slå
  på kopplingen i testmiljön (HANDOVER.md).

## Momsen (besvarad 29 september 2026)

- **William beslutade momsen per dokument, som i CRM:et i dag** (rättelse 34, prövat i Fortnox
  testbolag): en butiksbeställning har 25 %, också frakten, eftersom butiken är slutkund. Ett jobb har
  0 % på hela ordern (omvänd skattskyldighet). `DOMAIN.md` säger samma sak.
- **Kontot** (rättelse 36): sedan CRM-PR #259 har varje rad sitt konto efter dokumentets moms, och
  inte efter kundkortet. En butiksbeställning (25 %) bokförs alltså på 3001.
- **Kvar, före CRM:ets fas 9:** fakturatexten "Omvänd betalningsskyldighet" följer fortfarande
  kundkortet. Det är en öppen fråga i CRM:ets plan.
