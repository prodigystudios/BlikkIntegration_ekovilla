# Återförsäljarportalen ↔ CRM:et: integrationen (fas 5 och 6)

**Status:** plan och kontrakt. Portalens halva av affärsflödet är byggd, transporten mellan
systemen är inte byggd på någon sida. Skriven 2026-09-27.
**Källa:** `prodigystudios/aterforsaljare-ekovilla`, filen `CRM_INTEGRATION.md`. Det här är en
kopia. Ändras kontraktet ändras det i båda.
**Läst mot CRM:et:** commit `c1b563d` (2026-09-27 10:42). CRM:et byggs om (RBAC, SSR,
säkerhetsmigreringar). Kontrollera varje filhänvisning nedan mot koden som den ser ut när du läser
det här, innan du bygger på den.

Det här dokumentet är skrivet för dig som arbetar i CRM-repot (`BlikkIntegration_ekovilla`, alltså
app.ekovilla.se). Det förklarar vad återförsäljarportalen är, vad den skickar och vill ha tillbaka,
och vad som behöver byggas i CRM:et. Affärsreglerna bakom finns i portalens `DOMAIN.md`.

---

## Portalen i korthet

partner.ekovilla.se är en egen app, med egen Supabase och egen Vercel. Återförsäljare, det vill
säga butiker som K-Bygg Sandviken, loggar in där och gör två saker som berör Ekovilla:

1. **Offerter till sina kunder.** Butiken räknar på Ekovillas prislista 160 (Byggvaruhandel), lägger
   på sin marginal och skickar offerten. Kunden signerar i mobilen. Sedan skickar butiken
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
  riktningarna. Inget system läser det andras tabeller.
- **Portalen pratar aldrig med Fortnox.** CRM:et äger Fortnox-kopplingen. Fortnox byter
  refresh-token vid varje förnyelse, så två system kan inte dela den.
- **En återförsäljare i portalen är en butik.** Två butiker kan dela kundnummer i Ekovillas Fortnox.
  Kundnumret identifierar alltså inte en butik. Portalens `resellerId` gör det.

---

## Fyra flöden

| # | Flöde | Riktning | Vad CRM:et gör |
| --- | --- | --- | --- |
| 1 | Prislistan | CRM → portal | Läser lista 160 ur Fortnox, lägger till Ekovillas egna fält per artikel och publicerar till portalen. |
| 2 | Jobb | portal → CRM, status tillbaka | Tar emot ordern, hittar butikens kund, fördelar till en säljare, skapar en arbetsorder och skickar status, meddelanden och dokument tillbaka. |
| 3 | Butiksbeställning | portal → CRM, status tillbaka | Tar emot, ändrar eller drar tillbaka en beställning före bekräftelsen. Lägger på frakt, bekräftar och skickar status tillbaka. |
| 4 | Meddelanden på jobb | båda håll | Visar butikens meddelanden på arbetsordern och skickar säljarens svar tillbaka. |

---

## Transporten (gemensamt för alla flöden)

Inget av det här finns i någon av apparna i dag. Portalens `app/api/` är tom och väntar på det här.

### Signatur

Varje anrop, i båda riktningarna, signeras med HMAC-SHA256 och en delad hemlighet per miljö.

- **Hemligheten** heter `PORTAL_CRM_SHARED_SECRET` i båda apparna. Den är olika för testmiljön och
  produktionen, och ligger aldrig i koden.
- **Headers:**
  - `X-Ekovilla-Timestamp`: unix-sekunder.
  - `X-Ekovilla-Signature`: `v1=` följt av hex av `HMAC_SHA256(secret, timestamp + "." + råkropp)`.
- **Mottagaren:**
  - Nekar med 401 om tidsstämpeln avviker mer än 300 sekunder, eller om signaturen inte stämmer.
  - Jämför signaturen i konstant tid.
  - Signerar alltid mot den råa kroppen, före JSON-parsning.

### Idempotens

- **Header:** `Idempotency-Key`, satt av avsändaren. Formatet står per anrop nedan.
- **Mottagaren sparar varje behandlad nyckel**, i en tabell med unik nyckel och svaret som gavs. Ett
  upprepat anrop får samma svar och gör ingenting nytt. Avsändaren gör om ett anrop vid timeout och
  5xx, så dubbletter kommer att hända.
- **Svar:**
  - 2xx: mottaget.
  - 4xx: fel i anropet, och det görs inte om. 409 betyder "går inte längre", till exempel en
    ändring av en beställning som redan är bekräftad.
  - 5xx eller timeout: avsändaren försöker igen med backoff.

### Kroppen

- JSON och UTF-8.
- Belopp i kronor exkl. moms, avrundade till hela ören.
- Datum `YYYY-MM-DD`, tidpunkter ISO 8601 i UTC.
- **`unitCost` är priset.** Det står som i prislistan och är det ni skickar som `Price` till
  Fortnox.
- **`lineCost` och `costTotal` är bara information.** Räkna själva i CRM:et, som ni redan gör i
  `lib/domains/crm/pricing.ts`.

### I CRM:et

- **Routen** blir `app/api/portal/...` och ska släppas förbi sessionskontrollen i `middleware.ts`,
  på samma sätt som `/api/notifications/cleanup`. Signaturen kontrolleras i routen, som
  `isAuthorizedCron` i `app/api/notifications/cleanup/route.ts` kontrollerar `CRON_SECRET`.
- **Skrivningar** från portalens anrop har ingen användare bakom sig. Gör dem med service role, och
  logga dem som portalens.

### Miljöer

| Portal | Adress | CRM:et den pratar med |
| --- | --- | --- |
| Test | test.partner.ekovilla.se, Supabase `aterforsaljare-test` | **Öppen fråga**, se nedan |
| Prod | partner.ekovilla.se, prodprojektet finns inte än | app.ekovilla.se |

Portalen får två nya variabler: `EKOVILLA_CRM_URL` och `PORTAL_CRM_SHARED_SECRET`. CRM:et får
`RESELLER_PORTAL_URL` och samma hemlighet.

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

**CRM:et behöver:**

1. **En tabell för de här fälten per artikelnummer**, redigerbar av Ekovilla. Behörigheten
   `crm.article.manage` finns redan. Priset och enheten kommer från Fortnox. `GET /3/prices/sublist/160`
   ger priserna, och enheten finns i `fortnox_articles_cache.unit`.
2. **En publicering** som skickar hela listan till portalen:
   - `POST {RESELLER_PORTAL_URL}/api/ekovilla/pricelists`
   - `Idempotency-Key: pricelist-<validFrom>-<hash av innehållet>`

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
- **`resellerId: null` betyder att listan gäller alla butiker.** Om en butik ska ha en egen lista är
  en öppen fråga.

---

## Flöde 2: jobb (portal → CRM, status tillbaka)

### Butiken skickar ordern

Butiken skickar ordern själv när kunden har godkänt och de praktiska uppgifterna är ifyllda:
önskad period, kontaktperson på plats och vindslucka. Det sker alltså inte automatiskt vid
signaturen.

- **Anrop:** `POST {EKOVILLA_CRM_URL}/api/portal/jobs`
- **Idempotency-Key:** `job-<quoteId>`

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

- **`quantity`:** `volume` är lösull. Mängden i m³ är `areaM2 × thicknessMm / 1000`, samma formel som
  `pricing_mode: 'm3'` med `m2` och `thickness_mm` i era `line_items`. `count` är antal i artikelns
  enhet.
- **`construction`:** vind, snedtak, vägg eller övrigt.
- **`atticHatch`:** om vindsluckan sitter inne eller ute. Installatören behöver veta det.
- **`desiredPeriod`:** fritext, till exempel "Vecka 42". Det är inget datum, så lägg det inte i
  `desired_installation_date`.
- **`ekovillaCustomerNumber`:** kan vara `null`, om Ekovilla inte har kopplat butiken till en kund än.

### Det CRM:et gör med ordern

1. **Kontrollera signaturen och idempotensen.**

2. **Hitta butikens kund:** `crm_customers.fortnox_customer_id = store.ekovillaCustomerNumber`.
   Saknas numret, eller finns ingen sådan kund, går ordern till en admin (steg 3).

3. **Fördela till en säljare.** Det avgörs i CRM:et och aldrig i portalen. Välj den första som finns
   (portalens `DOMAIN.md`, "Vem hos Ekovilla som får ordern"):
   1. **Butikens säljare, satt per butik.** Det finns inte i CRM:et i dag. Det behövs en tabell som
      kopplar portalens `resellerId` till en användare, eftersom butiker kan dela kundnummer och
      kundkortet då inte räcker.
   2. **Kundansvarig** på kunden: `crm_customers.account_manager_id`.
   3. **Säljaren för länet där jobbet utförs,** enligt `crm_routing_rules` (county → user_id).
      Länet får tas fram ur arbetsadressen. `app/api/geocode` finns.
   4. **Ingen:** en admin fördelar ordern.

   Ordern går till en person, inte till en avdelning eller ett team.

4. **Skapa arbetsordern:**
   - **Kund:** butiken, inte slutkunden.
   - **Rader:** i `line_items` med `article_price = unit_price = unitCost` och `quantity`, som
     `m2`/`thickness_mm` för lösull. Ingen rabatt.
   - **ROT:** ingen. `rot_details` sätts inte, eftersom Ekovilla fakturerar butiken och butiken sköter
     ROT mot sin kund.
   - **Arbetsplatsen:** `work_address` är `workplace.address`. Fastighetsbeteckning, vindslucka,
     period, kontaktperson och fritext går till `internal_handoff` eller motsvarande, så att
     planeringen ser dem.
   - **Referens:** butikens offertnummer, `quoteNumber`, blir `YourOrderNumber` i Fortnox. Då
     känner butiken igen fakturan.
   - **Spårbarhet:** markera arbetsordern som portalens, med `quoteId` och `resellerId`, så att status
     kan skickas tillbaka. Det behövs en kolumn eller tabell för det.

   `createStandaloneCrmWorkOrder()` och `createCrmWorkOrderFromQuote()` i
   `lib/domains/crm/work-orders.ts` är närmast. Priserna måste stå på raderna, eftersom
   `pushWorkOrderToFortnox()` alltid skickar `Price` (`lib/domains/fortnox/orders.ts`) och
   `assertLineItemsArePriced()` stoppar opriserade rader.

5. **Meddela säljaren.** Det finns `notifications`, och `tasks` har redan `source`, som
   klädbeställningen använder. Om ordern skapas direkt eller först granskas är en öppen fråga.

6. **Svara** med `201 { "crmWorkOrderId": "…" }`. Portalen skapar då jobbet i läget "Mottagen av
   Ekovilla".

### Status tillbaka (CRM → portal)

- **Anrop:** `POST {RESELLER_PORTAL_URL}/api/ekovilla/events`
- **Idempotency-Key:** `<event>-<id>-<tidpunkt>`
- **Kropp:** `{ "type": "...", "occurredAt": "...", "data": { ... } }`

| `type` | `data` | Portalens status |
| --- | --- | --- |
| `job.confirmed` | `quoteId`, `ekovillaOrderNumber`, `confirmedAt` | Bekräftad |
| `job.scheduled` | `quoteId`, `scheduledFor` (datum). Skickas igen när datumet flyttas. | Planerad |
| `job.completed` | `quoteId`, `completedAt` (datum) | Utförd |
| `job.invoiced` | `quoteId`, `invoicedAt` (datum). När arbetsordern är helt fakturerad. | Fakturerad |
| `job.message` | `quoteId`, `messageId`, `authorName`, `department`, `body`, `sentAt` | Meddelande från Ekovilla |
| `job.document` | `quoteId`, `kind` (`order_confirmation` eller `self_inspection`), `name`, `contentBase64` (PDF) | Dokument på jobbet |

- **`job.confirmed`** skickas när Ekovilla har skapat ordern, i praktiken när arbetsordern
  finns och är godkänd av säljaren. `ekovillaOrderNumber` är arbetsorderns `order_number` eller
  Fortnox ordernummer. Vilket bestäms när det byggs.
- **Era statusar i `crm_work_orders.status`** översätts så här:
  - `scheduled` och `in_progress` blir Planerad.
  - `completed` blir Utförd.
  - `invoiced` blir Fakturerad. `partially_invoiced` skickas inte.
  - `cancelled` finns inte i portalen än, se de öppna frågorna.
- **Dokumenten skickas som PDF i kroppen.** Portalen sparar dem i sin egen lagring, eftersom
  systemen inte delar lagring. Vercel tar emot högst 4,5 MB per anrop.

### Meddelanden från butiken (portal → CRM)

- **Anrop:** `POST {EKOVILLA_CRM_URL}/api/portal/jobs/{quoteId}/messages`
- **Idempotency-Key:** `message-<messageId>`
- **Kropp:** `{ "messageId", "authorName", "body", "sentAt" }`

Visa meddelandet på arbetsordern och meddela den ansvariga säljaren. Säljarens svar går tillbaka som
`job.message`.

---

## Flöde 3: butiksbeställningar (portal → CRM, status tillbaka)

### Butiken beställer

Butiken beställer produkter ur prislistan: allt utom inblåsning (`m3`) och etablering. Antalet är
alltid hela enheter. Leveransen går till butiken, och **frakten sätter Ekovilla**, som en rad i
CRM:et eller i Fortnox. Portalen räknar ingen frakt. Butiken kan **ändra och dra tillbaka
beställningen tills Ekovilla har bekräftat den.** Efter bekräftelsen är den låst i portalen.

**Anrop:**

| Vad | Anrop | Idempotency-Key |
| --- | --- | --- |
| Ny beställning | `POST {EKOVILLA_CRM_URL}/api/portal/store-orders` | `store-order-<orderId>` |
| Ändrad | `PUT {EKOVILLA_CRM_URL}/api/portal/store-orders/{orderId}`, samma kropp | `store-order-<orderId>-<ändringstid>` |
| Tillbakadragen | `POST {EKOVILLA_CRM_URL}/api/portal/store-orders/{orderId}/withdraw` | `store-order-<orderId>-withdraw` |

Ändringen och tillbakadragningen svarar **409** om beställningen redan är bekräftad. Portalen visar
då att Ekovilla har hunnit bekräfta den.

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

CRM:et har **ingen produktorder i dag**. Den enda ordern är arbetsordern, `crm_work_orders`, som är
ett isoleringsjobb. Det finns två vägar, och valet görs med William:

- **A. En arbetsorder utan jobb.** Den återanvänder `pushWorkOrderToFortnox()` som den är, men
  behöver en typ som håller den borta från planeringen och installatörernas vyer.
- **B. En egen tabell för beställningar**, med ett eget `POST /orders` till Fortnox som återanvänder
  radbyggaren (`buildOrderRows`) och huvudets fält. Rekommendationen är B: arbetsordern är byggd
  kring ett jobb på plats, och en leverans till en butik har andra fält.

Oavsett väg ska Fortnox-ordern få:

| Fortnox | Kommer från |
| --- | --- |
| `CustomerNumber` | butikens kund |
| `DeliveryAddress1`, `DeliveryZipCode`, `DeliveryCity` | `delivery.address` |
| `YourOrderNumber` | `delivery.reference`, butikens eget ordernummer |
| `YourReference` | `delivery.contactName` |
| En textrad eller `Remarks` | `delivery.contactPhone`, `desiredPeriod` och `message` |
| `Price` per rad | `unitCost` |
| Fraktraden | Ekovilla lägger till den innan beställningen bekräftas |

Fördela beställningen till en säljare på samma sätt som jobben, men utan länet, eftersom
leveransen går till butiken.

### Status tillbaka

| `type` | `data` | Portalens status |
| --- | --- | --- |
| `store_order.confirmed` | `orderId`, `ekovillaOrderNumber`, `confirmedAt` | Bekräftad. Låser beställningen. |
| `store_order.delivered` | `orderId`, `deliveredAt` (datum) | Levererad |
| `store_order.invoiced` | `orderId`, `invoicedAt` (datum) | Fakturerad |
| `store_order.cancelled` | `orderId`, `reason` | Makulerad, Ekovillas beslut |

Butikens egen tillbakadragning heter Tillbakadragen i portalen. Den är skild från Makulerad, som
är Ekovillas.

---

## Det här finns i CRM:et i dag (läst @ `c1b563d`)

- **`crm_work_orders`**, i `supabase/migrations/20260925081734_baseline.sql`:
  - Nummer: `order_number`, med formatet `AO-YYYYMMDD-XXXXXX`.
  - Kund och innehåll: `customer_id`, `customer_snapshot`, `work_address`, `line_items`,
    `rot_details`, `internal_handoff`.
  - Planering: `desired_installation_date`, `status` (`draft` till `cancelled`), `assigned_to`.
  - Fortnox: `fortnox_order_number` med sina synkfält.
- **`pushWorkOrderToFortnox()`** i `lib/domains/fortnox/orders.ts`. Den sätter `OurReference`
  (säljaren), `YourReference`, `YourOrderNumber` och leveransadressen, och skickar alltid `Price`
  per rad. Den slår inte upp kundens prislista i Fortnox.
- **`crm_customers`** har kundnumret i `fortnox_customer_id` (unikt), och `price_list`,
  `account_manager_id`, `delivery_address` och `reverse_vat`.
- **`crm_routing_rules`** har kolumnerna `county`, `user_id` och `priority`. I dag används de bara
  för ringlistor.
- **Utan inloggning** släpper `middleware.ts` bara igenom `/api/auth`, två cron-routes med
  `CRON_SECRET` och Twilios statusanrop. Resten kräver session och RBAC-nycklar (`PERMISSIONS.md`).
  `app/api/orders/submit` är en platshållare utan koppling hit.
- **`tasks`** har `source` (klädbeställningen), och **`notifications`** har gallring.
- **Behörighetsnycklarna** finns: `crm.article.manage`, `crm.workorder.*`, `fortnox.workorder.push`
  och `crm.routingrule.manage`.

## Det här finns i portalen

- **Affärsflödet för båda flödena är byggt:**
  - skicka ordern (`hand_over_quote()`)
  - skapa, ändra och dra tillbaka en butiksbeställning
  - jobbens och beställningarnas statusar i databasen.
- **Typerna som är kontraktet:** `EkovillaOrder` och `EkovillaStoreOrder`, med tester.
- **Butikens kundnummer** ligger i `resellers.ekovilla_customer_number`. Det sätts bara av Ekovilla
  och kan inte skrivas från portalen.
- **Transporten saknas:**
  - avsändare med kö och omförsök
  - mottagaren `app/api/ekovilla/*`
  - att skapa jobbet när CRM:et svarat.

  Det byggs i portalen parallellt med CRM:ets halva, mot det här kontraktet.

## Öppna frågor (till William)

1. **Vilket CRM tar emot testmiljöns anrop?** test.partner.ekovilla.se ska inte skapa riktiga
   arbetsordrar i app.ekovilla.se och Fortnox.
2. **Granskar Ekovilla varje order manuellt**, eller skapas arbetsordern direkt och säljaren
   meddelas?
3. **Butiksbeställning:** väg A eller B ovan?
4. **Moms mellan Ekovilla och butiken:** omvänd skattskyldighet är ett antagande i portalen
   (`DOMAIN.md`). För produkter gäller normalt vanlig moms. Hur ska `reverse_vat` sättas på
   butikernas kunder?
5. **Ett jobb som Ekovilla avbryter** (`cancelled`) har ingen status i portalen. Ska det få en?
6. **Prislistan:** vem publicerar, och hur ofta? Var redigeras kundnamn, kategori och arbetsandel?
7. **Dokument:** vilka PDF:er ska butiken få på jobbet? Orderbekräftelse och egenkontroll är
   förberedda i portalen.

## Förslag till ordning i CRM:et

1. **Transporten:**
   - signatur och verifiering med tester
   - idempotenstabellen
   - undantaget i `middleware.ts`
   - hemligheterna.
2. **Prislistan:** tabellen för Ekovillas fält och publiceringen. Den är minst och fristående, och
   ger portalen riktiga priser.
3. **Jobb in:**
   - kunden och fördelningen, med tabellen för butikens säljare
   - arbetsordern
   - meddelandet till säljaren.
4. **Status, meddelanden och dokument tillbaka** för jobben.
5. **Butiksbeställningar**, efter beslutet om väg A eller B.

Testa kontraktet med exemplen ovan som fixturer: en signatur som stämmer och en som inte gör det,
ett upprepat anrop med samma nyckel, och en ändring efter bekräftelsen som ska ge 409. De nya
tabellerna behöver RLS och pgTAP-tester, som resten av CRM:et.
