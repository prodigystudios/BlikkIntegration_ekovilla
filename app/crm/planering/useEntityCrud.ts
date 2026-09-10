'use client';

import { useCallback, useEffect, useState } from 'react';
import { useToast } from '@/lib/Toast';

type WithId = { id: string };

// Shared CRUD-over-a-REST-collection for the planning management modals (bilar/jobbtyper/depåer).
// Each modal owns its field-row JSX + "add new" form; this owns the duplicated machine:
// load(no-store) → list state, optimistic patchLocal, save (PATCH /{id}), remove (DELETE /{id}),
// add (POST), plus loading/busy and the {ok,data,error} envelope handling + toasts.
//
// save/remove/add resolve to a success signal so the caller can fire its own onChanged() refresh.
export function useEntityCrud<T extends WithId>(opts: {
  api: string; // collection endpoint, e.g. /api/crm/planering/trucks
  listKey: string; // key under {data} holding the array, e.g. 'trucks'
  itemKey?: string; // key under {data} for a created row (default 'item')
  toPayload: (item: T) => unknown; // PATCH body built from an edited row
  labels?: { saved?: string; saveFail?: string; removeFail?: string; addFail?: string };
}) {
  const toast = useToast();
  const itemKey = opts.itemKey ?? 'item';
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  // 🧨 ETT FEL FÅR INTE SE UT SOM ETT TOMT REGISTER. Läsningen sväljer sitt fel (403, nätverksfel,
  // 500), och då står `items` kvar på [] med `loading` false — vilket en panel som skriver "Inga X
  // upplagda än" renderar som ett PÅSTÅENDE OM VERKLIGHETEN, byggt på att vi inte vet. Samma
  // felklass som StockPanel redan har en egen gren för ("Lagersaldot kunde inte räknas ut").
  //
  // Additivt: panelerna som inte läser fältet beter sig exakt som förut.
  const [loadError, setLoadError] = useState<string | null>(null);

  // Utbruten ur effekten så den kan köras om efter en NEKAD skrivning. Se `reload` nedan.
  const load = useCallback(async (): Promise<void> => {
    try {
      const r = await fetch(opts.api, { cache: 'no-store' });
      const j = await r.json();
      if (j.ok) {
        setItems(j.data[opts.listKey] as T[]);
        setLoadError(null);
      } else {
        setLoadError(j.error || 'Kunde inte hämta listan');
      }
    } catch {
      setLoadError('Kunde inte hämta listan');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.api, opts.listKey]);

  useEffect(() => {
    let active = true;
    load().finally(() => {
      if (active) setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [load]);

  /**
   * Hämta om listan från servern och kasta det lokala utkastet.
   *
   * 🧨 FINNS FÖR ATT EN NEKAD SPARNING ANNARS SER UT SOM EN LYCKAD. `patchLocal` skriver
   * optimistiskt vid varje tangenttryck. Failar PATCH:en visas bara en övergående toast — den
   * lokala raden står kvar och visar precis det tillstånd databasen just vägrade, tills modalen
   * avmonteras. Läsaren har ingen väg att se skillnaden.
   *
   * Blev nåbart i och med leverantörsregistret: det är första entiteten i den här modalen vars
   * sparning kan nekas av en DATABASREGEL (unikt namnindex bland aktiva). Depåer och bilar har inga
   * unika index, och jobbtypens PATCH skickar aldrig den unika `key`-kolumnen.
   */
  const reload = load;

  function patchLocal(id: string, patch: Partial<T>) {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }

  async function save(item: T): Promise<boolean> {
    setBusy(true);
    try {
      const r = await fetch(`${opts.api}/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(opts.toPayload(item)),
      });
      const j = await r.json();
      if (!j.ok) {
        toast.error(j.error || opts.labels?.saveFail || 'Kunde inte spara');
        return false;
      }
      toast.success(opts.labels?.saved || 'Sparad');
      return true;
    } catch {
      // ⚠️ `try/finally` UTAN `catch` gjorde ett nätverksfel (eller ett svar som inte är JSON) helt
      // tyst: felet kastades vidare till en anropare som inte fångar det, knappen tändes igen av
      // `finally` och ingenting sades. Tystnad efter ett tryck läses som "sparat" — och bjuder
      // dessutom in till ett andra tryck.
      toast.error(opts.labels?.saveFail || 'Kunde inte spara');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string): Promise<boolean> {
    setBusy(true);
    try {
      const r = await fetch(`${opts.api}/${id}`, { method: 'DELETE' });
      const j = await r.json();
      if (!j.ok) {
        toast.error(j.error || opts.labels?.removeFail || 'Kunde inte ta bort');
        return false;
      }
      setItems((prev) => prev.filter((it) => it.id !== id));
      return true;
    } catch {
      // Samma tystnad som i save — och här är den värre: raden står kvar i listan, vilket är exakt
      // vad man ser om ingenting hände OCH exakt vad man ser om borttagningen misslyckades.
      toast.error(opts.labels?.removeFail || 'Kunde inte ta bort');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function add(payload: unknown): Promise<T | null> {
    setBusy(true);
    try {
      const r = await fetch(opts.api, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const j = await r.json();
      if (!j.ok) {
        toast.error(j.error || opts.labels?.addFail || 'Kunde inte lägga till');
        return null;
      }
      const created = j.data[itemKey] as T;
      setItems((prev) => [...prev, created]);
      return created;
    } catch {
      // 🧨 Farligast av de tre: ett nätverksfel EFTER att requesten gått iväg kan mycket väl ha
      // skapat raden. Utan besked står formuläret kvar ifyllt, och nästa tryck ger en dubblett som
      // ingen kan se förrän listan laddas om.
      toast.error(opts.labels?.addFail || 'Kunde inte lägga till');
      return null;
    } finally {
      setBusy(false);
    }
  }

  return { items, setItems, loading, loadError, busy, reload, patchLocal, save, remove, add };
}
