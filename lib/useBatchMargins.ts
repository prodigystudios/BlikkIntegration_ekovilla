"use client";

import { useCallback, useEffect, useRef, useState } from 'react';

// Mängdhämtning av kalkyltal per arbetsorder, delad av arbetsorderlistans TG-märke och
// planeringstavlans TB-märke.
//
// Båda ytorna ställer samma fråga — "räkna de här ordrarnas marginal" — mot var sin smal rutt, och
// båda måste hantera samma fyra saker: att listan växer sida för sida, att sökfältet byter urval
// tio gånger i rad, att rutten har ett tak på antalet id:n, och att 403 är ett svar och inte ett
// glapp. Den logiken satt först bara i arbetsorderlistan; den bor här för att inte finnas i två
// exemplar som långsamt glider isär.
//
// Talen i sig skiljer sig åt (listan vill ha utfallets procent, tavlan plan OCH utfall), så typen
// är öppen och rutten en parameter. Allt annat är gemensamt.

/** Id:n per begäran. Under ruttarnas tak (200) med marginal, och lika med listans sidstorlek. */
const CHUNK = 100;

/**
 * Hämtar kalkyltal för de ordrar ytan visar.
 *
 * ⚠️ NYCKELN ÄR EN STRÄNG, INTE ARRAYEN. En array-identitet i beroendelistan byter referens vid
 * varje rendering och ger en oändlig hämtningsloop — samma fälla som planeringstavlan gick i
 * (useMemo räckte inte när identiteten bar korrektheten).
 *
 * ⚠️ BARA DE SOM SAKNAS FRÅGAS. Listan lägger på en sida i taget vid "Visa fler" och tavlan byter
 * vecka; utan det här hade varje steg räknat om alla föregående ordrar på nytt.
 *
 * ⚠️ 403 ÄR INTE ETT FEL. Rutterna gatar på crm.report.read; den som saknar nyckeln ska se märket
 * försvinna, inte ett felmeddelande. Efter ett 403 slutar hooken fråga.
 */
export function useBatchMargins<T>(endpoint: string, workOrderIds: string[], version = '') {
  const [items, setItems] = useState<Record<string, T>>({});
  const [forbidden, setForbidden] = useState(false);
  // Id:n vi redan bett om — även de som svaret inte innehöll, så en order utan kalkyl inte frågas
  // om på nytt vid varje rendering.
  const requestedRef = useRef<Set<string>>(new Set());
  const forbiddenRef = useRef(false);

  const idsKey = workOrderIds.join(',');

  // ⚠️ CACHEN MÅSTE GÅ ATT INVALIDERA. `requestedRef` är append-only och `setItems` slår bara ihop,
  // så utan det här visade ett id sitt FÖRSTA svar för alltid. På arbetsorderlistan märks det inte
  // — man navigerar bort — men planeringstavlan står uppe hela arbetsdagen och laddar om sig själv
  // på realtidshändelser, bland dem `ops_segment_reports`. När besättningen lämnade in
  // egenkontrollen slog säckbadgen om inom en halv sekund medan marginalmärket på samma kort stod
  // kvar på gårdagens svar. `version` bärs av anroparen och beskriver det underlag talen vilar på.
  useEffect(() => {
    requestedRef.current.clear();
  }, [version]);

  const load = useCallback(
    async (ids: string[]) => {
      // ⚠️ ETT MISSLYCKAT ANROP MÅSTE SLÄPPA ID:NA IGEN. De märks som frågade INNAN svaret kommer
      // (annars hade en andra rendering skickat samma begäran en gång till), men glappar nätet vid
      // första sidladdningen hade de hundra första radernas märke aldrig kommit tillbaka under
      // sessionen — även när rutten svarar normalt igen. Ingen loop: effekten körs bara om när
      // id-nyckeln ändras.
      const forget = () => {
        for (const id of ids) requestedRef.current.delete(id);
      };
      try {
        const res = await fetch(endpoint, {
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
        const payload = (json.data?.items || {}) as Record<string, T>;
        // Slås ihop, aldrig ersätts: tidigare sidor och veckor ska stå kvar.
        setItems((prev) => ({ ...prev, ...payload }));
      } catch {
        // Tyst mot användaren — ett uteblivet märke är ett tomt utrymme, inte ett fel som ska
        // larmas om. Men id:na släpps, så nästa filtrering eller vecka försöker igen.
        forget();
      }
    },
    [endpoint],
  );

  useEffect(() => {
    if (forbiddenRef.current) return;
    const ids = idsKey ? idsKey.split(',') : [];
    const missing = ids.filter((id) => id && !requestedRef.current.has(id));
    if (missing.length === 0) return;

    // ⚠️ FÖRDRÖJT. Sökfältet skriver rakt in i filtret utan debounce, så en tioteckens sökning
    // byter träfflista tio gånger. Utan pausen hade var och en av dem startat en egen
    // mängdberäkning — flera frågor över upp till hundra ordrar, med service-role — för ett
    // mellanläge ingen hinner läsa. Pausen gör att bara den lista man stannar på räknas.
    const timer = setTimeout(() => {
      for (const id of missing) requestedRef.current.add(id);
      // ⚠️ DELAS I KLUMPAR. Rutterna avvisar fler än 200 id:n, och `missing` kan växa förbi det:
      // varje misslyckat anrop lämnar tillbaka sina id:n, och två sådana plus en "Visa fler" hade
      // gett en begäran som ALLTID svarar 400 — alltså märken som aldrig kommer tillbaka under
      // sessionen. Klumpar gör den gränsen onåbar i stället för osannolik.
      for (let i = 0; i < missing.length; i += CHUNK) {
        void load(missing.slice(i, i + CHUNK));
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [idsKey, version, load]);

  return { items, forbidden };
}
