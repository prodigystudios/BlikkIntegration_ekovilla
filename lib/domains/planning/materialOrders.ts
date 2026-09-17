import { MATERIAL_SHORTS, sacksPerPalletFor } from '@/lib/domains/crm/materials';
import type { OpsDepot } from './types';
import type { MaterialSupplier } from './materialSuppliers';
import type { OrderEmailData, OrderEmailDepot } from './materialOrderEmail';
import type { ExpectedDeliveryStatus } from './expectedDeliveries';

// Materialbeställningar till fabriken: de rena reglerna. Tabellen och dess spärrar bor i
// supabase/sql/20260917_ops_material_orders.sql; mailets text i ./materialOrderEmail.ts.
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
    if (!Number.isInteger(l.sacks) || l.sacks <= 0) {
      problems.push({ kind: 'sacks_invalid', depot_name: name, material: l.material });
    } else if (perPallet && l.sacks % perPallet !== 0) {
      problems.push({ kind: 'sacks_not_pallets', depot_name: name, material: l.material, sacks_per_pallet: perPallet });
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(l.requested_on) || Number.isNaN(Date.parse(`${l.requested_on}T12:00:00Z`))) {
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
      return `${p.depot_name} · ${p.material}: ange ett antal säckar större än noll`;
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
