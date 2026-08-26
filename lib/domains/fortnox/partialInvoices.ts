import { getSupabaseAdmin } from '@/lib/supabase/server';
import { parseDecimal } from '@/lib/shared/number';
import { lineItemQuantity, isConfiguredLineItem, isUnpricedLineItem } from '@/lib/domains/crm/lineItems';
import { lineItemUnitPrice, lineItemDiscountPercent, lineItemEffectiveUnitPrice, lineItemRotLabor } from '@/lib/domains/crm/pricing';
import { fortnoxGet, fortnoxPost, fortnoxPut, FortnoxNotConnectedError, FortnoxPushInProgressError } from './client';
import { appendFortnoxTextNote, buildRotPropertyNote, claimFortnoxPush, resolveReverseVat, rotRowHouseWork } from './helpers';
import { DEFAULT_ROT_HOUSE_WORK_TYPE } from './types';
import { pushWorkOrderToFortnox } from './orders';

// Delfakturering (partial invoicing). Appen ÄGER det per-artikel fakturerade läget — en
// Fortnox-order exponerar bara en enda InvoiceReference och inget fakturerat antal per rad, så
// delprogressen går inte att läsa tillbaka därifrån. Varje omgång POST:ar vi en fristående
// fakturautkast (Model B) med exakt den omgångens antal och registrerar vad vi fakturerade.
//
// EN BAS, EN NYCKEL: återstående per artikel räknas mot arbetsorderns LEVANDE `line_items`, och
// rundornas rader matchas på radens stabila `id` (`lineKey`). Positionen bär ingenting, vilket är
// varför artikelraderna får redigeras mitt i ett pågående projekt — det som skyddas är bara det som
// redan står på en utställd faktura (`validateLineItemEdit`). Kolumnen
// `line_items_invoicing_snapshot` är historik från den gamla index-baserade modellen och läses
// inte av någon kodväg; två bilder av samma sanning var precis det som lät dem glida isär.
//
// Den beprövade en-shot-vägen (createInvoiceFromWorkOrder → order createinvoice) är orörd och
// används bara innan någon delfakturarunda startat.

// Quantity floating-point tolerance (m³ volumes are fractional). Below this two quantities are
// treated as equal — used for the "remaining" comparison and the final-round test.
const QTY_EPS = 1e-6;

const roundQty = (n: number) => Math.round(n * 1e6) / 1e6;
const roundMoney = (n: number) => Math.round(n * 100) / 100;

export type PartialInvoiceLineItem = {
  // Radens stabila UUID (obligatoriskt i quoteLineItemSchema). Nyckeln som fakturarundorna
  // refererar — därför får den ALDRIG genereras om vid redigering.
  id?: string | null;
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
  // Labour carved out of a material row for ROT. NOT yet supported in partial invoicing — see
  // hasCarvedRotLabor below.
  labor_cost?: string | null;
  // Avskriven rad: såld men aldrig utförd. Återstående blir 0 så ordern kan stängas på det som
  // faktiskt levererades, och raden räknas bort ur ordersumman och ur Fortnox-dokumentet — men
  // ligger kvar synlig, så skillnaden mot offerten går att förklara i efterhand. En rad som ALDRIG
  // fakturerats får lika gärna raderas rakt av; avskrivningen finns för att den ska synas.
  written_off?: boolean | null;
};

// Vad en runda fakturerade på en rad. `line_id` är radens stabila UUID och är nyckeln; `index`
// finns kvar för rundor skrivna innan 20260812_invoice_rounds_line_ids.sql och för poster som
// migreringen medvetet lämnade orörda (id gick inte att slå upp). Positionen är alltså inte längre
// bärande — det var den som tvingade fram artikellåset, eftersom en tillagd eller borttagen rad
// pekade om en redan utställd fakturas antal till fel artikel.
export type PartialRequestLine = { line_id?: string | null; index?: number | null; quantity: number };

// Delfakturering does not yet proportion carved-out ROT labour (each material row's `labor_cost`)
// across partially-invoiced quantities, so a ROT order that used the material→labour split can't be
// partial-invoiced without silently under- or mis-billing the labour. We block it with a clear
// message instead (Phase 2). Rows flagged fully as ROT work (is_rot_work) are unaffected — they
// invoice per row exactly as before.
export function hasCarvedRotLabor(lineItems: PartialInvoiceLineItem[] | null): boolean {
  // Frågar om något FAKTISKT bryts ut, inte om fältet är ifyllt. Skillnaden är verklig sedan
  // labor_cost blev ett à-pris: ett belopp som äter hela à-priset bryter ut noll (se splitRowLabor),
  // och en sådan order har ingenting att proportionera — att ändå spärra delfaktureringen hade
  // låst den på ett värde som inte längre betyder något.
  return (lineItems ?? []).some((i) => !i.is_rot_work && lineItemRotLabor(i) > 0);
}
export type InvoiceRound = { line_quantities: PartialRequestLine[] | null };
export type LineInvoiceState = { lineId: string | null; index: number; total: number; invoiced: number; remaining: number };

export type PartialInvoiceResult = {
  fortnox_invoice_number: string;
  round_number: number;
  status: 'partially_invoiced' | 'invoiced';
};

// A delfakturering validation failure (over-invoicing, nothing to invoice, bad row) — distinct
// from a Fortnox/network failure so the route can map it to a 409 with a friendly message.
export class PartialInvoiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PartialInvoiceError';
  }
}

// Hur mycket en runda fakturerade på EN rad. Matchar på radens id när posten bär ett (allt skrivet
// efter id-migreringen), annars på arrayposition — men positionsvägen används BARA för en rad som
// saknar id, så en migrerad runda kan aldrig råka matcha på fel sätt.
function invoicedOnLine(rounds: InvoiceRound[], lineId: string | null, index: number): number {
  return roundQty(
    rounds.reduce((sum, round) => {
      const entries = round.line_quantities ?? [];
      const match = lineId
        ? entries.find((q) => q.line_id === lineId) ?? entries.find((q) => !q.line_id && q.index === index)
        : entries.find((q) => q.index === index);
      return sum + (match ? Math.max(0, match.quantity) : 0);
    }, 0),
  );
}

// Fakturerat hittills + återstående per rad, mot arbetsorderns AKTUELLA rader och alla tidigare
// rundor. `total` är radens hela antal (m³-volym eller angivet antal, via den delade resolvern).
export function computeInvoiceState(lineItems: PartialInvoiceLineItem[] | null, priorRounds: InvoiceRound[]): LineInvoiceState[] {
  return (lineItems ?? []).map((item, index) => {
    const lineId = item.id ?? null;
    const total = roundQty(lineItemQuantity(item));
    const invoiced = invoicedOnLine(priorRounds, lineId, index);
    // A written-off row has nothing left to invoice, even though its quantity is untouched. This is
    // what lets an order close: isFinalRound requires EVERY row's remaining to reach zero, so a
    // single never-performed article would otherwise keep the order 'partially_invoiced' forever
    // while its total still counted work that was never done.
    const remaining = item.written_off ? 0 : Math.max(0, roundQty(total - invoiced));
    return { lineId, index, total, invoiced, remaining };
  });
}

// Rows that still count toward the order's value: everything not written off. Used for the order
// total and for the Fortnox rows, so a written-off article stops being billed and stops inflating
// the order — the numbers follow what was actually delivered.
export function activeLineItems<T extends { written_off?: boolean | null }>(lineItems: T[] | null | undefined): T[] {
  return (lineItems ?? []).filter((item) => !item.written_off);
}

// Vad en redigering av artikelraderna får göra när fakturor redan gått ut.
//
// Ersätter det gamla platta låset (allt eller inget från första delfakturan). Sedan rundorna
// nycklas på radens id är positionen betydelselös, så det som återstår att skydda är bara detta:
// det som redan står på en utställd faktura måste finnas kvar och får inte krympa under det
// fakturerade. Allt annat — lägga till, ta bort ofakturerat, ändra antal uppåt, byta pris på det
// som återstår, flytta om — är fritt, för det är precis vad ett pågående projekt kräver.
export function validateLineItemEdit(
  currentItems: PartialInvoiceLineItem[] | null,
  nextItems: PartialInvoiceLineItem[] | null,
  priorRounds: InvoiceRound[],
): { ok: true } | { ok: false; message: string } {
  const state = computeInvoiceState(currentItems, priorRounds);
  const invoicedByKey = new Map<string, { invoiced: number; index: number }>();
  (currentItems ?? []).forEach((item, index) => {
    const st = state[index];
    if (st && st.invoiced > 0) invoicedByKey.set(lineKey(item, index), { invoiced: st.invoiced, index });
  });
  if (invoicedByKey.size === 0) return { ok: true };

  const nextByKey = new Map<string, PartialInvoiceLineItem>();
  (nextItems ?? []).forEach((item, index) => nextByKey.set(lineKey(item, index), item));

  for (const [key, { invoiced, index }] of invoicedByKey) {
    const next = nextByKey.get(key);
    if (!next) {
      return { ok: false, message: `Rad ${index + 1} är fakturerad och kan inte tas bort. Sänk antalet till det som levererats i stället.` };
    }
    // Under det fakturerade skulle betyda att ordern säger att vi levererat mindre än vi redan
    // krävt betalt för. Ner TILL det fakturerade är däremot precis hur en order stängs på det som
    // faktiskt blev gjort — då blir återstående noll.
    const nextQty = roundQty(lineItemQuantity(next));
    if (nextQty + QTY_EPS < invoiced) {
      return { ok: false, message: `Rad ${index + 1} är fakturerad med ${invoiced} och antalet kan inte sänkas under det.` };
    }
    // Priset och artikeln är låsta när något av raden gått ut på faktura. Vi har ETT pris per rad,
    // så att ändra det skriver om vad den redan utställda fakturan påstås ha kostat — CRM och
    // bokföringen skulle sluta gå ihop. Ska resten säljas till ett annat pris hör det hemma på en
    // egen rad. Samma sak för husarbete: halva raden kan inte vara ROT och andra halvan inte.
    const cur = (currentItems ?? [])[index];
    const changed = (field: keyof PartialInvoiceLineItem) => String(cur?.[field] ?? '') !== String(next[field] ?? '');
    // ⚠️ `is_rot_work` jämförs som BOOLESKT och inte via `changed()`. Flaggan är en bool med
    // schemadefault `false`, och en rad sparad innan fältet fanns saknar den helt — rå
    // strängjämförelse läste då '' ≠ 'false' som en ändring och NEKADE en helt legitim
    // antalssänkning på en gammal delfakturerad order. Reproducerat mot den riktiga funktionen.
    // Samma normalisering som ROT-typen nedan, och av exakt samma skäl.
    const rotFlag = (item: PartialInvoiceLineItem | undefined) => item?.is_rot_work === true;
    if (changed('unit_price') || changed('discount_percent') || changed('article_number')
      || rotFlag(cur) !== rotFlag(next)) {
      return { ok: false, message: `Rad ${index + 1} är fakturerad — pris, rabatt, artikel och ROT-markering kan inte ändras. Lägg det som skiljer på en ny rad.` };
    }
    // ROT-TYPEN hör till samma lås, men den kan inte prövas med `changed()` ovan.
    //
    // Låset tillkom när fältet blev redigerbart på arbetsordern — förut gick det bara att sätta i
    // offerten, som låses vid orderskapandet. Typen ÄR ROT-identiteten: den säger Skatteverket
    // vilket slags husarbete som utförts, så en ändring på en rad som redan gått ut på faktura
    // låter underlaget säga en sak och den utställda fakturan en annan.
    //
    // ⚠️ Två skäl till den egna jämförelsen, båda skulle ge FALSKA blockeringar i `changed()`:
    //   • En rad sparad innan fältet fanns saknar det helt. Rå strängjämförelse hade läst
    //     '' ≠ 'CONSTRUCTION' som en ändring och låst en helt legitim antalssänkning. Båda sidor
    //     normaliseras därför mot defaulten.
    //   • På en rad som inte är ROT-arbete LÄSES typen aldrig (`rotRowHouseWork` returnerar null
    //     utan flaggan), så där ändrar den ingenting och ska inte spärra något.
    const houseWorkType = (item: PartialInvoiceLineItem | undefined) =>
      String(item?.house_work_type || DEFAULT_ROT_HOUSE_WORK_TYPE);
    if (cur?.is_rot_work === true && houseWorkType(cur) !== houseWorkType(next)) {
      return { ok: false, message: `Rad ${index + 1} är fakturerad — typen av husarbete kan inte ändras. Lägg det som skiljer på en ny rad.` };
    }
    // Avskrivning betyder "utfördes aldrig". Det kan inte gälla en rad som redan står på en
    // utställd faktura — pengarna är krävda. Sänk antalet till det levererade i stället.
    if (next.written_off && !cur?.written_off) {
      return { ok: false, message: `Rad ${index + 1} är redan fakturerad och kan inte skrivas av. Sänk antalet till det som levererats i stället.` };
    }
  }
  return { ok: true };
}

// Nyckeln en rad adresseras med genom hela delfaktureringen: radens stabila id, med
// arrayposition som reserv för äldre rader som saknar id. Samma funktion används av validering,
// radbygge och summering, så de tre kan aldrig adressera olika saker.
export function lineKey(item: { id?: string | null }, index: number): string {
  return item.id ?? `#${index}`;
}

// Validera en begärd runda mot återstående per rad. Kastar PartialInvoiceError vid
// överfakturering eller en tom begäran. Returnerar antalen (deduplicerade, bara positiva) nycklade
// på radnyckeln, samt om rundan fakturerar det sista av varje rad (→ status 'invoiced').
export function validatePartialRequest(
  state: LineInvoiceState[],
  request: PartialRequestLine[],
): { requestByKey: Map<string, number>; isFinalRound: boolean } {
  const byKey = new Map<string, number>();
  for (const line of request) {
    const qty = Math.max(0, line.quantity);
    if (qty <= 0) continue;
    // Begäran får peka ut raden med id (normalfallet) eller position (äldre klient).
    const st = line.line_id
      ? state.find((s) => s.lineId === line.line_id)
      : state.find((s) => s.index === line.index);
    if (!st) throw new PartialInvoiceError(`Ogiltig rad (${line.line_id ?? `index ${line.index}`}).`);
    const key = st.lineId ?? `#${st.index}`;
    const next = roundQty((byKey.get(key) ?? 0) + qty);
    if (next > st.remaining + QTY_EPS) {
      throw new PartialInvoiceError(`Antal att fakturera överstiger återstående för rad ${st.index + 1}.`);
    }
    byKey.set(key, next);
  }
  if (![...byKey.values()].some((q) => q > 0)) {
    throw new PartialInvoiceError('Inget antal att fakturera angavs.');
  }
  // Slutrunda när varje rads återstående når noll efter den här rundan.
  const isFinalRound = state.every((s) => s.remaining - (byKey.get(s.lineId ?? `#${s.index}`) ?? 0) <= QTY_EPS);
  return { requestByKey: byKey, isFinalRound };
}

// Build Fortnox INVOICE rows for this round. NOTE: invoice rows use `DeliveredQuantity` (order
// rows use OrderedQuantity, offer rows use Quantity). Quantity is this round's per-line amount;
// only lines with a positive quantity produce a row. Discount/ROT mapping mirrors buildOrderRows.
export function buildInvoiceRows(
  lineItems: PartialInvoiceLineItem[] | null,
  requestByKey: Map<string, number>,
  vatPercent: number,
  rotEnabled: boolean,
  reverseVat = false,
  rotPropertyNote: string | null = null,
) {
  const rows: Array<Record<string, unknown> & { Description: string }> = [];
  (lineItems ?? []).forEach((item, index) => {
    const qty = requestByKey.get(lineKey(item, index)) ?? 0;
    if (qty <= 0) return;
    const discount = lineItemDiscountPercent(item);
    rows.push({
      ...(item.article_number ? { ArticleNumber: item.article_number } : {}),
      Description: item.article_name || item.line_note || 'Artikel',
      DeliveredQuantity: qty,
      Price: lineItemUnitPrice(item),
      // Reverse charge (byggmoms) → 0 % VAT; the invoice's VAT regime comes from the customer
      // card (synced from reverse_vat), so we match the row VAT to keep the document consistent.
      VAT: reverseVat ? 0 : vatPercent,
      ...(item.article_unit_name ? { Unit: item.article_unit_name } : {}),
      ...(discount > 0 ? { Discount: discount, DiscountType: 'PERCENT' as const } : {}),
      // Husarbete bara på rader vi själva menar är arbete, och bara på ROT-dokument. Regeln bor i
      // rotRowHouseWork — läs de tre mätningarna där innan du breddar något här; två rimliga idéer
      // har redan prövats mot skarp Fortnox och fallit.
      ...(rotRowHouseWork(item, rotEnabled) ?? {}),
    });
  });
  // ROT property note (Fastighetsbeteckning / BRF org.nr) as a trailing text row — Fortnox has no
  // API field for it. A partial invoice builds its own rows (not copied from the order), so it's
  // appended here per round. Only set on a ROT order (the caller passes null otherwise).
  return appendFortnoxTextNote(rows, rotPropertyNote);
}

// This round's subtotal ex VAT (quantity × discounted unit price), matching pricing_summary.subtotal.
export function roundSubtotal(lineItems: PartialInvoiceLineItem[] | null, requestByKey: Map<string, number>): number {
  let sum = 0;
  (lineItems ?? []).forEach((item, index) => {
    const qty = requestByKey.get(lineKey(item, index)) ?? 0;
    if (qty <= 0) return;
    sum += qty * lineItemEffectiveUnitPrice(item);
  });
  return roundMoney(sum);
}

type WorkOrderRow = {
  id: string;
  status: string;
  project_name: string | null;
  vat_percent: number | null;
  customer_id: string | null;
  customer_snapshot: { reverse_vat?: boolean | null } | null;
  line_items: PartialInvoiceLineItem[] | null;
  partial_invoicing_started_at: string | null;
  fortnox_order_number: string | null;
  rot_details: { enabled?: boolean | null; property_designation?: string | null; brf_org_number?: string | null } | null;
};

type FortnoxOrderHeader = {
  CustomerNumber?: string | number;
  OurReference?: string | null;
  YourReference?: string | null;
  DeliveryAddress1?: string | null;
  DeliveryZipCode?: string | null;
  DeliveryCity?: string | null;
};

// Create ONE partial-invoice round: validate the requested quantities against remaining, ensure
// the Fortnox order exists (its header is the source for customer/references/delivery), POST a
// standalone draft invoice with this round's rows, then record the round and advance the work
// order to 'partially_invoiced' (or 'invoiced' when the last of every line is billed). Guarded by
// the same atomic claim as the full-invoice push so a double-submit can't create two invoices.
export async function createPartialInvoice(
  workOrderId: string,
  request: PartialRequestLine[],
  actorUserId: string | null,
): Promise<PartialInvoiceResult> {
  const supabase = getSupabaseAdmin();

  const { data: workOrder, error } = await supabase
    .from('crm_work_orders')
    .select('id, status, project_name, vat_percent, customer_id, customer_snapshot, line_items, partial_invoicing_started_at, fortnox_order_number, rot_details')
    .eq('id', workOrderId)
    .single<WorkOrderRow>();

  if (error || !workOrder) throw new Error(`Arbetsorder ${workOrderId} hittades inte`);

  // Gate the FIRST round on the work being ready to bill. Later rounds are not gated on status:
  // once delfakturering has started the order may legitimately be back in a work state (a job that
  // runs across several months bills as it goes), and requiring 'Fakturera' would mean flipping the
  // status back and forth just to invoice — which is exactly the conflation we removed.
  // En avbruten order faktureras aldrig, oavsett hur långt delfaktureringen hunnit — annars kan en
  // stale flik ställa ut en riktig faktura på ett jobb kunden hoppat av.
  if (workOrder.status === 'cancelled') {
    throw new PartialInvoiceError('Arbetsordern är avbruten och kan inte faktureras.');
  }
  // Bara FÖRSTA rundan gatas på att jobbet är klart att faktureras. Senare rundor gör det inte:
  // ordern ligger ofta tillbaka i ett arbetsläge (ett jobb över flera månader faktureras allt
  // eftersom), och att kräva "Fakturera" hade betytt att vippa statusen fram och tillbaka bara för
  // att fakturera — exakt den sammanblandning som togs bort.
  if (!workOrder.partial_invoicing_started_at
      && workOrder.status !== 'completed' && workOrder.status !== 'partially_invoiced') {
    throw new PartialInvoiceError('Sätt arbetsordern till "Fakturera" innan du delfakturerar.');
  }

  // Basen är arbetsorderns LEVANDE rader. Tidigare var den den frysta snapshoten, eftersom rundorna
  // pekade på arrayposition och varje redigering hade förskjutit dem. Sedan rundorna nycklas på
  // radens id är positionen betydelselös, och då ska återstående mätas mot det ordern faktiskt
  // innehåller nu — annars kan en artikel som tillkommer mitt i projektet aldrig faktureras.
  // Snapshoten skrivs fortfarande vid första rundan, men bara som historik.
  const basis = workOrder.line_items;

  // Phase 2 guard: carved-out ROT labour isn't proportioned across partial rounds yet — block rather
  // than silently mis-bill. Checked before claiming so it can't leave the sync status stuck pending.
  if (workOrder.rot_details?.enabled === true && hasCarvedRotLabor(basis)) {
    throw new PartialInvoiceError('Delfakturering av en ROT-order med utbruten arbetskostnad stöds inte än. Fakturera hela ordern i ett svep, eller hantera delfaktureringen i Fortnox.');
  }

  // Validate BEFORE claiming so a bad request doesn't flip the sync status to pending.
  const { data: priorRoundsData, error: roundsError } = await supabase
    .from('crm_work_order_invoices')
    .select('round_number, line_quantities, fortnox_invoice_number')
    .eq('work_order_id', workOrderId)
    .order('round_number', { ascending: true });
  // Fail closed. Ett svalt läsfel hade sett ut som "inget är fakturerat än" och låtit hela ordern
  // faktureras en gång till.
  if (roundsError) throw new Error(`Kunde inte läsa fakturarundorna: ${roundsError.message}`);
  const priorRounds = (priorRoundsData ?? []) as Array<{ round_number: number; line_quantities: PartialRequestLine[] | null; fortnox_invoice_number: string | null }>;
  const roundNumber = (priorRounds.length ? Math.max(...priorRounds.map((r) => r.round_number)) : 0) + 1;

  const state = computeInvoiceState(basis, priorRounds);
  const { requestByKey, isFinalRound } = validatePartialRequest(state, request);

  // Rader utan prisförankring får inte faktureras. Det här är en RIKTIG faktura till kunden, så en
  // oprissatt rad debiteras 0 kr — och bidrar dessutom med noll till ROT-underlaget. Ordern kan ha
  // skapats i Fortnox innan spärren fanns, så orderpushens kontroll räcker inte här.
  //
  // ⚠️ Spärra bara raderna som FAKTURERAS DEN HÄR RUNDAN. Hela `basis` hade stoppat en helt korrekt
  // omgång för en rad som inte ens ingår i den. (`filter` ger callbacken originalindexet, så
  // lineKey pekar rätt.)
  //
  // Före claimen och som PartialInvoiceError, precis som de två kontrollerna ovan: ingenting har
  // rört Fortnox än, så det här är ett underlagsfel (409) — inte en misslyckad push som ska stämpla
  // `fortnox_invoice_sync_status: 'failed'` på en order som aldrig blev anropad.
  //
  // ⚠️ Har raden REDAN delfakturerats en gång (möjligt på gammal data, då den fakturerades för 0 kr)
  // går den inte att rätta rakt av: validateLineItemEdit tillåter varken ett ändrat `unit_price`
  // eller en avskrivning på en fakturerad rad. Meddelandet nämner därför vägen ut, annars står
  // ordern still utan att någon förstår varför.
  const billedThisRound = (basis ?? []).filter((item, index) => (requestByKey.get(lineKey(item, index)) ?? 0) > 0);
  if (billedThisRound.some((item) => isConfiguredLineItem(item) && isUnpricedLineItem(item))) {
    throw new PartialInvoiceError(
      'Fakturaunderlaget har rader utan pris. Ange A-pris, välj artikel, eller skriv 0 om raden ingår. '
      + 'Är raden redan delfakturerad går den inte att prissätta om — fakturera då resten av ordern utan den raden, och ta den i Fortnox.',
    );
  }

  const claimed = await claimFortnoxPush(
    supabase, 'crm_work_orders', workOrderId, 'fortnox_invoice_sync_status', 'fortnox_invoice_claimed_at',
  );
  if (!claimed) throw new FortnoxPushInProgressError();

  try {
    const vatPercent = typeof workOrder.vat_percent === 'number' ? workOrder.vat_percent : 25;
    // Reverse charge (byggmoms) excludes ROT and forces 0 % rows + SEREVERSEDVAT on the invoice.
    const reverseVat = await resolveReverseVat(supabase, workOrder.customer_snapshot?.reverse_vat, workOrder.customer_id);
    const rotEnabled = workOrder.rot_details?.enabled === true && !reverseVat;

    // The invoice is independent, but we mirror the order's header (customer/references/delivery)
    // so the partial invoices match the order confirmation. Ensure the order exists first — this
    // also guarantees the customer is synced to Fortnox.
    let orderNumber = workOrder.fortnox_order_number;
    if (!orderNumber) {
      const pushed = await pushWorkOrderToFortnox(workOrderId);
      orderNumber = pushed.fortnox_order_number;
    }
    const order = await fortnoxGet<{ Order?: FortnoxOrderHeader }>(`/orders/${orderNumber}`);
    const header = order.Order ?? {};
    if (header.CustomerNumber == null) throw new Error('Fortnox-ordern saknar kundkoppling');

    const rotPropertyNote = rotEnabled ? buildRotPropertyNote(workOrder.rot_details) : null;
    const invoiceRows = buildInvoiceRows(basis, requestByKey, vatPercent, rotEnabled, reverseVat, rotPropertyNote);
    if (!invoiceRows.length) throw new PartialInvoiceError('Inget antal att fakturera angavs.');

    // A partial invoice is a STANDALONE Fortnox invoice (it can't use the order's createinvoice,
    // which would lock the order after one round), so it lacks the native order↔invoice link.
    // Stamp a human-readable reference into Remarks ("Övrigt") + YourOrderNumber so whoever handles
    // invoicing in Fortnox — who may not have the CRM — can see which order this invoice belongs to.
    const projectName = workOrder.project_name?.trim();
    const remarks = `Delfaktura ${roundNumber} – avser order ${orderNumber}${projectName ? ` – ${projectName}` : ''}`;

    const response = await fortnoxPost<{ Invoice?: { DocumentNumber?: string | number } }>('/invoices', {
      Invoice: {
        CustomerNumber: String(header.CustomerNumber),
        InvoiceDate: new Date().toISOString().slice(0, 10),
        Remarks: remarks,
        YourOrderNumber: String(orderNumber),
        ...(header.OurReference ? { OurReference: header.OurReference } : {}),
        ...(header.YourReference ? { YourReference: header.YourReference } : {}),
        // No VATType on the payload (kept consistent with offers/orders): the customer card drives
        // the VAT regime and rows carry the matching VAT (0 % for reverse charge, see
        // buildInvoiceRows) so header and rows never diverge.
        ...(rotEnabled ? { TaxReductionType: 'rot' } : {}),
        ...(header.DeliveryAddress1
          ? {
              DeliveryAddress1: header.DeliveryAddress1,
              ...(header.DeliveryZipCode ? { DeliveryZipCode: header.DeliveryZipCode } : {}),
              ...(header.DeliveryCity ? { DeliveryCity: header.DeliveryCity } : {}),
            }
          : {}),
        InvoiceRows: invoiceRows,
      },
    });

    const invoiceNumber = response.Invoice?.DocumentNumber != null ? String(response.Invoice.DocumentNumber) : '';
    if (!invoiceNumber) throw new Error('Fortnox returnerade inget fakturanummer');

    // Rundan sparas mot radens ID, inte dess position — det är hela poängen med omläggningen.
    //
    // ⚠️ En rad UTAN id måste få `index`, inte bara `legacy_index`: läsvägen (invoicedOnLine) letar
    // efter `index` för id-lösa rader, så en post med bara `legacy_index` hade lästs tillbaka som
    // "0 fakturerat" och samma antal kunnat faktureras igen. legacy_index är spårbarhet, inte nyckel.
    const lineQuantities = (basis ?? []).flatMap((item, index) => {
      const quantity = requestByKey.get(lineKey(item, index)) ?? 0;
      if (quantity <= 0) return [];
      return [item.id
        ? { line_id: item.id, quantity, legacy_index: index }
        : { line_id: null, index, quantity }];
    });

    await supabase.from('crm_work_order_invoices').insert({
      work_order_id: workOrderId,
      round_number: roundNumber,
      fortnox_invoice_number: invoiceNumber,
      fortnox_sync_status: 'synced',
      amount: roundSubtotal(basis, requestByKey),
      line_quantities: lineQuantities,
      created_by: actorUserId,
    });

    const status: 'partially_invoiced' | 'invoiced' = isFinalRound ? 'invoiced' : 'partially_invoiced';
    const nowIso = new Date().toISOString();
    await supabase
      .from('crm_work_orders')
      .update({
        fortnox_invoice_sync_status: 'synced',
        status,
        // Ingen snapshot längre: basen ÄR de levande raderna. En andra, frusen bild av samma sak
        // var det som lät "Fakturera resten" och valideringen svara olika.
        ...(workOrder.partial_invoicing_started_at ? {} : { partial_invoicing_started_at: nowIso }),
        // The terminal fortnox_invoice_number/at mirror the LAST round, for the existing card + reports.
        ...(isFinalRound ? { fortnox_invoice_number: invoiceNumber, fortnox_invoiced_at: nowIso } : {}),
      })
      .eq('id', workOrderId);

    // Annotate the Fortnox order's internal Comments so finance can see it's been (part-)invoiced
    // via standalone invoices — the order keeps no native InvoiceReference in this flow. Uses
    // Comments (internal), NOT Remarks (printed on the customer's order confirmation). Non-fatal:
    // the invoice is already created, so a failed annotation must not fail the round.
    try {
      const invoiceNumbers = [...priorRounds.map((r) => r.fortnox_invoice_number).filter(Boolean), invoiceNumber];
      const statusLabel = isFinalRound ? 'Fulldelfakturerad (avslutad)' : 'Delfakturerad';
      const comment = `${statusLabel} i CRM – fakturor: ${invoiceNumbers.join(', ')}`;
      await fortnoxPut(`/orders/${orderNumber}`, { Order: { Comments: comment } });
    } catch (annotateErr) {
      console.error('[Fortnox] kunde inte annotera order vid delfaktura:', (annotateErr as Error)?.message);
    }

    return { fortnox_invoice_number: invoiceNumber, round_number: roundNumber, status };
  } catch (e) {
    const syncStatus = e instanceof FortnoxNotConnectedError ? 'not_synced' : 'failed';
    await supabase
      .from('crm_work_orders')
      .update({ fortnox_invoice_sync_status: syncStatus })
      .eq('id', workOrderId);
    throw e;
  }
}

// "Fakturera allt" once delfakturering has already started: invoice every line's remaining quantity
// in a single final round (→ status 'invoiced'). Used by the existing invoice route when a partial
// round exists, so it never re-runs the order createinvoice (which would re-bill the full order).
export async function invoiceRemainingForWorkOrder(workOrderId: string, actorUserId: string | null): Promise<PartialInvoiceResult> {
  const supabase = getSupabaseAdmin();

  const { data: workOrder, error } = await supabase
    .from('crm_work_orders')
    .select('line_items')
    .eq('id', workOrderId)
    .single<{ line_items: PartialInvoiceLineItem[] | null }>();
  if (error || !workOrder) throw new Error(`Arbetsorder ${workOrderId} hittades inte`);

  // Samma bas som createPartialInvoice validerar mot. Läste tidigare den frysta snapshoten, vilket
  // betydde att den här funktionen kunde begära antal på rader som inte längre fanns — eller,
  // värre, på rätt POSITION men fel artikel.
  const { data: priorRoundsData, error: roundsError } = await supabase
    .from('crm_work_order_invoices')
    .select('line_quantities')
    .eq('work_order_id', workOrderId);
  // Fail closed: tolkas ett läsfel som "inga rundor" blir varje rads återstående dess fulla antal,
  // och hela ordern faktureras om.
  if (roundsError) throw new Error(`Kunde inte läsa fakturarundorna: ${roundsError.message}`);
  const state = computeInvoiceState(workOrder.line_items, (priorRoundsData ?? []) as InvoiceRound[]);

  // Rader pekas ut med id (position som reserv), precis som modalen gör.
  const request = state.filter((s) => s.remaining > QTY_EPS).map((s) => ({ line_id: s.lineId, index: s.index, quantity: s.remaining }));
  if (!request.length) throw new PartialInvoiceError('Det finns inget kvar att fakturera.');

  return createPartialInvoice(workOrderId, request, actorUserId);
}
