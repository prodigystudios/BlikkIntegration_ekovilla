"use client";

import { useCallback, useEffect, useState } from 'react';
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
  // ⚠️ Ett misslyckat anrop får ALDRIG se ut som en tom bok. Utan den här flaggan renderar båda
  // korten "ingen har rapporterat" — ett påstående om JOBBET — när sanningen är att vi inte vet.
  // Det är exakt samma förväxling som "Ej rapporterat" kontra "0 st", och i fältvyn bjuder den
  // dessutom in till en dubblettrapport i en bok man inte kan städa därifrån.
  const [loadError, setLoadError] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/crm/work-orders/${workOrderId}/sack-reports`, { cache: 'no-store' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) { setLoadError(true); return; }
      setReports((json.data?.items || []) as SackReportView[]);
      setHasFinal(Boolean(json.data?.has_final));
      setLoadError(false);
    } catch {
      setLoadError(true);
    } finally {
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

  return { reports, hasFinal, loading, saving, loadError, create, refresh };
}

