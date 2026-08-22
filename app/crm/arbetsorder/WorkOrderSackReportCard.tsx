"use client";

import { useEffect, useState } from 'react';
import { cn } from '@/lib/shared/cn';
import { crm } from '@/app/crm/lib/crmTokens';
import { formatDate, formatSacks, parseSackInput } from '@/app/crm/lib/format';
import { CONSTRUCTIONS, type ConstructionSlug } from '@/lib/domains/crm/constructions';
import { groupSackReportsByConstruction, totalReportedSacks } from '@/lib/domains/planning/sackLedger';
import { stockholmTodayISO } from '@/lib/domains/planning/timezone';
import type { SackReportView } from '@/lib/domains/planning/reports';
import type { NewSackReportEntry } from './useSackReports';

// Säckrapport-kortet — dörr 2 i säckrapporteringen.
//
// Läses och fylls i av en installatör som står i ett kryputrymme med handskar på och telefonen i
// en hand, i slutet av en dag. Kortets enda uppgift: göra dagens siffra användbar för nästa team.
//
// ── SIGNATUREN: PLACERINGSCHIPSEN ÄR FORMULÄRET ──────────────────────────────
// Ingen <select> någonstans. En rullgardin på en telefon är en hjullista — tre tapp och en
// felskrollning — och den döljer dessutom vokabulären tills man öppnat den. Chipsen visar hela
// vokabulären, tar ETT tapp, och löser flerplaceringsfallet utan en enda "lägg till rad"-knapp:
// tappa två chips, få två sifferrutor. Planen kräver flera placeringar i en submit just för att en
// POST slår tre på ett tak med dålig täckning.
//
// ── VAD KORTET MEDVETET INTE VISAR ───────────────────────────────────────────
// Det PLANERADE antalet. Tre tal har tre roller: offertradernas antal är säljarens UPPSKATTNING på
// en densitet vi vill hålla, delrapporten är vad som faktiskt blåstes, egenkontrollen är totalen.
// Ett "av 130 planerade" bredvid inmatningsrutan hade bjudit in installatören att få talen att gå
// ihop. Det planerade talet hör hemma på kontorets order, inte här.
//
// ── VAD MATERIALVALET GÖR HÄR ────────────────────────────────────────────────
// Frågan ställs BARA när ordern har mer än ett material — alltså precis det fall kolumnen finns
// för att lösa (depåhärledningen debiterar annars allt på orderns första igenkända material). Har
// jobbet ett material är frågan brus: rapporten lämnar material tomt och depån härleder som förut.

type Props = {
  reports: SackReportView[];
  loading: boolean;
  /** Egenkontrollen är inlämnad → jobbet är avräknat och en delrapport vore en nolloperation. */
  hasFinal: boolean;
  saving: boolean;
  /** Hämtningen misslyckades — boken kan mycket väl ha rader vi inte såg. */
  loadError: boolean;
  /** Distinkta materialkortnamn på ordern. Väljaren visas bara när de är fler än ett. */
  materialOptions: string[];
  onCreate: (input: { reportDay: string; note: string | null; entries: NewSackReportEntry[] }) => Promise<boolean>;
};

const CHIP_BASE =
  'inline-flex h-11 items-center justify-center rounded-xl border px-3.5 text-sm font-semibold transition active:scale-[0.98] ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40';
const CHIP_OFF = 'border-[#dce4d8] bg-white text-slate-600';
const CHIP_ON = 'border-transparent text-white shadow-[0_2px_8px_rgba(26,63,38,0.24)]';

export default function WorkOrderSackReportCard({
  reports,
  loading,
  hasFinal,
  saving,
  loadError,
  materialOptions,
  onCreate,
}: Props) {
  const [open, setOpen] = useState(false);
  // ⚠️ Tomt initialvärde och datumet först i en effekt. Komponenten serverrenderas innan den
  // hydrerar, och servern går på UTC — mellan 00:00 och 02:00 svensk tid står de två klockorna på
  // olika kalenderdagar, vilket ger en hydreringsmiss och ett synligt hopp i datumrutan.
  const [day, setDay] = useState('');
  const [picked, setPicked] = useState<Partial<Record<ConstructionSlug, string>>>({});
  const [material, setMaterial] = useState<string | null>(null);
  const [note, setNote] = useState('');

  useEffect(() => {
    if (open && !day) setDay(stockholmTodayISO());
  }, [open, day]);

  const groups = groupSackReportsByConstruction(reports);
  const total = totalReportedSacks(reports);
  const needsMaterial = materialOptions.length > 1;

  // ⚠️ STRIKT PARSNING. `parseDecimal` faller tillbaka på 0, så "abv" hade blivit en riktig
  // nollrad i en append-only bok som installatören inte kan rätta. Och ett chip som tappats på men
  // lämnats tomt får inte tyst falla bort ur submiten — då tror hen att vinden är rapporterad.
  // Båda blir null här, och null blockerar sparningen i stället för att skriva något påhittat.
  const pickedSlugs = CONSTRUCTIONS.filter(({ slug }) => slug in picked);
  const parsed = pickedSlugs.map(({ slug }) => ({ slug, sacks: parseSackInput(picked[slug] ?? '') }));
  const entries: NewSackReportEntry[] = parsed.flatMap(({ slug, sacks }) =>
    sacks === null ? [] : [{ construction: slug, sacks_blown: sacks, material }],
  );
  const allPickedFilled = parsed.length > 0 && parsed.every((row) => row.sacks !== null);
  const canSave = allPickedFilled && day !== '' && (!needsMaterial || material !== null) && !saving;

  function togglePlacement(slug: ConstructionSlug) {
    setPicked((current) => {
      const next = { ...current };
      if (slug in next) delete next[slug];
      else next[slug] = '';
      return next;
    });
  }

  function closeComposer() {
    setOpen(false);
    setPicked({});
    setNote('');
    setMaterial(null);
  }

  async function submit() {
    if (!canSave) return;
    const ok = await onCreate({ reportDay: day, note: note.trim() || null, entries });
    if (ok) closeComposer();
  }

  return (
    <div className={cn(crm.cardInner, 'grid gap-3')}>
      <div className="flex items-baseline justify-between gap-3">
        <p className={crm.sectionTitle}>Säckrapport</p>
        {!loading && reports.length > 0 ? (
          <p className="m-0 text-sm font-semibold text-slate-900">
            {formatSacks(total)} <span className="text-xs font-medium text-slate-500">säckar totalt</span>
          </p>
        ) : null}
      </div>

      {loading ? (
        <p className="m-0 text-sm text-slate-400">Hämtar…</p>
      ) : loadError ? (
        // "Vi vet inte", inte "inget finns". En tom lista här hade sett ut som ett svar om jobbet.
        <p className="m-0 text-sm text-amber-700">Kunde inte hämta rapporterna. Dra ner för att ladda om innan du rapporterar.</p>
      ) : reports.length === 0 ? (
        <p className="m-0 text-sm text-slate-500">Inget rapporterat än på det här jobbet.</p>
      ) : (
        <div className="grid gap-2.5">
          {groups.map((group) => (
            <div key={group.label} className="grid gap-1">
              <div className="flex items-baseline justify-between gap-3 border-b border-solid border-[#e8eee5] pb-1">
                <span className="text-sm font-semibold text-slate-800">{group.label}</span>
                <span className="text-sm font-semibold tabular-nums text-slate-900">{formatSacks(group.total)} st</span>
              </div>
              {group.items.map((item) => (
                // ⚠️ Ersatta rader ligger kvar i boken efter en egenkontroll. Visas de likadant som
                // de räknade räknar läsaren 30 + 25 + 91 = 146 och tror att talen inte går ihop —
                // men de måste synas, annars ser det ut som att en rapport försvunnit.
                <div key={item.id} className={cn('grid gap-0.5 text-xs', item.superseded ? 'text-slate-400' : 'text-slate-500')}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className={cn('truncate', item.superseded && 'line-through decoration-slate-300')}>
                      {formatDate(item.report_day)} · {item.created_by_name}
                      {item.kind === 'final' ? ' · egenkontroll' : ''}
                    </span>
                    <span className="shrink-0 tabular-nums">
                      {item.superseded ? <span className="mr-1.5 text-slate-400">ersatt</span> : null}
                      {formatSacks(item.sacks_blown)}
                    </span>
                  </div>
                  {/* Noteringen hör till RADEN. En not per grupp hade tappat allt utom den första —
                      och den är skriven till nästa team, alltså det enda på kortet någon behöver ordagrant. */}
                  {item.note ? <p className="m-0 pl-0.5 italic leading-relaxed">{item.note}</p> : null}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {hasFinal ? (
        // Spärren, med skäl. Utan förklaringen ser en försvunnen knapp ut som ett fel; med den är
        // det ett besked. En delrapport här hade varit en tyst nolloperation — raden landar, men
        // totalen rör sig inte, för egenkontrollen vinner.
        <p className="m-0 rounded-xl bg-[#eef3ec] px-3 py-2.5 text-xs leading-relaxed text-slate-600">
          Egenkontrollen är inlämnad och räknas som jobbets slutsumma. Behöver siffran ändras görs det
          genom att lämna in egenkontrollen på nytt.
        </p>
      ) : !open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex h-11 w-full items-center justify-center rounded-xl text-sm font-semibold text-white transition active:scale-[0.99]"
          style={{ backgroundColor: 'var(--crm-primary, #1a3f26)' }}
        >
          Rapportera dagens säckar
        </button>
      ) : (
        <div className="grid gap-3 rounded-xl border border-solid border-[#dce4d8] bg-white p-3">
          <div>
            <label className={crm.label} htmlFor="sack-report-day">Datum</label>
            <input
              id="sack-report-day"
              type="date"
              value={day}
              onChange={(e) => setDay(e.target.value)}
              className={cn(crm.input, 'h-11')}
            />
          </div>

          <div>
            <p className={cn(crm.label, 'mb-1.5')}>Var blåste ni?</p>
            <div className="flex flex-wrap gap-2">
              {CONSTRUCTIONS.map(({ slug, label }) => {
                const on = slug in picked;
                return (
                  <button
                    key={slug}
                    type="button"
                    aria-pressed={on}
                    onClick={() => togglePlacement(slug)}
                    className={cn(CHIP_BASE, on ? CHIP_ON : CHIP_OFF)}
                    style={on ? { backgroundColor: 'var(--crm-primary, #1a3f26)' } : undefined}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {pickedSlugs.map(({ slug, label }) => (
            <div key={slug} className="grid grid-cols-[1fr_7rem] items-center gap-2">
              <label className="text-sm font-semibold text-slate-700" htmlFor={`sack-count-${slug}`}>{label}</label>
              <input
                id={`sack-count-${slug}`}
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={picked[slug] ?? ''}
                onChange={(e) => setPicked((current) => ({ ...current, [slug]: e.target.value }))}
                placeholder="antal"
                aria-label={`Antal säckar – ${label}`}
                className={cn(crm.input, 'h-11 text-right')}
              />
            </div>
          ))}

          {needsMaterial ? (
            <div>
              {/* Frågan ställs bara när ordern bär flera material — se kortets huvud. */}
              <p className={cn(crm.label, 'mb-1.5')}>Vilket material?</p>
              <div className="flex flex-wrap gap-2">
                {materialOptions.map((short) => {
                  const on = material === short;
                  return (
                    <button
                      key={short}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setMaterial(on ? null : short)}
                      className={cn(CHIP_BASE, on ? CHIP_ON : CHIP_OFF)}
                      style={on ? { backgroundColor: 'var(--crm-primary, #1a3f26)' } : undefined}
                    >
                      {short}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          <div>
            <label className={crm.label} htmlFor="sack-report-note">Anteckning till nästa team (valfritt)</label>
            <textarea
              id="sack-report-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="T.ex. dålig åtkomst i norra gaveln"
              className="w-full rounded-lg border border-[#dce4d8] bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-[color:var(--crm-accent)] focus:ring-2 focus:ring-[color:var(--crm-accent-ring)]"
            />
          </div>

          {pickedSlugs.length > 0 && !allPickedFilled ? (
            <p className="m-0 text-xs text-amber-700">Fyll i ett antal för varje vald placering, eller tappa bort chipset igen.</p>
          ) : null}

          <div className="grid grid-cols-[auto_1fr] gap-2">
            <button type="button" onClick={closeComposer} className={cn(crm.ghostButton, 'h-11')}>Avbryt</button>
            <button
              type="button"
              onClick={submit}
              disabled={!canSave}
              className="inline-flex h-11 items-center justify-center rounded-xl text-sm font-semibold text-white transition active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
              style={{ backgroundColor: 'var(--crm-primary, #1a3f26)' }}
            >
              {saving ? 'Sparar…' : 'Spara rapport'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
