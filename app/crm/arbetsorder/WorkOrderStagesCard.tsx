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
  // Vilken rads inline-bekräftelse som är öppen. Ett id, inte en boolean: annars öppnas frågan på
  // varje etapp samtidigt och man ser inte vilken man svarar om.
  const [confirmId, setConfirmId] = useState<string | null>(null);

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
    // ⚠️ `crm.cardInner`, INTE `crm.card`. Den senare saknar padding helt — sektionen låg dikt mot
    // sin egen ram medan varje syskonkort på sidan (Säckrapporter, Framdrift, Card i
    // WorkOrderDetailClient) har p-3.5. Samma `grid gap-3` som de, så avstånden inuti matchar.
    <div className={cn(crm.cardInner, 'grid gap-3')}>
      {/* `items-baseline` som syskonen: rubriken och knappen ska sitta på samma textlinje, inte
          centreras mot varandras höjder. `<p>` och inte `<h3>` — hela sidan bygger korttitlar med
          crm.cardTitle på ett <p>, och en ensam rubriknivå mitt i det gör strukturen ojämn. */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className={crm.cardTitle}>Etapper</p>
        {canWrite && !loadError && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className={cn(crm.ghostButton, 'shrink-0')}
            disabled={saving || !unallocated}
            title={unallocated ? undefined : 'Hela ordern ligger redan i etapper'}
          >
            Ny etapp
          </button>
        )}
      </div>

      {loadError ? (
        // ⚠️ Aldrig "inga etapper" på ett misslyckat anrop — kortet hade bjudit in till att dela
        // upp en order som redan ÄR uppdelad, och nästa etapp hade dubblerat den första.
        // Bärnsten som i säckspåret: ett fel är inte samma sak som ett tomt läge.
        <p className="m-0 text-sm text-amber-700">Kunde inte läsa etapperna. Ladda om sidan.</p>
      ) : loading ? (
        <p className="m-0 text-sm text-slate-400">Hämtar…</p>
      ) : stages.length === 0 ? (
        <p className={crm.emptyValue}>
          Ordern är inte uppdelad — hela jobbet planeras som ett. Skapa en etapp om bara en del ska utföras nu.
        </p>
      ) : (
        // Vänsterskena, inte en ruta. Kortet är redan bg-[#f9fbf7], så en rad med samma bakgrund
        // syntes knappt — och listan är en LISTA, precis som säckspåret och framdriften.
        <ul className="m-0 grid list-none gap-2.5 p-0">
          {stages.map((stage) => {
            const value = stageValue(lineItems, stage, stages);
            const rader = (stage.line_quantities ?? []).length;
            const jobbtyp = stage.job_type ? jobTypes.find((t) => t.key === stage.job_type)?.label ?? stage.job_type : null;
            return (
              <li key={stage.id} className="grid gap-0.5 border-l-2 border-[#c3d4bc] pl-2.5">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                  <span className="text-sm font-semibold text-slate-900">
                    Etapp {stage.stage_number} · {stage.title}
                  </span>
                  <span className="text-sm font-semibold tabular-nums text-slate-900">
                    {formatCurrency(value.revenue, currencyCode)}
                  </span>
                </div>
                <span className="text-xs text-slate-500">
                  {[value.sacks > 0 ? `${value.sacks} säck` : null, `${rader} rad${rader === 1 ? '' : 'er'}`, jobbtyp]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
                {stage.work_description && (
                  <span className="whitespace-pre-wrap text-sm text-slate-700">{stage.work_description}</span>
                )}
                {canWrite && (
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                    <button type="button" onClick={() => setEditing(stage)} className={crm.ghostButton} disabled={saving}>
                      Ändra
                    </button>
                    {/* Bekräftelsen är INLINE och per rad — samma mönster som säckspåret, filerna och
                        kommentarerna på ordern: frågan ställs där raden står, så man ser VILKEN
                        etapp man tar bort medan man svarar. Modalen längre ner är något annat: den
                        visas bara när servern svarar 409, alltså när etappen är utplacerad och
                        borttagningen får en följd som inte får plats i ett inline-ja. */}
                    {confirmId === stage.id ? (
                      <>
                        <span className="text-slate-500">Ta bort?</span>
                        <button
                          type="button"
                          onClick={() => {
                            setConfirmId(null);
                            void requestRemove(stage);
                          }}
                          className={cn(crm.ghostButton, 'border-rose-200 text-rose-600 hover:border-rose-300 hover:text-rose-700')}
                          disabled={saving}
                        >
                          Ja
                        </button>
                        <button type="button" onClick={() => setConfirmId(null)} className={crm.ghostButton} disabled={saving}>
                          Avbryt
                        </button>
                      </>
                    ) : (
                      <button type="button" onClick={() => setConfirmId(stage.id)} className={crm.ghostButton} disabled={saving}>
                        Ta bort
                      </button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {!loadError && !loading && stages.length > 0 && unallocated && (
        <p className="m-0 text-xs text-slate-500">
          Delar av ordern ligger utanför etapperna. De planeras som &quot;resten&quot; i planeringen.
        </p>
      )}

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
                  line_quantities: editing.line_quantities,
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
    </div>
  );
}
