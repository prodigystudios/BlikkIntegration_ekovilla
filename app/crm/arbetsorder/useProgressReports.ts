"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { useToast } from '@/lib/Toast';
import type { ProgressReportView } from '@/lib/domains/crm/workOrderProgress';

// Framdriftsrapporter på en arbetsorder — hämtning, rapportering och borttagning.
//
// Samma arbetsfördelning som useSackReports och useWorkOrderFiles: alla toasts ligger HÄR och
// aldrig i komponenten, och mutationen returnerar en boolean så anroparen kan nollställa sitt
// formulär vid framgång.
//
// Radens `can_delete` kommer från servern av samma skäl som i säckboken: regeln bor i RLS (kontoret
// via crm.workorder.write, rapportören via ägarskap + besättning), och en klient som gissade sig
// till den hade ritat en knapp som svarar 403.
//
// ⚠️ INGEN `hasFinal`-MOTSVARIGHET. Säckkortets knapp döljs när egenkontrollen är inlämnad, för då
// vore en delrapport en tyst nolloperation. Framdriften har ingen final som vinner över
// dagsraderna, så det finns ingenting att spärra på — landgång kan byggas på ett återbesök efter
// att egenkontrollen lämnats in.

export type NewProgressEntry = {
  /** Orderradens id, eller null för ett fritextmoment (= rapporterat men inte sålt). */
  line_item_id: string | null;
  /** Bara för fritextmoment — servern ignorerar det för ett kopplat moment. */
  work_item: string | null;
  quantity: number;
  unit: string | null;
};

export function useProgressReports(workOrderId: string) {
  const toast = useToast();
  const [reports, setReports] = useState<ProgressReportView[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // ⚠️ En MÄNGD, inte ett id. Båda korten visar flera rader med varsin knapp, och kontoret som
  // städar två dubbletter i rad hinner mycket väl trycka på nästa medan den förra är i luften. Med
  // ett enda id skrev den andra borttagningen över den första, och när den första svarade
  // nollställdes fältet — alltså låstes den ANDRA radens knapp upp mitt i sin egen begäran.
  const [removingIds, setRemovingIds] = useState<ReadonlySet<string>>(() => new Set());
  const isRemoving = useCallback((id: string) => removingIds.has(id), [removingIds]);
  // ⚠️ Ett misslyckat anrop får ALDRIG se ut som en tom bok. Utan den här flaggan renderar korten
  // "ingen har rapporterat" — ett påstående om JOBBET — när sanningen är att vi inte vet. Samma
  // förväxling som "Ej rapporterat" kontra "0 st".
  const [loadError, setLoadError] = useState(false);

  // ⚠️ Svaren kommer inte nödvändigtvis i frågornas ordning. Två borttagningar i rad ger två
  // omhämtningar, och landar den FÖRSTA sist skriver den tillbaka en lista där den andra raden
  // fortfarande finns. Nästa klick på den svarar då 404 på en rad som faktiskt är borta.
  const refreshSeq = useRef(0);

  const refresh = useCallback(async () => {
    const seq = ++refreshSeq.current;
    const isLatest = () => seq === refreshSeq.current;
    try {
      const res = await fetch(`/api/crm/work-orders/${workOrderId}/progress-reports`, { cache: 'no-store' });
      const json = await res.json().catch(() => ({}));
      if (!isLatest()) return;
      if (!res.ok || !json.ok) { setLoadError(true); return; }
      setReports((json.data?.items || []) as ProgressReportView[]);
      setLoadError(false);
    } catch {
      if (isLatest()) setLoadError(true);
    } finally {
      // Ovillkorligt: `loading` går bara från true till false, och den första hämtningen ska släppa
      // skelettet även om en nyare redan hunnit förbi den.
      setLoading(false);
    }
  }, [workOrderId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const create = useCallback(
    async (input: {
      reportDay: string;
      location: string | null;
      note: string | null;
      entries: NewProgressEntry[];
    }): Promise<boolean> => {
      if (input.entries.length === 0) return false;
      setSaving(true);
      try {
        const res = await fetch(`/api/crm/work-orders/${workOrderId}/progress-reports`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            report_day: input.reportDay,
            location: input.location,
            note: input.note,
            entries: input.entries,
          }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json.ok) {
          // Routens `error` är redan skriven för att läsas av installatören: 409 säger att ordern
          // ändrats och att sidan behöver laddas om, 403 att man inte är inbokad på jobbet.
          toast.error(json?.error || 'Kunde inte spara rapporten');
          return false;
        }
        const saved = (json.data?.items || []) as ProgressReportView[];
        // ⚠️ INGEN SUMMA I BEKRÄFTELSEN. Säckkortet kan säga "55 säckar rapporterade" därför att
        // allt det räknar är säckar; här kan submiten bära 45 m OCH 3 st, och 48 är inget tal.
        // Antalet moment är det enda ärliga kvittot.
        toast.success(saved.length === 1 ? 'Framdrift rapporterad' : `${saved.length} moment rapporterade`);
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
   * Tar bort en felrapporterad rad — kontorets rättning, och rapportörens egen ångerknapp för
   * dubbeltrycket i dålig täckning.
   *
   * Listan hämtas OM efter borttagningen i stället för att raden plockas ur klientens array:
   * gruppernas summor och "av 120"-jämförelsen räknas ur hela listan, och en lokal filtrering hade
   * visat rätt rader med fel summa tills sidan laddades om.
   */
  const remove = useCallback(
    async (id: string): Promise<boolean> => {
      setRemovingIds((current) => new Set(current).add(id));
      try {
        const res = await fetch(`/api/crm/work-orders/${workOrderId}/progress-reports/${id}`, { method: 'DELETE' });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json.ok) {
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

  return { reports, loading, saving, loadError, isRemoving, create, remove, refresh };
}
