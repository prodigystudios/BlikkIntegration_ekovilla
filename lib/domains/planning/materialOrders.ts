import { MATERIAL_SHORTS, sacksPerPalletFor } from '@/lib/domains/crm/materials';
import type { OpsDepot } from './types';
import type { MaterialSupplier } from './materialSuppliers';
import {
  effectiveOrderEmailTemplate,
  renderOrderEmail,
  type OrderEmailData,
  type OrderEmailDepot,
  type OrderEmailLanguage,
  type OrderEmailTemplateProblem,
} from './materialOrderEmail';
import type { ExpectedDeliveryStatus } from './expectedDeliveries';
import type { DepotMaterialForecast } from './depotForecast';
import { addDaysISO } from './timezone';

// Materialbeställningar till fabriken: de rena reglerna. Tabellen och dess spärrar bor i
// supabase/archive/sql/20260917_ops_material_orders.sql; mailets text i ./materialOrderEmail.ts.
//
// Ren, utan sidoeffekter och utan databasanrop. API:t (etapp 4d) läser ur databasen, anropar reglerna här
// och skriver. Plan: ~/.claude/plans/etapp4-bestallningsmail.md.

// ---------------------------------------------------------------------------
// Orderrader
// ---------------------------------------------------------------------------

/** En stockrad som klienten föreslår: bara vad, var, hur mycket och när. Namn och adress läser SERVERN. */
export type OrderLineInput = {
  depot_id: string;
  material: string;
  sacks: number;
  /** 'YYYY-MM-DD' — senast-dagen för leveransen till depån. */
  requested_on: string;
};

/** En stockrad som den lagras på ordern: kompletterad ur databasen vid Granska. */
export type OrderLine = OrderLineInput & {
  depot_name: string;
  depot_location: string;
  sacks_per_pallet: number | null;
};

export type OrderLineProblem =
  | { kind: 'no_lines' }
  | { kind: 'too_many_lines' }
  | { kind: 'supplier_inactive' }
  | { kind: 'depot_unknown'; depot_id: string }
  | { kind: 'depot_inactive'; depot_name: string }
  | { kind: 'depot_without_location'; depot_name: string }
  | { kind: 'material_unknown'; material: string }
  | { kind: 'material_not_supplied'; material: string }
  | { kind: 'sacks_invalid'; depot_name: string; material: string }
  | { kind: 'sacks_not_pallets'; depot_name: string; material: string; sacks_per_pallet: number }
  | { kind: 'date_invalid'; depot_name: string }
  | { kind: 'date_in_past'; depot_name: string }
  | { kind: 'duplicate_line'; depot_name: string; material: string }
  | { kind: 'depot_dates_differ'; depot_name: string };

export const ORDER_LINES_MAX = 60;
/** Samma tak som databasens _material_order_lines_valid. Ett tal utanför det går inte att göra till en väntad leverans. */
export const ORDER_LINE_SACKS_MAX = 100000;

/**
 * Kontrollera och komplettera orderraderna mot registret. Returnerar antingen de lagringsbara raderna eller
 * problemen — aldrig en halv beställning.
 *
 * ⚠️ DEPÅNAMN OCH ADRESS KOMMER ALDRIG FRÅN KLIENTEN. De läses ur ops_depots här, och det är dem fabriken
 * får i mailet.
 *
 * Reglerna, alla från planen:
 * - leverantören är aktiv och levererar materialet (materialet väljer MOTTAGARE — fel material = fel fabrik)
 * - depån finns, är aktiv och HAR en Plats (leveransadressen); utan den vägras beställningen
 * - säckarna är ett positivt heltal, och en hel pallmultipel när pallstorleken är känd
 * - datumet är idag eller senare
 * - högst en rad per depå och material, och ett datum per depå (mailet har en rubrik per depå)
 */
export function buildOrderLines(
  input: OrderLineInput[],
  ctx: { supplier: Pick<MaterialSupplier, 'active' | 'materials'>; depots: OpsDepot[]; today: string },
): { ok: true; lines: OrderLine[] } | { ok: false; problems: OrderLineProblem[] } {
  const problems: OrderLineProblem[] = [];
  if (input.length === 0) problems.push({ kind: 'no_lines' });
  if (!ctx.supplier.active) problems.push({ kind: 'supplier_inactive' });

  const depotById = new Map(ctx.depots.map((d) => [d.id, d]));
  const seen = new Set<string>();
  const dateByDepot = new Map<string, string>();
  const lines: OrderLine[] = [];

  for (const l of input) {
    const depot = depotById.get(l.depot_id);
    if (!depot) {
      problems.push({ kind: 'depot_unknown', depot_id: l.depot_id });
      continue;
    }
    const name = depot.name;
    if (!depot.active) problems.push({ kind: 'depot_inactive', depot_name: name });
    const location = (depot.location ?? '').trim();
    if (location === '') problems.push({ kind: 'depot_without_location', depot_name: name });

    if (!MATERIAL_SHORTS.includes(l.material)) {
      problems.push({ kind: 'material_unknown', material: l.material });
    } else if (!ctx.supplier.materials.includes(l.material)) {
      problems.push({ kind: 'material_not_supplied', material: l.material });
    }

    const perPallet = MATERIAL_SHORTS.includes(l.material) ? sacksPerPalletFor(l.material) : null;
    if (!Number.isInteger(l.sacks) || l.sacks <= 0 || l.sacks > ORDER_LINE_SACKS_MAX) {
      problems.push({ kind: 'sacks_invalid', depot_name: name, material: l.material });
    } else if (perPallet && l.sacks % perPallet !== 0) {
      problems.push({ kind: 'sacks_not_pallets', depot_name: name, material: l.material, sacks_per_pallet: perPallet });
    }

    // ⚠️ Rundresa, inte bara Date.parse: '2027-02-29' tolkas som 1 mars utan att fela. Mailet hade sagt en
    // annan dag än raden, och databasen hade vägrat raden först när mailet redan gått.
    if (!isRealDate(l.requested_on)) {
      problems.push({ kind: 'date_invalid', depot_name: name });
    } else if (l.requested_on < ctx.today) {
      problems.push({ kind: 'date_in_past', depot_name: name });
    }

    // JSON, inte en avgränsare: materialkoderna innehåller både mellanslag och snedstreck.
    const key = JSON.stringify([l.depot_id, l.material]);
    if (seen.has(key)) problems.push({ kind: 'duplicate_line', depot_name: name, material: l.material });
    seen.add(key);

    const date = dateByDepot.get(l.depot_id);
    if (date === undefined) dateByDepot.set(l.depot_id, l.requested_on);
    else if (date !== l.requested_on) problems.push({ kind: 'depot_dates_differ', depot_name: name });

    lines.push({ ...l, depot_name: name, depot_location: location, sacks_per_pallet: perPallet });
  }

  if (input.length > ORDER_LINES_MAX) problems.push({ kind: 'too_many_lines' });
  // En rad per problem räcker: samma depå utan Plats på tre rader är ETT problem att rätta.
  const unique = [...new Map(problems.map((p) => [JSON.stringify(p), p])).values()];
  return unique.length > 0 ? { ok: false, problems: unique } : { ok: true, lines };
}

/** 'YYYY-MM-DD' som är en verklig kalenderdag — samma sträng tillbaka efter en tolkning. */
function isRealDate(iso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const parsed = new Date(`${iso}T12:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === iso;
}

export function describeOrderLineProblem(p: OrderLineProblem): string {
  switch (p.kind) {
    case 'no_lines':
      return 'Beställningen har inga rader';
    case 'too_many_lines':
      return `En beställning får ha högst ${ORDER_LINES_MAX} rader`;
    case 'supplier_inactive':
      return 'Leverantören är inaktiv — aktivera den under Leverantörer innan du beställer';
    case 'depot_unknown':
      return 'En depå på beställningen finns inte längre';
    case 'depot_inactive':
      return `${p.depot_name} är inaktiv`;
    case 'depot_without_location':
      return `${p.depot_name} saknar Plats — fyll i leveransadressen under Depåer, annars vet fabriken inte vart lasset ska`;
    case 'material_unknown':
      return `Okänt material: ${p.material}`;
    case 'material_not_supplied':
      return `Leverantören levererar inte ${p.material}`;
    case 'sacks_invalid':
      return `${p.depot_name} · ${p.material}: ange ett antal säckar mellan 1 och ${ORDER_LINE_SACKS_MAX}`;
    case 'sacks_not_pallets':
      return `${p.depot_name} · ${p.material}: beställ i hela pallar (${p.sacks_per_pallet} säck per pall)`;
    case 'date_invalid':
      return `${p.depot_name}: ogiltigt datum`;
    case 'date_in_past':
      return `${p.depot_name}: leveransdatumet har redan passerat`;
    case 'duplicate_line':
      return `${p.depot_name} · ${p.material} står två gånger — slå ihop raderna`;
    case 'depot_dates_differ':
      return `${p.depot_name} har olika datum på raderna — en depå får ett leveransdatum per beställning`;
  }
}

/**
 * Mailets data ur en granskad order. Depåerna i den ordning de först förekommer; materialen i sin ordning.
 *
 * ⚠️ Bara det mailet får veta: inga prognosfält, inga id:n.
 */
export function orderEmailDataFromOrder(order: {
  order_no: number;
  supplier_name: string;
  contact_name: string | null;
  sender_name: string;
  message: string | null;
  lines: OrderLine[];
  other_lines: { text: string; depot_name: string | null }[];
}): OrderEmailData {
  const depots: OrderEmailDepot[] = [];
  const byDepot = new Map<string, OrderEmailDepot>();
  for (const l of order.lines) {
    let d = byDepot.get(l.depot_id);
    if (!d) {
      d = { depotName: l.depot_name, address: l.depot_location, deliveryDate: l.requested_on, items: [] };
      byDepot.set(l.depot_id, d);
      depots.push(d);
    }
    d.items.push({ material: l.material, sacks: l.sacks });
  }
  return {
    orderNumber: order.order_no,
    supplierName: order.supplier_name,
    contactName: order.contact_name,
    senderName: order.sender_name,
    message: order.message,
    depots,
    otherLines: order.other_lines.map((o) => ({ text: o.text, depotName: o.depot_name })),
  };
}

// ---------------------------------------------------------------------------
// Utskick
// ---------------------------------------------------------------------------

/**
 * Skarpt utskick eller inte.
 *
 * 🧨 BARA `VERCEL_ENV === 'production'` OCH en egen flagga. `.env.local` har en skarp RESEND_API_KEY och
 * pekar på produktionsdatan — en lokal dev-server skickar alltså på riktigt, till fabriken. Preview kör
 * dessutom med NODE_ENV=production, så NODE_ENV säger ingenting. I alla andra lägen skickas bara testmail
 * till den inloggade.
 */
export function materialOrderSendMode(env: Record<string, string | undefined>): 'live' | 'blocked' {
  return env.VERCEL_ENV === 'production' && env.MATERIAL_ORDER_SEND_ENABLED === 'true' ? 'live' : 'blocked';
}

/**
 * Resends idempotensnyckel för ett försök. Samma order och samma försök = samma nyckel, så ett omförsök
 * efter ett nätverksfel inte blir ett andra mail. Ett nytt försöksnummer får bara komma när ett utskick
 * bevisligen INTE gick iväg (release) — se SendEmailOptions i lib/email.ts.
 */
export function materialOrderIdempotencyKey(orderId: string, attempt: number): string {
  return `material-order/${orderId}/${attempt}`;
}

/**
 * Resend-koder som BEVISAR att inget skickades. Allt annat är oklart: mailet kan ha gått iväg.
 *
 * ⚠️ En FAST LISTA, inte en svartlista. En kod som inte står här — en ny, en okänd, `application_error`,
 * `internal_server_error`, 409-koderna för idempotens — behandlas som oklar, och ordern står kvar som
 * 'sending' tills den skickats om med samma nyckel eller en människa avgjort den. Att gissa "avvisat" om
 * en okänd kod hade gett ett nytt försök med ny nyckel, och fabriken två mail.
 */
const DEFINITE_REJECTIONS = new Set([
  'validation_error',
  'missing_required_field',
  'invalid_from_address',
  'invalid_parameter',
  'invalid_access',
  'invalid_region',
  'invalid_idempotency_key',
  'missing_api_key',
  'invalid_api_Key',
  'rate_limit_exceeded',
  'method_not_allowed',
  'not_configured',
]);

export function classifySendError(code: string | null | undefined): 'rejected' | 'ambiguous' {
  return code && DEFINITE_REJECTIONS.has(code) ? 'rejected' : 'ambiguous';
}

/** Från, svar till och kopia. Alla går till den delade brevlådan order@ (beslut 2026-09-11). */
export function materialOrderAddresses(env: Record<string, string | undefined>): {
  from: string;
  replyTo: string;
  bcc: string;
} {
  return {
    from: (env.MATERIAL_ORDER_MAIL_FROM ?? '').trim() || 'Ekovilla <order@ekovilla.se>',
    replyTo: 'order@ekovilla.se',
    bcc: 'order@ekovilla.se',
  };
}

// ---------------------------------------------------------------------------
// Leveransstatus efter utskick
// ---------------------------------------------------------------------------

export type OrderDeliveryState = 'waiting' | 'partial' | 'arrived' | 'cancelled' | 'none';

/**
 * Hur det gått för en skickad order, härlett ur dess väntade leveranser (samma rader som tavlan visar).
 *
 * - waiting    inget har kommit, något väntas fortfarande
 * - partial    något har kommit och något väntas
 * - arrived    allt som inte avbokats har kommit
 * - cancelled  allt är avbokat
 * - none       ordern har inga stockrader (bara "Övrigt på lasset")
 *
 * En avbokad rad räknas varken som framme eller som väntad: den säger att fabriken inte fått besked.
 */
export function orderDeliveryState(rows: { status: ExpectedDeliveryStatus }[]): OrderDeliveryState {
  if (rows.length === 0) return 'none';
  const arrived = rows.filter((r) => r.status === 'arrived').length;
  const expected = rows.filter((r) => r.status === 'expected').length;
  if (arrived === 0 && expected === 0) return 'cancelled';
  if (expected === 0) return 'arrived';
  return arrived > 0 ? 'partial' : 'waiting';
}

// ---------------------------------------------------------------------------
// Övrigt på lasset
// ---------------------------------------------------------------------------

export type OtherLineInput = { text: string; depot_id: string | null };
export type OtherLine = { text: string; depot_id: string | null; depot_name: string | null };

export const OTHER_LINES_MAX = 20;
export const OTHER_LINE_TEXT_MAX = 200;
export const ORDER_MESSAGE_MAX = 1000;

/**
 * Fria rader som följer med lasset men aldrig rör lagret. Depånamnet läses ur registret, som för stockraderna.
 * null när en rad pekar på en depå som inte finns — raden står då utan depå hellre än med ett påhittat namn.
 */
export function buildOtherLines(input: OtherLineInput[], depots: OpsDepot[]): OtherLine[] {
  const byId = new Map(depots.map((d) => [d.id, d]));
  return input
    .map((o) => ({ text: o.text.trim(), depot_id: o.depot_id }))
    .filter((o) => o.text !== '')
    .map((o) => {
      const depot = o.depot_id ? byId.get(o.depot_id) : undefined;
      return { text: o.text, depot_id: depot ? depot.id : null, depot_name: depot ? depot.name : null };
    });
}

// ---------------------------------------------------------------------------
// Sätta ihop ordern: rader + mail, ur registret
// ---------------------------------------------------------------------------

export type ComposedOrder = {
  lines: OrderLine[];
  other_lines: OtherLine[];
  message: string | null;
  supplier_name: string;
  recipient_email: string;
  from_address: string;
  reply_to: string;
  bcc: string;
  email_language: OrderEmailLanguage;
  email_subject: string;
  email_text: string;
  composed_by_name: string;
};

/**
 * Hela ordern som den ska lagras — raderna kompletterade ur registret och mailet renderat med leverantörens mall.
 *
 * ⚠️ SAMMA FUNKTION VID GRANSKA OCH VID SKICKA. Skicka sätter ihop ordern en gång till ur det AKTUELLA
 * registret och jämför med det lagrade: har leverantörens adress, mall eller en depås adress ändrats sedan
 * granskningen ska ordern granskas om, inte skickas med en text ingen sett.
 */
export function composeOrder(input: {
  supplier: MaterialSupplier;
  depots: OpsDepot[];
  lines: OrderLineInput[];
  other_lines: OtherLineInput[];
  message: string | null;
  order_no: number;
  composed_by_name: string;
  today: string;
  env: Record<string, string | undefined>;
}):
  | { ok: true; order: ComposedOrder }
  | { ok: false; lineProblems: OrderLineProblem[]; templateProblems: OrderEmailTemplateProblem[] } {
  const built = buildOrderLines(input.lines, { supplier: input.supplier, depots: input.depots, today: input.today });
  if (!built.ok) return { ok: false, lineProblems: built.problems, templateProblems: [] };

  const other = buildOtherLines(input.other_lines, input.depots);
  const message = (input.message ?? '').trim() || null;
  const language = input.supplier.order_email_language;
  const rendered = renderOrderEmail(
    effectiveOrderEmailTemplate(input.supplier),
    language,
    orderEmailDataFromOrder({
      order_no: input.order_no,
      supplier_name: input.supplier.name,
      contact_name: input.supplier.contact_name,
      sender_name: input.composed_by_name,
      message,
      lines: built.lines,
      other_lines: other,
    }),
  );
  if (!rendered.ok) return { ok: false, lineProblems: [], templateProblems: rendered.problems };

  const addresses = materialOrderAddresses(input.env);
  return {
    ok: true,
    order: {
      lines: built.lines,
      other_lines: other,
      message,
      supplier_name: input.supplier.name,
      recipient_email: input.supplier.email.trim(),
      from_address: addresses.from,
      reply_to: addresses.replyTo,
      bcc: addresses.bcc,
      email_language: language,
      email_subject: rendered.email.subject,
      email_text: rendered.email.text,
      composed_by_name: input.composed_by_name,
    },
  };
}

/** De fält som avgör om det lagrade mailet fortfarande är det som skulle skickas idag. */
export function composedOrderDiffers(
  stored: Pick<ComposedOrder, 'recipient_email' | 'email_subject' | 'email_text' | 'email_language' | 'from_address' | 'reply_to' | 'bcc'>,
  fresh: ComposedOrder,
): boolean {
  return (
    stored.recipient_email !== fresh.recipient_email ||
    stored.email_subject !== fresh.email_subject ||
    stored.email_text !== fresh.email_text ||
    stored.email_language !== fresh.email_language ||
    stored.from_address !== fresh.from_address ||
    stored.reply_to !== fresh.reply_to ||
    stored.bcc !== fresh.bcc
  );
}

// ---------------------------------------------------------------------------
// Varningar
// ---------------------------------------------------------------------------

export type OrderWarning =
  | { kind: 'forecast_unavailable' }
  | { kind: 'open_inflow'; depot_name: string; material: string; sacks: number; next_arrival: string }
  | { kind: 'overdue_inflow'; depot_name: string; material: string; sacks: number }
  | { kind: 'after_run_out'; depot_name: string; material: string; run_out_day: string; requested_on: string }
  | { kind: 'lead_time_too_short'; depot_name: string; requested_on: string; earliest: string }
  | { kind: 'lead_time_zero' }
  | { kind: 'unknown_pallet_size'; material: string }
  | { kind: 'excluded_jobs'; count: number }
  | { kind: 'earlier_order_open'; order_no: number }
  | { kind: 'earlier_orders_unknown' };

/**
 * Det den som skickar bör ha sett innan mailet går. Inget av det blockerar — men Skicka kräver att varningarna
 * är kvitterade, så att ett dubbelt lass eller ett datum efter att depån tagit slut inte går iväg obemärkt.
 *
 * `forecast` null = prognosen kunde inte räknas: det är en varning, inte ett hinder.
 */
export function orderWarnings(input: {
  lines: OrderLine[];
  forecast: { rows: DepotMaterialForecast[]; excludedCount: number } | null;
  leadTimeDays: number;
  today: string;
  /** Tidigare skickade ordrar till samma leverantör som inte kommit fram än. */
  openEarlierOrders: number[];
  /** Läsningen av tidigare ordrar felade: säg det, i stället för att tyst inte ha något att varna om. */
  earlierOrdersUnknown?: boolean;
}): OrderWarning[] {
  const warnings: OrderWarning[] = [];
  if (!input.forecast) warnings.push({ kind: 'forecast_unavailable' });

  const earliest = addDaysISO(input.today, Math.max(0, input.leadTimeDays));
  if (input.leadTimeDays === 0) warnings.push({ kind: 'lead_time_zero' });

  const unknownPallet = new Set<string>();
  const tooShort = new Set<string>();
  for (const l of input.lines) {
    if (l.sacks_per_pallet === null) unknownPallet.add(l.material);
    if (l.requested_on < earliest && !tooShort.has(l.depot_id)) {
      tooShort.add(l.depot_id);
      warnings.push({ kind: 'lead_time_too_short', depot_name: l.depot_name, requested_on: l.requested_on, earliest });
    }
    const f = input.forecast?.rows.find((r) => r.depot_id === l.depot_id && r.material === l.material);
    if (!f) continue;
    if (f.on_order > 0 && f.next_arrival) {
      warnings.push({ kind: 'open_inflow', depot_name: l.depot_name, material: l.material, sacks: f.on_order, next_arrival: f.next_arrival });
    }
    if (f.overdue_inflow > 0) {
      warnings.push({ kind: 'overdue_inflow', depot_name: l.depot_name, material: l.material, sacks: f.overdue_inflow });
    }
    if (f.run_out_day && l.requested_on > f.run_out_day) {
      warnings.push({ kind: 'after_run_out', depot_name: l.depot_name, material: l.material, run_out_day: f.run_out_day, requested_on: l.requested_on });
    }
  }
  for (const material of unknownPallet) warnings.push({ kind: 'unknown_pallet_size', material });
  if (input.forecast && input.forecast.excludedCount > 0) warnings.push({ kind: 'excluded_jobs', count: input.forecast.excludedCount });
  for (const order_no of input.openEarlierOrders) warnings.push({ kind: 'earlier_order_open', order_no });
  if (input.earlierOrdersUnknown) warnings.push({ kind: 'earlier_orders_unknown' });
  return warnings;
}

export function describeOrderWarning(w: OrderWarning): string {
  switch (w.kind) {
    case 'forecast_unavailable':
      return 'Prognosen kunde inte räknas ut — varningarna om lagret nedan saknas';
    case 'open_inflow':
      return `${w.depot_name} · ${w.material}: ${w.sacks} säck är redan på väg (första väntas ${w.next_arrival})`;
    case 'overdue_inflow':
      return `${w.depot_name} · ${w.material}: ${w.sacks} säck är beställda men försenade — hör av dig till fabriken hellre än att beställa igen`;
    case 'after_run_out':
      return `${w.depot_name} · ${w.material}: leveransen ${w.requested_on} kommer efter att depån tar slut (${w.run_out_day})`;
    case 'lead_time_too_short':
      return `${w.depot_name}: ${w.requested_on} är tidigare än leverantörens ledtid medger (tidigast ${w.earliest})`;
    case 'lead_time_zero':
      return 'Leverantören har ledtid 0 dagar — stämmer det?';
    case 'unknown_pallet_size':
      return `Pallstorleken för ${w.material} är okänd — beställs i säckar`;
    case 'excluded_jobs':
      return `${w.count} jobb kunde inte räknas in i prognosen — behovet kan vara större`;
    case 'earlier_order_open':
      return `Beställning #${w.order_no} till samma fabrik har inte kommit fram än`;
    case 'earlier_orders_unknown':
      return 'Tidigare beställningar till fabriken kunde inte läsas — kontrollera att inget redan är på väg';
  }
}

/**
 * Ett fingeravtryck av exakt de varningar som visades. Skicka kräver att klienten skickar tillbaka det.
 *
 * 🧨 EN KVITTERING GÄLLER DET MAN SÅG, INTE "VARNINGAR" I ALLMÄNHET. Med en ren ja/nej-flagga godkändes vilka
 * varningar som helst — och vissa beställningar bär alltid en (okänd pallstorlek för Paroc, ledtid 0), så
 * rutan kryssas av vana. Bokar en kollega in ett lass mellan granskning och Skicka dyker varningen "redan på
 * väg" upp, och den hade godkänts osedd: två lass. Ordningsoberoende, så samma varningar i annan ordning är
 * samma avtryck.
 */
export function warningsFingerprint(warnings: OrderWarning[]): string {
  return JSON.stringify(warnings.map((w) => JSON.stringify(w, Object.keys(w).sort())).sort());
}

/** Är den sammansatta ordern exakt den som redan är lagrad? Då finns inget att skriva. */
export function composedEqualsStored(stored: Record<string, unknown>, composed: ComposedOrder): boolean {
  return (Object.keys(composed) as (keyof ComposedOrder)[]).every(
    (k) => JSON.stringify(stored[k] ?? null) === JSON.stringify(composed[k] ?? null),
  );
}
