"use client";

import { useEffect, useState } from 'react';
import { cn } from '@/lib/shared/cn';
import { crm } from '@/app/crm/lib/crmTokens';
import { formatDate, formatQuantity, parseQuantityInput } from '@/app/crm/lib/format';
import { stockholmTodayISO } from '@/lib/domains/planning/timezone';
import {
  groupProgressReports,
  progressLocationSuggestions,
  PROGRESS_UNIT_FALLBACKS,
  type ProgressReportView,
  type ProgressWorkItem,
} from '@/lib/domains/crm/workOrderProgress';
import type { NewProgressEntry } from './useProgressReports';

// Framdriftskortet — fältets andra rapportyta, bredvid säckrapporten.
//
// Löser det säckboken inte kan: ett jobb som bygger landgångar hade ingen väg att säga "vi byggde
// 45 m i dag, på Hus A". Kontoret fick prosa i en kommentar, eller ingenting.
//
// ── SAMMA SIGNATUR SOM SÄCKKORTET, MED FLIT ──────────────────────────────────
// Chipsen ÄR formuläret, allt klickbart 44 px, ingen <select> (en rullgardin på en telefon är en
// hjullista — tre tapp och en felskrollning — och den döljer vokabulären tills man öppnat den).
// Korten sitter på samma flik och måste läsas som syskon.
//
// ── MEN DET PLANERADE ANTALET VISAS HÄR, TILL SKILLNAD FRÅN SÄCKKORTET ───────
// ⚠️ LÄS DEN HÄR INNAN DU "HARMONISERAR" DE TVÅ KORTEN. Säckkortet gömmer det planerade antalet
// med flit: det är säljarens UPPSKATTNING på en densitet vi vill hålla, och ett "av 130 planerade"
// bredvid inmatningsrutan hade bjudit in installatören att få talen att gå ihop.
//
// Här är talet något helt annat: 120 m landgång är SÅLT OMFÅNG, skrivet av säljaren och det som
// faktureras. Besättningen behöver veta vad som är kvar att bygga — det är själva frågan de har när
// de öppnar kortet, och att gömma svaret hade gjort kortet sämre utan att skydda någonting.
//
// ── INGEN TOTAL I RUBRIKEN ───────────────────────────────────────────────────
// ⚠️ 45 m landgång + 3 st brandmatta är inget tal. Varje moment bär sin egen summa och sin egen
// enhet; en totalsumma hade krävt att meter och styck adderades. Samma skäl som domänen medvetet
// saknar en funktion som summerar över moment.

// ── DELAS MED KONTORET (canReport) ───────────────────────────────────────────
// Till skillnad från säckarna, där fältet och kontoret har två egna kort. Där är läsningarna
// genuint olika frågor: fältet vill veta hur långt man kommit på vinden (grupperat per placering),
// kontoret varför det står 91 när raderna ser ut att bli 146 (kronologiskt, en ORDNINGSFRÅGA).
//
// Här ställer båda SAMMA fråga — hur långt har vi kommit, och vad är byggt utanför ordern — så en
// andra komponent hade bara blivit en kopia som glider isär. Samma mönster som WorkOrderArticles,
// som fältvyn återanvänder med canEdit={false}.
type Props = {
  reports: ProgressReportView[];
  /** Orderns antals-/meterrader. Tom lista = bara fritextmoment går att rapportera. */
  workItems: ProgressWorkItem[];
  loading: boolean;
  /** Hämtningen misslyckades — boken kan mycket väl ha rader vi inte såg. */
  loadError: boolean;
  /** Per rad, inte en delad flagga: två borttagningar i rad får inte låsa upp varandras knappar. */
  isRemoving: (id: string) => boolean;
  onDelete: (id: string) => void;
  /**
   * Får den som tittar rätta? False tar bort "Ta bort" per rad.
   *
   * Skilt från `canReport`: den säger vem som RAPPORTERAR (fältet), den här vem som får RÄTTA.
   * Kontoret har canReport={false} men rättar; ekonomiytans läsvy har varken eller.
   */
  canEdit?: boolean;
  /**
   * Fältet rapporterar; kontoret läser och rättar.
   *
   * Styr både formuläret och rubrikens tyngd — fältvyns kort står bland andra `sectionTitle`-kort
   * på Info-fliken, kontorets bland `cardTitle`-kort i översiktens spalt.
   */
  canReport?: boolean;
  saving?: boolean;
  onCreate?: (input: {
    reportDay: string;
    location: string | null;
    note: string | null;
    entries: NewProgressEntry[];
  }) => Promise<boolean>;
};

const CHIP_BASE =
  'inline-flex h-11 items-center justify-center rounded-xl border px-3.5 text-sm font-semibold transition active:scale-[0.98] ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40';
const CHIP_OFF = 'border-[#dce4d8] bg-white text-slate-600';
const CHIP_ON = 'border-transparent text-white shadow-[0_2px_8px_rgba(26,63,38,0.24)]';

/** Chip för fritextmomentet. Eget värde så det inte kan kollidera med ett orderrad-id. */
const FREE_KEY = '__free__';

export default function WorkOrderProgressCard({
  reports,
  workItems,
  loading,
  loadError,
  isRemoving,
  onDelete,
  canEdit = true,
  canReport = true,
  saving = false,
  onCreate,
}: Props) {
  const [open, setOpen] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  // ⚠️ Tomt initialvärde och datumet först i en effekt. Komponenten serverrenderas innan den
  // hydrerar, och servern går på UTC — mellan 00:00 och 02:00 svensk tid står de två klockorna på
  // olika kalenderdagar, vilket ger en hydreringsmiss och ett synligt hopp i datumrutan.
  const [day, setDay] = useState('');
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [freeLabel, setFreeLabel] = useState('');
  const [freeUnit, setFreeUnit] = useState<string | null>(null);
  const [location, setLocation] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    if (open && !day) setDay(stockholmTodayISO());
  }, [open, day]);

  // ⚠️ GRUPPERINGEN FÅR HELA LISTAN, chipsen bara de rapporterbara. En avskriven rad (såld men
  // markerad aldrig utförd) ska inte gå att rapportera NY framdrift på, men måste fortfarande gå
  // att slå upp: rapporterades 45 m innan raden skrevs av ska kortet visa "45 av 120 m · Avskriven"
  // och inte "Ej på ordern" — den märkningen är till för arbete som aldrig såldes.
  const groups = groupProgressReports(reports, workItems);
  const reportable = workItems.filter((item) => !item.writtenOff);
  const locationSuggestions = progressLocationSuggestions(reports).slice(0, 6);
  // Enhetschips för ett fritextmoment: de enheter ordern faktiskt använder, plus husets vanliga.
  // Fallbacken behövs i precis det fall kortet hänvisar till "Annat" — en order utan
  // antals-/meterrader har inga enheter att härleda ur, och utan den fick fältet välja mellan noll
  // chips. Ingen fri inmatning av enhet, men null är tillåtet: "Röjning – 1" behöver ingen.
  const unitOptions = [
    ...new Set([
      ...reportable.map((i) => i.unit).filter((u): u is string => Boolean(u)),
      ...PROGRESS_UNIT_FALLBACKS,
    ]),
  ];
  const freePicked = FREE_KEY in picked;

  // ⚠️ STRIKT PARSNING. `parseDecimal` faller tillbaka på 0, så "abv" hade blivit en riktig nollrad
  // i en bok där en rad bara går att ta bort — och ett chip som tappats på men lämnats tomt får
  // inte tyst falla bort ur submiten, då tror hen att landgången är rapporterad. Båda blir null
  // här, och null blockerar sparningen i stället för att skriva något påhittat.
  const pickedItems = reportable.filter((item) => item.lineItemId in picked);
  const parsedItems = pickedItems.map((item) => ({ item, quantity: parseQuantityInput(picked[item.lineItemId] ?? '') }));
  const freeQuantity = freePicked ? parseQuantityInput(picked[FREE_KEY] ?? '') : null;
  const freeLabelOk = !freePicked || freeLabel.trim() !== '';

  const entries: NewProgressEntry[] = [
    ...parsedItems.flatMap(({ item, quantity }) =>
      quantity === null ? [] : [{ line_item_id: item.lineItemId, work_item: null, quantity, unit: null }],
    ),
    ...(freePicked && freeQuantity !== null && freeLabel.trim() !== ''
      ? [{ line_item_id: null, work_item: freeLabel.trim(), quantity: freeQuantity, unit: freeUnit }]
      : []),
  ];

  const pickedCount = parsedItems.length + (freePicked ? 1 : 0);
  const allFilled =
    pickedCount > 0 && parsedItems.every((row) => row.quantity !== null) && (!freePicked || freeQuantity !== null);
  const canSave = allFilled && freeLabelOk && day !== '' && !saving;

  function toggle(key: string) {
    setPicked((current) => {
      const next = { ...current };
      if (key in next) delete next[key];
      else next[key] = '';
      return next;
    });
  }

  function closeComposer() {
    setOpen(false);
    setPicked({});
    setFreeLabel('');
    setFreeUnit(null);
    setLocation('');
    setNote('');
  }

  async function submit() {
    if (!canSave || !onCreate) return;
    const ok = await onCreate({
      reportDay: day,
      location: location.trim() || null,
      note: note.trim() || null,
      entries,
    });
    if (ok) closeComposer();
  }

  return (
    <div className={cn(crm.cardInner, 'grid gap-3')}>
      <p className={canReport ? crm.sectionTitle : crm.cardTitle}>Framdrift</p>

      {/* ⚠️ AVVIKELSEN MÅSTE SYNAS UTAN ATT MAN SCROLLAR. William 2026-09-16: arbete utanför
          ordern ska vara synligt på ordern — ingen notis, ingen egen livscykel. Då räcker inte en
          märkning per grupp längst ner på ett kort med åtta moment; det är ju precis det kontoret
          ska upptäcka utan att leta. Raden visas bara för kontoret: fältet har just rapporterat
          raden och behöver inte påminnas om den. */}
      {!canReport && !loading && groups.some((g) => g.notOnOrder) ? (
        <p className="m-0 rounded-xl bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
          {groups.filter((g) => g.notOnOrder).length === 1
            ? 'Ett moment är rapporterat utan att finnas på ordern.'
            : `${groups.filter((g) => g.notOnOrder).length} moment är rapporterade utan att finnas på ordern.`}{' '}
          Se raderna märkta <strong className="font-semibold">Ej på ordern</strong> nedan.
        </p>
      ) : null}

      {loading ? (
        <p className="m-0 text-sm text-slate-400">Hämtar…</p>
      ) : loadError ? (
        // "Vi vet inte", inte "inget finns". En tom lista här hade sett ut som ett svar om jobbet.
        <p className="m-0 text-sm text-amber-700">Kunde inte hämta rapporterna. Dra ner för att ladda om innan du rapporterar.</p>
      ) : groups.length === 0 ? (
        // "Ingen har rapporterat", inte "noll gjort". Och säg VAR rapporten görs — kontorets kort
        // är en läsvy, och den som står här och undrar varför den är tom ska inte behöva leta efter
        // skrivstället. Samma val som säckrapporternas tomtext.
        <p className={canReport ? 'm-0 text-sm text-slate-500' : crm.emptyValue}>
          {canReport
            ? 'Inget rapporterat än på det här jobbet.'
            : 'Ingen har rapporterat framdrift på det här jobbet än. Rapporterna kommer från installatörens vy.'}
        </p>
      ) : (
        <div className="grid gap-3">
          {groups.map((group) => {
            const remaining = group.planned != null ? Math.max(0, group.planned - group.reported) : null;
            return (
              <div key={group.key} className="grid gap-1">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 border-b border-[#e8eee5] pb-1">
                  <span className="text-sm font-semibold text-slate-800">{group.label}</span>
                  <span className="shrink-0 text-sm font-semibold tabular-nums text-slate-900">
                    {formatQuantity(group.reported)}
                    {/* Det sålda omfånget, som besättningen behöver för att veta vad som är kvar —
                        se kortets huvud för varför säckkortet gör motsatt val. */}
                    {group.planned != null ? (
                      <span className="font-medium text-slate-500"> av {formatQuantity(group.planned)}</span>
                    ) : null}
                    {group.unit ? <span className="font-medium text-slate-500"> {group.unit}</span> : null}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                  {remaining != null && remaining > 0 ? (
                    <span className="font-semibold text-slate-600">Kvar {formatQuantity(remaining)}{group.unit ? ` ${group.unit}` : ''}</span>
                  ) : null}
                  {group.overPlanned ? (
                    <span className={cn(crm.badge, 'border-amber-200 bg-amber-50 text-amber-800')}>Över planerat</span>
                  ) : null}
                  {/* Rapporterat men inte sålt. Kontoret ser samma märkning på ordern — William
                      2026-09-16: avvikelsen ska vara synlig, inte skicka en notis. */}
                  {group.notOnOrder ? (
                    <span className={cn(crm.badge, 'border-slate-200 bg-slate-50 text-slate-600')}>Ej på ordern</span>
                  ) : null}
                  {/* Rapporterad framdrift på en rad som markerats som aldrig utförd — en
                      motsägelse kontoret ska se, men en ANNAN än "Ej på ordern": här finns både en
                      rad och ett sålt antal att jämföra mot. */}
                  {group.writtenOff ? (
                    <span className={cn(crm.badge, 'border-amber-200 bg-amber-50 text-amber-800')}>Avskriven rad</span>
                  ) : null}
                </div>

                {/* Per plats — hela skälet att platsen finns. "Hus A 25, Hus B 20" är svaret på
                    frågan nästa team har när de kliver in i ett flerhusprojekt. Visas bara när den
                    säger något utöver momentets egen summa. */}
                {group.locations.length > 1 ? (
                  <p className="m-0 text-xs text-slate-500">
                    {group.locations.map((loc) => `${loc.label} ${formatQuantity(loc.total)}`).join(' · ')}
                  </p>
                ) : null}

                {group.items.map((item) => (
                  <div key={item.id} className="grid gap-0.5 text-xs text-slate-500">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="truncate">
                        {formatDate(item.report_day)} · {item.created_by_name}
                        {item.location ? ` · ${item.location}` : ''}
                      </span>
                      <span className="shrink-0 tabular-nums">{formatQuantity(item.quantity)}</span>
                    </div>
                    {/* Noteringen hör till RADEN och är skriven till nästa team — alltså det enda
                        på kortet någon behöver ordagrant. */}
                    {item.note ? <p className="m-0 pl-0.5 italic leading-relaxed">{item.note}</p> : null}
                    {item.can_delete && canEdit ? (
                      confirmId === item.id ? (
                        <div className="flex items-center justify-end gap-2 pt-0.5">
                          <span className="text-slate-500">Ta bort raden?</span>
                          <button
                            type="button"
                            onClick={() => onDelete(item.id)}
                            disabled={isRemoving(item.id)}
                            className="inline-flex h-11 items-center rounded-xl px-3 text-sm font-semibold text-rose-600 transition active:scale-[0.98] disabled:opacity-60"
                          >
                            {isRemoving(item.id) ? 'Tar bort…' : 'Ja, ta bort'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmId(null)}
                            disabled={isRemoving(item.id)}
                            className="inline-flex h-11 items-center rounded-xl px-3 text-sm font-semibold text-slate-500 transition active:scale-[0.98] disabled:opacity-60"
                          >
                            Avbryt
                          </button>
                        </div>
                      ) : (
                        <div className="flex justify-end">
                          <button
                            type="button"
                            onClick={() => setConfirmId(item.id)}
                            className="inline-flex h-11 items-center rounded-xl px-2 text-sm font-medium text-slate-400 transition active:scale-[0.98]"
                          >
                            Ta bort
                          </button>
                        </div>
                      )
                    ) : null}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}

      {/* Kontoret rapporterar inte — det är fältets yta. Rättningen (Ta bort per rad) finns
          däremot i båda vyerna, och den styrs av `can_delete` från servern. */}
      {!canReport ? null : !open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex h-11 w-full items-center justify-center rounded-xl text-sm font-semibold text-white transition active:scale-[0.99]"
          style={{ backgroundColor: 'var(--ek-green)' }}
        >
          Rapportera dagens arbete
        </button>
      ) : (
        <div className="grid gap-3 rounded-xl border border-[#dce4d8] bg-white p-3">
          <div>
            <label className={crm.label} htmlFor="progress-day">Datum</label>
            <input
              id="progress-day"
              type="date"
              value={day}
              onChange={(e) => setDay(e.target.value)}
              className={cn(crm.input, 'h-11')}
            />
          </div>

          <div>
            <p className={cn(crm.label, 'mb-1.5')}>Vad gjorde ni?</p>
            <div className="flex flex-wrap gap-2">
              {reportable.map((item) => {
                const on = item.lineItemId in picked;
                return (
                  <button
                    key={item.lineItemId}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggle(item.lineItemId)}
                    className={cn(CHIP_BASE, on ? CHIP_ON : CHIP_OFF)}
                    style={on ? { backgroundColor: 'var(--ek-green)' } : undefined}
                  >
                    {item.label}
                  </button>
                );
              })}
              {/* Fritextmomentet, visuellt underordnat orderns rader: det ska vara vägen för det
                  som INTE är sålt, inte den bekvämaste vägen för det som är. */}
              <button
                type="button"
                aria-pressed={freePicked}
                onClick={() => toggle(FREE_KEY)}
                className={cn(CHIP_BASE, freePicked ? CHIP_ON : 'border-dashed border-[#c9d4c4] bg-transparent text-slate-500')}
                style={freePicked ? { backgroundColor: 'var(--ek-green)' } : undefined}
              >
                Annat
              </button>
            </div>
            {reportable.length === 0 ? (
              <p className="m-0 mt-1.5 text-xs text-slate-500">
                Ordern har inga antals- eller meterrader. Använd <strong className="font-semibold">Annat</strong> och
                skriv vad ni gjorde.
              </p>
            ) : null}
          </div>

          {pickedItems.map((item) => (
            <div key={item.lineItemId} className="grid grid-cols-[1fr_7rem] items-center gap-2">
              <label className="text-sm font-semibold text-slate-700" htmlFor={`progress-qty-${item.lineItemId}`}>
                {item.label}
                {item.unit ? <span className="font-medium text-slate-400"> ({item.unit})</span> : null}
              </label>
              <input
                id={`progress-qty-${item.lineItemId}`}
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={picked[item.lineItemId] ?? ''}
                onChange={(e) => setPicked((current) => ({ ...current, [item.lineItemId]: e.target.value }))}
                placeholder="antal"
                aria-label={`Mängd – ${item.label}`}
                className={cn(crm.input, 'h-11 text-right')}
              />
            </div>
          ))}

          {freePicked ? (
            <div className="grid gap-2 rounded-xl border border-dashed border-[#c9d4c4] p-2.5">
              <div>
                <label className={crm.label} htmlFor="progress-free-label">Vad gjorde ni?</label>
                <input
                  id="progress-free-label"
                  type="text"
                  value={freeLabel}
                  onChange={(e) => setFreeLabel(e.target.value)}
                  placeholder="T.ex. Extra sarg"
                  className={cn(crm.input, 'h-11')}
                />
              </div>
              {unitOptions.length > 0 ? (
                <div>
                  <p className={cn(crm.label, 'mb-1.5')}>Enhet (valfritt)</p>
                  <div className="flex flex-wrap gap-2">
                    {unitOptions.map((unit) => {
                      const on = freeUnit === unit;
                      return (
                        <button
                          key={unit}
                          type="button"
                          aria-pressed={on}
                          onClick={() => setFreeUnit(on ? null : unit)}
                          className={cn(CHIP_BASE, on ? CHIP_ON : CHIP_OFF)}
                          style={on ? { backgroundColor: 'var(--ek-green)' } : undefined}
                        >
                          {unit}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}
              <div className="grid grid-cols-[1fr_7rem] items-center gap-2">
                <label className="text-sm font-semibold text-slate-700" htmlFor="progress-free-qty">Mängd</label>
                <input
                  id="progress-free-qty"
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  value={picked[FREE_KEY] ?? ''}
                  onChange={(e) => setPicked((current) => ({ ...current, [FREE_KEY]: e.target.value }))}
                  placeholder="antal"
                  aria-label="Mängd – annat"
                  className={cn(crm.input, 'h-11 text-right')}
                />
              </div>
              {/* Säg vad rapporten BLIR. Raden hamnar på ordern märkt "Ej på ordern", och den som
                  rapporterar ska veta att hen skickar en avvikelse och inte fyller i ett fält. */}
              <p className="m-0 text-xs leading-relaxed text-slate-500">
                Det här registreras som arbete utanför ordern, så kontoret ser det.
              </p>
            </div>
          ) : null}

          <div>
            <label className={crm.label} htmlFor="progress-location">Var? (valfritt)</label>
            <input
              id="progress-location"
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="T.ex. Hus A"
              className={cn(crm.input, 'h-11')}
            />
            {/* Förslag ur det som redan rapporterats på ordern. Utan dem skriver dag två "hus A"
                där dag ett skrev "Hus A" — grupperingen fångar det ändå, men förslaget gör att det
                inte uppstår. */}
            {locationSuggestions.length > 0 ? (
              <div className="mt-1.5 flex flex-wrap gap-2">
                {locationSuggestions.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => setLocation(suggestion)}
                    className={cn(CHIP_BASE, location === suggestion ? CHIP_ON : CHIP_OFF)}
                    style={location === suggestion ? { backgroundColor: 'var(--ek-green)' } : undefined}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div>
            <label className={crm.label} htmlFor="progress-note">Anteckning till nästa team (valfritt)</label>
            <textarea
              id="progress-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="T.ex. klart fram till norra gaveln"
              className="w-full rounded-lg border border-[#dce4d8] bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-[color:var(--ek-accent)] focus:ring-2 focus:ring-[color:var(--ek-accent-ring)]"
            />
          </div>

          {pickedCount > 0 && !allFilled ? (
            <p className="m-0 text-xs text-amber-700">Fyll i en mängd för varje valt moment, eller tappa bort chipset igen.</p>
          ) : null}
          {freePicked && !freeLabelOk ? (
            <p className="m-0 text-xs text-amber-700">Skriv vad ni gjorde, annars går raden inte att läsa på ordern.</p>
          ) : null}

          <div className="grid grid-cols-[auto_1fr] gap-2">
            <button type="button" onClick={closeComposer} className={cn(crm.ghostButton, 'h-11')}>Avbryt</button>
            <button
              type="button"
              onClick={submit}
              disabled={!canSave}
              className="inline-flex h-11 items-center justify-center rounded-xl text-sm font-semibold text-white transition active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
              style={{ backgroundColor: 'var(--ek-green)' }}
            >
              {saving ? 'Sparar…' : 'Spara rapport'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
