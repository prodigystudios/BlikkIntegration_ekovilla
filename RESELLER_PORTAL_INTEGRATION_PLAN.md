# Återförsäljarportalen ↔ CRM:et: integrationen (fas 5 och 6)

**Status:** kontrakt, beslutat med William 2026-09-27. Portalens halva av affärsflödet är byggd.
Transporten är inte byggd på någon sida.
**Källa:** `prodigystudios/aterforsaljare-ekovilla`, filen `CRM_INTEGRATION.md`. Det här är en
kopia. Ändras kontraktet ändras det i båda.
**Hur CRM:et bygger sin halva** står i CRM-repots `RESELLER_PORTAL_CRM_PLAN.md` (PR #242), läst mot
CRM:et @ `2cea02c`. Kontrollera varje filhänvisning mot koden innan du bygger på den. CRM:et byggs om
(RBAC, SSR, säkerhetsmigreringar).

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

## Besluten (William 2026-09-27)

| Fråga | Beslut |
| --- | --- |
| Testmiljön | CRM:et får test.app.ekovilla.se: grenen `testmiljo`, eget Supabase-projekt och Fortnox testbolaget. Den sätts upp när någon utanför ska testa. Tills dess byggs och testas allt lokalt↔lokalt. |
| Granskning | **Ekovilla granskar inte ordern.** Butikens godkännande i portalen räcker. CRM:et skapar arbetsordern och Fortnox-ordern automatiskt. |
| Butiksbeställningar | **Väg B:** en egen tabell i CRM:et och ett eget `POST /orders` till Fortnox. |
| Prislistan | Fälten redigeras per artikel i CRM:et. En admin publicerar med en knapp och väljer `validFrom`. |
| Avbrutet jobb | En ny händelse, `job.cancelled`. Portalen visar jobbet som **Avbrutet**, med skälet. |
| Dokument | Butiken får **orderbekräftelsen och egenkontrollen**. |
| Avsändare på meddelanden | **Namn och avdelning**, till exempel "Anna Berg · Planering". Avdelningen är en fast lista, se `job.message`. |
| Moms mellan Ekovilla och butiken | **Öppen.** Tas med ekonomi eller revisor, och ska vara besvarad före första riktiga jobbet i prod. Se sist. |

---

## Fyra flöden

| # | Flöde | Riktning | Vad CRM:et gör |
| --- | --- | --- | --- |
| 1 | Prislistan | CRM → portal | Läser lista 160 ur Fortnox, lägger till Ekovillas egna fält per artikel och publicerar till portalen. |
| 2 | Jobb | portal → CRM, status tillbaka | Tar emot ordern, hittar butikens kund, fördelar till en säljare, skapar arbetsordern och Fortnox-ordern, och skickar status, meddelanden och dokument tillbaka. |
| 3 | Butiksbeställning | portal → CRM, status tillbaka | Tar emot, ändrar eller drar tillbaka en beställning före bekräftelsen. Lägger på frakt, bekräftar och skickar status tillbaka. |
| 4 | Meddelanden på jobb | båda håll | Visar butikens meddelanden på arbetsordern och skickar säljarens svar tillbaka. |

---

## Transporten (gemensamt för alla flöden)

Inget av det här finns i någon av apparna i dag.

### Signatur

Varje anrop, i båda riktningarna, signeras med HMAC-SHA256 och en delad hemlighet per miljö.

- **Hemligheten** heter `PORTAL_CRM_SHARED_SECRET` i båda apparna. Den är olika lokalt, i
  testmiljön och i produktionen, och ligger aldrig i koden.
- **Headers:**
  - `X-Ekovilla-Timestamp`: unix-sekunder.
  - `X-Ekovilla-Signature`: `v1=` följt av hex av `HMAC_SHA256(secret, timestamp + "." + råkropp)`.
- **Mottagaren:**
  - Nekar med 401 om tidsstämpeln avviker mer än 300 sekunder, om signaturen inte stämmer eller om
    `v1=` saknas.
  - Jämför i konstant tid.
  - Läser den råa kroppen först och parsar JSON:en efteråt.
  - Avsändaren signerar vid varje försök, eftersom en signatur bara gäller i 300 sekunder.
- **Utan hemlighet** svarar mottagarens routes 503 och inget skickas. Koden kan därför gå ut mörk.

### Idempotens

- **Header:** `Idempotency-Key`, satt av avsändaren. Formatet står per anrop nedan.
- **Mottagaren sparar varje behandlad nyckel** med en hash av kroppen och svaret som gavs. Ett
  upprepat anrop får samma svar och gör ingenting nytt. **Samma nyckel med en annan kropp ger 422.**
  Dubbletter stoppas dessutom av affärsnycklarna: samma `quoteId` eller `orderId` ger alltid samma
  arbetsorder eller beställning.
- **Svar:**
  - 2xx: mottaget.
  - 4xx: fel i anropet, och det görs inte om. 409 betyder "går inte längre", till exempel en
    ändring av en beställning som redan är bekräftad.
  - 5xx eller timeout: avsändaren försöker igen med backoff, ett begränsat antal gånger.

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
- Kroppen är `{}`, signerad som allt annat.
- Svaret är `200 { "ok": true }`, eller 503 utan hemlighet.

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

- **Portalen:** `EKOVILLA_CRM_URL` och `PORTAL_CRM_SHARED_SECRET`.
- **CRM:et:** `RESELLER_PORTAL_URL` och samma hemlighet.
- **Testmiljöerna:** portalens testmiljö pratar med CRM:ets testmiljö, aldrig med app.ekovilla.se.

### Så körs det lokalt

- **Portarna:** CRM:et kör på :3000 och portalen på :3001: `DATA_SOURCE=supabase npm run dev -- -p
  3001`.
- **Portalens `.env.local`:** `EKOVILLA_CRM_URL=http://localhost:3000` och ett lokalt
  `PORTAL_CRM_SHARED_SECRET`, samma värde som i CRM:ets `.env.development.local`.
- **CRM:ets `.env.development.local`:** `RESELLER_PORTAL_URL=http://localhost:3001` och samma
  hemlighet.
- **Kunden:** butikens `ekovilla_customer_number` i portalens lokala databas måste finnas som kund
  (`fortnox_customer_id`) i CRM:ets lokala databas. Annars står jobbet som Mottagen, precis som det
  ska för en okopplad butik.
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
     Då känner butiken igen fakturan.
   - **Kontakten på plats:** `customer_snapshot.end_contact_name` och `end_contact_phone`.
   - **Resten av arbetsplatsen:** fastighetsbeteckning, vindslucka, önskad period och fritext skrivs
     som text i `internal_handoff.handoff_notes`, inte som egna nycklar.
     `desired_installation_date` lämnas tom.
   - **Spårbarhet:** kopplingen sparas i `crm_portal_jobs`, och ordern får brickan "Från
     återförsäljarportalen · <butik>".

5. **Svara** med `201 { "crmWorkOrderId": "…" }` så snart arbetsordern finns. Portalen skapar då
   jobbet i läget **Mottagen av Ekovilla**.

6. **Skapa Fortnox-ordern automatiskt, direkt efter svaret**, med `pushWorkOrderToFortnox()`.
   - Portalen väntar aldrig på Fortnox.
   - Misslyckas anropet gör CRM:et om det ett begränsat antal gånger, och sedan får säljaren en
     notis.
   - När Fortnox-ordern finns skickas `job.confirmed`, normalt inom någon minut.

**Om kunden saknas** (numret är `null` eller okänt) skapas arbetsordern ändå, hos reservadmin. Fortnox-ordern kan inte skapas utan kund, så jobbet står som
**Mottagen** tills Ekovilla har kopplat kunden. Då skapas Fortnox-ordern och `job.confirmed`
skickas.

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
| `job.cancelled` | `quoteId`, `reason`, `cancelledAt` | **Avbrutet**, med skälet |
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
- **`job.cancelled`** skickas när arbetsordern avbryts eller tas bort. `reason` är fritext till
  butiken och får vara tom. Inget kommer efter den.
- **`job.message`:**
  - `authorName` är säljarens namn.
  - `department` är en av `Försäljning`, `Planering`, `Ekonomi`, eller tom sträng.
  - Portalen visar det som "Anna Berg · Planering".
- **`job.document`:**
  - `kind` är `order_confirmation`, som skickas när Fortnox-ordern finns, eller `self_inspection`,
    som skickas när jobbet är utfört.
  - Ett nytt dokument av samma sort ersätter det gamla.
  - PDF:en skickas i kroppen, och portalen sparar den i sin egen lagring. Vercel tar emot högst
    4,5 MB per anrop.

### Meddelanden från butiken (portal → CRM)

- `POST {EKOVILLA_CRM_URL}/api/portal/jobs/{quoteId}/messages`
- `Idempotency-Key: message-<messageId>`
- Kropp: `{ "messageId", "authorName", "body", "sentAt" }`

CRM:et visar meddelandet på arbetsordern, på ett eget kort som är skilt från de interna
kommentarerna, och meddelar säljaren. Säljarens svar går tillbaka som `job.message`.

---

## Flöde 3: butiksbeställningar (portal → CRM, status tillbaka)

### Butiken beställer

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

- Kroppen är densamma som för en ny beställning, plus `updatedAt`, tidpunkten då butiken ändrade.
- CRM:et sparar det senaste `updatedAt`.
- En ändring med ett äldre eller samma `updatedAt` är ett sent omförsök. Den ignoreras med
  `200 { "status": "ignored" }`, så att den inte skriver över en nyare ändring.
- **409** betyder bara att beställningen redan är bekräftad. Det gäller både ändringen och
  tillbakadragningen, och portalen visar då att Ekovilla hunnit före.

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
butiken. Momsen på produkter är en öppen fråga, se sist.

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

## Det här finns i CRM:et i dag

Läst mot `c1b563d` och i CRM:ets plan mot `2cea02c`.

- **`crm_work_orders`**, i `supabase/migrations/20260925081734_baseline.sql`:
  - Nummer: `order_number`, med formatet `AO-YYYYMMDD-XXXXXX`.
  - Kund och innehåll: `customer_id`, `customer_snapshot`, `work_address`, `line_items`,
    `rot_details`, `internal_handoff`.
  - Planering och status: `status` (`draft` till `cancelled`), `assigned_to`.
  - Fortnox: `fortnox_order_number` med sina synkfält.
- **`pushWorkOrderToFortnox()`** i `lib/domains/fortnox/orders.ts`. Den skickar alltid `Price` per
  rad, är idempotent på `fortnox_order_number` och har en claim.
- **`crm_customers`** har kundnumret i `fortnox_customer_id` (unikt), och `account_manager_id` och
  `reverse_vat`.
- **`crm_routing_rules`** har kolumnerna `county`, `user_id` och `priority`.
- **Utan inloggning** släpper `middleware.ts` i dag bara igenom `/api/auth`, två cron-routes med
  `CRON_SECRET` och Twilios statusanrop.
- **SQL testas med vitest-tester** som läser migreringarna, och med `supabase/checks/parity.sql`.
  CRM:et har ingen pgTAP.
- **Resten bygger CRM:et** enligt `RESELLER_PORTAL_CRM_PLAN.md`: tabellerna för portalen, kön ut,
  planerat datum på arbetsordrarna och routerna.

## Det här finns i portalen

- **Affärsflödet för båda flödena är byggt:**
  - skicka ordern (`hand_over_quote()`)
  - skapa, ändra och dra tillbaka en butiksbeställning
  - jobbens och beställningarnas statusar i databasen.
- **Typerna som är kontraktet:** `EkovillaOrder` och `EkovillaStoreOrder`, med tester.
- **Butikens kundnummer** ligger i `resellers.ekovilla_customer_number`. Det sätts bara av Ekovilla.
- **Kvar i portalen**, mot det här kontraktet:
  - avsändaren med kö och omförsök
  - mottagaren `app/api/ekovilla/*` med ping
  - att skapa jobbet när CRM:et svarat 201
  - `scheduledUntil` och statusen Avbrutet på jobben
  - dokumenten i den egna lagringen
  - `updatedAt` på ändrade beställningar.

## Öppen fråga

- **Momsen mellan Ekovilla och butiken.** Omvänd skattskyldighet är ett antagande i portalen
  (`DOMAIN.md`). `reverse_vat` sitter på kunden i CRM:et och gäller alla kundens dokument, medan
  produkter normalt har vanlig moms. Frågan tas med ekonomi eller revisor. Den ska vara besvarad
  före första riktiga jobbet i prod, eftersom Fortnox-ordern skapas automatiskt, och den stoppar
  butiksbeställningarna i CRM:et.
