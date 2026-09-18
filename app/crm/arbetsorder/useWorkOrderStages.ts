"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { useToast } from '@/lib/Toast';
import type { StageLineState, WorkOrderStage } from '@/lib/domains/crm/workOrderStages';
import type { StageDraft } from './WorkOrderStageModal';

// Etapper på en arbetsorder — hämtning, skapande, ändring och borttagning.
//
// Samma arbetsfördelning som useProgressReports och useSackReports: alla toasts ligger HÄR och
// aldrig i komponenten, och mutationerna returnerar en boolean så anroparen kan stänga sin modal
// först vid framgång.

export type StageView = WorkOrderStage & {
  work_description: string | null;
  job_type: string | null;
  created_by_name: string | null;
  created_at: string;
};

export function useWorkOrderStages(workOrderId: string) {
  const toast = useToast();
  const [stages, setStages] = useState<StageView[]>([]);
  // Radläget räknat på SERVERN, mot orderns aktuella rader och alla etapper. Editorn klampar mot
  // det; räknades det i klienten hade det blivit en andra implementation av computeStageState.
  const [lineState, setLineState] = useState<StageLineState[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // ⚠️ Ett misslyckat anrop får ALDRIG se ut som "ordern har inga etapper". Kortet hade då erbjudit
  // "Dela upp ordern" på en order som redan ÄR uppdelad, och nästa etapp hade dubblerat den första.
  const [loadError, setLoadError] = useState(false);

  // Ordningsräknare: ett långsamt svar får inte skriva över ett nyare. Samma mönster som
  // säckrapporternas omhämtningar.
  const seq = useRef(0);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    setLoading(true);
    try {
      const r = await fetch(`/api/crm/work-orders/${workOrderId}/stages`);
      const j = await r.json();
      if (mine !== seq.current) return;
      if (!j.ok) {
        setLoadError(true);
        return;
      }
      setLoadError(false);
      setStages((j.data?.items ?? []) as StageView[]);
      setLineState((j.data?.line_state ?? []) as StageLineState[]);
    } catch {
      if (mine === seq.current) setLoadError(true);
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [workOrderId]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = useCallback(
    async (draft: StageDraft): Promise<boolean> => {
      setSaving(true);
      try {
        const r = await fetch(`/api/crm/work-orders/${workOrderId}/stages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(draft),
        });
        const j = await r.json();
        if (!j.ok) {
          toast.error(j.error || 'Kunde inte skapa etappen');
          return false;
        }
        toast.success('Etapp skapad');
        await load();
        return true;
      } finally {
        setSaving(false);
      }
    },
    [workOrderId, toast, load],
  );

  const update = useCallback(
    async (stageId: string, draft: Partial<StageDraft>): Promise<boolean> => {
      setSaving(true);
      try {
        const r = await fetch(`/api/crm/work-orders/${workOrderId}/stages/${stageId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(draft),
        });
        const j = await r.json();
        if (!j.ok) {
          toast.error(j.error || 'Kunde inte spara etappen');
          return false;
        }
        toast.success('Etapp sparad');
        await load();
        return true;
      } finally {
        setSaving(false);
      }
    },
    [workOrderId, toast, load],
  );

  /**
   * Ta bort en etapp.
   *
   * ⚠️ TVÅ STEG NÄR ETAPPEN ÄR UTPLACERAD. Servern svarar 409 med hur många placeringar som berörs,
   * och anroparen måste bekräfta innan `force` skickas. Placeringarna ligger kvar men blir
   * rest-scopade, så kortens säckantal HOPPAR — det ska vara ett medvetet val, inte en
   * överraskning. Returnerar 409-beskedet så anroparen kan visa det i sin bekräftelseruta.
   */
  const remove = useCallback(
    async (stageId: string, force = false): Promise<{ ok: true } | { ok: false; needsConfirm: boolean; message: string }> => {
      setSaving(true);
      try {
        const r = await fetch(`/api/crm/work-orders/${workOrderId}/stages/${stageId}${force ? '?force=1' : ''}`, {
          method: 'DELETE',
        });
        const j = await r.json();
        if (!j.ok) {
          const needsConfirm = j.errorDetails?.code === 'crm_work_order_stage_has_segments';
          // Toasta INTE när det är en bekräftelsefråga — anroparen visar den i en ruta i stället.
          if (!needsConfirm) toast.error(j.error || 'Kunde inte ta bort etappen');
          return { ok: false, needsConfirm, message: j.error || 'Kunde inte ta bort etappen' };
        }
        const released = j.data?.released_segments ?? 0;
        toast.success(
          released > 0
            ? `Etappen borttagen. ${released} placering${released > 1 ? 'ar' : ''} visar nu resten av ordern.`
            : 'Etapp borttagen',
        );
        await load();
        return { ok: true };
      } finally {
        setSaving(false);
      }
    },
    [workOrderId, toast, load],
  );

  return { stages, lineState, loading, saving, loadError, reload: load, create, update, remove };
}
