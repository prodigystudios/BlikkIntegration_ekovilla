"use client";

import { useCallback, useEffect, useRef, useState } from 'react';

// Täckningsgraden per order för arbetsorderlistan.
//
// Egen rutt av samma skäl som på arbetsordern: kostnadsdata får inte ligga i den nyttolast andra
// ytor läser. Svaret är dessutom smalt — bara procenten, inte uppställningen.

/** Id:n per begäran. Under ruttens tak (200) med marginal, och lika med listans sidstorlek. */
const CHUNK = 100;

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
    // ⚠️ ETT MISSLYCKAT ANROP MÅSTE SLÄPPA ID:NA IGEN. De märks som frågade INNAN svaret kommer
    // (annars hade en andra rendering skickat samma begäran en gång till), men glappar nätet vid
    // första sidladdningen hade de hundra första radernas märke aldrig kommit tillbaka under
    // sessionen — även när rutten svarar normalt igen. Ingen loop: effekten körs bara om när
    // listans id-nyckel ändras.
    const forget = () => {
      for (const id of ids) requestedRef.current.delete(id);
    };
    try {
      const res = await fetch('/api/crm/work-orders/after-calculation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ work_order_ids: ids }),
      });
      if (res.status === 403) {
        // Behörigheten saknas — det är ett svar, inte ett glapp. Fråga inte igen.
        forbiddenRef.current = true;
        setForbidden(true);
        return;
      }
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        forget();
        return;
      }
      const items = (json.data?.items || {}) as Record<string, WorkOrderMargin>;
      // Slås ihop, aldrig ersätts: tidigare sidor ska stå kvar.
      setMargins((prev) => ({ ...prev, ...items }));
    } catch {
      // Tyst mot användaren — ett uteblivet märke är ett tomt utrymme i listan, inte ett fel som
      // ska larmas om. Men id:na släpps, så nästa filtrering eller sida försöker igen.
      forget();
    }
  }, []);

  useEffect(() => {
    if (forbiddenRef.current) return;
    const ids = idsKey ? idsKey.split(',') : [];
    const missing = ids.filter((id) => id && !requestedRef.current.has(id));
    if (missing.length === 0) return;

    // ⚠️ FÖRDRÖJT. Sökfältet skriver rakt in i listans filter utan debounce, så en tioteckens
    // sökning byter träfflista tio gånger. Utan pausen hade var och en av dem startat en egen
    // mängdberäkning — sex frågor över upp till hundra ordrar, med service-role — för ett
    // mellanläge ingen hinner läsa. Pausen gör att bara den lista man stannar på räknas.
    const timer = setTimeout(() => {
      for (const id of missing) requestedRef.current.add(id);
      // ⚠️ DELAS I KLUMPAR. Rutten avvisar fler än 200 id:n, och `missing` kan växa förbi det:
      // varje misslyckat anrop lämnar tillbaka sina id:n, och två sådana plus en "Visa fler" hade
      // gett en begäran som ALLTID svarar 400 — alltså chip som aldrig kommer tillbaka under
      // sessionen. Klumpar gör den gränsen onåbar i stället för osannolik.
      for (let i = 0; i < missing.length; i += CHUNK) {
        void load(missing.slice(i, i + CHUNK));
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [idsKey, load]);

  return { margins, forbidden };
}
