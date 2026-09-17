"use client";
import React from 'react';

// Fördröjd fritextsökning efter arbetsordrar, delad av de två modaler som har en sökbar
// ordervalsruta: tidrapportens (app/tid/TimeEntryModal, endpoint /api/time/work-orders) och
// attestens rättelse (app/ekonomi/TimeCorrectionModal, endpoint /api/crm/work-orders).
//
// Delad för att de två kopiorna bar SAMMA latenta bugg (sekvensnumret nedan) — två definitioner av
// "sök order" driver isär vid första rättelsen, och driften är tyst. Hooken äger bara sökningen:
// vilken träff som är VALD hör till formuläret och stannar där.
//
// Anroparen skiljer sig bara i adress och radmappning; båda svaren har formen { ok, data: { items } }.

export type WorkOrderSearchState<T> = {
  query: string;
  setQuery: (value: string) => void;
  hits: T[];
  searching: boolean;
  /** Sant när svaret INTE gick att hämta — skilj det från "noll träffar" i gränssnittet. */
  failed: boolean;
  /** Nollställ ruta, träffar och pågående sökning (t.ex. när datumet byts). */
  reset: () => void;
};

/** Under så här många tecken frågar vi inte: en bokstav matchar halva registret. */
export const MIN_SEARCH_LENGTH = 2;

export function useWorkOrderSearch<T>({
  endpoint,
  map,
  enabled = true,
}: {
  endpoint: string;
  map: (row: any) => T;
  enabled?: boolean;
}): WorkOrderSearchState<T> {
  const [query, setQuery] = React.useState('');
  const [hits, setHits] = React.useState<T[]>([]);
  const [searching, setSearching] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  const seqRef = React.useRef(0);

  // `map` kommer typiskt som en pil i renderingen och byter identitet varje gång. Den läses ur en
  // ref så hooken inte söker om vid varje rendering — deps är avsiktligt bara termen och enabled.
  const mapRef = React.useRef(map);
  mapRef.current = map;

  const reset = React.useCallback(() => {
    // 🧨 Sekvensnumret MÅSTE räknas upp här. Ett svar som redan är i luften hör till den gamla
    // termen; utan uppräkningen landar det efteråt och ritar upp träfflistan igen — under en tom
    // ruta, ovanpå ett jobb användaren just valt. Ett andra tryck i den återuppståndna listan
    // bokar då timmar på en order ingen sökt efter. Båda modalerna hade den luckan.
    seqRef.current += 1;
    setQuery('');
    setHits([]);
    setSearching(false);
    setFailed(false);
  }, []);

  React.useEffect(() => {
    const term = query.trim();
    if (!enabled || term.length < MIN_SEARCH_LENGTH) {
      // Samma skäl som i reset: backar man ned till ett tecken är svaret på vägen inte längre svaret.
      seqRef.current += 1;
      setHits([]);
      setSearching(false);
      setFailed(false);
      return;
    }
    const seq = ++seqRef.current;
    setSearching(true);
    setFailed(false);
    // Fördröjning så en sökning inte skickas per tangenttryck.
    const timer = setTimeout(async () => {
      try {
        // Via URL och inte strängkonkatenering: attestens endpoint bär redan `?limit=8`, och ett
        // andra `?` hade gjort hela frågesträngen till en enda parameter.
        const url = new URL(endpoint, window.location.origin);
        url.searchParams.set('q', term);
        const res = await fetch(`${url.pathname}${url.search}`, {
          cache: 'no-store', credentials: 'same-origin',
        });
        const body = await res.json().catch(() => null);
        if (seq !== seqRef.current) return;
        if (!res.ok || !body?.ok) {
          // Ett 401/403/500 är inte "inga träffar". Sa vi det ändå trodde installatören att jobbet
          // inte var hens och rapporterade dagen som intern tid.
          setHits([]);
          setFailed(true);
          return;
        }
        setHits(((body.data?.items ?? []) as any[]).map((row) => mapRef.current(row)));
      } catch {
        // Utan den här grenen ligger FÖRRA sökningens träffar kvar under den NYA termen.
        if (seq === seqRef.current) { setHits([]); setFailed(true); }
      } finally {
        if (seq === seqRef.current) setSearching(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [endpoint, query, enabled]);

  return { query, setQuery, hits, searching, failed, reset };
}
