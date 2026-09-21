"use client";

import { useBatchMargins } from '@/lib/useBatchMargins';

// Täckningsgraden per order för arbetsorderlistan.
//
// Egen rutt av samma skäl som på arbetsordern: kostnadsdata får inte ligga i den nyttolast andra
// ytor läser. Svaret är dessutom smalt — bara procenten, inte uppställningen.
//
// Själva hämtningen (klumpar, fördröjning, 403, att bara fråga om det som saknas) bor i
// useBatchMargins och delas med planeringstavlans TB-märke.

export type WorkOrderMargin = {
  tg1: number | null;
  tg2: number | null;
  /**
   * Något saknas i underlaget — typiskt att tiden inte är rapporterad än.
   *
   * ⚠️ Betyder INTE att talen ovan är osäkra. De räknas bara när materialkostnaden är komplett;
   * går någon del inte att prissätta blir de null.
   */
  isPreliminary: boolean;
};

/** Hämtar TG för de ordrar listan visar. */
export function useWorkOrderMargins(workOrderIds: string[]) {
  const { items, forbidden } = useBatchMargins<WorkOrderMargin>(
    '/api/crm/work-orders/after-calculation',
    workOrderIds,
  );
  return { margins: items, forbidden };
}
