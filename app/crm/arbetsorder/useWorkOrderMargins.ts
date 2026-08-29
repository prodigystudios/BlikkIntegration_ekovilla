"use client";

import { useCallback, useEffect, useRef, useState } from 'react';

// Täckningsgraden per order för arbetsorderlistan.
//
// Egen rutt av samma skäl som på arbetsordern: kostnadsdata får inte ligga i den nyttolast andra
// ytor läser. Svaret är dessutom smalt — bara procenten, inte uppställningen.

export type WorkOrderMargin = {
  tg1: number | null;
  tg2: number | null;
  /** Något material gick inte att prissätta, alltså är talet för högt. */
  materialCostIsPartial: boolean;
  isPreliminary: boolean;
};

/**
 * Hämtar TG för de ordrar listan visar.
 *
 * ⚠️ NYCKELN ÄR EN STRÄNG, INTE ARRAYEN. En array-identitet i beroendelistan byter referens vid
 * varje rendering och ger en oändlig hämtningsloop — samma fälla som planeringstavlan gick i
 * (useMemo räckte inte när identiteten bar korrektheten).
 *
 * ⚠️ BARA DE SOM SAKNAS FRÅGAS. Listan lägger på en sida i taget vid "Visa fler", och utan det här
 * hade varje sida räknat om alla föregående ordrar på nytt.
 *
 * ⚠️ 403 ÄR INTE ETT FEL. Rutten gatar på crm.report.read; den som saknar nyckeln ska se märket
 * försvinna, inte ett felmeddelande. Efter ett 403 slutar hooken fråga.
 */
export function useWorkOrderMargins(workOrderIds: string[]) {
  const [margins, setMargins] = useState<Record<string, WorkOrderMargin>>({});
  const [forbidden, setForbidden] = useState(false);
  // Id:n vi redan bett om — även de som svaret inte innehöll, så en order utan kalkyl inte frågas
  // om på nytt vid varje rendering.
  const requestedRef = useRef<Set<string>>(new Set());
  const forbiddenRef = useRef(false);

  const idsKey = workOrderIds.join(',');

  const load = useCallback(async (ids: string[]) => {
    try {
      const res = await fetch('/api/crm/work-orders/after-calculation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ work_order_ids: ids }),
      });
      if (res.status === 403) {
        forbiddenRef.current = true;
        setForbidden(true);
        return;
      }
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) return;
      const items = (json.data?.items || {}) as Record<string, WorkOrderMargin>;
      // Slås ihop, aldrig ersätts: tidigare sidor ska stå kvar.
      setMargins((prev) => ({ ...prev, ...items }));
    } catch {
      // Tyst. Ett uteblivet märke är ett tomt utrymme i listan, inte ett fel som ska larmas om —
      // och listan i övrigt fungerar.
    }
  }, []);

  useEffect(() => {
    if (forbiddenRef.current) return;
    const ids = idsKey ? idsKey.split(',') : [];
    const missing = ids.filter((id) => id && !requestedRef.current.has(id));
    if (missing.length === 0) return;
    for (const id of missing) requestedRef.current.add(id);
    void load(missing);
  }, [idsKey, load]);

  return { margins, forbidden };
}
