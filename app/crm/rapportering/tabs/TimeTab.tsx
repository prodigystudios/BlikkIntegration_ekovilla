"use client";

import { useMemo } from 'react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import { cn } from '@/lib/shared/cn';
import type { SalesReport } from '@/lib/domains/crm/reports';
import {
  ExportButton,
  SectionCard,
  StatTile,
  downloadCsv,
  formatCount,
  formatMonth,
  formatRangeLabel,
} from '../reportUi';

// Tid: dagens sektion "Tid", flyttad hit oförändrad (spec 2026-10-07). Fliken visas bara när rutten
// lämnat ut tiden — se visibleReportTabs.

// Tidens tre serier. Arbetsorder mättat (det man vill se mest av), internt dämpat, frånvaro i en
// egen ton så den aldrig läses som arbetad tid.
const COLOR_WORK_ORDER = '#15803d';
const COLOR_INTERNAL = '#a3b18a';
const COLOR_ABSENCE = '#c084fc';

/**
 * Minuter som timmar. Databasen räknar minuter; sidan visar timmar.
 *
 * ⚠️ HELA TIMMAR BARA I DE STORA TALEN. I listorna och persontabellen visas en decimal, av två
 * skäl: ett internprojekt på 25 minuter blev annars "0 h" i just den lista som ska visa vart
 * timmarna tog vägen, och elva rader som var för sig avrundas till hel timme kan tillsammans
 * ligga flera timmar från totalen ovanför. Minuterna är exakta hela vägen; det här gäller bara
 * presentationen.
 */
/**
 * Timmar för CSV-export: en decimal med KOMMA, som resten av huset
 * (app/ekonomi/TimeApprovals.tsx). En punkt hade landat som text i svenskt Excel.
 */
function csvHours(minutes: number) {
  return (minutes / 60).toFixed(1).replace('.', ',');
}

function formatHours(minutes: number, decimals: 0 | 1 = 0) {
  const value = new Intl.NumberFormat('sv-SE', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(minutes / 60);
  return `${value} h`;
}

/** Andel som heltalsprocent, eller null när nämnaren är noll. Aldrig 0 %, aldrig Infinity. */
function share(part: number, whole: number): number | null {
  return whole > 0 ? (part / whole) * 100 : null;
}

const MISSING_LABEL = 'Uppgift saknas';

export default function TimeTab({ report }: { report: SalesReport }) {
const timeMonthData = useMemo(
  () => (report?.time?.byMonth || []).map((p) => ({
    ...p,
    label: report?.time && report.time.byMonth.length === 1
      ? formatRangeLabel(report.range.from, report.range.to)
      : formatMonth(p.period),
  })),
  [report],
);

  return (
    <div className="grid grid-cols-1 gap-6">
      {/* 1d. Tid — vart timmarna tog vägen.

          ⚠️ `time === null` betyder att användaren saknar `time.entry.read.all`. Sektionen
          uteblir då HELT — inte som ett "du saknar behörighet"-kort, för en yta som skyltar
          med vad den döljer inbjuder till att någon ber om nyckeln utan att veta varför den
          finns. Se kommentaren i reports.ts. */}
      {report.time ? (
      <SectionCard
        title="Tid"
        subtitle="Rapporterade timmar i perioden, uppdelat på arbetsorder, interntid och frånvaro. Frånvaro räknas inte som arbetad tid. Timmarna är vad som rapporterats — inte vad som attesterats."
        action={<ExportButton onClick={() => downloadCsv(
          `tid_${report.range.from}_${report.range.to}.csv`,
          ['Person', 'Arbetsorder (h)', 'Internt (h)', 'Arbetad tid (h)', 'Frånvaro (h)'],
          // `?? []`: TypeScripts narrowing av `report.time` når inte in i den här callbacken,
          // och en non-null-assertion hade dolt just det null-fall grinden finns för.
          (report.time?.byPerson ?? []).map((person) => [
            person.userName,
            // En decimal även här: hela timmar per rad summerar inte till totalen.
            csvHours(person.workOrderMinutes),
            csvHours(person.internalMinutes),
            csvHours(person.workedMinutes),
            csvHours(person.absenceMinutes),
          ]),
        )} />}
      >
        {report.time.unavailable ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-8 text-center text-sm text-amber-800">
            Tiden kunde inte räknas. Övriga siffror på sidan är opåverkade.
          </div>
        ) : report.time.entries === 0 && report.time.unreadableEntries === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-5 py-8 text-center text-sm text-slate-500">
            Ingen tid rapporterad i perioden.
          </div>
        ) : (
          <div className="grid gap-5">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatTile
                label="Arbetad tid"
                value={formatHours(report.time.workedMinutes)}
                // ⚠️ "har rapporterat", inte "personer". Talet räknar alla med minst en rad —
                // även den som bara fyllt i frånvaro — och stod det bara "11 personer" under
                // rubriken "Arbetad tid" hade det lästs som att elva personer producerade dem.
                sub={`${formatCount(report.time.people)} har rapporterat · ${formatCount(report.time.entries)} rader`}
              />
              <StatTile
                label="På arbetsorder"
                value={formatHours(report.time.workOrderMinutes)}
                sub={(() => {
                  const pct = share(report.time.workOrderMinutes, report.time.workedMinutes);
                  return pct == null ? 'ingen arbetad tid' : `${Math.round(pct)} % av arbetad tid`;
                })()}
              />
              <StatTile
                label="Interntid"
                value={formatHours(report.time.internalMinutes)}
                sub={(() => {
                  const pct = share(report.time.internalMinutes, report.time.workedMinutes);
                  return pct == null ? 'ingen arbetad tid' : `${Math.round(pct)} % av arbetad tid`;
                })()}
              />
              <StatTile
                label="Frånvaro"
                value={formatHours(report.time.absenceMinutes)}
                sub="ingår inte i arbetad tid"
              />
            </div>

            {/* ⚠️ MÅSTE SYNAS. En rad utan både minuter och timmar räknas inte, och utan den här
                raden skiljer sig summan från antalet rapporterade rader utan att något ser
                trasigt ut. */}
            {report.time.unreadableEntries > 0 ? (
              <p className="m-0 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
                {formatCount(report.time.unreadableEntries)} tidrader saknar både minuter och
                timmar och kunde inte räknas. De ingår inte i summorna ovan.
              </p>
            ) : null}

            <div>
              <p className="mb-2 mt-0 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                Timmar per månad
              </p>
              <div className="h-56 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={timeMonthData} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eef2f0" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#64748b' }} />
                    {/* ⚠️ INGEN AVRUNDNING TILL HEL TIMME. Domänen är minuter, och på en liten
                        skala lägger Recharts sina streck på 0/30/60/90/120 — avrundade blev de
                        "0","1","1","2","2", alltså en axel med upprepade etiketter. Decimalen
                        visas bara när den behövs. */}
                    <YAxis
                      tickFormatter={(v) => {
                        const hours = Number(v) / 60;
                        return new Intl.NumberFormat('sv-SE', {
                          maximumFractionDigits: Number.isInteger(hours) ? 0 : 1,
                        }).format(hours);
                      }}
                      tick={{ fontSize: 12, fill: '#64748b' }}
                      width={44}
                    />
                    {/* En decimal, samma som tabellen under: ett 25-minuterssegment får inte
                        säga "0 h" i tooltipen medan raden nedanför säger "0,4 h". */}
                    <Tooltip formatter={(value, name) => [formatHours(Number(value), 1), name]} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    {/* Staplade: månadens höjd är den rapporterade tiden, och delarna syns i den. */}
                    <Bar dataKey="workOrderMinutes" name="Arbetsorder" stackId="tid" fill={COLOR_WORK_ORDER} maxBarSize={44} />
                    <Bar dataKey="internalMinutes" name="Internt" stackId="tid" fill={COLOR_INTERNAL} maxBarSize={44} />
                    <Bar dataKey="absenceMinutes" name="Frånvaro" stackId="tid" fill={COLOR_ABSENCE} radius={[4, 4, 0, 0]} maxBarSize={44} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="grid gap-5 lg:grid-cols-2">
              {report.time.byInternalProject.length > 0 ? (
                <div>
                  <p className="mb-2 mt-0 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                    Interntid per projekt
                  </p>
                  <table className="w-full border-collapse text-sm">
                    <tbody>
                      {report.time.byInternalProject.map((row) => (
                        <tr key={row.label ?? '(saknas)'} className="border-b border-slate-100 last:border-b-0">
                          <td className={cn('py-1.5 pr-3', row.label == null && 'text-slate-400')}>
                            {row.label ?? MISSING_LABEL}
                          </td>
                          <td className="py-1.5 text-right tabular-nums text-slate-700">{formatHours(row.minutes, 1)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}

              {report.time.byAbsenceReason.length > 0 ? (
                <div>
                  <p className="mb-2 mt-0 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                    Frånvaro per orsak
                  </p>
                  <table className="w-full border-collapse text-sm">
                    <tbody>
                      {report.time.byAbsenceReason.map((row) => (
                        <tr key={row.label ?? '(saknas)'} className="border-b border-slate-100 last:border-b-0">
                          <td className={cn('py-1.5 pr-3', row.label == null && 'text-slate-400')}>
                            {row.label ?? MISSING_LABEL}
                          </td>
                          <td className="py-1.5 text-right tabular-nums text-slate-700">{formatHours(row.minutes, 1)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>

            {report.time.byPerson.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[620px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-[11px] font-bold uppercase tracking-[0.1em] text-slate-400">
                      <th className="py-2 pr-3">Person</th>
                      <th className="py-2 px-3 text-right">Arbetsorder</th>
                      <th className="py-2 px-3 text-right">Internt</th>
                      <th className="py-2 px-3 text-right">Arbetad tid</th>
                      <th className="py-2 pl-3 text-right">Frånvaro</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.time.byPerson.map((person) => (
                      <tr key={person.userId} className="border-b border-slate-100 last:border-b-0">
                        <td className="py-2 pr-3 font-medium text-slate-800">{person.userName}</td>
                        <td className="py-2 px-3 text-right tabular-nums text-slate-600">{formatHours(person.workOrderMinutes, 1)}</td>
                        <td className="py-2 px-3 text-right tabular-nums text-slate-600">{formatHours(person.internalMinutes, 1)}</td>
                        <td className="py-2 px-3 text-right tabular-nums font-semibold text-slate-800">{formatHours(person.workedMinutes, 1)}</td>
                        <td className="py-2 pl-3 text-right tabular-nums text-slate-500">{formatHours(person.absenceMinutes, 1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        )}
      </SectionCard>
      ) : null}
    </div>
  );
}
