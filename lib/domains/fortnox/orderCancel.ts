import { fortnoxGet, fortnoxPut } from './client';

/**
 * En Fortnox-orders läge och makuleringen av den. Generiska Fortnox-operationer, delade av butiksbeställningarnas Makulera
 * (lib/domains/portal/storeOrderFulfilment.ts, 8b2) och arbetsorderns Avbruten (./workOrderCancel.ts).
 */

/**
 * Fakturanumret en Fortnox-order pekar på (`InvoiceReference`), eller null. 🧨 En ofakturerad order svarar med strängen
 * "0", inte null (uppmätt 2026-09-29, order 71 före och efter createinvoice): "0" är ingen faktura.
 */
export function fortnoxInvoiceReference(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value).trim();
  return text === '' || /^0+$/.test(text) ? null : text;
}

export type FortnoxOrderState = {
  cancelled: boolean;
  /** Fakturan ordern pekar på, eller null. */
  invoiceNumber: string | null;
};

/** GET /orders/{n}: makulerad, och fakturan (InvoiceReference, där "0" är ingen). */
export async function readFortnoxOrderState(orderNumber: string): Promise<FortnoxOrderState> {
  const { Order } = await fortnoxGet<{ Order?: { Cancelled?: boolean | null; InvoiceReference?: string | number | null } }>(
    `/orders/${encodeURIComponent(orderNumber)}`,
  );
  return { cancelled: Order?.Cancelled === true, invoiceNumber: fortnoxInvoiceReference(Order?.InvoiceReference) };
}

/** PUT /orders/{n}/cancel. */
export async function cancelFortnoxOrder(orderNumber: string): Promise<void> {
  await fortnoxPut(`/orders/${encodeURIComponent(orderNumber)}/cancel`);
}

/**
 * Makulerar en Fortnox-order och avgör ett nej på orderns läge, inte på Fortnox felkod (8b2): en som redan är makulerad
 * (också när Fortnox lista släpar efter) är klar, en fakturerad kan inte makuleras. Annat kastas. Delas av Makulera,
 * svepet och pushen som makulerar sin egen order, och av arbetsorderns Avbruten.
 */
export async function cancelFortnoxOrderByState(
  orderNumber: string,
  deps: { cancel: (orderNumber: string) => Promise<void>; readOrder: (orderNumber: string) => Promise<FortnoxOrderState> },
): Promise<{ kind: 'cancelled' } | { kind: 'invoiced'; invoiceNumber: string }> {
  try {
    await deps.cancel(orderNumber);
    return { kind: 'cancelled' };
  } catch (e) {
    const state = await deps.readOrder(orderNumber).catch(() => null);
    if (state?.cancelled) return { kind: 'cancelled' };
    if (state?.invoiceNumber) return { kind: 'invoiced', invoiceNumber: state.invoiceNumber };
    throw e;
  }
}
