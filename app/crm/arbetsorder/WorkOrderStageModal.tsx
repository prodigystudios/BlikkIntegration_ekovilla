"use client";

import { useMemo, useState } from 'react';
import CrmModal from '@/app/crm/components/CrmModal';
import Input from '../../../components/ui/Input';
import { crm } from '@/app/crm/lib/crmTokens';
import { cn } from '@/lib/shared/cn';
import { lineItemEffectiveUnitPrice } from '@/lib/domains/crm/pricing';
import { parseDecimal } from '@/lib/shared/number';
import { formatCurrency } from '@/app/crm/lib/format';
import type { StageLineQuantity, StageLineState } from '@/lib/domains/crm/workOrderStages';

// Etappeditorn. Formen är delfakturamodalens, med flit: samma fråga ställs — hur mycket av varje rad
// hör till den här omgången — och planeraren känner igen den.
//
// ⚠️ RADLÄGET KOMMER FRÅN SERVERN (`GET /stages` svarar med `line_state`). Räknades "kvar att
// planera" här hade det blivit en andra implementation av computeStageState, och de två hade glidit
// isär precis som veckosummorna gjorde. Klienten klampar mot serverns tal; servern validerar ändå.

export type StageLineItem = {
  id?: string | null;
  article_name?: string | null;
  article_unit_name?: string | null;
  line_note?: string | null;
  unit_price?: string | null;
  article_price?: number | null;
  discount_percent?: string | null;
  written_off?: boolean | null;
};

export type StageDraft = {
  title: string;
  line_quantities: StageLineQuantity[];
  work_description: string | null;
  job_type: string | null;
};

const roundQty = (n: number) => Math.round(n * 1e6) / 1e6;
const fmtQty = (n: number) => String(Math.round(n * 1000) / 1000);

export default function WorkOrderStageModal({
  lineItems,
  lineState,
  jobTypes,
  currencyCode,
  editing,
  submitting,
  onClose,
  onSubmit,
}: {
  lineItems: StageLineItem[];
  /** Per rad: totalt, taget av etapper, kvar. Serverns tal — se modulhuvudet. */
  lineState: StageLineState[];
  jobTypes: Array<{ key: string; label: string }>;
  currencyCode: string;
  /** Etappen som redigeras. `lineState` ska då vara räknat med excludeStageId. */
  editing: {
    stage_number: number;
    title: string;
    work_description: string | null;
    job_type: string | null;
    /** Etappens egna antal — förifyller formuläret. Se kommentaren vid `inputs`. */
    line_quantities: StageLineQuantity[] | null;
  } | null;
  submitting: boolean;
  onClose: () => void;
  onSubmit: (draft: StageDraft) => void;
}) {
  const [title, setTitle] = useState(editing?.title ?? '');
  const [workDescription, setWorkDescription] = useState(editing?.work_description ?? '');
  const [jobType, setJobType] = useState(editing?.job_type ?? '');

  const rows = useMemo(() => {
    // ⚠️ PARAS PÅ RADENS ID, inte på arrayposition. `lineState` hämtas en gång från servern medan
    // `lineItems` är orderns levande rader; raderas eller läggs en rad till i artikelfliken utan att
    // etapperna hämtas om, visade indexparningen ett artikelnamn bredvid en ANNAN rads rest.
    const byLineId = new Map(lineState.filter((s) => s.lineId).map((s) => [s.lineId as string, s]));
    return (
      lineItems.map((item, index) => {
        const state = item.id ? byLineId.get(item.id) : undefined;
        return {
          index,
          item,
          lineId: item.id ?? null,
          total: state?.total ?? 0,
          allocated: state?.allocated ?? 0,
          // En avskriven rad har inget att planera — computeStageState har redan nollat den, men
          // flaggan styr också om raden gråas ut och får ett eget besked.
          unallocated: state?.unallocated ?? 0,
          writtenOff: !!item.written_off,
        };
      })
    );
  }, [lineItems, lineState]);

  // ⚠️ TOMT SOM STARTVÄRDE VID NY ETAPP, inte "allt som är kvar". Delfakturan förifyller med resten
  // eftersom en faktura nästan alltid tar det som är kvar. En etapp är motsatsen: den finns för att
  // man ska plocka ut en DEL. Ett förifyllt fält hade gjort "hela ordern" till det lätta svaret.
  //
  // 🧨 VID REDIGERING FÖRIFYLLS ETAPPENS EGNA ANTAL. Utan det var etappen omöjlig att byta namn på
  // (Spara låg låst, eftersom inget antal var ifyllt), och skrev man in EN rad skickades bara den —
  // PATCH ersätter line_quantities, så etappens övriga rader försvann TYST. Formuläret måste visa
  // hela det som sparas om.
  const [inputs, setInputs] = useState<Record<number, string>>(() => {
    if (!editing) return {};
    const own = new Map((editing.line_quantities ?? []).map((q) => [q.line_id, q.quantity]));
    const seeded: Record<number, string> = {};
    lineItems.forEach((item, index) => {
      const q = item.id ? own.get(item.id) : undefined;
      if (q != null && q > 0) seeded[index] = fmtQty(q);
    });
    return seeded;
  });

  const picked = rows.map((r) => {
    const requested = Math.max(0, parseDecimal(inputs[r.index] ?? '0'));
    const quantity = Math.min(r.unallocated, roundQty(requested));
    return { ...r, quantity, amount: quantity * lineItemEffectiveUnitPrice(r.item) };
  });

  const grandTotal = picked.reduce((sum, p) => sum + p.amount, 0);
  const anyPositive = picked.some((p) => p.quantity > 0);
  const anyAvailable = rows.some((r) => r.unallocated > 0);
  const canSave = anyPositive && title.trim().length > 0;

  function submit() {
    onSubmit({
      title: title.trim(),
      line_quantities: picked
        .filter((p) => p.quantity > 0 && p.lineId)
        .map((p) => ({ line_id: p.lineId as string, quantity: p.quantity })),
      work_description: workDescription.trim() || null,
      job_type: jobType.trim() || null,
    });
  }

  return (
    <CrmModal
      onClose={onClose}
      ariaLabel={editing ? 'Ändra etapp' : 'Ny etapp'}
      maxWidth="sm:max-w-[680px]"
      header={
        <div>
          <p className={crm.pageTitle}>{editing ? `Ändra etapp ${editing.stage_number}` : 'Ny etapp'}</p>
          <p className="mt-0.5 text-xs text-slate-500">
            Välj vad som ska utföras i den här omgången. Resten ligger kvar och kan planeras separat.
          </p>
        </div>
      }
      footer={
        <>
          <button type="button" onClick={onClose} className={cn(crm.ghostButton, 'ml-auto')} disabled={submitting}>
            Avbryt
          </button>
          <button type="button" onClick={submit} disabled={submitting || !canSave} className={cn(crm.saveButton, 'h-9 w-auto px-4')}>
            {submitting ? 'Sparar…' : editing ? 'Spara etapp' : 'Skapa etapp'}
          </button>
        </>
      }
    >
      <div className="grid gap-3">
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="grid gap-1">
            <span className={crm.label}>Namn</span>
            <Input
              value={title}
              disabled={submitting}
              placeholder="t.ex. Snedtak"
              onChange={(e) => setTitle(e.target.value)}
              aria-label="Etappens namn"
            />
          </label>
          <label className="grid gap-1">
            <span className={crm.label}>Jobbtyp (valfritt)</span>
            <select
              value={jobType}
              disabled={submitting}
              onChange={(e) => setJobType(e.target.value)}
              className={crm.input}
              aria-label="Jobbtyp"
            >
              <option value="">Ärvs från ordern</option>
              {jobTypes.map((t) => (
                <option key={t.key} value={t.key}>{t.label}</option>
              ))}
            </select>
          </label>
        </div>

        <label className="grid gap-1">
          <span className={crm.label}>Arbetsbeskrivning för etappen (valfritt)</span>
          <textarea
            value={workDescription}
            disabled={submitting}
            rows={2}
            placeholder="t.ex. Snedtaket, börja från gaveln"
            onChange={(e) => setWorkDescription(e.target.value)}
            className={cn(crm.input, 'min-h-[56px] py-2')}
            aria-label="Arbetsbeskrivning för etappen"
          />
          <span className="text-[11px] text-slate-400">
            Följer med till placeringen på kalendern och är det besättningen läser i fält.
          </span>
        </label>

        {rows.length === 0 ? (
          <p className={crm.emptyValue}>Arbetsordern saknar artiklar att dela upp.</p>
        ) : !anyAvailable ? (
          <p className={crm.emptyValue}>Hela ordern ligger redan i etapper.</p>
        ) : (
          picked.map((p) => {
            const name = p.item.article_name || p.item.line_note || 'Artikel';
            const unit = p.item.article_unit_name || '';
            const done = p.unallocated <= 0;
            return (
              <div
                key={p.index}
                className={cn(
                  'grid gap-2 rounded-xl border border-[#e0e8dc] bg-[#f9fbf7] p-3 sm:grid-cols-[1fr,auto]',
                  done && 'opacity-60',
                )}
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-800">{name}</p>
                  <p className="mt-0.5 text-[11px] text-slate-500">
                    {p.writtenOff
                      ? 'Avskriven rad — ingenting att planera'
                      : `Totalt ${fmtQty(p.total)} ${unit} · I etapper ${fmtQty(p.allocated)} · Kvar ${fmtQty(p.unallocated)} ${unit}`}
                  </p>
                </div>
                <div className="flex items-center gap-2 sm:justify-end">
                  <div className="w-24">
                    <Input
                      inputMode="decimal"
                      value={inputs[p.index] ?? ''}
                      disabled={done || submitting}
                      placeholder="0"
                      onChange={(e) => setInputs((prev) => ({ ...prev, [p.index]: e.target.value }))}
                      // 🧨 KLAMPAR VID BLUR, så fältet aldrig visar ett tal som inte sparas.
                      // Matten klampade redan (`Math.min(unallocated, …)`), men rutan stod kvar på
                      // det man skrev: 999 i en rad med 18 kvar gav "10 080 kr" bredvid en ruta som
                      // sa 999. Den som inte räknar i huvudet ser inte att det kapades.
                      //
                      // Vid blur och inte vid varje tangenttryck: klampning under skrivningen
                      // skriver om siffran mitt i inmatningen ("18" blir det man får när man skriver
                      // det andra tecknet i "19"), vilket är värre än problemet.
                      //
                      // ⚠️ Delfakturamodalen har samma brist — dess egen kommentar säger "clamps
                      // input to [0, remaining]" men den klampar bara matten. Egen ändring.
                      onBlur={() => {
                        const raw = inputs[p.index] ?? '';
                        if (raw.trim() === '') return;
                        if (parseDecimal(raw) <= p.unallocated) return;
                        setInputs((prev) => ({ ...prev, [p.index]: fmtQty(p.unallocated) }));
                      }}
                      aria-label={`Antal i etappen (${name})`}
                    />
                  </div>
                  <span className="w-24 shrink-0 text-right text-sm tabular-nums text-slate-700">
                    {formatCurrency(p.amount, currencyCode)}
                  </span>
                </div>
              </div>
            );
          })
        )}

        {anyAvailable ? (
          <div className="mt-1 flex items-center justify-between rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
            <span className="text-sm font-semibold text-amber-900">Etappens värde (ex moms)</span>
            <strong className="text-sm tabular-nums text-amber-950">{formatCurrency(grandTotal, currencyCode)}</strong>
          </div>
        ) : null}
      </div>
    </CrmModal>
  );
}
