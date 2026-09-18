"use client";

import { useEffect, useMemo, useState } from 'react';
import { crm } from '@/app/crm/lib/crmTokens';
import { cn } from '@/lib/shared/cn';
import { formatCurrency } from '@/app/crm/lib/format';
import { lineItemRowTotal } from '@/lib/domains/crm/pricing';
import { totalSacks } from '@/lib/domains/crm/materials';
import { scopeLineItems, type StageLineItem } from '@/lib/domains/crm/workOrderStages';
import { DEFAULT_JOB_TYPES } from '@/lib/domains/planning/jobTypes';
import WorkOrderStageModal, { type StageDraft } from './WorkOrderStageModal';
import CrmConfirmDialog from '@/app/crm/components/CrmConfirmDialog';
import { useWorkOrderStages, type StageView } from './useWorkOrderStages';

// Kontorets etappkort: dela upp en order som ska utföras i omgångar.
//
// ⚠️ ORDVALET. "Etapp" här är en TIDSETAPP — vad som görs nu och vad som görs senare. I
// egenkontrollen betyder "etapp" en KONSTRUKTIONSDEL (vind, vägg). Se
// lib/domains/crm/workOrderStages.ts.

function stageValue(lineItems: StageLineItem[], stage: StageView, siblings: StageView[]) {
  const scoped = scopeLineItems(lineItems, { kind: 'stage', stage, siblings });
  return {
    revenue: scoped.reduce((sum, r) => sum + lineItemRowTotal(r as never), 0),
    sacks: totalSacks(scoped as never),
  };
}

/**
 * Jobbtyperna, med DEFAULT_JOB_TYPES som reserv.
 *
 * ⚠️ FAILAR ÖPPET, och det är rätt här. Listan ligger bakom planning.schedule.read, som kontoret
 * inte nödvändigtvis bär — och jobbtypen är ett VALFRITT fält som ärvs till placeringen. Att låta
 * hela etappkortet falla för att en valfri rullista inte gick att läsa vore en sämre affär. Samma
 * fallback som planeringstavlan använder innan listan laddat.
 */
function useJobTypes(): Array<{ key: string; label: string }> {
  const [types, setTypes] = useState<Array<{ key: string; label: string }>>(DEFAULT_JOB_TYPES);
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const r = await fetch('/api/crm/planering/job-types', { cache: 'no-store' });
        const j = await r.json();
        if (!alive || !j.ok) return;
        const active = (j.data?.jobTypes ?? []) as Array<{ key: string; label: string; active: boolean }>;
        if (active.length > 0) setTypes(active.filter((t) => t.active).map((t) => ({ key: t.key, label: t.label })));
      } catch {
        /* reserven står kvar */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);
  return types;
}

export default function WorkOrderStagesCard({
  workOrderId,
  lineItems,
  currencyCode,
  canWrite,
}: {
  workOrderId: string;
  lineItems: StageLineItem[];
  currencyCode: string;
  canWrite: boolean;
}) {
  const jobTypes = useJobTypes();
  const { stages, lineState, loading, saving, loadError, create, update, remove } = useWorkOrderStages(workOrderId);
  const [editing, setEditing] = useState<StageView | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<{ stage: StageView; message: string } | null>(null);

  const unallocated = useMemo(() => lineState.some((s) => s.unallocated > 0), [lineState]);

  // Vad som är kvar när den etapp som REDIGERAS räknas bort — annars kan man inte spara den orörd.
  // Servern gör samma sak med excludeStageId; det här är bara editorns klampning.
  const editingLineState = useMemo(() => {
    if (!editing) return lineState;
    const own = new Map((editing.line_quantities ?? []).map((q) => [q.line_id, q.quantity]));
    return lineState.map((s) => {
      const mine = s.lineId ? own.get(s.lineId) ?? 0 : 0;
      const allocated = Math.max(0, s.allocated - mine);
      return { ...s, allocated, unallocated: Math.max(0, s.total - allocated) };
    });
  }, [editing, lineState]);

  async function submit(draft: StageDraft) {
    const ok = editing ? await update(editing.id, draft) : await create(draft);
    if (ok) {
      setEditing(null);
      setCreating(false);
    }
  }

  async function requestRemove(stage: StageView) {
    const res = await remove(stage.id);
    // 409 = etappen är utplacerad. Fråga först; se useWorkOrderStages.remove.
    if (!res.ok && res.needsConfirm) setConfirmRemove({ stage, message: res.message });
  }

  return (
    <section className={crm.card}>
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className={crm.cardTitle}>Etapper</h3>
          <p className="mt-0.5 text-[11px] text-slate-500">
            Dela upp ordern när den ska utföras vid flera tillfällen. Planeringen bokar en etapp i taget.
          </p>
        </div>
        {canWrite && !loadError && (
          <button type="button" onClick={() => setCreating(true)} className={cn(crm.ghostButton, 'shrink-0')} disabled={saving || !unallocated}>
            Ny etapp
          </button>
        )}
      </div>

      <div className="mt-3 grid gap-2">
        {loadError ? (
          // ⚠️ Aldrig "inga etapper" på ett misslyckat anrop — kortet hade bjudit in till att dela
          // upp en order som redan ÄR uppdelad, och nästa etapp hade dubblerat den första.
          <p className={crm.emptyValue}>Kunde inte läsa etapperna. Ladda om sidan.</p>
        ) : loading ? (
          <p className={crm.emptyValue}>Laddar…</p>
        ) : stages.length === 0 ? (
          <p className={crm.emptyValue}>
            Ordern är inte uppdelad — hela jobbet planeras som ett. Skapa en etapp om bara en del ska utföras nu.
          </p>
        ) : (
          stages.map((stage) => {
            const value = stageValue(lineItems, stage, stages);
            return (
              <div key={stage.id} className="rounded-xl border border-[#e0e8dc] bg-[#f9fbf7] p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-sm font-semibold text-slate-800">
                    Etapp {stage.stage_number} · {stage.title}
                  </span>
                  <span className="text-sm tabular-nums text-slate-700">{formatCurrency(value.revenue, currencyCode)}</span>
                </div>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  {value.sacks > 0 ? `${value.sacks} säck · ` : ''}
                  {(stage.line_quantities ?? []).length} rad{(stage.line_quantities ?? []).length === 1 ? '' : 'er'}
                  {stage.job_type ? ` · ${jobTypes.find((t) => t.key === stage.job_type)?.label ?? stage.job_type}` : ''}
                </p>
                {stage.work_description && (
                  <p className="mt-1 whitespace-pre-wrap text-[11px] text-slate-600">{stage.work_description}</p>
                )}
                {canWrite && (
                  <div className="mt-2 flex items-center gap-2">
                    <button type="button" onClick={() => setEditing(stage)} className={crm.ghostButton} disabled={saving}>
                      Ändra
                    </button>
                    <button type="button" onClick={() => void requestRemove(stage)} className={crm.dangerButton} disabled={saving}>
                      Ta bort
                    </button>
                  </div>
                )}
              </div>
            );
          })
        )}

        {!loadError && !loading && stages.length > 0 && unallocated && (
          <p className="text-[11px] text-slate-500">
            Delar av ordern ligger utanför etapperna. De planeras som &quot;resten&quot; i planeringen.
          </p>
        )}
      </div>

      {(creating || editing) && (
        <WorkOrderStageModal
          lineItems={lineItems}
          lineState={editing ? editingLineState : lineState}
          jobTypes={jobTypes}
          currencyCode={currencyCode}
          editing={
            editing
              ? {
                  stage_number: editing.stage_number,
                  title: editing.title,
                  work_description: editing.work_description,
                  job_type: editing.job_type,
                }
              : null
          }
          submitting={saving}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSubmit={submit}
        />
      )}

      {confirmRemove && (
        <CrmConfirmDialog
          title={`Ta bort etapp ${confirmRemove.stage.stage_number} ändå?`}
          message={confirmRemove.message}
          confirmLabel="Ta bort etappen"
          tone="danger"
          busy={saving}
          onCancel={() => setConfirmRemove(null)}
          onConfirm={() => {
            const stage = confirmRemove.stage;
            setConfirmRemove(null);
            void remove(stage.id, true);
          }}
        />
      )}
    </section>
  );
}
