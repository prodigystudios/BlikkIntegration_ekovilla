import { netAmount, toNumber, type NetAmountRow } from './pricing';
import { isDeadWorkOrder } from './work-orders';

// ── Fakturerat: en post per FAKTURA, inte en per order ──
//
// En arbetsorder faktureras på ett av två sätt, och "fakturerat" måste räknas olika för dem:
//
//   · I ETT SVEP (orderns createinvoice i Fortnox). Fakturan är hela ordern: orderns netto, på
//     `fortnox_invoiced_at`.
//   · I RUNDOR (delfakturering). Varje runda är en egen faktura med eget belopp och eget datum, i
//     `crm_work_order_invoices`. Ordern blir `invoiced` först med sista rundan, och först då sätts
//     `fortnox_invoiced_at` — till SISTA rundans dag.
//
// Rapporten och översikten räknade tidigare bara det första sättet. En delfakturerad order syntes
// därför inte alls förrän den var slutfakturerad, och då landade HELA ordervärdet på sista rundans
// dag: pengar fakturerade i augusti redovisades i oktober.
//
// ⚠️ EN ORDER RÄKNAS PÅ ETT SÄTT, ALDRIG BÅDA. Har delfaktureringen börjat är rundorna sanningen och
// orderns eget netto räknas inte, inte heller när ordern till slut blir `invoiced` — annars räknas
// sista rundornas pengar två gånger. Rundorna är också det som stämmer när raderna ändrats efteråt:
// fakturan är det som skickades, inte det ordern säger i dag.
//
// Rundans `amount` är radernas antal × pris efter rabatt, utan moms (roundSubtotal) — samma bas som
// netAmount. En order som delfakturerats till fullo summerar därför till samma netto som i ett svep.

export type InvoicedOrderRow = NetAmountRow & {
  status: string | null;
  created_at: string;
  fortnox_invoiced_at: string | null;
  /**
   * Satt = ordern faktureras i rundor, och rundorna räknas i stället för ordern.
   *
   * ⚠️ MÅSTE HÄMTAS av varje läsning som matar invoicedRevenue. Saknas den i en select räknas varje
   * slutfakturerad delfakturaorder dubbelt: en gång som order och en gång som sina rundor. Därför
   * obligatorisk, och läsningarna tilldelar sina rader utan `as` — då fäller typkontrollen en select
   * som tappat kolumnen.
   *
   * Känt och inte jagat: createPartialInvoice sätter kolumnen EFTER att rundan lagts in. Fallerar
   * just den skrivningen, och ordern sedan stängs genom att antalen sänks till det fakturerade
   * (work-orders.ts, `closes`), blir ordern `invoiced` utan kolumnen och räknas här dubbelt. Det
   * kräver ett databasfel mitt i en runda; workOrderInvoicingStarted är den fullständiga frågan.
   */
  partial_invoicing_started_at: string | null;
  assigned_to: string | null;
  client_name?: string | null;
};

type InvoiceRoundOrder = { status: string | null; assigned_to: string | null; client_name?: string | null };

/** En delfakturarunda, med sin order inbäddad (`work_order:crm_work_orders(...)`). */
export type InvoiceRoundRow = {
  amount: number | string | null;
  created_at: string;
  /**
   * Null när läsaren inte får se ordern — då räknas inte rundan heller. Som lista när klienten inte
   * vet att relationen är många-till-en; samma läsning som planeringens `work_order`-inbäddningar.
   */
  work_order: InvoiceRoundOrder | InvoiceRoundOrder[] | null;
};

/** Pengar som fakturerades: hur mycket, när, åt vem och till vilken kund. */
export type InvoicedRevenue = {
  /** Kronor exklusive moms. */
  amount: number;
  /** Tidpunkten fakturan skapades — den pengarna hör till. */
  at: string;
  assigned_to: string | null;
  client_name: string | null;
};

/**
 * The date an order's revenue is attributed to in the REPORT. Rows predating fortnox_invoiced_at
 * fall back to their creation date. The overview deliberately does not — it requires the stamp
 * (tests/crm/overviewSummary.test.ts) — which is why invoicedRevenue takes the rule as an argument.
 */
export function invoicedAt(order: Pick<InvoicedOrderRow, 'fortnox_invoiced_at' | 'created_at'>): string {
  return order.fortnox_invoiced_at || order.created_at;
}

/** En order med de delfakturarundor som redan gått ut (`invoice_rounds:crm_work_order_invoices(amount)`). */
export type OrderWithRounds = NetAmountRow & {
  /**
   * Tom lista = inga rundor. PostgREST svarar med tom lista också när RLS döljer rundorna för
   * läsaren — då räknas hela nettot som kvar, samma tal som före avdraget. Null tåls för säkerhets skull.
   */
  invoice_rounds: Array<{ amount: number | string | null }> | null;
};

/**
 * Det som ÅTERSTÅR att fakturera på ordern: nettot minus de rundor som redan gått ut.
 *
 * Utan avdraget stod en delfakturerad order kvar i "Att fakturera" med hela sitt värde, också den
 * del som redan fakturerats och syns i Fakturerat. Aldrig under noll: varje runda avrundas till hela ören
 * (roundSubtotal) medan nettot inte gör det, så en helt fakturerad order kan hamna en bråkdel av
 * ett öre under — ett lager visar då noll kvar, inte ett minus.
 */
export function uninvoicedAmount(order: OrderWithRounds): number {
  const billed = (order.invoice_rounds ?? []).reduce((total, round) => total + toNumber(round.amount), 0);
  return Math.max(0, netAmount(order) - billed);
}

/**
 * Varje faktura bland raderna, i ETT svep eller per runda. Filtrerar inte på period — anroparen
 * gör det på `at` med sin egen fönsterregel, så rapportens och översiktens fönster förblir sina.
 * `orderInvoicedAt` är anroparens regel för när en order fakturerades i ett svep; null = räknas inte.
 */
export function invoicedRevenue<Order extends InvoicedOrderRow>(
  orders: Order[],
  rounds: InvoiceRoundRow[],
  orderInvoicedAt: (order: Order) => string | null,
): InvoicedRevenue[] {
  const fromOrders = orders.flatMap((order) => {
    if (order.status !== 'invoiced' || order.partial_invoicing_started_at) return [];
    const at = orderInvoicedAt(order);
    if (!at) return [];
    return [{
      amount: netAmount(order),
      at,
      assigned_to: order.assigned_to,
      client_name: order.client_name ?? null,
    }];
  });

  // Avbrutna ordrar är ingen omsättning, samma regel som för ordrarna. En order med fakturerade
  // rundor går inte att avbryta i dag (workOrderInvoicingStarted spärrar), så vakten är ett skydd
  // och inte ett fall som förekommer.
  const fromRounds = rounds.flatMap((round) => {
    const order = Array.isArray(round.work_order) ? round.work_order[0] : round.work_order;
    if (!order || isDeadWorkOrder(order.status)) return [];
    return [{
      amount: toNumber(round.amount),
      at: round.created_at,
      assigned_to: order.assigned_to,
      client_name: order.client_name ?? null,
    }];
  });

  return [...fromOrders, ...fromRounds];
}
