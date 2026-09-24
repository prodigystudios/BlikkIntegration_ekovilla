"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { useToast } from '@/lib/Toast';
import type { KmaDirectoryEntry, KmaPrefill } from '@/lib/domains/crm/kmaPlans/prefill';
import type { KmaFormValues } from '@/lib/domains/crm/kmaPlans/types';

// KMA-planerna på en arbetsorder — listan, förifyllnaden och sparandet av en ny revision.
//
// Samma arbetsfördelning som useProgressReports: alla toasts ligger HÄR och aldrig i komponenten,
// och en misslyckad hämtning är ett eget läge — aldrig en tom lista. "Ingen KMA-plan ännu" är ett
// påstående om ordern; ett laddfel säger bara att vi inte vet.
//
// `canCreate` kommer från SERVERN (crm.workorder.write, samma nyckel som insert-policyn). Kortet
// gatar dessutom på sin egen `canEdit` — ekonomins läsvy visar listan men aldrig knapparna.

export type KmaPlanItem = {
  id: string;
  revision: number;
  issued_on: string;
  project_name: string;
  created_by_name: string;
  created_at: string;
  pdf_url: string;
};

export type KmaPrefillResponse = KmaPrefill & {
  directory: KmaDirectoryEntry[];
  /** null = planeringen kunde inte läsas; 0 = läst, ingen besättning. */
  crew_count: number | null;
};

export function useKmaPlans(workOrderId: string) {
  const toast = useToast();
  const [items, setItems] = useState<KmaPlanItem[]>([]);
  const [canCreate, setCanCreate] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);

  // Svaren kommer inte nödvändigtvis i frågornas ordning — en äldre hämtning som landar sist får
  // inte skriva tillbaka en lista utan den revision som just sparades.
  const refreshSeq = useRef(0);

  const refresh = useCallback(async () => {
    const seq = ++refreshSeq.current;
    const isLatest = () => seq === refreshSeq.current;
    try {
      const res = await fetch(`/api/crm/work-orders/${workOrderId}/kma-plans`, { cache: 'no-store' });
      const json = await res.json().catch(() => ({}));
      if (!isLatest()) return;
      if (!res.ok || !json.ok) {
        setLoadError(true);
        return;
      }
      setItems((json.data?.items || []) as KmaPlanItem[]);
      setCanCreate(json.data?.can_create === true);
      setLoadError(false);
    } catch {
      if (isLatest()) setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [workOrderId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** Dialogens startvärden. null = gick inte att hämta (toasten är redan visad). */
  const loadPrefill = useCallback(
    async (salesName: string | null): Promise<KmaPrefillResponse | null> => {
      try {
        const query = salesName ? `?sales_name=${encodeURIComponent(salesName.slice(0, 120))}` : '';
        const res = await fetch(`/api/crm/work-orders/${workOrderId}/kma-plans/prefill${query}`, { cache: 'no-store' });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json.ok) {
          toast.error(json?.error || 'Kunde inte förbereda KMA-planen');
          return null;
        }
        return json.data as KmaPrefillResponse;
      } catch {
        toast.error('Kunde inte förbereda KMA-planen');
        return null;
      }
    },
    [workOrderId, toast],
  );

  /** Sparar en ny revision. Svarar med adressen och filnamnet så dialogen kan ladda ned den. */
  const create = useCallback(
    async (form: KmaFormValues): Promise<{ pdfUrl: string; filename: string; revision: number } | null> => {
      setSaving(true);
      try {
        const res = await fetch(`/api/crm/work-orders/${workOrderId}/kma-plans`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(form),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json.ok) {
          // Routens `error` är skriven för att läsas: 409 säger att någon annan sparade samtidigt.
          toast.error(json?.error || 'Kunde inte spara KMA-planen');
          return null;
        }
        const item = json.data?.item as KmaPlanItem;
        toast.success(`KMA-planen sparad, revision ${item.revision}`);
        await refresh();
        return { pdfUrl: json.data.pdf_url as string, filename: json.data.filename as string, revision: item.revision };
      } catch {
        toast.error('Kunde inte spara KMA-planen');
        return null;
      } finally {
        setSaving(false);
      }
    },
    [workOrderId, refresh, toast],
  );

  return { items, canCreate, loading, loadError, saving, refresh, loadPrefill, create };
}
