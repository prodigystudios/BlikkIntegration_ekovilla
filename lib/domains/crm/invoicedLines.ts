// Hur mycket av en artikelrad som redan gått ut på faktura, läst ur delfaktureringens rundor.
//
// ⚠️ BEROENDEFRI MED FLIT. Regeln behövs på båda sidor: servern spärrar en redigering av en
// fakturerad rad (validateLineItemEdit i fortnox/partialInvoices.ts), och ordersidans artikeleditor
// låser samma rader i förväg. partialInvoices drar in serverkod och går inte att importera i en
// klientkomponent — därför bor matchningen här och används av båda, så de inte kan börja peka ut
// olika rader.

import { lineItemQuantity, type LineItemQuantitySource } from './lineItems';

export type InvoicedRoundLine = { line_id?: string | null; index?: number | null; quantity: number };
export type InvoicedRound = { line_quantities: InvoicedRoundLine[] | null };

const roundQty = (n: number) => Math.round(n * 1e6) / 1e6;

/**
 * Fakturerat antal på en rad, summerat över alla rundor. Raden matchas på sitt stabila id; en
 * rundpost utan id (äldre rundor) matchas på position.
 */
export function invoicedOnLine(rounds: InvoicedRound[], lineId: string | null, index: number): number {
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

/** Id:n på de rader där något redan fakturerats — de som validateLineItemEdit låser. */
export function invoicedLineIds(
  lineItems: Array<{ id?: string | null }> | null | undefined,
  rounds: InvoicedRound[] | null | undefined,
): Set<string> {
  const ids = new Set<string>();
  if (!rounds?.length) return ids;
  (lineItems ?? []).forEach((item, index) => {
    if (item.id && invoicedOnLine(rounds, item.id, index) > 0) ids.add(item.id);
  });
  return ids;
}

/**
 * Fakturerade rader vars antal sänkts under det fakturerade — samma regel och samma ord som
 * validateLineItemEdit. Editorn visar det före sparningen, i stället för att hela sparningen nekas
 * med 409 efteråt (och alla andra ändringar i samma redigering går förlorade).
 *
 * Det fakturerade läses mot de SPARADE raderna, som servern gör; raden numreras på sin plats i
 * utkastet, som i editorn. Ner TILL det fakturerade är tillåtet — det är hur ordern stängs.
 */
export function invoicedFloorIssues(
  rows: Array<LineItemQuantitySource & { id?: string | null }>,
  savedItems: Array<{ id?: string | null }> | null | undefined,
  rounds: InvoicedRound[] | null | undefined,
): string[] {
  if (!rounds?.length) return [];
  const invoicedById = new Map<string, number>();
  (savedItems ?? []).forEach((item, index) => {
    if (!item.id) return;
    const invoiced = invoicedOnLine(rounds, item.id, index);
    if (invoiced > 0) invoicedById.set(item.id, invoiced);
  });
  const issues: string[] = [];
  rows.forEach((row, i) => {
    const invoiced = row.id ? invoicedById.get(row.id) : undefined;
    if (invoiced == null) return;
    if (roundQty(lineItemQuantity(row)) + 1e-6 < invoiced) {
      issues.push(`Rad ${i + 1} är fakturerad med ${invoiced} och antalet kan inte sänkas under det.`);
    }
  });
  return issues;
}
