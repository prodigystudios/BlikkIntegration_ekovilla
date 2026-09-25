import { getSupabaseAdmin } from '@/lib/supabase/server';
import { lineItemQuantity } from '@/lib/domains/crm/lineItems';
import { isFortnoxOrderClosed, LINE_ITEM_CRM_ONLY_KEYS, MIRRORED_SNAPSHOT_KEYS, MIRRORED_WORK_ADDRESS_KEYS, ROT_DOCUMENT_KEYS } from '@/lib/domains/crm/workOrderSyncFields';
import { lineItemUnitPrice, lineItemDiscountPercent, lineItemRowTotal } from '@/lib/domains/crm/pricing';
import { fortnoxGet, fortnoxGetBinary, fortnoxPost, fortnoxPut, FortnoxApiError, FortnoxNotConnectedError, FortnoxPushInProgressError } from './client';
import { activeLineItems } from './partialInvoices';
import { FORTNOX_TEXT_ROW, appendFortnoxTextNote, buildOrderProjectNote, fortnoxTextRowFields, assertLineItemsArePriced, assertOrderRowsSynced, claimFortnoxPush, resolveDocumentOrganisationNumber, resolveOurReference, resolveReverseVat, resolveRotReference, rotLaborRow, rotRowHouseWork, rowRotLaborCarveout, splitRotMaterialRow } from './helpers';
// Läget kommer från documentPdfMode (ingen pdf-lib), typerna raderas vid kompilering. Själva
// renderaren laddas dynamiskt i renderOrderDocument, så PDF-motorn aldrig hamnar på kallstarten
// för de routes som bara sparar en arbetsorder. Samma uppdelning som offers.ts.
import { ORDER_PDF_MODE, type OrderPdfMode } from './documentPdfMode';
import type { FortnoxCompanySettingsResponse } from './offerPdf';
import type { FortnoxOrderResponse } from './orderPdfDesign';
import { stockholmTodayISO } from '@/lib/domains/planning/timezone';

// The point-in-time customer data carried on both the quote and the work order. Named once
// because the header builder below has to read the same shape off either of them.
type CustomerSnapshot = {
  contact_name?: string | null;
  your_reference?: string | null;
  street_address?: string | null;
  delivery_address?: string | null;
  delivery_postal_code?: string | null;
  delivery_city?: string | null;
  postal_code?: string | null;
  city?: string | null;
  reverse_vat?: boolean | null;
  end_contact_name?: string | null;
  end_contact_phone?: string | null;
  end_contact_email?: string | null;
  label?: string | null;
  // Minnet av att märkningen tömts på arbetsordern. Sätts av mergeWorkOrderSnapshotOverrides, som
  // ser övergången; läses av orderReferenceNumberField för att faktiskt blanka YourOrderNumber.
  label_cleared?: boolean | null;
};

// The work order's OWN address column — what the order detail page edits, and (since
// getWorkAddress seeds it) where the job site lives once an order exists.
type WorkOrderAddress = {
  street_address?: string | null;
  postal_code?: string | null;
  city?: string | null;
};

type RotDetails = {
  enabled?: boolean | null;
  property_designation?: string | null;
  brf_org_number?: string | null;
};

type WorkOrderRow = {
  id: string;
  quote_id: string | null;
  customer_id: string | null;
  assigned_to: string | null;
  customer_snapshot: CustomerSnapshot | null;
  work_address: WorkOrderAddress | null;
  project_name: string;
  client_name: string | null;
  amount: number;
  vat_percent: number | null;
  currency_code: string;
  fortnox_order_number: string | null;
  // Orderns EGNA ROT-uppgifter — det är de som gäller för dokumentet, se resolveOrderRotDetails.
  rot_details?: RotDetails | null;
  line_items: Array<{
    article_number?: string | null;
    article_name?: string | null;
    article_unit_name?: string | null;
    unit_price?: string | null;
    article_price?: number | null;
    quantity?: string | null;
    pricing_mode?: string | null;
    m2?: string | null;
    thickness_mm?: string | null;
    discount_percent?: string | null;
    line_note?: string | null;
    is_rot_work?: boolean | null;
    house_work_type?: string | null;
    // Labour carved out of a material row for ROT — summed onto the aggregated "Arbetskostnad ROT" row.
    labor_cost?: string | null;
    // Avskriven rad — sold but never performed. Kept in place (never deleted, so invoice rounds'
    // array indices stay valid) but dropped from the Fortnox document. See partialInvoices.ts.
    written_off?: boolean | null;
  }> | null;
};

export type PushOrderResult = {
  fortnox_order_number: string;
  /**
   * 🧨 ORDERN SKAPADES, MEN DOKUMENTET ÄR INTE KOMPLETT.
   *
   * Sätts när efterkontrollen upptäckte en sparning som landat mitt i pushen men INTE lyckades
   * spegla om den. Reparationsanropet har då redan stämplat ner synkstatusen — men den som
   * anropade oss svarade ändå "skapad/synkad" och visade en grön toast, medan brickan läste
   * Misslyckad och faktureringen var spärrad utan att något förklarade varför. Precis den tysta
   * framgång hela den här ändringen finns för att ta bort, en nivå upp.
   */
  mirrorFailed?: boolean;
  /**
   * ⚠️ Rensningen går inte att skicka ALLS — inte "gick inte den här gången".
   *
   * `buildOrderHeader` utelämnar tomma värden och en Fortnox-PUT rör bara fält den bär, så ett
   * tömt "Er referens"/"Vår referens"/leveransadress kan aldrig nollas av en omsynk. Rådet "synka
   * om" hade alltså skickat säljaren i en cirkel: andra försöket rapporterar framgång medan
   * Fortnox behåller sitt gamla värde. Fältet måste rättas för hand i Fortnox.
   */
  mirrorNeedsManualFix?: boolean;
};

export type CreateInvoiceResult = {
  fortnox_invoice_number: string;
};

// ⚠️ VARJE RAD SKICKAR VARJE FÄLT — omsynken PUT:ar hela radlistan och Fortnox uppdaterar per
// position, så ett utelämnat fält ärvs från raden som låg där förut. Se FORTNOX_TEXT_ROW i
// helpers.ts. Ordern glider dessutom garanterat: en avskriven rad faller bort ur pushen
// (activeLineItems) och förskjuter varje rad under sig.
type FortnoxOrderRow = {
  ArticleNumber?: string | null;
  Description: string;
  OrderedQuantity?: number;
  DeliveredQuantity?: number;
  Price?: number;
  VAT?: number;
  // Unit avvisar null (2000699) — tom sträng är det enda tomvärdet den tar.
  Unit?: string;
  Discount?: number;
  DiscountType?: 'PERCENT' | 'AMOUNT';
  HouseWork?: boolean;
  HouseWorkType?: string | null;
  [FORTNOX_TEXT_ROW]?: true;
};

// A text-only order row: Description with no article/quantities, so Fortnox renders it as a
// comment line under the article (carries the per-row free text / Radtext).
// NOTE: if a Fortnox test company rejects a text-only /orders row, the fallback is to append
// the Radtext to the article row's Description instead — the offer side is unaffected.
function orderTextRow(description: string, vat = 0): FortnoxOrderRow {
  // Uttryckliga tomvärden i stället för utelämnade fält — se FORTNOX_TEXT_ROW i helpers.ts.
  return { ...fortnoxTextRowFields(), Description: description, OrderedQuantity: 0, DeliveredQuantity: 0, VAT: vat };
}

// Exported for tests. NOTE: Fortnox order rows use `OrderedQuantity` (offer rows use
// `Quantity`, invoice rows use `DeliveredQuantity`) — sending `Quantity` to /orders
// returns 400 "Felaktigt fältnamn (Quantity)".
export function buildOrderRows(allLineItems: WorkOrderRow['line_items'], vatPercent: number, rotEnabled: boolean, reverseVat = false, documentNote: string | null = null): FortnoxOrderRow[] {
  // Written-off rows are dropped from the document: the customer is never billed for work that
  // wasn't performed, and the Fortnox order total has to match what the order is actually worth.
  // They stay in line_items (indices are load-bearing for the invoice rounds) — only the push omits.
  const lineItems = activeLineItems(allLineItems);
  if (!lineItems.length) return [];

  // Accumulates the labour carved out of material rows (kr, ex VAT), emitted as one aggregated
  // "Arbetskostnad ROT" row after the loop. Mirrors buildOfferRows so offer→order stays consistent.
  let carvedLaborTotal = 0;

  const rows = lineItems.flatMap((item) => {
    // Shared CRM pricing helpers (single source of truth) — identical parse/clamp/total logic as the
    // quote form, work-order editor and partialInvoices, so the order row can never drift from them.
    const price = lineItemUnitPrice(item);
    // For m³ rows the quantity is the computed volume, not the (empty) quantity field.
    const quantity = lineItemQuantity(item);
    const discount = lineItemDiscountPercent(item);

    // ROT labour carved out of THIS material row — removed from the row and re-booked onto the
    // aggregated husarbete row below, leaving the order total unchanged. See buildOfferRows. The
    // split rounds the material unit price and lets the labour absorb the residual so the two rows'
    // rounded totals still sum to the row total (no drift on non-divisible quantities).
    const rowNet = lineItemRowTotal(item);
    const carve = rowRotLaborCarveout(item, rowNet, rotEnabled);
    const split = carve > 0 ? splitRotMaterialRow(rowNet, quantity, carve) : null;
    if (split) carvedLaborTotal += split.labour;

    const row: FortnoxOrderRow = {
      // ⚠️ Sätts ALLTID, även tomt: ett utelämnat fält ärver raden som låg på positionen förut.
      ArticleNumber: item.article_number || null,
      Description: item.article_name || item.line_note || 'Artikel',
      // Fortnox invoices the DELIVERED quantity. A work order is the basis for invoicing
      // the full completed job, so delivered = ordered (otherwise the row sum stays 0 /
      // stale on new or edited rows).
      OrderedQuantity: quantity,
      DeliveredQuantity: quantity,
      // When labour is carved out this row is material only: the unit price becomes the reduced
      // material net (discount baked in) so quantity × price nets to it; otherwise the raw price +
      // a separate Discount % line, as before.
      Price: split ? split.materialUnitPrice : price,
      // Reverse charge (omvänd skattskyldighet / byggmoms) → 0 % output VAT on rows; the document's
      // VAT regime comes from the customer card (synced from reverse_vat), so matching rows here.
      VAT: reverseVat ? 0 : vatPercent,
      Unit: item.article_unit_name || '',
      // DiscountType:'PERCENT' is required — Fortnox defaults to AMOUNT (kronor), which would
      // book discount_percent as a kronor discount and diverge from the CRM total. Baked into the
      // price on a carved material row, alltså 0 där.
      //
      // ⚠️ Nollan skickas ALLTID. Utan den gick en borttagen rabatt aldrig fram till Fortnox —
      // dokumentet låg kvar på den gamla procenten.
      Discount: carve === 0 ? discount : 0,
      DiscountType: 'PERCENT',
      // Husarbete bara på rader vi själva menar är arbete, och bara på ROT-dokument. Regeln bor i
      // rotRowHouseWork — läs de tre mätningarna där innan du breddar något här; två rimliga idéer
      // har redan prövats mot skarp Fortnox och fallit.
      ...(rotRowHouseWork(item, rotEnabled) ?? {}),
    };
    // The per-row free text (Radtext) gets its own text row — only when an article name is
    // present, since otherwise it is already the row Description (the fallback above).
    const lineNote = item.line_note?.trim();
    if (lineNote && item.article_name?.trim()) return [row, orderTextRow(lineNote, reverseVat ? 0 : vatPercent)];
    return [row];
  });

  // One aggregated "Arbetskostnad ROT" husarbete row for all carved labour (kept out of line_items —
  // synthesised only at push time). ROT and reverse charge never co-occur, so VAT is just vatPercent.
  const laborRow = rotLaborRow(carvedLaborTotal, reverseVat ? 0 : vatPercent);
  if (laborRow) rows.push({ ...laborRow, OrderedQuantity: 1, DeliveredQuantity: 1 });

  // Dokumentets textrad sist: orderns TITEL (+ kundens märkning) och, för en ROT-order,
  // fastighetsbeteckningen/BRF org.nr. Fortnox har inget API-fält för någondera, och raderna är det
  // enda som `createinvoice` kopierar vidare till fakturan (uppmätt 2026-09-16). Byggs ihop till EN
  // sträng i buildOrderHeader — två textrader i följd gör Fortnox till en felaktig prissatt rad.
  return appendFortnoxTextNote(rows, documentNote, { ...fortnoxTextRowFields(), OrderedQuantity: 0, DeliveredQuantity: 0, VAT: reverseVat ? 0 : vatPercent });
}

// The header fields we own on a Fortnox order. Everything else on the document (customer, dates,
// totals) is either set once at creation or computed by Fortnox, and is deliberately absent here:
// a PUT only touches the fields it carries, so an omitted key leaves Fortnox's value alone.
export type FortnoxOrderHeaderFields = {
  OurReference?: string;
  YourReference?: string;
  // Nullbar: `null` är hur fältet RENSAS (uppmätt — `''` rensar inte). Se orderReferenceNumberField.
  YourOrderNumber?: string | null;
  Remarks?: string;
  DeliveryAddress1?: string;
  DeliveryZipCode?: string;
  DeliveryCity?: string;
  // Kundens org.nr/personnummer. Sätts av Fortnox vid skapandet, men `createorder` tar det ur
  // OFFERTEN — se documentOrganisationNumber i helpers.ts för varför vi skickar det ändå.
  // ⛔ Går INTE att tömma: `null` avvisas (2005095 "Fältet är av typen string") och `''` accepteras
  // men rensar inte (båda uppmätta i testbolaget 2026-09-25). Utelämna fältet i stället.
  OrganisationNumber?: string;
};

// The job site as Fortnox delivery address — or nothing, when the job happens at the customer's
// own address.
//
// Two sources, in order: the work order's `work_address` column (what the order detail page edits)
// and, for a row that never got one, the snapshot's `delivery_*`. They hold the same value at
// creation (getWorkAddress copies snapshot → column), so reading the column first changes nothing
// for an untouched order and is the whole point for an edited one — the edit used to land only in
// the column while the push kept reading the snapshot.
//
// The "only when it differs from the customer address" rule is preserved deliberately: sending a
// delivery address unconditionally would print a delivery block on every order confirmation that
// doesn't have one today. Street is the anchor (same rule as buildCustomerSnapshot); postal/city
// go as entered and are never borrowed from the customer address, since a job in another town
// would otherwise get the wrong ort.
export function buildOrderDeliveryFields(
  workAddress: WorkOrderAddress | null | undefined,
  snapshot: CustomerSnapshot | null | undefined,
): Pick<FortnoxOrderHeaderFields, 'DeliveryAddress1' | 'DeliveryZipCode' | 'DeliveryCity'> {
  // Which source is AUTHORITATIVE is decided by whether the column exists at all — not by whether
  // it happens to hold a street. A row that HAS a work_address owns its job site, so an emptied
  // street means "no separate job site", not "look in the snapshot". Falling back on a blank street
  // would re-push the address the seller just deleted, and would do it on a first create push too.
  // Only a row with no work_address at all (legacy: getWorkAddress and the standalone create both
  // always write one) may fall back to the snapshot's delivery_*.
  const site = workAddress
    ? (workAddress.street_address?.trim()
        ? { street: workAddress.street_address.trim(), zip: workAddress.postal_code?.trim(), city: workAddress.city?.trim() }
        : null)
    : (snapshot?.delivery_address?.trim()
        ? {
            street: snapshot.delivery_address.trim(),
            zip: snapshot.delivery_postal_code?.trim(),
            city: snapshot.delivery_city?.trim(),
          }
        : null);
  if (!site) return {};

  const customerStreet = snapshot?.street_address?.trim();
  if (customerStreet && site.street.toLowerCase() === customerStreet.toLowerCase()) return {};

  return {
    DeliveryAddress1: site.street,
    ...(site.zip ? { DeliveryZipCode: site.zip } : {}),
    ...(site.city ? { DeliveryCity: site.city } : {}),
  };
}

// "Er referens" for the Fortnox header. It is its OWN snapshot field on a work order, deliberately
// NOT the customer contact: contact_name is who we and the installers call and may be re-pointed at
// a site foreman mid-job, while YourReference is the customer's formal reference and is what routes
// their invoice for approval. The two start out as the same person, which is why one field used to
// serve both — and why fixing a phone number silently rewrote the customer's invoice reference.
//
// The contact_name fallback covers orders created before the split: dropping it would blank their
// YourReference on the next sync. The PATCH route freezes the old value into your_reference the
// first time such an order's contact is edited, so the fallback only ever reads an untouched row.
export function resolveYourReference(
  snapshot: { your_reference?: string | null; contact_name?: string | null } | null | undefined,
): string | null {
  return snapshot?.your_reference?.trim() || snapshot?.contact_name?.trim() || null;
}

/**
 * "Ert referensnummer" på orderhuvudet.
 *
 * `referenceNumber` kommer ur `resolveRotReference` och bärs av två uppgifter som aldrig gäller
 * samtidigt: företagskundens MÄRKNING och privatkundens FASTIGHETSBETECKNING.
 *
 * Tre lägen:
 *
 *   värde                   → skriv det
 *   inget värde, ingen tömning begärd → UTELÄMNA nyckeln (en PUT rör bara fält den bär, så
 *                             Fortnox behåller sitt — rätt för en order vi inte har någon åsikt om)
 *   tömning BEGÄRD          → `null`
 *
 * ⚠️ `null` OCH INTE `''`. Uppmätt i drift 2026-08-26 på ett HEADERFÄLT: `YourOrderNumber: null`
 * rensar "Ert referensnummer" på Fortnox-ordern. Det bekräftar att headerfält följer samma regel
 * som radfälten (uppmätta 2026-08-20, se FORTNOX_TEXT_ROW i helpers.ts): `null` rensar, `''`
 * accepteras men rensar inte. Undantaget `Unit` — som avvisar null med 2000699 — gäller alltjämt
 * bara det fältet.
 *
 * ⛔ RENSNINGEN LÄSES UR `label_cleared`, ALDRIG UR ATT MÄRKNINGEN ÄR TOM. En tom märkning är
 * normalläget: `buildCustomerSnapshot` skriver alltid nyckeln, så "tomt" gäller i stort sett varje
 * order. Rensade vi på det hade referensnumret blankats även där någon satt det för hand i
 * Fortnox — plus att headern aldrig mer blivit tom, så varje speglad PATCH kostat en PUT i onödan.
 *
 * `label_cleared` sätts bara av `mergeWorkOrderSnapshotOverrides`, som ser ÖVERGÅNGEN (fältet hade
 * ett värde, klienten skickade tomt). Att det lagras som ett TILLSTÅND är hela poängen: en
 * misslyckad PUT kan då tas om. Bars rensningen bara av den PATCH som begärde den, hade nästa
 * artikelredigering eller "Synka om" byggt headern utan att veta något, lyckats, och stämplat
 * 'synced' medan Fortnox fortfarande bar den gamla märkningen.
 *
 * ⚠️ Och det släcks av `syncWorkOrderHeaderToFortnox` när PUT:en gått igenom. Ett minne som låg
 * kvar för alltid hade blankat ett "Ert referensnummer" som ekonomi senare skrivit in för hand i
 * Fortnox, vid nästa bästa adress- eller referensändring — samma fel som regeln ovan finns för att
 * undvika, bara nedsmalnat i stället för borta.
 */
export function orderReferenceNumberField(
  referenceNumber: string | null,
  snapshot: { label_cleared?: boolean | null } | null | undefined,
): { YourOrderNumber?: string | null } {
  if (referenceNumber) return { YourOrderNumber: referenceNumber };
  // ⚠️ Referensnumret vinner alltid över rensningen: på en ROT-order ÄR numret
  // fastighetsbeteckningen, och en märkning som töms där får inte blanka den.
  return snapshot?.label_cleared === true ? { YourOrderNumber: null } : {};
}

type OrderHeaderWorkOrder = {
  assigned_to: string | null;
  // Kundkortet, för dokumentets OrganisationNumber. Alla tre anropare läser redan kolumnen.
  customer_id?: string | null;
  /** Orderns titel — blir en textrad på dokumentet (buildOrderProjectNote). */
  project_name?: string | null;
  customer_snapshot: CustomerSnapshot | null;
  work_address: WorkOrderAddress | null;
  // ⚠️ ORDERNS EGNA ROT-uppgifter, och det är DE som gäller. Se resolveOrderRotDetails.
  rot_details?: RotDetails | null;
};

type OrderHeaderQuote = {
  assigned_to?: string | null;
  customer_snapshot?: CustomerSnapshot | null;
  rot_details?: RotDetails | null;
} | null;

/**
 * Vems ROT-uppgifter gäller för dokumentet — arbetsorderns eller offertens?
 *
 * ⚖️ ARBETSORDERNS. Regeln kommer från verksamheten (William 2026-08-26): offerten är vad kunden
 * BAD om och tackade ja till, arbetsordern är den faktiska sanningen om vad vi fakturerar. Ändras
 * något under arbetets gång ändras arbetsordern, aldrig offerten — offerten är dessutom låst så
 * fort ordern skapats.
 *
 * Fram till nu läste pushen offertens `rot_details` medan CRM-vyn (WorkOrderArticles,
 * ordersidans ROT-kort) läste ORDERNS. Två källor till samma fakta. De var identiska kopior och
 * offerten låst, så inget kunde glida — men i samma stund ROT blev redigerbart på ordern hade
 * dokumentet och skärmen börjat säga olika saker.
 *
 * Helobjekts-fallback, inte per fält — exakt som `customer_snapshot` en rad ovanför, och av samma
 * skäl: en per-fält-reserv hade återuppväckt ett värde säljaren medvetet tömt (en borttagen
 * fastighetsbeteckning hade kommit tillbaka från offerten).
 *
 * Reserven finns för rader vars `rot_details` är tom `{}` — kolumnen är `not null default '{}'`,
 * och en fristående order utan offert har ingenting att falla tillbaka på ändå.
 */
export function resolveOrderRotDetails(
  workOrder: { rot_details?: RotDetails | null },
  linkedQuote: { rot_details?: RotDetails | null } | null | undefined,
): RotDetails | null {
  const own = workOrder.rot_details;
  if (own && Object.keys(own).length > 0) return own;
  return linkedQuote?.rot_details ?? null;
}

// Builds the order header (and the ROT text-row note that belongs with it) from the work order.
//
// ONE builder for all three push paths — create, the row re-sync after an article edit, and the
// header-only sync after a contact/address edit. They used to disagree: only the create path ever
// set OurReference/YourReference/delivery, so a contact person or work address corrected on the
// order stayed in CRM and Fortnox kept the offer's original values with nothing to signal it.
//
// The WORK ORDER's snapshot leads and the quote's is a whole-object fallback, not a per-field one.
// The two are identical at creation (createCrmWorkOrderFromQuote copies the quote's), and the order
// is what gets edited afterwards — a per-field fallback would resurrect a value the seller
// deliberately cleared. Same reasoning for assigned_to, which the detail page re-assigns and which
// only ever holds an office role (listAssignableCrmUsers is sales/admin/konsult), never an installer.
async function buildOrderHeader(
  workOrder: OrderHeaderWorkOrder,
  linkedQuote: OrderHeaderQuote,
  rotEnabled: boolean,
  supabase: ReturnType<typeof getSupabaseAdmin>,
  // Får den här pushen försöka RENSA "Ert referensnummer" (`YourOrderNumber: null`)?
  //
  // ⛔ Standard false, och bara header-synken sätter true. Två skäl:
  //   • SKAPANDEVÄGEN har inget att rensa — dokumentet finns inte än — så ett null där vore ren
  //     risk på det enda anrop som saknar dedup-skydd.
  //   • RADSYNKEN och "Synka om" måste förbli körbara. Skulle Fortnox avvisa null (som den redan
  //     gör för `Unit`, 2000699) hade varje artikelredigering och varje omsynk kastat, ordern
  //     legat kvar på 'failed', och assertOrderRowsSynced spärrat faktureringen — permanent, för
  //     minnet av rensningen ligger kvar tills den lyckas.
  //
  // Kvar blir en enda väg som kan misslyckas, och den är icke-fatal: sparningen har redan landat
  // och säljaren får felet i en toast.
  opts?: { allowReferenceClear?: boolean },
): Promise<{ header: FortnoxOrderHeaderFields; documentNote: string | null }> {
  const snapshot = workOrder.customer_snapshot ?? linkedQuote?.customer_snapshot ?? null;
  const ourReference = await resolveOurReference(workOrder.assigned_to ?? linkedQuote?.assigned_to ?? null, supabase);
  // Ur KUNDKORTET, inte ur snapshoten: numret går inte att redigera på offerten eller ordern, så
  // kopiorna där är kortet som det såg ut när kunden valdes. Samma regel som workOrderReadiness.
  const organisationNumber = await resolveDocumentOrganisationNumber(supabase, workOrder.customer_id);
  const { referenceNumber, propertyNote } = resolveRotReference(
    resolveOrderRotDetails(workOrder, linkedQuote), snapshot?.label, rotEnabled);

  const yourReference = resolveYourReference(snapshot);

  // Titeln (+ märkningen) som textrad, hopslagen med ROT-noten till EN rad. Två textrader i följd
  // gör Fortnox till en felaktig prissatt rad — samma skäl som buildRotPropertyNote slår ihop sina.
  const documentNote = [buildOrderProjectNote(workOrder.project_name, snapshot?.label), propertyNote]
    .filter(Boolean).join('  ') || null;

  return {
    header: {
      ...(ourReference ? { OurReference: ourReference } : {}),
      ...(yourReference ? { YourReference: yourReference } : {}),
      // "Ert referensnummer" — the order field is YourOrderNumber (the offer uses
      // YourReferenceNumber; sending the wrong one is a 2001399 "Felaktigt fältnamn").
      // Tre lägen, inklusive rensningen — se orderReferenceNumberField. Rensningen bara på den
      // väg som får försöka den (opts ovan).
      ...orderReferenceNumberField(referenceNumber, opts?.allowReferenceClear ? snapshot : null),
      // No Remarks: it is Fortnox's own per-document body text (it rewrites it on createorder
      // anyway), and the customer contact is deliberately CRM-internal — see the removal of
      // buildEndContactNote.
      ...buildOrderDeliveryFields(workOrder.work_address, snapshot),
      // ⚠️ Utan det här bar en order skapad ur en offert från FÖRE kundens nummer ett tomt
      // OrganisationNumber för alltid — `createorder` kopierar offertens, och fakturan ärver ordern.
      // Utelämnas när kortet saknar ett giltigt nummer, så Fortnox behåller sitt.
      ...(organisationNumber ? { OrganisationNumber: organisationNumber } : {}),
    },
    documentNote,
  };
}

// The quote fields the header builder falls back on (an order created from a quote inherits its
// ROT details, which never live on the work order itself). Null for a standalone order.
async function fetchLinkedQuoteForHeader(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  quoteId: string | null,
): Promise<OrderHeaderQuote> {
  if (!quoteId) return null;
  const { data } = await supabase
    .from('crm_quotes')
    .select('assigned_to, customer_snapshot, rot_details')
    .eq('id', quoteId)
    .maybeSingle();
  return (data as OrderHeaderQuote) ?? null;
}

// Resolves the Fortnox customer number from an already-fetched linked quote.
// Checks customer_source first, then falls back to crm_customers.fortnox_customer_id.
async function resolveCustomerNumberFromQuote(
  linkedQuote: { customer_source: { kind?: string; fortnox_customer_id?: string } | null; customer_id: string | null } | null,
  supabase: ReturnType<typeof getSupabaseAdmin>,
): Promise<string | null> {
  if (!linkedQuote) return null;

  if (linkedQuote.customer_source?.kind === 'fortnox' && linkedQuote.customer_source.fortnox_customer_id) {
    return linkedQuote.customer_source.fortnox_customer_id;
  }

  if (linkedQuote.customer_id) {
    return resolveFortnoxCustomerNumberById(linkedQuote.customer_id, supabase);
  }

  return null;
}

// Look up a customer's Fortnox number directly (used for standalone orders whose customer
// lives on the work order, not on a quote).
async function resolveFortnoxCustomerNumberById(
  customerId: string,
  supabase: ReturnType<typeof getSupabaseAdmin>,
): Promise<string | null> {
  const { data } = await supabase
    .from('crm_customers')
    .select('fortnox_customer_id')
    .eq('id', customerId)
    .maybeSingle();
  return (data as { fortnox_customer_id?: string | null } | null)?.fortnox_customer_id ?? null;
}

/**
 * 🧨 VAKTEN MOT EN SPARNING SOM LANDADE MITT I PUSHEN.
 *
 * Skapandet bygger orderhuvudet ur en rad som lästes innan Fortnox ens svarat. Mellan den
 * läsningen och POST:en ligger offertuppslaget, kundnumret (ett Fortnox-GET), byggmomsen,
 * ansvarigs namn och själva skrivningen — sekunder, inte millisekunder. En sparning som landar i
 * det fönstret skrivs till databasen men når aldrig payloaden.
 *
 * ⚠️ OCH SÄLJAREN FÅR INGEN ANING, för PATCH-vägen är tyst just då: `syncWorkOrderHeaderToFortnox`
 * svarar null när ordern ännu saknar `fortnox_order_number`, och numret sparas först EFTER POST:en.
 * Båda vägarna rapporterar alltså framgång medan fältet tappas mellan dem.
 *
 * Mätt i drift 2026-09-09 på arbetsorder AO-20260909-06D6B7 (Fortnox-order 131): märkningen
 * "58184" stod kvar i CRM medan Fortnox-orderns "Ert referensnummer" var tomt — och fakturan ur
 * den ärvde tomheten, eftersom `createinvoice` kopierar orderns huvud. Claimen sattes 12:01:50,
 * stämpeln 'synced' 12:02:29.
 *
 * Att flytta läsningen hjälper inte: fönstret är det långsamma arbetet NEDSTRÖMS om den. Läget
 * upptäcks därför i efterhand i stället — skiljer sig raden från den vi byggde huvudet ur, speglas
 * dokumentet om.
 *
 * ⚠️ VILKEN VÄG REPARATIONEN TAR BEROR PÅ VAD SOM SKILJER SIG, och det är inte en detalj:
 *
 *  • snapshot / arbetsadress / ansvarig → header-synken räcker. De bor alla i orderhuvudet.
 *  • `rot_details` → den FULLA pushen. ROT delar sig i två halvor på dokumentet: en VILLAS
 *    fastighetsbeteckning blir headerns `YourOrderNumber`, men en BOSTADSRÄTTS uppgifter blir en
 *    TEXTRAD (se resolveRotReference), och header-synken släpper medvetet radhalvan. En BRF-order
 *    vars uppgifter rättades mitt i pushen hade alltså upptäckts, "reparerats" med en header-PUT
 *    som inte bar något ROT — och stämplats 'synced'. Raderna hör hit just för att `rot_details`
 *    redigeras på DEN HÄR routen, till skillnad från `line_items` som har sin egen.
 *
 * ⛔ KVARSTÅENDE, OLAGBART: flippas `rot_details.enabled` inne i fönstret går det inte att rätta
 * alls. `TaxReductionType` sätts bara vid create, och PATCH-routens 409-spärr mot det keyar på
 * `fortnox_order_number` — som är null ända tills POST:en landat. Den fulla pushen nedan avvisas då
 * av Fortnox med 2004021 och stämplar 'failed', vilket är rätt utfall: ordern ska inte kunna se
 * komplett ut. Att tiga hade varit värre.
 *
 * ⚠️ ETT FEL HÄR FÄLLER INTE PUSHEN. Ordern ÄR skapad och numret sparat — att kasta hade fått
 * anroparen att tro att inget hänt, och nästa försök hade gått idempotensvägen ändå.
 * `syncWorkOrderHeaderToFortnox` stämplar själv ner synkstatusen när den misslyckas, så sanningen
 * går inte förlorad: ordern står kvar som osynkad och "Synka om" reparerar den.
 */
// Jämför två jsonb-värden som DATA, inte som text.
//
// 🧨 TVÅ FÄLLOR, båda verkliga:
//
//  • NYCKELORDNING. `JSON.stringify` är ordningskänslig, och samma kolumn kommer tillbaka i olika
//    ordning beroende på om raden just skrivits om av en merge eller lästs rakt ur jsonb. Nycklarna
//    sorteras därför före jämförelsen.
//  • `label_cleared` ÄR INTE KUNDDATA. Det är synkens eget minne av en genomförd referensrensning,
//    och `clearReferenceMemory` flippar det mitt i pushen — på offert→order-vägen skriver alltså
//    pushen om snapshoten själv. Räknades det med hade efterkontrollen sett en "ändring" vid varje
//    orderskapande och skickat en onödig header-PUT; misslyckades den PUT:en stämplades dessutom
//    'failed' över det 'synced' som skrevs ögonblicket innan.
function same(a: unknown, b: unknown): boolean {
  const normalise = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(normalise);
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .filter(([key]) => key !== 'label_cleared' && !(LINE_ITEM_CRM_ONLY_KEYS as readonly string[]).includes(key))
          .sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0))
          .map(([key, val]) => [key, normalise(val)]),
      );
    }
    return value ?? null;
  };
  return JSON.stringify(normalise(a ?? null)) === JSON.stringify(normalise(b ?? null));
}

async function resyncHeaderIfSnapshotChangedDuringPush(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  workOrderId: string,
  atBuild: {
    customer_snapshot: CustomerSnapshot | null;
    work_address: WorkOrderAddress | null;
    assigned_to: string | null;
    rot_details: RotDetails | null;
    line_items: unknown;
  },
): Promise<{ mirrorFailed?: boolean; mirrorNeedsManualFix?: boolean }> {
  // ⚠️ ALLA INGÅNGARNA till dokumentet, inte bara de två uppenbara: `assigned_to` bär OurReference
  // och `rot_details` bär YourOrderNumber på en villa (resolveRotReference). Ett första utkast läste
  // bara snapshot + adress och lämnade därmed halva problemet öppet — en ansvarig som byttes mitt i
  // pushen gick just den tysta vägen som hela ändringen finns för.
  //
  // 🧨 OCH `line_items`, av ett eget skäl: artikelvägen (`updateWorkOrderInFortnox`) CLAIMAR INTE,
  // den stämplar bara 'pending'. Create sparar dessutom `fortnox_order_number` FÖRE radskrivningen,
  // så en artikelredigering som landar i fönstret hittar ett nummer, PUT:ar sina nya rader och
  // stämplar 'synced' — varpå creates egen `putOrderHeaderAndRows` skriver tillbaka de gamla
  // raderna över dem och stämplar 'synced' igen. Fortnox och CRM håller då olika rader,
  // `assertOrderRowsSynced` släpper igenom, och `createinvoice` fakturerar de gamla.
  const { data } = await supabase
    .from('crm_work_orders')
    .select('customer_snapshot, work_address, assigned_to, rot_details, line_items, quote_id')
    .eq('id', workOrderId)
    .maybeSingle();

  const fresh = data as (typeof atBuild & { quote_id: string | null }) | null;
  // Läsfel → gör ingenting. Vi vet inte att något ändrats, och en spekulativ PUT vore värre.
  if (!fresh) return {};

  // ⚠️ JÄMFÖR BARA DET SOM NÅR DOKUMENTET, aldrig hela kolumnen.
  //
  // `rot_details` bär också `rot_percent` och `max_deduction`, som Fortnox ALDRIG får se — de läses
  // bara av vår egen preliminära "Att betala" (se ROT_DOCUMENT_KEYS). En rättad procentsats hade
  // annars dragit igång en full positionsbaserad rad-PUT för en ändring dokumentet inte ens har,
  // med allt vad `assertLineItemsArePriced` och 'failed'-stämpling innebär.
  //
  // Och `customer_snapshot` bär telefon, e-post, slutkundens uppgifter, org.nr och personnummer —
  // inget av det når Fortnox. Hela kolumnen jämförd gjorde en rättad telefon på arbetsplatsen till
  // en "ändring", med en header-PUT som kunde stämpla 'failed' och spärra faktureringen för ett
  // fält dokumentet aldrig burit. Se MIRRORED_SNAPSHOT_KEYS.
  //
  // Samma sak för `work_address`: PATCH-schemat fyller på med `delivery_address: null` och
  // `invoice_address: null`, så en rad som saknar nycklarna jämförs olik och kostar en header-PUT
  // i onödan. Routen normaliserar redan så (workOrderMirroredFieldsChanged) — den här vägen måste
  // göra samma sak, annars är varje spurios skrivning en ny chans att stämpla 'failed'.
  // ⚠️ TOMHETEN NORMALISERAS, samma regel som workOrderMirroredFieldsChanged: `''`, blanktecken och
  // null är SAMMA sak för Fortnox. Utan det räknades en sparning som skriver tom sträng där raden
  // höll null som en ändring — och kostade en header-PUT direkt efter att ordern stämplats
  // 'synced'. En sådan PUT som misslyckas stämplar 'failed' och spärrar faktureringen.
  const subset = (value: unknown, keys: readonly string[]): Record<string, unknown> => {
    const row = (value ?? {}) as Record<string, unknown>;
    return Object.fromEntries(keys.map((key) => {
      const raw = row[key];
      if (typeof raw !== 'string') return [key, raw ?? null];
      const trimmed = raw.trim();
      return [key, trimmed.length > 0 ? trimmed : null];
    }));
  };

  // ROT bär en RADHALVA, och artiklarna ÄR raderna — båda kräver den fulla pushen. Se rutan ovan.
  const rowsDiffer = !same(subset(fresh.rot_details, ROT_DOCUMENT_KEYS), subset(atBuild.rot_details, ROT_DOCUMENT_KEYS))
    || !same(fresh.line_items, atBuild.line_items);
  const headerDiffers = !same(subset(fresh.customer_snapshot, MIRRORED_SNAPSHOT_KEYS), subset(atBuild.customer_snapshot, MIRRORED_SNAPSHOT_KEYS))
    || !same(subset(fresh.work_address, MIRRORED_WORK_ADDRESS_KEYS), subset(atBuild.work_address, MIRRORED_WORK_ADDRESS_KEYS))
    || !same(fresh.assigned_to, atBuild.assigned_to);

  if (!rowsDiffer && !headerDiffers) return {};

  // 🧨 REPARATIONEN MÅSTE RAPPORTERA VAD DEN FAKTISKT FICK UTTRYCKT — inte "kastade inget".
  //
  // `buildOrderHeader` UTELÄMNAR tomma värden (`...(ourReference ? { OurReference } : {})`), och en
  // Fortnox-PUT rör bara fält den bär. En TÖMNING går därför inte igenom: vakten ser skillnaden,
  // PUT:en går igenom, och Fortnox behåller sitt gamla värde. Utan det här hade svaret sagt att allt
  // speglats medan kundens dokument bar kvar en referens eller en arbetsplats som inte längre gäller.
  //
  // ⚠️ `label` är UNDANTAGET: den har sitt eget rensningsminne (`label_cleared` →
  // `YourOrderNumber: null`) och lagas därför av PUT:en som vanligt.
  //
  // Leveransadressen MÄTS genom att bygga fältet före och efter, i stället för att gissa på
  // kolumnen: `buildOrderDeliveryFields` returnerar `{}` både när arbetsadressen tömts OCH när den
  // blivit lika med kundens gata — två olika ändringar, samma outtryckbara utfall.
  const deliveryBefore = buildOrderDeliveryFields(atBuild.work_address, atBuild.customer_snapshot);
  const deliveryAfter = buildOrderDeliveryFields(fresh.work_address, fresh.customer_snapshot);
  // ⚠️ NYCKEL FÖR NYCKEL, inte "blev objektet tomt". Rensas bara orten utelämnas `DeliveryCity`
  // medan gata och postnummer skickas — PUT:en rör bara fält den bär, så Fortnox behåller den gamla
  // orten och dokumentet får en halv adress från två olika platser.
  const deliveryCleared = Object.entries(deliveryBefore)
    .some(([key, value]) => value && !(deliveryAfter as Record<string, unknown>)[key]);

  const referenceCleared = Boolean(resolveYourReference(atBuild.customer_snapshot))
    && !resolveYourReference(fresh.customer_snapshot);

  // ⚠️ OurReference faller tillbaka på OFFERTENS ansvarige (buildOrderHeader). En tömd ansvarig på
  // en offertfödd order rensar alltså ingenting — och ett larm där hade varit rött för ett dokument
  // som faktiskt är rätt, utan något sätt att bli av med det. Offerten läses bara i just det fallet.
  let ourReferenceCleared = Boolean(atBuild.assigned_to) && !fresh.assigned_to;
  if (ourReferenceCleared && fresh.quote_id) {
    const { data: quote } = await supabase
      .from('crm_quotes').select('assigned_to').eq('id', fresh.quote_id).maybeSingle();
    if ((quote as { assigned_to?: string | null } | null)?.assigned_to) ourReferenceCleared = false;
  }

  const unexpressibleClear = referenceCleared || ourReferenceCleared || deliveryCleared;

  try {
    // ⚠️ `null` FRÅN HEADER-SYNKEN BETYDER ATT INGENTING SKICKADES — en tom header, eller en order
    // som hunnit stängas. Att läsa "kastade inte" som framgång hade gjort just de fallen tysta.
    const mirrored = rowsDiffer
      ? await updateWorkOrderInFortnox(workOrderId, { recheckAfterPush: false })
      : await syncWorkOrderHeaderToFortnox(workOrderId);
    if (unexpressibleClear) return { mirrorFailed: true, mirrorNeedsManualFix: true };
    if (mirrored === null) return { mirrorFailed: true };
  } catch (e) {
    console.error('[fortnox] Omspegling efter orderskapandet misslyckades:', (e as Error)?.message);
    // Kastar INTE — ordern finns i Fortnox och numret är sparat, så ett kast hade fått anroparen
    // att tro att ingenting hänt och nästa försök hade gått idempotensvägen ändå. Men tystnad
    // duger inte: felet bärs upp så svaret kan säga att dokumentet behöver synkas om.
    return { mirrorFailed: true };
  }
  return {};
}

// Push a CRM work order to Fortnox as an order.
// If the linked quote already has a Fortnox offer number, converts that offer to an order
// (preserving the offer→order link in Fortnox). Otherwise creates a standalone order.
export async function pushWorkOrderToFortnox(workOrderId: string): Promise<PushOrderResult> {
  const supabase = getSupabaseAdmin();

  // Idempotenskollen går på en SMAL läsning, före claimen. Hela underlaget läses först när pushen
  // är vår (se omläsningen inne i try:t) — en order som redan ligger i Fortnox ska varken claimas
  // eller läsas i sin helhet.
  const { data: existing, error } = await supabase
    .from('crm_work_orders')
    .select('id, fortnox_order_number')
    .eq('id', workOrderId)
    .single<{ id: string; fortnox_order_number: string | null }>();

  if (error || !existing) throw new Error(`Arbetsorder ${workOrderId} hittades inte`);

  // Idempotency: if this work order is already linked to a Fortnox order, don't try
  // to create another one — Fortnox rejects a second createorder on the same offer
  // (error 2000499). Just return the existing number.
  //
  // ⚠️ INGEN 'synced'-stämpel här. Grenen skickar ingenting till Fortnox, så den vet ingenting om
  // radernas läge — samma regel som header-synken. Att den tidigare stämplade byggde på antagandet
  // att ett sparat ordernummer betydde att raderna gått igenom, och det gäller inte längre: numret
  // sparas nu FÖRE rad-PUT:en (se createorder-grenen nedan), just för att en order som finns i
  // Fortnox aldrig ska tappas bort. En kvarstående 'failed' hade alltså kunnat tvättas till
  // 'synced' av ett anrop som inte skickade en enda rad — precis det läge fakturaspärren finns för.
  if (existing.fortnox_order_number) {
    return { fortnox_order_number: existing.fortnox_order_number };
  }

  // Atomically claim the push so a concurrent request can't create a SECOND Fortnox order
  // for this work order (the create branch below has no Fortnox-side dedup for standalone
  // POST /orders). If we lose the claim, a fresh push is already in flight.
  const claimed = await claimFortnoxPush(
    supabase, 'crm_work_orders', workOrderId, 'fortnox_order_sync_status', 'fortnox_order_claimed_at',
  );
  if (!claimed) throw new FortnoxPushInProgressError();

  try {
    // Underlaget läses när pushen är vår, inte innan.
    //
    // ⚠️ DET STÄNGER INTE RACET — det krymper det bara med claimens två UPDATE:ar. Allt långsamt
    // ligger EFTER den här läsningen: offertuppslaget, kundnumret (ett Fortnox-GET), byggmomsen,
    // ansvarigs namn och själva POST:en. Order 131 låg 39 sekunder mellan claim och 'synced', och
    // nästan hela det fönstret ligger nedströms härifrån. Den som tror att en läsning tidigare
    // eller senare i sig löser problemet bygger vidare på fel antagande — vakten mot en sparning
    // som landar mitt i pushen är `resyncHeaderIfSnapshotChangedDuringPush` i slutet av try:t.
    const { data: workOrder, error: readError } = await supabase
      .from('crm_work_orders')
      .select('id, quote_id, customer_id, assigned_to, customer_snapshot, work_address, project_name, client_name, amount, vat_percent, currency_code, line_items, fortnox_order_number, rot_details')
      .eq('id', workOrderId)
      .single<WorkOrderRow>();

    if (readError || !workOrder) throw new Error(`Arbetsorder ${workOrderId} hittades inte`);

    // 🧨 IDEMPOTENSEN PRÖVAS OM — den smala läsningen ovan skedde FÖRE claimen.
    //
    // Hann en samtidig push slutföra sig däremellan, ser vi numret först nu. Utan den här raden
    // går vi vidare till standalone-grenen och POST:ar EN ORDER TILL åt samma kund — den grenen
    // har ingen dedup hos Fortnox (till skillnad från createorder, som skyddas av 2000499).
    //
    // ⚠️ Statusen stämplas 'not_synced', inte 'synced': vi skickade ingenting och vet inte vad den
    // andra pushen hann med. Att claimen redan skrivit 'pending' får inte bli kvar — pending har
    // ingen tidsgräns för `assertOrderRowsSynced` och hade spärrat faktureringen tyst.
    //
    // ⚖️ MEDVETET VAL, och det kostar något: lyckades den andra pushen står ordern nu som "Ej
    // synkad" tills någon trycker "Synka om", och faktureringen är spärrad så länge. Alternativet
    // — att gissa 'synced' — vore värre åt fel håll: claimen har redan skrivit över den andra
    // pushens egen stämpel, så ett 'failed' därifrån hade tvättats bort och ordern sett komplett ut
    // medan Fortnox höll andra rader än vi. `fortnox_order_synced_at` går inte att skilja på:
    // tidsstämpeln kan lika gärna komma från en äldre lyckad synk. Hellre ett synligt extra
    // knapptryck än en tyst osanning — samma regel som resten av synkstatusen följer.
    if (workOrder.fortnox_order_number) {
      await supabase
        .from('crm_work_orders')
        .update({ fortnox_order_sync_status: 'not_synced' })
        .eq('id', workOrderId);
      // ⚠️ OCH DET SÄGS. Utan `mirrorFailed` svarade routen 201 med grön toast medan brickan läste
      // "Ej synkad" och faktureringen var spärrad — samma tysta framgång som resten av ändringen
      // tar bort. Beskedet ("synka om ordern") är rätt handling även här.
      return { fortnox_order_number: workOrder.fortnox_order_number, mirrorFailed: true };
    }

    // Rader utan prisförankring blir Price 0 på ordern (och carve 0 → ingen ROT-arbetsrad). Ordern
    // ärver offertens rader rakt av, så en offert från 900-stubbens tid bär felet vidare hit.
    // Avskrivna rader räknas bort — de pushas inte alls. Inne i try:t så catch:en stämplar 'failed'.
    assertLineItemsArePriced(activeLineItems(workOrder.line_items), 'Arbetsordern');

    let fortnoxOrderNumber: string;

    // Fetch linked quote data in one query – used for offer number, customer resolution,
    // and reference fields on standalone orders.
    type LinkedQuote = {
      fortnox_offer_number: string | null;
      customer_id: string | null;
      customer_source: { kind?: string; fortnox_customer_id?: string } | null;
      assigned_to: string | null;
      customer_snapshot: CustomerSnapshot | null;
      rot_details: RotDetails | null;
    };

    const linkedQuote: LinkedQuote | null = workOrder.quote_id
      ? await (async () => {
          const { data } = await supabase
            .from('crm_quotes')
            .select('fortnox_offer_number, customer_id, customer_source, assigned_to, customer_snapshot, rot_details')
            .eq('id', workOrder.quote_id!)
            .maybeSingle();
          return data as LinkedQuote | null;
        })()
      : null;

    const fortnoxOfferNumber = linkedQuote?.fortnox_offer_number ?? null;

    if (fortnoxOfferNumber) {
      // Convert existing Fortnox offer → order.
      // Fortnox carries OurReference, YourReference, and DeliveryAddress from the offer automatically.
      let resolved = '';
      try {
        const response = await fortnoxPut<{ Order?: { DocumentNumber?: string | number } }>(
          `/offers/${fortnoxOfferNumber}/createorder`,
        );
        if (response.Order?.DocumentNumber != null) resolved = String(response.Order.DocumentNumber);
      } catch (e) {
        // 2000499 = the offer already has an order (a prior push converted it). Any other
        // error is a real failure and must propagate.
        const message = String((e as any)?.message || '');
        if (!message.includes('2000499') && !message.toLowerCase().includes('redan en skapad order')) throw e;
      }
      // At this point the order exists in Fortnox (just created, or already converted) but
      // we may not have captured its number — the createorder response shape can vary, or
      // the order already existed. Resolve it from the offer's OrderReference so a created
      // order is never reported as failed.
      if (!resolved) {
        const offer = await fortnoxGet<{ Offer?: { OrderReference?: number | string | null } }>(`/offers/${fortnoxOfferNumber}`);
        const existing = offer.Offer?.OrderReference;
        if (!existing) throw new Error('Fortnox returnerade inget ordernummer vid konvertering');
        resolved = String(existing);
      }
      fortnoxOrderNumber = resolved;

      // Spara numret INNAN raderna skickas. Kastar PUT:en nedan finns ordern i Fortnox medan vi
      // saknar dess nummer — då 409:ar PDF-rutten, delfaktureringen hittar den inte, och varje nytt
      // försök går om createorder-vägen och 2000499-återhämtningen. Med numret sparat blir ett
      // misslyckande i stället en vanlig 'failed' som "Försök igen" reparerar.
      await supabase
        .from('crm_work_orders')
        .update({ fortnox_order_number: fortnoxOrderNumber })
        .eq('id', workOrderId);

      // ⚠️ KONVERTERINGEN BYGGER ORDERN UR OFFERTENS RADER — arbetsorderns skickas aldrig. Utan
      // den här PUT:en håller Fortnox alltså andra rader än vi, med stämpeln 'synced' på.
      //
      // Att det inte är teoretiskt: `updateWorkOrderInFortnox` faller tillbaka hit när ordern
      // saknar Fortnox-nummer. Misslyckas första pushen (Fortnox frånkopplat) och säljaren sedan
      // ändrar ett antal i artikelfliken, går vägen line-items-rutten → omsynk → hit → och
      // ändringen som just sparades försvinner tyst.
      //
      // ⚠️ SKICKAS ALLTID, aldrig villkorat på att raderna skiljer sig från offertens. Ett första
      // utkast jämförde `workOrder.line_items` mot `crm_quotes.line_items` och hoppade över PUT:en
      // när de var lika — men offertens push är BEST-EFFORT (se app/api/crm/quotes/[id]/route.ts):
      // en misslyckad offertsynk lämnar Fortnox-offerten bakom offertraden. Arbetsordern kopierar
      // då de nya raderna, jämförelsen ser dem som identiska, ingen PUT sker — och ordern stämplas
      // 'synced' ovanpå Fortnox gamla rader. Våra egna rader är helt enkelt inget bevis för vad
      // Fortnox håller. En extra PUT per orderskapande är priset för att slippa den slutsatsen.
      await putOrderHeaderAndRows(supabase, workOrder, fortnoxOrderNumber, linkedQuote);
    } else {
      // No Fortnox offer exists – create a standalone order with full reference data.
      // Resolve the customer from the linked quote, or — for a truly standalone order
      // (no quote) — from the work order's own customer.
      const customerNumber =
        (await resolveCustomerNumberFromQuote(linkedQuote, supabase)) ??
        (workOrder.customer_id ? await resolveFortnoxCustomerNumberById(workOrder.customer_id, supabase) : null);
      if (!customerNumber) {
        throw new Error(
          'Ingen Fortnox-kundkoppling hittades. Kunden måste vara synkad till Fortnox.',
        );
      }

      const vatPercent = typeof workOrder.vat_percent === 'number' ? workOrder.vat_percent : 25;
      // Reverse charge (byggmoms) excludes ROT and forces 0 % rows + SEREVERSEDVAT on the order.
      const reverseVat = await resolveReverseVat(
        supabase,
        workOrder.customer_snapshot?.reverse_vat ?? linkedQuote?.customer_snapshot?.reverse_vat,
        linkedQuote?.customer_id ?? workOrder.customer_id,
      );
      const rotEnabled = resolveOrderRotDetails(workOrder, linkedQuote)?.enabled === true && !reverseVat;
      // ⛔ INGEN rensning här. Dokumentet skapas i det här anropet — det finns ingenting att rensa,
      // och `createorder` är den enda Fortnox-skrivningen utan dedup-skydd.
      const { header, documentNote } = await buildOrderHeader(workOrder, linkedQuote, rotEnabled, supabase);
      const orderRows = buildOrderRows(workOrder.line_items, vatPercent, rotEnabled, reverseVat, documentNote);

      const response = await fortnoxPost<{ Order: { DocumentNumber: string } }>('/orders', {
        Order: {
          CustomerNumber: customerNumber,
          // Svensk dag: UTC-dygnet daterar en order skapad på natten till dagen före.
          OrderDate: stockholmTodayISO(),
          ...header,
          // No VATType on the payload (Fortnox rejects it on offers; we keep orders consistent):
          // the customer card drives the VAT regime, and rows carry the matching VAT (0 % for
          // reverse charge, see buildOrderRows) so header and rows never diverge.
          //
          // TaxReductionType is set HERE only. The ROT regime of an order never changes after it
          // exists, and re-sending it on an update would add a rejection path for no gain.
          ...(rotEnabled ? { TaxReductionType: 'rot' } : {}),
          OrderRows: orderRows,
        },
      });
      fortnoxOrderNumber = response.Order?.DocumentNumber;
      if (!fortnoxOrderNumber) throw new Error('Fortnox returnerade inget ordernummer');

      // Spara numret direkt, av samma skäl som i createorder-grenen — men här väger det tyngre:
      // POST /orders har ingen dubblettspärr på Fortnox sida (createorder skyddas åtminstone av
      // 2000499). Faller något mellan POST:en och den gemensamma uppdateringen nedan finns ordern i
      // Fortnox utan att vi vet om det, och nästa försök skapar EN ORDER TILL åt samma kund.
      await supabase
        .from('crm_work_orders')
        .update({ fortnox_order_number: fortnoxOrderNumber })
        .eq('id', workOrderId);
    }

    await supabase
      .from('crm_work_orders')
      .update({
        fortnox_order_number: fortnoxOrderNumber,
        fortnox_order_sync_status: 'synced',
        fortnox_order_synced_at: new Date().toISOString(),
      })
      .eq('id', workOrderId);

    // Hann någon spara medan pushen pågick? Då bär Fortnox fel huvud — spegla om det.
    const { mirrorFailed, mirrorNeedsManualFix } = await resyncHeaderIfSnapshotChangedDuringPush(
      supabase, workOrderId, {
        customer_snapshot: workOrder.customer_snapshot,
        work_address: workOrder.work_address,
        assigned_to: workOrder.assigned_to,
        rot_details: workOrder.rot_details ?? null,
        line_items: workOrder.line_items ?? null,
      },
    );

    return {
      fortnox_order_number: fortnoxOrderNumber,
      ...(mirrorFailed ? { mirrorFailed: true } : {}),
      // ⚠️ MÅSTE MED. Utan den här raden var hela "rätta fältet direkt i Fortnox"-grenen i de tre
      // routerna död kod, och en säljare som tömt Er referens fick rådet "synka om" — det cirkulära
      // rådet som aldrig kan laga en rensning.
      ...(mirrorNeedsManualFix ? { mirrorNeedsManualFix: true } : {}),
    };
  } catch (e) {
    const syncStatus = e instanceof FortnoxNotConnectedError ? 'not_synced' : 'failed';
    await supabase
      .from('crm_work_orders')
      .update({ fortnox_order_sync_status: syncStatus })
      .eq('id', workOrderId);
    throw e;
  }
}

// Fakturanumret en Fortnox-order redan pekar på, eller null. Läsfel svaras som null med flit: den
// enda frågan här är "finns det redan en faktura", och kan vi inte svara ja ska anroparen gå vidare
// på sin vanliga väg i stället för att falla på ett GET.
//
// ⚠️ UNDANTAGET är att Fortnox inte är anslutet. Det är inget svar på frågan utan ett annat problem,
// och rutterna översätter just den klassen till ett eget besked ("koppla Fortnox"). Svaldes den här
// skulle en säljare med utgången token få rådet att synka om — vilket faller på exakt samma sak.
async function fetchInvoiceReference(orderNumber: string): Promise<string | null> {
  const order = await fortnoxGet<{ Order?: { InvoiceReference?: number | string | null } }>(
    `/orders/${orderNumber}`,
  ).catch((e) => {
    if (e instanceof FortnoxNotConnectedError) throw e;
    return null;
  });
  const existing = order?.Order?.InvoiceReference;
  return existing ? String(existing) : null;
}

// Create a DRAFT invoice in Fortnox from the work order's Fortnox order
// (PUT /orders/{n}/createinvoice). Fortnox carries the customer, rows, delivered
// quantities, ROT and references from the order automatically — we only create the
// draft; bookkeeping/sending is done by finance inside Fortnox. Idempotent: a work order
// that already has an invoice number returns it without creating a second invoice. On
// success the work order is moved to status `invoiced` ("Avslutad").
export async function createInvoiceFromWorkOrder(workOrderId: string): Promise<CreateInvoiceResult> {
  const supabase = getSupabaseAdmin();

  const { data: workOrder, error } = await supabase
    .from('crm_work_orders')
    // line_items och sync_status hämtas bara för de två spärrarna nedan — fakturan byggs av Fortnox
    // ur ORDERNS rader, inte ur våra.
    .select('id, fortnox_order_number, fortnox_invoice_number, fortnox_order_sync_status, line_items')
    .eq('id', workOrderId)
    .single<{ id: string; fortnox_order_number: string | null; fortnox_invoice_number: string | null; fortnox_order_sync_status: string | null; line_items: WorkOrderRow['line_items'] }>();

  if (error || !workOrder) throw new Error(`Arbetsorder ${workOrderId} hittades inte`);

  // Idempotency: already invoiced → confirm synced and return the existing number.
  if (workOrder.fortnox_invoice_number) {
    await supabase
      .from('crm_work_orders')
      .update({ fortnox_invoice_sync_status: 'synced' })
      .eq('id', workOrderId);
    return { fortnox_invoice_number: workOrder.fortnox_invoice_number };
  }

  // ── Lokala kontroller, FÖRE claimen ────────────────────────────────────────────────────────
  //
  // Ingenting har rört Fortnox än, så ett avslag här är ett underlagsfel — inte en misslyckad
  // push. Låg de efter claimen skulle de stämpla `fortnox_invoice_sync_status: 'failed'` på en
  // order som aldrig anropades, och säljaren fick se en trasig FAKTURA-synk fast problemet är
  // orderns rader. Samma konvention som delfaktureringen dokumenterar.

  // Rader utan prisförankring får inte faktureras. Fakturan byggs av Fortnox ur ORDERNS rader, så
  // en order som skapades innan spärren fanns bär sina Price 0-rader rakt in på kundens faktura —
  // orderpushens kontroll räcker alltså inte, den ordern finns ju redan.
  assertLineItemsArePriced(activeLineItems(workOrder.line_items), 'Arbetsordern');

  // Ordern fanns redan — då säger ingenting här att Fortnox har VÅRA rader. Misslyckad eller aldrig
  // genomförd radsynk betyder att createinvoice fakturerar gamla rader till kunden, och det syns
  // inte hos oss efteråt. Kontrollen gäller bara den här grenen: skapas ordern nedan är raderna
  // färska per konstruktion.
  if (workOrder.fortnox_order_number && workOrder.fortnox_order_sync_status !== 'synced') {
    // ⚠️ FRÅGA FORTNOX INNAN VI VÄGRAR. Lyckades ett tidigare createinvoice men vår stämpling av
    // fakturanumret föll bort, är fakturan skapad medan vi inte vet om det. Vägrade vi rakt av
    // skulle numret bli omöjligt att få tag i från appen: omsynken lagar inte läget heller, för
    // Fortnox avvisar ändringar på en fakturerad order. Före den här grenen läkte ett nytt försök
    // sig självt via återhämtningen längre ner — den vägen måste stå kvar öppen.
    const alreadyInvoiced = await fetchInvoiceReference(workOrder.fortnox_order_number);
    if (alreadyInvoiced) {
      // ⚠️ SAMMA fält som den vanliga lyckade vägen nedan, inte bara fakturanumret. Utan
      // `status: 'invoiced'` fastnar arbetsordern i 'completed' för alltid: nästa försök returnerar
      // direkt på idempotensgrenen, statusen är systemstyrd och går inte att rätta för hand
      // (SYSTEM_MANAGED_WO_STATUSES svarar 409), och rapporterna filtrerar på 'invoiced' — intäkten
      // hade alltså försvunnit ur fakturerat-siffrorna.
      await supabase
        .from('crm_work_orders')
        .update({
          fortnox_invoice_number: alreadyInvoiced,
          fortnox_invoice_sync_status: 'synced',
          fortnox_invoiced_at: new Date().toISOString(),
          status: 'invoiced',
        })
        .eq('id', workOrderId);
      return { fortnox_invoice_number: alreadyInvoiced };
    }
    assertOrderRowsSynced(workOrder.fortnox_order_sync_status);
  }

  // Atomically claim the invoice push so a double-click / retry can't create TWO draft
  // invoices (Fortnox's createinvoice can succeed before the order shows as invoiced).
  const claimed = await claimFortnoxPush(
    supabase, 'crm_work_orders', workOrderId, 'fortnox_invoice_sync_status', 'fortnox_invoice_claimed_at',
  );
  if (!claimed) throw new FortnoxPushInProgressError();

  try {
    // The invoice is created FROM the Fortnox order, so the order must exist there first.
    // Ensure it's synced (creates it if missing; idempotent if already synced).
    let orderNumber = workOrder.fortnox_order_number;
    if (!orderNumber) {
      const pushed = await pushWorkOrderToFortnox(workOrderId);
      orderNumber = pushed.fortnox_order_number;
    }

    let invoiceNumber = '';
    try {
      const response = await fortnoxPut<{ Invoice?: { DocumentNumber?: string | number } }>(
        `/orders/${orderNumber}/createinvoice`,
      );
      if (response.Invoice?.DocumentNumber != null) invoiceNumber = String(response.Invoice.DocumentNumber);
    } catch (createErr) {
      // createinvoice fails if the order was already (fully) invoiced. Recover the existing
      // invoice via the order's InvoiceReference; if there's none, the failure is real.
      const existing = await fetchInvoiceReference(orderNumber);
      if (!existing) throw createErr;
      invoiceNumber = existing;
    }

    // Response without a number but no error — resolve from the order's InvoiceReference.
    if (!invoiceNumber) {
      const order = await fortnoxGet<{ Order?: { InvoiceReference?: number | string | null } }>(`/orders/${orderNumber}`);
      const existing = order.Order?.InvoiceReference;
      if (!existing) throw new Error('Fortnox returnerade inget fakturanummer');
      invoiceNumber = String(existing);
    }

    await supabase
      .from('crm_work_orders')
      .update({
        fortnox_invoice_number: invoiceNumber,
        fortnox_invoice_sync_status: 'synced',
        fortnox_invoiced_at: new Date().toISOString(),
        status: 'invoiced',
      })
      .eq('id', workOrderId);

    return { fortnox_invoice_number: invoiceNumber };
  } catch (e) {
    const syncStatus = e instanceof FortnoxNotConnectedError ? 'not_synced' : 'failed';
    await supabase
      .from('crm_work_orders')
      .update({ fortnox_invoice_sync_status: syncStatus })
      .eq('id', workOrderId);
    throw e;
  }
}

/**
 * PUT header + ALLA artikelrader på en Fortnox-order som redan finns.
 *
 * Den enda platsen som skriver arbetsorderns rader till Fortnox. Delas av omsynken
 * (`updateWorkOrderInFortnox`) och av createorder-grenen i `pushWorkOrderToFortnox`, som måste
 * skicka om raderna när arbetsordern hunnit redigeras — Fortnox konvertering bygger ordern ur
 * OFFERTENS rader. Låg de som två kopior skulle de glida isär, och radbygget är för fullt av
 * Fortnox-särfall för att bära det (byggmoms, ROT-textraden, avskrivna rader).
 *
 * Anropas inne i anroparens try-block: kastar den, ska anroparens catch stämpla synkstatusen.
 */
async function putOrderHeaderAndRows(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  workOrder: WorkOrderRow,
  orderNumber: string,
  // Redan inläst offert, när anroparen har en. Läses den om här kan de två läsningarna se olika
  // versioner av samma offert — headern och raderna skulle då kunna byggas ur var sin.
  preloadedQuote?: OrderHeaderQuote,
): Promise<void> {
  const linkedQuote = preloadedQuote !== undefined
    ? preloadedQuote
    : await fetchLinkedQuoteForHeader(supabase, workOrder.quote_id);

  const vatPercent = typeof workOrder.vat_percent === 'number' ? workOrder.vat_percent : 25;
  // Reverse charge (byggmoms) must be honoured here too, else re-sending rows silently re-PUTs the
  // order at 25 % VAT and un-does the 0 %-rate push. ROT is excluded then.
  const reverseVat = await resolveReverseVat(supabase, workOrder.customer_snapshot?.reverse_vat, workOrder.customer_id);
  const rotEnabled = resolveOrderRotDetails(workOrder, linkedQuote)?.enabled === true && !reverseVat;
  // Radlistans LÄNGD är auktoritativ: skickar vi färre rader än dokumentet har raderas de
  // överskjutande (mätt 2026-08-20 — offert 10047 gick 11 → 8 rader på en push). En ROT-not som
  // rider som en text-RAD (bostadsrätt) skulle alltså WIPAS om vi inte regenererade den här.
  // Villa/företag lägger den i YourOrderNumber, som headern nedan bär. Samma byggare som
  // skapandevägen, så de två kan inte glida isär.
  //
  // ⚠️ Men raderna som blir kvar ERSÄTTS INTE — de uppdateras per position, och ett fält vi inte
  // skickar ärvs från raden som låg där förut. Se FORTNOX_TEXT_ROW i helpers.ts. Det biter extra
  // hårt här: efter `createorder` bär Fortnox-ordern OFFERTENS rader, inklusive mätrader som
  // buildOrderRows aldrig skapar, så positionerna är förskjutna redan vid första omsynken.
  // Rensning tillåten här sedan `YourOrderNumber: null` är uppmätt (2026-08-26). Det var
  // osäkerheten som höll radvägen utanför: hade Fortnox avvisat null skulle varje artikelredigering
  // och varje "Synka om" ha kastat, med ordern kvar på 'failed' och faktureringen spärrad av
  // assertOrderRowsSynced. Nu är det den ENDA vägen som levererar båda halvorna av en ROT-ändring
  // (referensnumret i headern, ROT-noten som rad), så den måste kunna rensa.
  const { header, documentNote } = await buildOrderHeader(workOrder, linkedQuote, rotEnabled, supabase, {
    allowReferenceClear: true,
  });
  const orderRows = buildOrderRows(workOrder.line_items, vatPercent, rotEnabled, reverseVat, documentNote);

  await fortnoxPut(`/orders/${orderNumber}`, { Order: { ...header, OrderRows: orderRows } });

  // Minnet av rensningen släcks när PUT:en gått igenom — samma regel och samma skäl som i
  // syncWorkOrderHeaderToFortnox. Utan den här raden hade radvägen rensat referensnumret vid VARJE
  // framtida synk och därmed blankat ett värde ekonomi senare skrivit in för hand i Fortnox.
  if ('YourOrderNumber' in header && header.YourOrderNumber === null) {
    await clearReferenceMemory(supabase, workOrder.id);
  }
}

/**
 * Släck minnet av en genomförd referensrensning.
 *
 * ⚠️ LÄSER OM SNAPSHOTEN FÖRST. Den kopia anroparen har i handen lästes FÖRE Fortnox-anropet, och
 * en samtidig PATCH (kontaktperson, Er referens, arbetsadress) kan ha skrivit kolumnen under tiden
 * — ett återskrivet helobjekt hade då tyst rullat tillbaka den redigeringen. Fönstret går inte att
 * stänga helt utan `jsonb_set` i en RPC, men det krymper från "hela Fortnox-anropet" till
 * "två närliggande satser".
 */
async function clearReferenceMemory(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  workOrderId: string,
): Promise<void> {
  const { data } = await supabase
    .from('crm_work_orders')
    .select('customer_snapshot')
    .eq('id', workOrderId)
    .maybeSingle();
  const snapshot = (data?.customer_snapshot ?? {}) as Record<string, unknown>;
  await supabase
    .from('crm_work_orders')
    .update({ customer_snapshot: { ...snapshot, label_cleared: false } })
    .eq('id', workOrderId);
}

// Re-sync an already-synced Fortnox order: header AND article rows (PUT:en styr radlistans längd,
// men uppdaterar kvarvarande rader per position — se FORTNOX_TEXT_ROW i helpers.ts).
// If the order was never synced, falls back to the create path. Used after the work order's
// line_items are edited, and by the manual "Synka om" button — which is why the header goes
// too: it used to send rows only, so "Synka om" could not repair a contact person or work
// address no matter how many times a seller pressed it. Fortnox rejects edits to an
// invoiced/cancelled order — that surfaces as the thrown error and sync status flips to 'failed'.
export async function updateWorkOrderInFortnox(
  workOrderId: string,
  // ⚠️ `false` BARA från efterkontrollen själv. Den anropar den här vägen när raderna skiljer sig,
  // och en efterkontroll därifrån hade blivit en rekursion: push → kontroll → push → kontroll.
  // En extra runda räcker för att konvergera; fler vore en loop så länge någon fortsätter spara.
  opts?: { recheckAfterPush?: boolean },
): Promise<PushOrderResult> {
  const supabase = getSupabaseAdmin();

  const { data: workOrder, error } = await supabase
    .from('crm_work_orders')
    .select('id, quote_id, customer_id, assigned_to, customer_snapshot, work_address, vat_percent, project_name, fortnox_order_number, line_items, rot_details')
    .eq('id', workOrderId)
    .single<WorkOrderRow>();

  if (error || !workOrder) throw new Error(`Arbetsorder ${workOrderId} hittades inte`);

  // Not yet in Fortnox → create it (which also stores the number + synced state).
  if (!workOrder.fortnox_order_number) {
    return pushWorkOrderToFortnox(workOrderId);
  }

  await supabase
    .from('crm_work_orders')
    .update({ fortnox_order_sync_status: 'pending' })
    .eq('id', workOrderId);

  try {
    // Samma spärr som på skapandevägen: den här PUT:en skriver om ALLA orderrader, så en oprissatt
    // rad skulle skriva om en korrekt order till 0 kr.
    //
    // ⚠️ MÅSTE ligga inne i try:t. Utanför skulle raderna sparas lokalt, PUT:en utebli och ordern
    // stå kvar som 'synced' med gamla rader i Fortnox — samma tysta drift som granskningen redan
    // hittat på andra ställen. Här stämplar catch:en 'failed' i stället, så det syns.
    assertLineItemsArePriced(activeLineItems(workOrder.line_items), 'Arbetsordern');

    await putOrderHeaderAndRows(supabase, workOrder, workOrder.fortnox_order_number);

    await supabase
      .from('crm_work_orders')
      .update({ fortnox_order_sync_status: 'synced', fortnox_order_synced_at: new Date().toISOString() })
      .eq('id', workOrderId);

    // 🧨 SAMMA RACE SOM PÅ SKAPANDEVÄGEN. Raden lästes före PUT:en, och mellan dem ligger
    // radbygget och hela Fortnox-anropet. En översiktssparning som landar där skrivs till
    // databasen medan den här PUT:en lägger tillbaka det gamla huvudet — och stämplar 'synced'.
    // Exakt felet på order 131, på den väg efterkontrollen först inte täckte.
    if (opts?.recheckAfterPush !== false) {
      const { mirrorFailed, mirrorNeedsManualFix } = await resyncHeaderIfSnapshotChangedDuringPush(
        supabase, workOrderId, {
          customer_snapshot: workOrder.customer_snapshot,
          work_address: workOrder.work_address,
          assigned_to: workOrder.assigned_to,
          rot_details: workOrder.rot_details ?? null,
          line_items: workOrder.line_items ?? null,
        },
      );
      if (mirrorFailed) {
        return {
          fortnox_order_number: workOrder.fortnox_order_number,
          mirrorFailed: true,
          ...(mirrorNeedsManualFix ? { mirrorNeedsManualFix: true } : {}),
        };
      }
    }

    return { fortnox_order_number: workOrder.fortnox_order_number };
  } catch (e) {
    const syncStatus = e instanceof FortnoxNotConnectedError ? 'not_synced' : 'failed';
    await supabase.from('crm_work_orders').update({ fortnox_order_sync_status: syncStatus }).eq('id', workOrderId);
    throw e;
  }
}

// Push ONLY the header (references, on-site contact note, delivery address) of an already-synced
// Fortnox order. Called after the order's contact person, work address or ansvarig is edited.
//
// Rows are deliberately NOT sent. A contact correction has to be possible on an order whose rows
// are frozen by delfakturering, and re-PUTting rows there would break the array-index match that
// tracks invoiced-vs-remaining per article. Rows have their own path (updateWorkOrderInFortnox).
//
// Returns null — quietly, not as an error — when there is nothing to push:
//   • the order isn't in Fortnox yet. A contact edit must never CREATE the Fortnox document; that
//     belongs to the article push or the seller's explicit "Skicka till Fortnox".
//   • the order is fully invoiced. Fortnox refuses edits to an invoiced order, and a closed order
//     must not flip to sync_status 'failed' every time someone corrects a phone number.
//     `partially_invoiced` is NOT excluded: under Model B those invoices are standalone documents,
//     so the Fortnox order itself is still open and accepts a header update.
export async function syncWorkOrderHeaderToFortnox(workOrderId: string): Promise<PushOrderResult | null> {
  const supabase = getSupabaseAdmin();

  // Narrower than WorkOrderRow on purpose: this path reads no rows and no pricing, and typing it
  // as the full row would claim fields the select doesn't fetch.
  type HeaderSyncRow = OrderHeaderWorkOrder & {
    quote_id: string | null;
    customer_id: string | null;
    status: string;
    fortnox_order_number: string | null;
    fortnox_invoice_number: string | null;
    partial_invoicing_started_at: string | null;
  };

  const { data: workOrder, error } = await supabase
    .from('crm_work_orders')
    .select('id, quote_id, customer_id, assigned_to, customer_snapshot, work_address, status, fortnox_order_number, fortnox_invoice_number, partial_invoicing_started_at, rot_details')
    .eq('id', workOrderId)
    .single<HeaderSyncRow>();

  if (error || !workOrder) throw new Error(`Arbetsorder ${workOrderId} hittades inte`);
  if (!workOrder.fortnox_order_number) return null;
  // ⚠️ HELFAKTURERAD, inte "har ett fakturanummer". Delfakturering POSTar fristående fakturor och
  // lämnar Fortnox-ordern ÖPPEN — men dess slutrunda sätter ändå `fortnox_invoice_number`, så det
  // gamla villkoret stängde ute just de ordrar funktionens egen doc säger ska släppas igenom.
  // Se isFortnoxOrderClosed.
  if (isFortnoxOrderClosed(workOrder)) return null;

  try {
    const linkedQuote = await fetchLinkedQuoteForHeader(supabase, workOrder.quote_id);
    // ROT only decides which of the two "Ert referensnummer" values the header carries; the note
    // half of resolveRotReference is a ROW and belongs to the row path, so it's dropped here.
    const reverseVat = await resolveReverseVat(supabase, workOrder.customer_snapshot?.reverse_vat, workOrder.customer_id);
    const rotEnabled = resolveOrderRotDetails(workOrder, linkedQuote)?.enabled === true && !reverseVat;
    // Enda vägen som får försöka rensa "Ert referensnummer" — se buildOrderHeader.
    const { header } = await buildOrderHeader(workOrder, linkedQuote, rotEnabled, supabase, {
      allowReferenceClear: true,
    });
    const clearedReference = 'YourOrderNumber' in header && header.YourOrderNumber === null;

    // An empty header would be a PUT that says nothing — skip the round trip. null, not a result:
    // nothing was sent, so the caller must not report a completed sync (and must not re-read the
    // row expecting a fresh timestamp).
    if (Object.keys(header).length === 0) return null;

    await fortnoxPut(`/orders/${workOrder.fortnox_order_number}`, { Order: header });

    // ⚠️ MINNET SLÄCKS FÖRST NÄR PUT:EN GÅTT IGENOM, och det är hela skälet till att det finns.
    //
    // Går den inte fram ligger `label_cleared` kvar och nästa header-synk försöker igen — annars
    // hade en misslyckad rensning tvättats bort av nästa lyckade synk medan Fortnox bar kvar den
    // gamla märkningen.
    //
    // Och den släcks FAKTISKT, i stället för att ligga kvar för alltid: en rensning som skickas om
    // och om igen hade blankat ett "Ert referensnummer" som ekonomi senare skrivit in för hand i
    // Fortnox, vid nästa bästa adress- eller referensändring. Rensningen ska ske en gång.
    if (clearedReference) {
      await clearReferenceMemory(supabase, workOrderId);
    }

    // ⚠️ INGEN 'synced'-stämpel här. Statusen betyder "Fortnox-ordern motsvarar HELA vårt underlag",
    // och den här vägen skickar medvetet inga rader — den kan inte gå i god för dem. Stämplade den
    // 'synced' doldes "Försök igen"-knappen och ordern såg komplett ut medan Fortnox fortfarande
    // höll raderna från före redigeringen. (Det gamla `.neq('failed')` täckte bara hälften:
    // `'not_synced'` betyder exakt samma sak för radernas del.)
    //
    // Följden är med flit att `fortnox_order_synced_at` inte heller rörs — tidsstämpeln hör ihop
    // med att HELA dokumentet verifierats, och en kontaktändring verifierar inte raderna.
    //
    // Uppgradering sker bara via en full push (pushWorkOrderToFortnox / updateWorkOrderInFortnox,
    // dvs. "Synka om"), som faktiskt skickar både header och rader.
    return { fortnox_order_number: workOrder.fortnox_order_number };
  } catch (e) {
    // ⚠️ MISSLYCKANDET stämplas däremot. Asymmetrin är avsiktlig: går PUT:en inte fram ligger
    // Fortnox-dokumentet bevisligen efter vårt underlag, och det är sant om hela dokumentet — inte
    // bara om headern. Att tiga här vore värst av allt för FortnoxNotConnectedError, som rutten
    // medvetet sväljer: kontaktändringen hade då aldrig nått Fortnox, svaret sagt att allt gick
    // bra, och ordern fortsatt visa "Synkad".
    //
    // Läget läks av en full push ("Synka om"), aldrig av att headern lyckas nästa gång — bara den
    // fulla pushen kan gå i god för raderna.
    const syncStatus = e instanceof FortnoxNotConnectedError ? 'not_synced' : 'failed';
    await supabase.from('crm_work_orders').update({ fortnox_order_sync_status: syncStatus }).eq('id', workOrderId);
    throw e;
  }
}

// Resolve a work order's synced Fortnox order number, or throw a 409 telling the
// caller to sync the work order to Fortnox first.
//
// ⚠️ KRÄVER MEDVETET INTE `fortnox_order_sync_status === 'synced'`, till skillnad från
// faktureringen. Ett försök att lägga till kravet här visade varför: orderbekräftelsen är ett
// historiskt dokument som måste gå att hämta även på en FAKTURERAD order — och en fakturerad order
// kan inte synkas om (Fortnox avvisar ändringar på den), så en status som en gång hamnat i 'failed'
// hade låst ute PDF:en för alltid.
//
// Kvarstående risk, medvetet accepterad: står ordern i 'failed' renderar Fortnox bekräftelsen ur de
// rader den råkar hålla, som kan vara äldre än våra. Det är ett eget problem — spärra i så fall
// MEJL-vägen, inte visningen.
type OrderForPdf = {
  orderNumber: string;
  projectName: string | null;
  /** Kundens id — hämtar momsnumret till kundraden i vår egen formgivning. */
  customerId: string | null;
  /** Sökande, fastighetsbeteckning och BRF org.nr. Fortnox äger inget av det; CRM gör. */
  rotDetails: RotDetails | null;
  rotEnabled: boolean;
  /** Arbetsorderns `customer_snapshot.personal_number`. Reserv bakom kundkortet. */
  snapshotPersonalNumber: string | null;
};

async function requireOrderNumber(workOrderId: string): Promise<OrderForPdf> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('crm_work_orders')
    .select('fortnox_order_number, project_name, quote_id, customer_id, rot_details, customer_snapshot')
    .eq('id', workOrderId)
    .maybeSingle();

  if (error) throw new FortnoxApiError(500, `Kunde inte läsa arbetsordern: ${error.message}`, undefined, 'Kunde inte läsa arbetsordern. Försök igen.');
  const row = data as {
    fortnox_order_number?: string | number | null;
    project_name?: string | null;
    quote_id?: string | null;
    customer_id?: string | null;
    rot_details?: RotDetails | null;
    customer_snapshot?: { personal_number?: string | null } | null;
  } | null;

  const orderNumber = row?.fortnox_order_number;
  if (!orderNumber) throw new FortnoxApiError(409, 'Synka arbetsordern till Fortnox först.', undefined, 'Synka arbetsordern till Fortnox först.');

  // Samma upplösning som pushen använder — orderns egna ROT-uppgifter, med offertens som reserv för
  // rader vars `rot_details` är tom `{}`. Läste PDF:en dem på annat sätt hade dokumentet kunnat
  // säga något annat än det vi skickade till Fortnox.
  const rotDetails = resolveOrderRotDetails(row ?? {}, await fetchLinkedQuoteForHeader(supabase, row?.quote_id ?? null));

  return {
    orderNumber: String(orderNumber),
    // Projektnamnet följer med enbart för PDF:ens filnamn (ordernummer + projektnamn).
    projectName: row?.project_name ?? null,
    customerId: row?.customer_id ?? null,
    rotDetails,
    rotEnabled: rotDetails?.enabled === true,
    snapshotPersonalNumber: row?.customer_snapshot?.personal_number ?? null,
  };
}

/**
 * Orderdokumentet i vår egen formgivning: orderbekräftelsen eller följesedeln.
 *
 * Samma arbetsdelning som offerten. Datahämtningen bor här, ritandet i `orderPdfDesign.ts`, och
 * BELOPPEN ÄGS AV FORTNOX — vi räknar ingenting om.
 *
 * Ingen tyst fallback: sväljer någon av läsningarna sitt fel får säljaren ett dokument som SER rätt
 * ut men saknar företagsfoten eller ROT-sökandena, och mejlar det vidare utan att märka något.
 */
async function renderOrderDocument(
  order: OrderForPdf,
  kind: 'order' | 'delivery',
): Promise<Uint8Array> {
  const { orderNumber } = order;
  const { Order } = await fortnoxGet<{ Order: FortnoxOrderResponse }>(`/orders/${orderNumber}`);
  const { renderDeliveryNotePdf, renderOrderPdfDesign } = await import('./orderPdfDesign');
  const { resolveCustomerPersonalNumber, resolveCustomerVatNumber } = await import('./helpers');

  // Personnumret läses BARA för orderbekräftelsen på en ROT-order. Följesedeln visar det aldrig,
  // och då ska det inte hämtas heller.
  const wantsRot = kind === 'order' && order.rotEnabled;
  const [companyResponse, customerVatNumber, cardPersonalNumber] = await Promise.all([
    fortnoxGet<{ CompanySettings?: FortnoxCompanySettingsResponse }>('/settings/company'),
    resolveCustomerVatNumber(getSupabaseAdmin(), order.customerId, Order?.CustomerNumber),
    wantsRot
      ? resolveCustomerPersonalNumber(getSupabaseAdmin(), order.customerId, Order?.CustomerNumber)
      : Promise.resolve(null),
  ]);

  const input = {
    order: Order,
    company: companyResponse.CompanySettings ?? {},
    customerVatNumber,
    // 🧨 Sökanden kommer ur CRM. Fortnox `/taxreductions?filter=orders` ger NOLL poster på varje
    // ROT-order (mätt 2026-09-07) — registret fylls först när avdraget rapporteras, alltså långt
    // efter att kunden fått sin orderbekräftelse. Se rotApplicantLines i documentPdfDesign.ts.
    rotDetails: order.rotDetails,
    rotEnabled: order.rotEnabled,
    cardPersonalNumber,
    snapshotPersonalNumber: order.snapshotPersonalNumber,
  };
  return kind === 'order' ? renderOrderPdfDesign(input) : renderDeliveryNotePdf(input);
}

// The order confirmation as a PDF — our own design since 2026-09-07 (ORDER_PDF_MODE).
//
// `mode: 'off'` är nödutgången och går till Fortnox utskriftsmall: `GET /orders/{n}/preview`. Vi
// använder `/preview`, inte `/print` — preview renderar samma layout som Fortnox egen
// förhandsgranskning och är biverkningsfri (markerar inte ordern som utskriven). Accept-headern
// MÅSTE vara `application/json`; Fortnox avvisar `application/pdf` med kod 1000030 och returnerar
// ändå PDF-binären. Se FORTNOX_INTEGRATION.md.
export async function getFortnoxOrderPdf(
  workOrderId: string,
  options: { mode?: OrderPdfMode } = {},
): Promise<{ bytes: Uint8Array; contentType: string; orderNumber: string; projectName: string | null }> {
  const order = await requireOrderNumber(workOrderId);
  const { orderNumber, projectName } = order;

  if ((options.mode ?? ORDER_PDF_MODE) === 'design') {
    return { bytes: await renderOrderDocument(order, 'order'), contentType: 'application/pdf', orderNumber, projectName };
  }

  const { bytes, contentType } = await fortnoxGetBinary(`/orders/${orderNumber}/preview`, 'application/json');
  if (contentType.includes('application/json')) {
    const text = new TextDecoder().decode(bytes).slice(0, 500);
    throw new FortnoxApiError(502, `Fortnox returnerade inte en PDF för order ${orderNumber}: ${text}`, undefined, 'Fortnox kunde inte skapa en orderbekräftelse. Försök igen om en stund.');
  }
  return { bytes, contentType, orderNumber, projectName };
}

/**
 * Följesedeln — leveransdokumentet till arbetsplatsen.
 *
 * ⛔ **Ingen väg till Fortnox utskriftsmall.** Följesedeln finns inte som Fortnox-dokument för våra
 * ordrar, så det finns ingenting att falla tillbaka på. Går vår rendering sönder finns ingen
 * följesedel — till skillnad från orderbekräftelsen, som alltid kan hämtas från Fortnox.
 */
export async function getDeliveryNotePdf(
  workOrderId: string,
): Promise<{ bytes: Uint8Array; contentType: string; orderNumber: string; projectName: string | null }> {
  const order = await requireOrderNumber(workOrderId);
  return {
    bytes: await renderOrderDocument(order, 'delivery'),
    contentType: 'application/pdf',
    orderNumber: order.orderNumber,
    projectName: order.projectName,
  };
}
