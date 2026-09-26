/**
 * Vilka fält på en arbetsorder NÅR kundens Fortnox-dokument, och när tar dokumentet emot dem?
 *
 * ⚠️ EGEN MODUL UTAN BEROENDEN, med flit. Reglerna behövs på båda sidor om domängränsen — av
 * CRM-routerna (ska den här sparningen larma eller pusha?) och av `fortnox/orders` (hann något
 * ändras medan vi skrev?). Låg de i `crm/work-orders.ts` blev importen en cykel:
 * `fortnox/orders` → `crm/work-orders` → `fortnox/partialInvoices` → `fortnox/orders`. Den var
 * godartad idag — ingen läser en importerad binding vid modulinitiering — men det är precis den
 * sortens kant som blir en `undefined` vid nästa omflyttning.
 *
 * `crm/work-orders.ts` re-exporterar allt härifrån, så befintliga importvägar är oförändrade.
 */

// De fält i `work_address` som faktiskt når huvudet — se `buildOrderDeliveryFields`, som bara läser
// gata, postnummer och ort. `delivery_address`/`invoice_address` bor i samma kolumn men rör inte
// orderhuvudet.
export const MIRRORED_WORK_ADDRESS_KEYS = ['street_address', 'postal_code', 'city'] as const;

/**
 * De fält i `customer_snapshot` som når orderhuvudet.
 *
 * 🧨 KOLUMNEN BÄR MYCKET MER. Telefon, e-post, slutkundens kontaktuppgifter, org.nr och personnummer
 * ligger där också — och INGET av det skickas till Fortnox. Jämförs hela kolumnen blir en rättad
 * telefon på arbetsplatsen en "ändring", med en header-PUT som följd; misslyckas den stämplas
 * ordern 'failed' och faktureringen spärras, för ett fält dokumentet aldrig burit.
 *
 * ⚠️ `contact_name` står med trots att det är kundkontakten: `resolveYourReference` faller tillbaka
 * på det när `your_reference` saknas, så på en äldre rad ÄR det referensen Fortnox får.
 * `label_cleared` står INTE med — det är synkens eget minne, inte kunddata.
 */
export const MIRRORED_SNAPSHOT_KEYS = [
  'your_reference',
  'contact_name',
  'label',
  'reverse_vat',
  'street_address',
  'delivery_address',
  'delivery_postal_code',
  'delivery_city',
] as const;

/**
 * De ROT-fält som faktiskt NÅR FORTNOX-DOKUMENTET.
 *
 * ⚠️ `rot_percent` och `max_deduction` står medvetet UTANFÖR. De läses bara av `pricing.ts` för vår
 * egen preliminära "Att betala" — Fortnox räknar det verkliga avdraget själv och får aldrig
 * siffrorna. Låg de med hade en rättad procentsats dragit igång en full positionsbaserad rad-PUT
 * (plus `assertLineItemsArePriced`, som kan stämpla 'failed' och spärra faktureringen) för en
 * ändring dokumentet aldrig ser.
 */
export const ROT_DOCUMENT_KEYS = ['enabled', 'property_designation', 'brf_org_number'] as const;

/**
 * Radfält som stannar i CRM.
 *
 * ⚠️ EXKLUDERINGS-, inte inkluderingslista, med flit. Nästan allt på en rad når Fortnox (artikel,
 * antal, pris, rabatt, enhet, radtext, husarbetesflaggor), så en inkluderingslista hade måst hållas
 * i synk med `buildOrderRows` och tyst börjat missa nya fält. Här defaultar ett nytt fält i stället
 * till "räknas som en ändring" — fel åt det säkra hållet.
 *
 * `include_in_description` styr bara vilken rad som hamnar i VÅR arbetsbeskrivning
 * (measurementBlock.ts). Fortnox ser den aldrig, så en ÖVRIGT-bock får inte kosta en full
 * positionsbaserad rad-PUT — den farligaste skrivningen i hela pushen.
 */
export const LINE_ITEM_CRM_ONLY_KEYS = ['include_in_description'] as const;

/** Tom sträng, blanktecken och null är SAMMA tomhet. Fortnox ser ingen skillnad; inte vi heller. */
function mirroredText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Är FORTNOX-ORDERN stängd för ändringar?
 *
 * 🧨 "Fakturerad" räcker inte som fråga — de två faktureringsvägarna gör helt olika saker med
 * Fortnox-ordern:
 *
 *  • HELFAKTURERING går `PUT /orders/{n}/createinvoice`. Fortnox konverterar ordern till en faktura
 *    och dokumentet STÄNGS: varje efterföljande skrivning avvisas.
 *  • DELFAKTURERING (Model B) POST:ar FRISTÅENDE fakturor och rör aldrig createinvoice. Orderns
 *    dokument hos Fortnox är alltså fortfarande ÖPPET och tar emot ändringar.
 *
 * ⚠️ Och just slutrundan i en delfakturering sätter `fortnox_invoice_number` på ordern (spegling åt
 * kortet och rapporterna, se partialInvoices). Ett villkor som bara frågar efter fakturanumret
 * låser därför ute en order som Fortnox gärna hade tagit emot — och eftersom `createPartialInvoice`
 * medvetet INTE gatar på synkstatusen kan en sådan order stå kvar på 'failed' med sin enda
 * reparationsväg ("Synka om") bortspärrad. `partial_invoicing_started_at` är det som skiljer dem.
 */
export function isFortnoxOrderClosed(workOrder: {
  status?: string | null;
  fortnox_invoice_number?: string | null;
  partial_invoicing_started_at?: string | null;
} | null | undefined): boolean {
  if (!workOrder) return false;
  if (workOrder.partial_invoicing_started_at) return false;
  return workOrder.status === 'invoiced' || Boolean(workOrder.fortnox_invoice_number);
}

/**
 * Är ändringen en RENSNING som Fortnox inte kan ta emot?
 *
 * 🧨 `buildOrderHeader` UTELÄMNAR tomma värden (`...(yourReference ? { YourReference } : {})`), och
 * en Fortnox-PUT rör bara fält den bär. Ett tömt "Er referens" eller en tömd arbetsadress kan
 * därför ALDRIG nollas via synken — PUT:en går igenom, rapporterar framgång, och Fortnox behåller
 * sitt gamla värde. Kundens dokument bär då kvar en referens eller en arbetsplats som inte längre
 * gäller, med allt grönt på skärmen.
 *
 * ⚠️ Rådet "synka om" är därför FEL här — det skickar säljaren i en cirkel där andra försöket
 * rapporterar framgång lika tyst. Fältet måste rättas för hand i Fortnox.
 *
 * ⚠️ `label` är UNDANTAGET och står inte med: den har ett eget rensningsminne (`label_cleared` →
 * `YourOrderNumber: null`) och lagas av PUT:en som vanligt.
 *
 * ⚠️ `assigned_to` står inte heller med: kolumnen är `not null`, så ansvarig kan aldrig tömmas.
 */
export function workOrderClearIsUnexpressible(
  current: {
    customer_snapshot?: Record<string, unknown> | null;
    work_address?: Record<string, unknown> | null;
  } | null | undefined,
  overrides: { your_reference?: string | null; work_address?: Record<string, unknown> | null },
): boolean {
  const snapshot = (current?.customer_snapshot ?? {}) as Record<string, unknown>;

  if ('your_reference' in overrides) {
    // Samma fallback som huvudet använder (resolveYourReference) på BÅDA sidor.
    const before = mirroredText(snapshot.your_reference) ?? mirroredText(snapshot.contact_name);
    const after = mirroredText(overrides.your_reference) ?? mirroredText(snapshot.contact_name);
    if (before && !after) return true;
  }

  if ('work_address' in overrides) {
    const next = (overrides.work_address ?? {}) as Record<string, unknown>;
    const prev = (current?.work_address ?? {}) as Record<string, unknown>;
    // Nyckel för nyckel: rensas bara orten utelämnas DeliveryCity medan gata och postnummer
    // skickas, och dokumentet får en halv adress från två olika platser.
    if (MIRRORED_WORK_ADDRESS_KEYS.some((key) => mirroredText(prev[key]) && !mirroredText(next[key]))) return true;
  }

  return false;
}

/**
 * Ändrades något som faktiskt NÅR kundens Fortnox-dokument?
 *
 * 🧨 SKILT FRÅN "skickade klienten fältet". Ordervyn skickar `your_reference` vid varje sparning
 * och `label` vid varje sparning av en företagsorder, så en närvarokoll (`'label' in updateInput`)
 * betyder bara att formuläret postades. Det duger för att BESLUTA OM EN PUSH — en extra PUT med
 * oförändrade värden är ofarlig — men inte för att LARMA: på en fakturerad order, där ändringen
 * omöjligt kan nå fram, hade varje rättad anteckning gett ett rött "nådde inte Fortnox" om
 * ingenting.
 *
 * ⚠️ TRE NORMALISERINGAR, var och en hittad genom att den saknades:
 *
 *  1. `work_address` jämförs FÄLT FÖR FÄLT, aldrig med `JSON.stringify`. Kolumnen är jsonb och
 *     kommer tillbaka i PostgREST:s nyckelordning (city, postal_code, street_address …) medan
 *     Zod-schemat bygger sin egen (street_address, postal_code, city …) och dessutom fyller på med
 *     nycklar klienten aldrig skickade. Två strängar som ALDRIG kan bli lika — mätt mot den riktiga
 *     raden för order 131 — alltså "ändrat" vid varje sparning.
 *  2. `your_reference` jämförs mot samma FALLBACK som huvudet använder (`resolveYourReference`:
 *     your_reference → contact_name). En äldre rad utan egen referens bär kontaktpersonens namn
 *     dit, och klientens utkast seedas från just det värdet.
 *  3. Tomhet normaliseras: `''`, `'  '` och `null` är samma sak.
 *
 * ROT ligger medvetet UTANFÖR. De fälten går den fulla pushen, inte header-vägen, och har sin egen
 * ändringsflagga i `mergeWorkOrderRotDetails` (`documentChanged`).
 */
export function workOrderMirroredFieldsChanged(
  current: {
    customer_snapshot?: Record<string, unknown> | null;
    work_address?: Record<string, unknown> | null;
    assigned_to?: string | null;
  } | null | undefined,
  // Bara nycklar klienten FAKTISKT skickade får finnas här — `undefined` betyder "rör inte".
  overrides: {
    label?: string | null;
    your_reference?: string | null;
    assigned_to?: string | null;
    work_address?: Record<string, unknown> | null;
  },
): boolean {
  const snapshot = (current?.customer_snapshot ?? {}) as Record<string, unknown>;

  if ('label' in overrides && mirroredText(overrides.label) !== mirroredText(snapshot.label)) return true;

  if ('your_reference' in overrides) {
    // ⚠️ FALLBACKEN GÄLLER BÅDA SIDOR. Tidigare gick bara det nuvarande värdet genom
    // `your_reference ?? contact_name`, så att TÖMMA fältet på en rad vars referens ÄR
    // kontaktnamnet såg ut som en ändring — fast headern får exakt samma värde efter sparningen.
    // Det gav ett rött "nådde inte Fortnox" för en ändring som inte finns.
    const before = mirroredText(snapshot.your_reference) ?? mirroredText(snapshot.contact_name);
    const after = mirroredText(overrides.your_reference) ?? mirroredText(snapshot.contact_name);
    if (after !== before) return true;
  }

  if ('assigned_to' in overrides && (overrides.assigned_to ?? null) !== (current?.assigned_to ?? null)) return true;

  if ('work_address' in overrides) {
    const next = (overrides.work_address ?? {}) as Record<string, unknown>;
    const prev = (current?.work_address ?? {}) as Record<string, unknown>;
    if (MIRRORED_WORK_ADDRESS_KEYS.some((key) => mirroredText(next[key]) !== mirroredText(prev[key]))) return true;
  }

  return false;
}

/**
 * Ändrades orderns TITEL (`project_name`) på ett sätt som syns på dokumentet?
 *
 * 🧨 TITELN ÄR EN RAD, INTE ETT HUVUDFÄLT. Fortnox har inget fält för projektnamnet, så den går som
 * textraden `Projekt: X  Märkning: Y` sist i radlistan (buildOrderProjectNote). Header-synken
 * släpper medvetet raderna — en titelrättning som gick den vägen hade sparats i CRM, rapporterats
 * grön och aldrig nått orderbekräftelsen eller fakturan. Alltså full push, samma som ROT.
 *
 * ⚠️ JÄMFÖRS PÅ VÄRDET, inte på närvaron. Den fulla pushen skriver om hela radlistan positionellt
 * och kan stämpla 'failed' (assertLineItemsArePriced), så den ska bara köras när dokumentet faktiskt
 * får en ny text. Blanktecken runt om räknas inte — buildOrderProjectNote trimmar dem ändå.
 */
export function workOrderTitleChanged(
  current: { project_name?: string | null } | null | undefined,
  next: string | null | undefined,
): boolean {
  return mirroredText(next) !== mirroredText(current?.project_name);
}
