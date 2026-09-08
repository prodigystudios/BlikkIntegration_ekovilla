'use client';

import { useState } from 'react';
import { cn } from '@/lib/shared/cn';
import Select from '@/components/ui/Select';
import { crm } from '@/app/crm/lib/crmTokens';
import type { OpsSegment, OpsTruck } from '@/lib/domains/planning/types';
import type { JobType } from '@/lib/domains/planning/jobTypes';

export type PlaceholderInput = {
  title: string;
  customer: string | null;
  truck_id: string;
  start_day: string;
  end_day: string;
  job_type: string | null;
  field_visible: boolean;
  work_description: string | null;
};

/**
 * Publicerings-switchen. Egen liten komponent i stället för en `<input type="checkbox">` av två
 * skäl: kryssrutan kan inte få kanter (globals.css nollar dem för allt utom knappar, se
 * FRONTEND_SYSTEM.md), och det här är inte ett kryss bland andra kryss — det är formulärets enda
 * kontroll som gör något utanför kontoret.
 *
 * `p-0` bär sin vikt: globals.css ger varje `<button>` `padding: 10px 14px`, vilket annars hade
 * blåst upp spåret till en klump. Se [[project_global_button_padding]].
 */
function VisibilitySwitch({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={cn(
        'flex w-full items-start gap-2.5 p-0 text-left',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'relative mt-0.5 inline-flex h-[18px] w-8 shrink-0 items-center rounded-full transition-colors',
          on ? 'bg-emerald-600' : 'bg-slate-300',
        )}
      >
        <span
          className={cn(
            'inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform',
            on ? 'translate-x-[16px]' : 'translate-x-[2px]',
          )}
        />
      </span>
      <span className="grid gap-0.5">
        <span className="text-[12px] font-semibold text-slate-800">Synlig för entreprenad</span>
        <span className="text-[10.5px] font-normal leading-snug text-slate-500">
          {on
            ? 'Bilens besättning ser bokningen i Mina jobb och på startsidan.'
            : 'Bara planeringen ser den här bokningen.'}
        </span>
      </span>
    </button>
  );
}

// Create a placeholder card — a booked truck/day slot before the real CRM work order exists.
// Samma modal redigerar en befintlig platshållare: fälten är identiska, och en separat
// redigeringsmodal hade bara blivit en kopia som glider isär.
export default function PlaceholderModal({
  trucks,
  hiddenTruckIds,
  jobTypes,
  defaultDay,
  editing,
  crewCountFor,
  onClose,
  onSubmit,
}: {
  trucks: OpsTruck[];
  /**
   * Bilar som är bortvalda i filterraden. Listan visar dem — man ska kunna boka på en bil man
   * dammat av vyn från — men de MÅSTE märkas: förvalet är `trucks[0]`, som mycket väl är en dold
   * bil, och en sparning avdöljer den (se `revealTruck` i PlanningClient). Utan märkningen ändras
   * planerarens filter utan att något sagt det. De andra två bilväljarna märker på samma sätt.
   */
  hiddenTruckIds?: Set<string>;
  jobTypes: JobType[];
  defaultDay: string;
  /** Platshållaren som redigeras, eller undefined när en ny skapas. */
  editing?: OpsSegment;
  /**
   * Hur många ur besättningen som skulle se bokningen på den valda bilen och de valda dagarna.
   * `null` betyder att det inte går att avgöra (dagarna ligger utanför den laddade perioden) —
   * då säger modalen ingenting hellre än något den inte kan belägga.
   */
  crewCountFor?: (truckId: string, startDay: string, endDay: string) => number | null;
  onClose: () => void;
  onSubmit: (input: PlaceholderInput) => Promise<void> | void;
}) {
  const [title, setTitle] = useState(editing?.placeholder_title ?? '');
  const [customer, setCustomer] = useState(editing?.placeholder_customer ?? '');
  const [truckId, setTruckId] = useState(editing?.truck_id ?? trucks[0]?.id ?? '');
  const [startDay, setStartDay] = useState(editing?.start_day ?? defaultDay);
  const [endDay, setEndDay] = useState(editing?.end_day ?? defaultDay);
  const [jobType, setJobType] = useState(editing?.job_type ?? '');
  const [fieldVisible, setFieldVisible] = useState(editing?.field_visible ?? false);
  const [description, setDescription] = useState(editing?.work_description ?? '');
  const [saving, setSaving] = useState(false);

  const valid = title.trim().length > 0 && truckId && startDay && endDay && endDay >= startDay;

  // Vem bokningen faktiskt når, om den publiceras. Räknas bara när den är på: annars är siffran ett
  // svar på en fråga ingen ställt.
  const reach = fieldVisible && valid && crewCountFor ? crewCountFor(truckId, startDay, endDay) : null;
  const truckName = trucks.find((t) => t.id === truckId)?.name ?? 'Bilen';

  const submit = async () => {
    if (!valid || saving) return;
    setSaving(true);
    try {
      await onSubmit({
        title: title.trim(),
        customer: customer.trim() || null,
        truck_id: truckId,
        start_day: startDay,
        end_day: endDay,
        job_type: jobType || null,
        field_visible: fieldVisible,
        work_description: description.trim() || null,
      });
    } finally {
      setSaving(false);
    }
  };

  const field = 'h-9 w-full rounded-lg border border-[#dce4d8] bg-white px-2.5 text-[12.5px] text-slate-700 outline-none transition focus:border-[color:var(--ek-accent)]';

  return (
    <div className="fixed inset-0 z-[2800] flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl border border-[#e0e8dc] bg-[#f9fbf7] p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-0.5 text-[14px] font-bold text-slate-900">{editing ? 'Redigera platshållare' : 'Ny platshållare'}</h3>
        <p className="mb-3 text-[11px] text-slate-500">Boka en bil/dag innan den riktiga arbetsordern finns.</p>

        <div className="grid gap-2.5">
          <label className="grid gap-1">
            <span className="text-[11px] font-semibold text-slate-500">Titel</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="t.ex. Vind Ekvägen 4" className={field} autoFocus />
          </label>
          <label className="grid gap-1">
            <span className="text-[11px] font-semibold text-slate-500">Kund (valfritt)</span>
            <input value={customer} onChange={(e) => setCustomer(e.target.value)} className={field} />
          </label>
          <label className="grid gap-1">
            <span className="text-[11px] font-semibold text-slate-500">Bil</span>
            {/* `field` delas med modalens fyra <input> och blir därför kvar. Här behövs bara
                skillnaderna mot SelectMenus bas — `crm.selectMenu` bär höjden (och `min-h-0`, utan
                vilken `h-9` tyst förlorar mot basens `min-h-11`), textstorleken kommer hit.
                Ingen breddspärr: etiketten är ett `grid` och full bredd, så omslaget sträcks. */}
            <Select
              value={truckId}
              onChange={(e) => setTruckId(e.target.value)}
              aria-label="Bil"
              className={cn(crm.selectMenu, 'text-[12.5px]')}
            >
              {trucks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}{hiddenTruckIds?.has(t.id) ? ' (dold – visas igen)' : ''}
                </option>
              ))}
            </Select>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="grid gap-1">
              <span className="text-[11px] font-semibold text-slate-500">Från</span>
              <input type="date" value={startDay} onChange={(e) => { setStartDay(e.target.value); if (endDay < e.target.value) setEndDay(e.target.value); }} className={field} />
            </label>
            <label className="grid gap-1">
              <span className="text-[11px] font-semibold text-slate-500">Till</span>
              <input type="date" value={endDay} min={startDay} onChange={(e) => setEndDay(e.target.value)} className={field} />
            </label>
          </div>
          <label className="grid gap-1">
            <span className="text-[11px] font-semibold text-slate-500">Jobbtyp (valfritt)</span>
            <Select
              value={jobType}
              onChange={(e) => setJobType(e.target.value)}
              aria-label="Jobbtyp (valfritt)"
              className={cn(crm.selectMenu, 'text-[12.5px]')}
            >
              <option value="">—</option>
              {jobTypes.map((t) => (
                <option key={t.key} value={t.key}>{t.label}</option>
              ))}
            </Select>
          </label>

          {/* Blocket som skiljer sig från resten av formuläret, för att det gör något resten inte
              gör: släpper ut bokningen ur planeringen och hem till besättningens telefoner.
              Beskrivningen ligger kvar synlig även när switchen är av — ett fält som försvinner
              med sitt innehåll är hur text blir kvar i databasen utan att någon vet om det. */}
          <div className={cn('grid gap-2 rounded-xl border p-2.5 transition-colors', fieldVisible ? 'border-emerald-200 bg-emerald-50/60' : 'border-[#dce4d8] bg-white')}>
            <VisibilitySwitch on={fieldVisible} onChange={setFieldVisible} />
            {/* Vem den når. Noll mottagare är det enda tillstånd som behöver en varning: switchen
                står på, allt ser rätt ut, och ingen ser bokningen. */}
            {reach === 0 && (
              <p className="m-0 rounded-lg bg-amber-50 px-2 py-1.5 text-[10.5px] leading-snug text-amber-800">
                {truckName} har ingen besättning de här dagarna, så ingen ser bokningen än. Sätt
                besättning på bilen i tavlan.
              </p>
            )}
            {reach !== null && reach > 0 && (
              <p className="m-0 text-[10.5px] leading-snug text-slate-500">
                {reach === 1 ? '1 person' : `${reach} personer`} på {truckName} ser den.
              </p>
            )}
            <label className="grid gap-1">
              <span className="text-[11px] font-semibold text-slate-500">Arbetsbeskrivning</span>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                maxLength={2000}
                placeholder="t.ex. Service av blåsmaskin — filterbyte och smörjning"
                className="w-full resize-y rounded-lg border border-[#dce4d8] bg-white px-2.5 py-2 text-[12.5px] leading-snug text-slate-700 outline-none transition focus:border-[color:var(--ek-accent)]"
              />
            </label>
          </div>
        </div>

        <div className="mt-4 flex gap-2">
          <button onClick={onClose} className={cn(crm.ghostButton, 'flex-1')}>Avbryt</button>
          <button
            onClick={submit}
            disabled={!valid || saving}
            className="flex-1 rounded-lg border border-emerald-300 bg-emerald-600 px-3 py-1.5 text-[12.5px] font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? (editing ? 'Sparar…' : 'Skapar…') : editing ? 'Spara' : 'Skapa'}
          </button>
        </div>
      </div>
    </div>
  );
}
