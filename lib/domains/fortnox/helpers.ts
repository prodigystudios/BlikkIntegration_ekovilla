import { getSupabaseAdmin } from '@/lib/supabase/server';
import { lineItemRotLabor, type PricingLineItem } from '@/lib/domains/crm/pricing';
import { isConfiguredLineItem, isUnpricedLineItem } from '@/lib/domains/crm/lineItems';
import { FortnoxApiError } from './client';
import { DEFAULT_ROT_HOUSE_WORK_TYPE, ROT_LABOR_ARTICLE_NUMBER, ROT_LABOR_DESCRIPTION } from './types';

// Vidareexporteras här sedan de flyttade till types.ts (klientsäkert — se kommentaren där).
export { ROT_LABOR_ARTICLE_NUMBER, ROT_LABOR_DESCRIPTION };

/**
 * Kastar om någon DEBITERBAR rad saknar prisförankring — varken skrivet A-pris eller vald artikel.
 *
 * En sådan rad blir `Price: 0` på Fortnox-dokumentet. På en ROT-offert blir den dessutom carve 0,
 * så "Arbetskostnad ROT"-raden uteblir helt och kunden får inget avdragsunderlag. Ingetdera syns
 * hos oss — bara i dokumentet kunden får.
 *
 * ⚠️ Spärren behövs ÄVEN nu när offertformuläret blockerar sparningen. Offerter och arbetsordrar
 * som redan ligger i databasen från 900-stubbens tid bär raderna med sig, och de kan pushas när som
 * helst.
 *
 * ⚠️ VAR I ANROPAREN SPÄRREN LIGGER STYRS AV VAD STATUSEN SKULLE KOMMA ATT PÅSTÅ:
 *
 *   • Är anroparens uppgift att SKRIVA dokumentet (offertpush, orderpush, omsynk) hör spärren hemma
 *     inne i try:t, efter claimen. Kastar den innan registreras felet aldrig i
 *     `fortnox_*_sync_status` — och på omsynkvägen (PUT som ersätter ALLA rader) blir följden att
 *     raderna sparas lokalt, PUT:en uteblir och dokumentet står kvar som 'synced' med gamla rader
 *     i Fortnox. Precis den tysta drift granskningen redan hittat på andra ställen.
 *   • Är anroparen en annan operation som bara LÄSER underlaget (faktureringen bygger fakturan ur
 *     Fortnox egna orderrader) hör spärren hemma FÖRE claimen. Där har ingenting rört Fortnox, och
 *     en stämpel skulle utpeka fel sak — en trasig fakturasynk fast problemet är orderns rader.
 *
 * Samma avvägning som delfaktureringen dokumenterar.
 *
 * ⚠️ `isConfiguredLineItem` avgör vilka rader som omfattas, INTE `isBlankLineItem`. Rena textrader
 * (bara `line_note`) är en tillåten form som byggs till en textrad utan pris — spärrade vi dem
 * skulle befintliga offerter bli permanent opushbara.
 */
export function assertLineItemsArePriced(lineItems: unknown, subject: string): void {
  const items = Array.isArray(lineItems) ? (lineItems as Record<string, unknown>[]) : [];
  const unpriced = items.filter(
    (item) => isConfiguredLineItem(item as Parameters<typeof isConfiguredLineItem>[0])
      && isUnpricedLineItem(item as Parameters<typeof isUnpricedLineItem>[0]),
  );
  if (!unpriced.length) return;
  // Nämn nollan. En rad som ingår i priset (frakt, ställning) är en medveten nolla och passerar —
  // utan den meningen läser mottagaren spärren som att gratisrader inte längre är möjliga.
  const message = `${subject} har ${unpriced.length === 1 ? 'en rad' : `${unpriced.length} rader`} utan pris. Välj artikel, ange A-pris, eller skriv 0 om raden ingår.`;
  throw new FortnoxApiError(409, message, undefined, message);
}

/**
 * Kastar om arbetsorderns rader inte bevisligen ligger i Fortnox.
 *
 * ⚠️ FAKTURAN BYGGS AV FORTNOX UR ORDERNS RADER. `PUT /orders/{n}/createinvoice` tittar aldrig på
 * vad vi har — den fakturerar det Fortnox råkar hålla. Är radernas PUT misslyckad ('failed') eller
 * aldrig genomförd ('not_synced') fakturerar vi alltså gamla rader till kunden, utan att något syns
 * hos oss. 'pending' betyder att en synk är i luften just nu och svaret ännu inte är känt.
 *
 * Fail-closed går att göra utan risk för gammal data: kolumnen är `not null default 'not_synced'`
 * med en CHECK på de fyra värdena (20260604_fortnox_work_orders.sql), så det finns inga NULL som
 * skulle blockeras av misstag.
 *
 * Beskedet pekar på knappen som redan finns: arbetsordern visar "Försök igen" / "Skicka till
 * Fortnox" i precis de här lägena.
 */
export function assertOrderRowsSynced(syncStatus: string | null | undefined): void {
  if (syncStatus === 'synced') return;
  // ⚠️ 'pending' har ingen tidsgräns. `updateWorkOrderInFortnox` skriver statusen UTAN att sätta
  // någon claim-tidsstämpel, så en synk som dör mitt i lämnar ordern pending för alltid — till
  // skillnad från claimFortnoxPush, som återtar en gammal claim. Beskedet måste därför nämna
  // omsynken, annars står säljaren och väntar på något som aldrig blir klart.
  // ⚠️ PÅSTÅ INTE att raderna saknas i Fortnox — det vet vi inte. Statusen kan ha satts av en
  // headersynk som föll på ett utgånget token, på en order vars rader faktiskt ligger där. Säg det
  // som är sant: läget är inte bekräftat, och en omsynk bekräftar det.
  const message = syncStatus === 'pending'
    ? 'En synk mot Fortnox pågår. Vänta tills den är klar — har läget fastnat, synka om arbetsordern.'
    : 'Arbetsorderns artiklar är inte bekräftat synkade till Fortnox. Synka om arbetsordern och försök igen.';
  throw new FortnoxApiError(409, message, undefined, message);
}

// The ROT labour carved out of a single row (kr, ex VAT). Returns 0 when it's not a ROT document,
// when the row is already fully flagged as ROT work (is_rot_work — its whole amount is labour,
// handled separately), or when no labour was entered. `rowNet` is the row's discounted total
// (lineItemRowTotal), kept as a final clamp so the remaining material can never go negative.
//
// ⚠️ `labor_cost` är ett À-PRIS (kr per m³/styck) och räknas mot antalet — se splitRowLabor i
// lib/domains/crm/pricing.ts, som äger tolkningen. Räkningen görs INTE om här: gjorde vi det skulle
// dokumentet till Fortnox kunna säga något annat än offerten på skärmen.
export function rowRotLaborCarveout(
  item: PricingLineItem,
  rowNet: number,
  rotEnabled: boolean,
): number {
  if (!rotEnabled || item.is_rot_work) return 0;
  const labor = lineItemRotLabor(item);
  if (!(labor > 0)) return 0;
  return Math.min(labor, Math.max(0, rowNet));
}

// Split a carved ROT material row so the two resulting rows' ROUNDED totals still sum to the row's
// rounded total — no drift versus the CRM total. Fortnox stores a row Price at 2 decimals and
// re-multiplies by the quantity, so we (a) round the reduced material unit price to 2 dp, then
// (b) let the aggregated labour absorb whatever rounding residual that leaves. Returns the unit
// price to send on the material row and the labour amount to add to the aggregated husarbete row.
export function splitRotMaterialRow(
  rowNet: number,
  quantity: number,
  carve: number,
): { materialUnitPrice: number; labour: number } {
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const targetTotal = round2(rowNet);
  const materialNet = Math.max(0, rowNet - carve);
  const materialUnitPrice = quantity > 0 ? round2(materialNet / quantity) : round2(materialNet);
  const materialShown = quantity > 0 ? round2(quantity * materialUnitPrice) : materialUnitPrice;
  // Residual (rowNet rounding + material-unit rounding) rides on the labour row, so material +
  // labour is exact to the öre. Clamp at 0: for an absurd sub-öre carve the material rounding can
  // exceed the carve and drive this negative, which must never pollute the aggregated labour total.
  const labour = Math.max(0, round2(targetTotal - materialShown));
  return { materialUnitPrice, labour };
}

// Husarbete-fälten för EN rad på ett dokument: skickas BARA på rader vi själva menar är arbete,
// och bara på ROT-dokument. Allt annat utelämnas helt.
//
// Regeln ser försiktig ut och är det med flit. Tre mätningar mot Fortnox 2026-08-19 ligger bakom
// den, och två av dem motbevisade var sin rimlig idé. Läs dem innan du breddar något här.
//
// 1. ⚠️ INGENTING PÅ ETT ICKE-ROT-DOKUMENT. Ett icke-ROT-dokument (`TaxReductionType: 'none'`)
//    nekar VILKEN husarbetestyp som helst — även den tomma — med 2004021. Se
//    FORTNOX_INTEGRATION.md sekt. 4 punkt 2.
//
// 2. 🧨 `HouseWork: false` SKICKAS ALDRIG. Mätt: artikel 1058 (Arbetskostnad per man,
//    husarbete-flaggad i Fortnox) lades som en vanlig rad utan kryss, och vårt uttryckliga `false`
//    TOG BORT artikelns flagga. Dokumentationens påstående att artikelflaggan ärvs "oavsett vad vi
//    skickar" gäller alltså bara när vi är TYSTA — den står inte emot ett uttryckligt `false`.
//    Följden hade varit tyst: varje monterings- och framkörningsrad (1012, 1024–1026, 1058, 1068)
//    utan kryss hade tappat sitt ROT-avdrag, och det syns inte hos oss — bara på dokumentet.
//
// 3. 🧨 EN TYP UTAN FLAGGA BLIR ÄNDÅ HUSARBETE. Mätt, och den stängde en hel designidé:
//    redovisningen ville ha `HouseWorkType` på materialrader (utan flagga) för att ROT-underlaget
//    skulle bli rätt. Det såg ut att fungera — materialraden kom in som Bygg utan flagga — men vid
//    NÄSTA radändring omvaliderar Fortnox dokumentet och befordrar varje rad som bär en typ till
//    husarbete. Andra pushen hade flaggat materialet, alltså ROT på material, vilket inte är
//    tillåtet. Att det inte syns förrän en omvalidering sker är samma fördröjda felklass som
//    beskrivs i FORTNOX_INTEGRATION.md sekt. 4 punkt 3.
//
//    ⇒ En typ kan alltså inte sättas på en rad som inte ska vara husarbete. Vill man ha en typ på
//      materialrader måste den sitta på ARTIKELN i Fortnox — med den kända följden att artikeln
//      sedan nekar varje icke-ROT-dokument den hamnar på. Det är en verksamhetsavvägning, inte en
//      kodfråga.
export function rotRowHouseWork(
  item: { is_rot_work?: boolean | null; house_work_type?: string | null },
  rotEnabled: boolean,
): { HouseWork: true; HouseWorkType: string } | null {
  if (!rotEnabled || !item.is_rot_work) return null;
  return { HouseWork: true, HouseWorkType: item.house_work_type || DEFAULT_ROT_HOUSE_WORK_TYPE };
}

// The aggregated "Arbetskostnad ROT" husarbete row appended to a ROT document once material rows
// have carved out labour. Returns null when nothing was carved (so no empty row is emitted). The
// shape is quantity-agnostic: each builder spreads the quantity key it needs (offers → Quantity,
// orders → OrderedQuantity/DeliveredQuantity, invoices → DeliveredQuantity). `vat` is the row VAT
// already resolved by the caller (0 % under reverse charge, though that never co-occurs with ROT).
export function rotLaborRow(total: number, vat: number): {
  ArticleNumber: string;
  Description: string;
  Price: number;
  Unit: string;
  Discount: number;
  DiscountType: 'PERCENT';
  VAT: number;
  HouseWork: true;
  HouseWorkType: string;
} | null {
  const price = Math.round(total * 100) / 100;
  if (!(price > 0)) return null;
  return {
    ArticleNumber: ROT_LABOR_ARTICLE_NUMBER,
    Description: ROT_LABOR_DESCRIPTION,
    Price: price,
    // Unit/Discount uttryckligen satta av samma skäl som allt annat här: raden kan hamna där en
    // annan rad låg, och då ärvs varje fält vi inte skickar. Se FORTNOX_TEXT_ROW.
    Unit: '',
    Discount: 0,
    DiscountType: 'PERCENT',
    VAT: vat,
    HouseWork: true,
    HouseWorkType: DEFAULT_ROT_HOUSE_WORK_TYPE,
  };
}

// A Fortnox push completes well within this window; a 'pending' claim older than this is
// treated as abandoned (a crashed/timed-out request) and may be re-claimed, so the guard
// can never permanently deadlock a document.
const PUSH_CLAIM_STALE_MS = 120_000;

// Atomically claims the right to push a row to Fortnox so two concurrent requests
// (a double-clicked button, the auto-push-on-create racing a manual "Skicka till Fortnox",
// or a retried POST) can't each create a DUPLICATE Fortnox document.
//
// It flips `statusCol` to 'pending' and stamps `claimedAtCol`, but ONLY when no fresh claim
// is already held — i.e. the status is not already 'pending', or the existing 'pending' claim
// is stale (a crashed/timed-out push). Returns true iff this caller acquired the claim.
//
// IMPORTANT: this can't be one UPDATE with an .or() filter. PostgREST rejects a logical
// .or()/.and() filter on a mutation, raising a misleading "column <x> does not exist" even
// for columns that plainly exist (they work in SELECT and in the SET clause). So we express
// the "claim unless a fresh pending claim is held" condition as TWO single-predicate
// conditional UPDATEs. Each is still one atomic statement, so PostgreSQL's READ COMMITTED
// re-evaluation keeps it race-safe across instances: of two concurrent claimers, only one
// flips the row and the other matches 0 rows.
export async function claimFortnoxPush(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  table: 'crm_work_orders' | 'crm_quotes',
  id: string,
  statusCol: string,
  claimedAtCol: string,
): Promise<boolean> {
  const staleBefore = new Date(Date.now() - PUSH_CLAIM_STALE_MS).toISOString();
  const stamp = { [statusCol]: 'pending', [claimedAtCol]: new Date().toISOString() };

  // A DB error here is NOT a lost claim — swallowing it would masquerade a real failure
  // (rejected filter, missing column, constraint) as "another push is already in progress"
  // and permanently deadlock the document. Fail loudly so the actual cause surfaces.
  const fail = (e: { message: string }, phase: string): never => {
    throw new Error(`[Fortnox] push-claim (${phase}) mot ${table}/${id} misslyckades: ${e.message}`);
  };

  // 1) Normal case: the row isn't currently held — claim it. Covers every non-'pending'
  //    status (not_synced / synced / failed), which is also the only state a never-claimed
  //    row is in. One concurrent claimer wins; the other re-reads 'pending' → 0 rows.
  const first = await supabase
    .from(table).update(stamp).eq('id', id).neq(statusCol, 'pending').select('id');
  if (first.error) fail(first.error, 'normal');
  if (Array.isArray(first.data) && first.data.length > 0) return true;

  // 2) The row IS 'pending' but the claim is stale (a crashed/timed-out push) — re-claim it,
  //    so the guard can never permanently deadlock. A 'pending' row always carries a
  //    claimedAt (stamped together with the status here), so a timestamp test is sufficient.
  const second = await supabase
    .from(table).update(stamp).eq('id', id).eq(statusCol, 'pending').lt(claimedAtCol, staleBefore).select('id');
  if (second.error) fail(second.error, 'stale');
  return Array.isArray(second.data) && second.data.length > 0;
}

// Resolve whether a Fortnox document should be reverse-charge VAT (omvänd skattskyldighet /
// byggmoms). The point-in-time `customer_snapshot.reverse_vat` is authoritative when present
// (set at quote/order creation). Legacy rows whose snapshot predates the flag fall back to the
// live customer record. Drives both the document VATType and the 0 % row VAT in the push.
export async function resolveReverseVat(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  snapshotReverseVat: boolean | null | undefined,
  customerId: string | null | undefined,
): Promise<boolean> {
  if (typeof snapshotReverseVat === 'boolean') return snapshotReverseVat;
  if (!customerId) return false;
  const { data } = await supabase
    .from('crm_customers')
    .select('reverse_vat')
    .eq('id', customerId)
    .maybeSingle();
  return (data as { reverse_vat?: boolean | null } | null)?.reverse_vat === true;
}

// Builds a ROT property note (Fastighetsbeteckning + BRF org.nr) for a text row on the
// offer/order/invoice. Fortnox has NO API field for the ROT property designation — it must be
// typed manually into the husarbete dialog — so we surface it as a plain comment line for whoever
// finalizes the invoice. Returns null when nothing was entered. Both values share ONE line
// (double-space separated) so they never become two consecutive text rows (which Fortnox turns
// into a bogus priced row). Newlines are stripped by Fortnox, so whitespace is the separator.
export function buildRotPropertyNote(
  rot: { property_designation?: string | null; brf_org_number?: string | null } | null | undefined,
): string | null {
  const property = rot?.property_designation?.trim();
  const brf = rot?.brf_org_number?.trim();
  const parts: string[] = [];
  if (property) parts.push(`Fastighetsbeteckning: ${property}`);
  if (brf) parts.push(`BRF org.nr: ${brf}`);
  return parts.length ? parts.join('  ') : null;
}

// "Ert referensnummer" and the ROT property text row are two halves of ONE rule, so they are
// resolved together instead of by two parallel copies of the same condition. A villa's
// fastighetsbeteckning IS the customer's reference for the house and fits the single reference
// field; a bostadsrätt needs two values (BRF org.nr + lägenhetsnr) that don't fit, so those ride
// as a text row instead. A företag's märkning (customer_snapshot.label) uses the same reference
// field — the two can never collide, since ROT is always a private customer.
//
// Returns exactly one of the two populated for a ROT document (never both), and the märkning as
// referenceNumber for everything else. See FORTNOX_INTEGRATION.md 4b for why Fortnox can't take
// the designation as a real field.
export function resolveRotReference(
  rot: { property_designation?: string | null; brf_org_number?: string | null } | null | undefined,
  label: string | null | undefined,
  rotEnabled: boolean,
): { referenceNumber: string | null; propertyNote: string | null } {
  const hasProperty = rotEnabled && !!rot?.property_designation?.trim();
  const hasBrf = rotEnabled && !!rot?.brf_org_number?.trim();
  const propertyAsRef = hasProperty && !hasBrf;
  return {
    referenceNumber: propertyAsRef ? rot!.property_designation!.trim() : (label?.trim() || null),
    propertyNote: propertyAsRef ? null : (rotEnabled ? buildRotPropertyNote(rot) : null),
  };
}

/**
 * 🧨 FORTNOX PUT UPPDATERAR RADERNA PER POSITION — ETT UTELÄMNAT FÄLT ÄRVS FRÅN DEN GAMLA RADEN.
 *
 * En rad-PUT ersätter INTE radlistan. Fortnox matchar de skickade raderna mot dokumentets
 * befintliga rader på plats i listan och uppdaterar fält för fält, precis som med header-fälten.
 * Ett fält vi inte skickar behåller alltså värdet från raden som låg på den positionen förut.
 *
 * Det gör varje "skicka bara när vi har ett värde"-mönster till en bugg, för radernas positioner
 * glider hela tiden: en mätrad tillkommer när säljaren fyller i m², en rad dras om i formuläret,
 * en avskriven rad faller bort ur pushen. Mätt i drift 2026-08-20 på offert 10047 — en mätrad
 * hamnade där en artikelrad legat och kom ut hos kunden med artikelnummer 13202, 3 000 kr och
 * husarbete-flagga. Dokumentet blev 3 000 kr dyrare än offerten i CRM:et.
 *
 * ⇒ VARJE RAD MÅSTE BÄRA VARJE FÄLT, även när värdet är "inget". Mätt mot skarp Fortnox samma dag:
 *
 *   | Skickat                | Utfall                                        |
 *   | ---------------------- | --------------------------------------------- |
 *   | `ArticleNumber: null`  | rensar artikelnumret                          |
 *   | `ArticleNumber: ''`    | 200 — men rensar INTE, gamla numret ligger kvar |
 *   | `Price` / `Quantity: 0`| skriver över                                  |
 *   | `Unit: ''`             | accepteras men rensar INTE en ärvd enhet      |
 *   | `Unit: null`           | 400, kod 2000699 "Värdet kan inte vara null. (unit)" |
 *   | `HouseWork: false`     | rensar flaggan                                |
 *   | `HouseWorkType: null`  | rensar typen (`''` rensar INTE)               |
 *   | `OfferRows: []`        | 400 — radlistan går inte att tömma och lägga om |
 *
 * Regeln är alltså `null` för att rensa och `''` för att inte rensa — utom `Unit`, som avvisar
 * null helt. Och eftersom radlistan inte går att tömma finns ingen "skriv om allt"-utväg: det är
 * fälten på varje rad som måste vara fullständiga.
 */
export const FORTNOX_TEXT_ROW = Symbol('fortnoxTextRow');

/**
 * Fälten en textrad (mätrad, Radtext, ROT-not) måste bära för att inte ärva något.
 *
 * Symbolnyckeln märker raden som textrad åt `appendFortnoxTextNote`. Den serialiseras aldrig —
 * `JSON.stringify` och `Object.keys` hoppar över symbolnycklar — så payloaden till Fortnox ser
 * likadan ut som utan den.
 *
 * ⚠️ `Unit: ''` STOPPAR INTE ARVET. Tom sträng är det enda tomvärde fältet tar (null ger 2000699),
 * men den skriver inte över — mätt 2026-08-20. En textrad som glider dit en artikelrad låg behåller
 * alltså artikelns enhet, och det syns i drift: offert 10047 har textrader som bär "M3" och "RLE".
 * Följden är kosmetisk (raden har pris 0 och antal 0), men enheten går inte att få bort så länge
 * raden uppdateras på plats. Fältet skickas ändå, för en rad som ALDRIG haft en enhet ska inte
 * kunna få en.
 *
 * ⚠️ HUSARBETE SÄTTS INTE HÄR — medvetet. Ett uttryckligt `HouseWork: false` stämplar
 * EMPTYHOUSEWORK, och ett dokument som inte är ROT i Fortnox avvisar varje husarbetesfält med
 * 2004021 (se rotRowHouseWork punkt 1). Vår `rotEnabled` är inte samma sak som dokumentets läge:
 * en orders `TaxReductionType` sätts BARA vid create, så en order som skapades innan ROT kryssades
 * i är inte ett ROT-dokument — och då hade varje Radtext-rad sänkt hela omsynken med 2004021.
 * Att låta vår kryssruta äga flaggan i stället för artikelregistret är ett eget beslut; tills det
 * är fattat rör vi inte husarbete här.
 */
export function fortnoxTextRowFields() {
  return {
    [FORTNOX_TEXT_ROW]: true as const,
    ArticleNumber: null,
    Price: 0,
    Unit: '',
    Discount: 0,
    DiscountType: 'PERCENT' as const,
  };
}

// Appends a document-level text note to a Fortnox row list WITHOUT creating two consecutive
// text rows — Fortnox treats a second consecutive text row (Description only, no amounts) as a
// new priced product row. If the last row is already a text row we merge the note into it
// (double-space separated); otherwise we push a new text row. Mutates and returns `rows`.
//
// ⚠️ Textraden känns igen på symbolen från fortnoxTextRowFields, inte på hur många nycklar den
// har. Den gamla kontrollen (`Object.keys(last).length === 1`) slutade gälla när textraderna
// började bära uttryckliga tomvärden — se FORTNOX_TEXT_ROW ovan.
export function appendFortnoxTextNote<T extends { Description: string }>(
  rows: T[], note: string | null | undefined, textRowFields: Omit<T, 'Description'> | null = null,
): T[] {
  if (!note) return rows;
  const last = rows[rows.length - 1] as (T & { [FORTNOX_TEXT_ROW]?: true }) | undefined;
  if (last?.[FORTNOX_TEXT_ROW]) {
    last.Description = `${last.Description}  ${note}`;
  } else {
    rows.push({ ...(textRowFields ?? {}), Description: note } as T);
  }
  return rows;
}

// Looks up the assigned user's full name for use as OurReference in Fortnox documents.
export async function resolveOurReference(
  userId: string | null,
  supabase: ReturnType<typeof getSupabaseAdmin>,
): Promise<string | undefined> {
  if (!userId) return undefined;
  const { data } = await supabase
    .from('profiles')
    .select('full_name')
    .eq('id', userId)
    .maybeSingle();
  return (data as { full_name?: string | null } | null)?.full_name ?? undefined;
}
