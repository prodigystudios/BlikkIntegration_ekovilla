"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { useToast } from '@/lib/Toast';
import { formatSacks } from '@/app/crm/lib/format';
import type { SackReportView } from '@/lib/domains/planning/reports';

// Säckrapporter på en arbetsorder — hämtning och delrapportering.
//
// Samma arbetsfördelning som useWorkOrderFiles: alla toasts ligger HÄR och aldrig i komponenten,
// och mutationen returnerar en boolean så anroparen kan nollställa sitt formulär vid framgång.
//
// `has_final` kommer från servern och inte från en klientsidig koll på raderna. Skälet är att
// spärren MÅSTE vara samma på båda ställena: routen avvisar en delrapport när egenkontrollen är
// inlämnad, och kortet ska dölja knappen av exakt samma anledning. Räknade klienten ut det själv
// kunde de två glida isär, och installatören hade mötts av ett 409 efter att ha stått och skrivit.
//
// Radens `can_delete` bär samma ansvar och kommer av samma skäl från servern: regeln bor i två
// RLS-policyer (kontoret respektive rapportören), och en klient som gissade sig till den hade
// ritat en knapp som svarar 403.

export type NewSackReportEntry = {
  construction: string;
  sacks_blown: number;
  material: string | null;
};

export function useSackReports(workOrderId: string) {
  const toast = useToast();
  const [reports, setReports] = useState<SackReportView[]>([]);
  const [hasFinal, setHasFinal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // ⚠️ En MÄNGD, inte ett id. Båda korten visar flera rader med varsin knapp, och kontoret som
  // städar två dubbletter i rad hinner mycket väl trycka på nästa medan den förra är i luften. Med
  // ett enda id skrev den andra borttagningen över den första — och när den första svarade
  // nollställdes fältet, alltså låstes den ANDRA radens knapp upp mitt i sin egen begäran. Ett
  // extra klick där svarar 404 på en rad som faktiskt togs bort, vilket läser som att något gick
  // fel när ingenting gjorde det.
  const [removingIds, setRemovingIds] = useState<ReadonlySet<string>>(() => new Set());
  const isRemoving = useCallback((id: string) => removingIds.has(id), [removingIds]);
  // ⚠️ Ett misslyckat anrop får ALDRIG se ut som en tom bok. Utan den här flaggan renderar båda
  // korten "ingen har rapporterat" — ett påstående om JOBBET — när sanningen är att vi inte vet.
  // Det är exakt samma förväxling som "Ej rapporterat" kontra "0 st", och i fältvyn bjuder den
  // dessutom in till en dubblettrapport i en bok man inte kan städa därifrån.
  const [loadError, setLoadError] = useState(false);

  // ⚠️ Svaren kommer inte nödvändigtvis i frågornas ordning. Två borttagningar i rad ger två
  // omhämtningar, och landar den FÖRSTA sist skriver den tillbaka en lista där den andra raden
  // fortfarande finns. Nästa klick på den svarar då 404 på en rad som faktiskt är borta — samma
  // felaktiga besked som mängden av pågående borttagningar ovan finns för att slippa.
  //
  // Räknaren är en ref och inte state: den ska inte rendera om något, och en state-uppdatering
  // hade dessutom kommit för sent för svaret som just landat.
  const refreshSeq = useRef(0);

  const refresh = useCallback(async () => {
    const seq = ++refreshSeq.current;
    const isLatest = () => seq === refreshSeq.current;
    try {
      const res = await fetch(`/api/crm/work-orders/${workOrderId}/sack-reports`, { cache: 'no-store' });
      const json = await res.json().catch(() => ({}));
      if (!isLatest()) return;
      if (!res.ok || !json.ok) { setLoadError(true); return; }
      setReports((json.data?.items || []) as SackReportView[]);
      setHasFinal(Boolean(json.data?.has_final));
      setLoadError(false);
    } catch {
      if (isLatest()) setLoadError(true);
    } finally {
      // Ovillkorligt: `loading` går bara från true till false, och den första hämtningen ska
      // släppa skelettet även om en nyare redan hunnit förbi den.
      setLoading(false);
    }
  }, [workOrderId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const create = useCallback(
    async (input: { reportDay: string; note: string | null; entries: NewSackReportEntry[] }): Promise<boolean> => {
      if (input.entries.length === 0) return false;
      setSaving(true);
      try {
        const res = await fetch(`/api/crm/work-orders/${workOrderId}/sack-reports`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ report_day: input.reportDay, note: input.note, entries: input.entries }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json.ok) {
          // Routens `error` är redan skriven för att läsas av installatören — spärren när
          // egenkontrollen finns förklarar varför, och RLS-avslaget säger att man inte är inbokad.
          toast.error(json?.error || 'Kunde inte spara rapporten');
          return false;
        }
        const saved = (json.data?.items || []) as SackReportView[];
        const total = saved.reduce((sum, row) => sum + row.sacks_blown, 0);
        toast.success(total === 1 ? '1 säck rapporterad' : `${formatSacks(total)} säckar rapporterade`);
        await refresh();
        return true;
      } catch {
        toast.error('Kunde inte spara rapporten');
        return false;
      } finally {
        setSaving(false);
      }
    },
    [workOrderId, refresh, toast],
  );

  /**
   * Tar bort en felrapporterad delrapport — kontorets rättning, och rapportörens egen ångerknapp
   * för dubbeltrycket i dålig täckning.
   *
   * Listan hämtas OM efter borttagningen i stället för att raden plockas ur klientens array.
   * Skälet är supersede-regeln: totalen i kortets rubrik beror på vilka rader som finns kvar och
   * vilken sorts rader de är, och den räkningen görs av servern. En lokal filtrering hade visat
   * rätt lista med fel summa tills sidan laddades om.
   */
  const remove = useCallback(
    async (id: string): Promise<boolean> => {
      setRemovingIds((current) => new Set(current).add(id));
      try {
        const res = await fetch(`/api/crm/work-orders/${workOrderId}/sack-reports/${id}`, { method: 'DELETE' });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json.ok) {
          // Routens `error` är skriven för att läsas: 409 förklarar att egenkontrollen rättas på
          // annat sätt, 403 att det är rapportören eller kontoret som får ta bort.
          toast.error(json?.error || 'Kunde inte ta bort rapporten');
          return false;
        }
        toast.success('Rapporten borttagen');
        await refresh();
        return true;
      } catch {
        toast.error('Kunde inte ta bort rapporten');
        return false;
      } finally {
        setRemovingIds((current) => {
          const next = new Set(current);
          next.delete(id);
          return next;
        });
      }
    },
    [workOrderId, refresh, toast],
  );

  return { reports, hasFinal, loading, saving, loadError, isRemoving, create, remove, refresh };
}

