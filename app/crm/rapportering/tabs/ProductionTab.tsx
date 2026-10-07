"use client";

import { useMemo } from 'react';
import {
  ResponsiveContainer, BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import type { SalesReport } from '@/lib/domains/crm/reports';
import {
  REPORT_RANGE_LABELS,
  reportPeriodEnd,
  type ReportRangeKey,
} from '../reportRanges';
import {
  ExportButton,
  SectionCard,
  StatTile,
  downloadCsv,
  formatCount,
  formatCurrency,
  formatMonth,
  formatRangeLabel,
} from '../reportUi';

// Produktion: dagens sektion "Produktion — planerat mot utfall", flyttad hit oförändrad (spec
// 2026-10-07). Bara periodväljaren gäller här.

const COLOR_SACKS = '#0284c7'; // sky — samma ton som säcklinjen i planeringens insikter
// Planerat ritas dämpat och utfallet mättat: ögat ska dras till vad som FAKTISKT hände, med planen
// som bakgrund att läsa det mot — inte tvärtom.
const COLOR_PLANNED = '#b6c9d9';

const MATERIAL_UNKNOWN_LABEL = 'Okänt material';

/** Materialets etikett. `null` betyder att raden saknar material — aldrig ett påhittat namn. */
function materialLabel(material: string | null): string {
  return material ?? MATERIAL_UNKNOWN_LABEL;
}

/**
 * "Perioden slutar idag — resten räknas inte."
 *
 * ⚠️ FINNS FÖR ATT PLANERAT ARBETE LIGGER I FRAMTIDEN. På en onsdag visade "Denna vecka"
 * 45 175 kr planerat för Södertälje-bilen medan planeringskalendern visade 102 877 kr för hela
 * veckan — båda rätt, men bara den ena syntes, och etiketten "Denna vecka" inbjöd till fel läsning.
 *
 * Perioden ändras INTE. Att låta planerat räknas till söndag medan utfallet slutar på onsdag hade
 * ställt en hel veckas plan mot tre dagars utfall, och jobbet sett ut att ligga efter varje gång
 * någon tittade mitt i veckan. I stället skrivs avgränsningen ut.
 */
function PeriodEndsTodayNote({ activeRangeKey, rangeTo }: { activeRangeKey: ReportRangeKey | null; rangeTo: string }) {
  // Bara för snabbknapparna: en egen vald slutdag är ett medvetet val och behöver ingen förklaring.
  if (!activeRangeKey) return null;
  const periodEnd = reportPeriodEnd(activeRangeKey);
  if (!periodEnd || periodEnd <= rangeTo) return null;

  const label = REPORT_RANGE_LABELS.find(([key]) => key === activeRangeKey)?.[1] ?? 'Perioden';
  // Resten börjar dagen EFTER periodens slut — idag är redan medräknad. UTC-förankrat: datumen är
  // kalenderdagar, aldrig tidpunkter.
  const restFrom = new Date(Date.parse(`${rangeTo}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  return (
    <p className="m-0 rounded-lg border border-[#cfdcc9] bg-[#f9fbf7] px-3 py-2 text-[12px] text-slate-600">
      <strong className="font-semibold text-slate-800">Perioden slutar idag ({formatRangeLabel(rangeTo, rangeTo)}).</strong>{' '}
      Resten av perioden ({formatRangeLabel(restFrom, periodEnd)}) räknas inte — varken planerat
      eller utfall. Planeringskalendern visar hela {label.toLowerCase()}, så dess siffror är högre.
    </p>
  );
}

export default function ProductionTab({ report, activeRangeKey }: { report: SalesReport; activeRangeKey: ReportRangeKey | null }) {
  // Samma etikettregel som försäljningsserien, så månaderna går att läsa mot varandra.
  // Planerat och utfall delar månadsaxel (båda byggs ur `months` på servern), så de kan ställas
  // i samma punkt utan att någon rad behöver matchas ihop.
  const productionMonthData = useMemo(() => {
    if (!report) return [];
    const plannedByMonth = new Map(report.planned.byMonth.map((p) => [p.period, p.sacks]));
    // ⚠️ null, INTE 0, när det planerade inte gick att läsa. Recharts hoppar över null och ritar
    // ingen stapel; en nolla hade ritat en tom stapel som läses som "inget var planerat".
    const plannedUnknown = report.planned.unavailable;
    return report.production.byMonth.map((p) => ({
      ...p,
      planned: plannedUnknown ? null : plannedByMonth.get(p.period) ?? 0,
      label: report.production.byMonth.length === 1
        ? formatRangeLabel(report.range.from, report.range.to)
        : formatMonth(p.period),
    }));
  }, [report]);

  // Materialen slås ihop på nyckeln, inte på ordningen: listorna sorteras var för sig och ett
  // material kan finnas i den ena men inte i den andra (planerat men inte blåst, eller tvärtom).
  const productionMaterialData = useMemo(() => {
    if (!report) return [];
    const keys: Array<string | null> = [];
    const push = (material: string | null) => { if (!keys.some((k) => k === material)) keys.push(material); };
    for (const row of report.production.byMaterial) push(row.material);
    for (const row of report.planned.byMaterial) push(row.material);
    return keys
      .map((material) => ({
        material,
        label: materialLabel(material),
        sacks: report.production.byMaterial.find((r) => r.material === material)?.sacks ?? 0,
        planned: report.planned.unavailable
          ? null
          : report.planned.byMaterial.find((r) => r.material === material)?.sacks ?? 0,
      }))
      // Okänt sist, precis som i de två källistorna.
      .sort((a, b) => {
        if ((a.material === null) !== (b.material === null)) return a.material === null ? 1 : -1;
        return (b.sacks + (b.planned ?? 0)) - (a.sacks + (a.planned ?? 0));
      });
  }, [report]);

  // Bilraderna: utfallet som grund, planerat inflätat. En bil som var PLANERAD men inte
  // rapporterade något måste också med — annars försvinner just de rader man vill titta på.
  const productionTruckRows = useMemo(() => {
    if (!report) return [];
    const plannedByTruck = new Map(report.planned.byTruck.map((t) => [t.truck_id, t]));
    // ⚠️ null = "gick inte att läsa", 0 = "inget planerat". Tabellen, exporten och diagrammen
    // måste skilja dem åt precis som brickorna ovan gör — annars läses en trasig läsning som att
    // ingenting var inplanerat, vilket är ett påstående om verksamheten.
    const unknown = report.planned.unavailable;
    const rows = report.production.byTruck.map((truck) => ({
      ...truck,
      plannedSacks: unknown ? null : plannedByTruck.get(truck.truck_id)?.sacks ?? 0,
      plannedRevenue: unknown ? null : plannedByTruck.get(truck.truck_id)?.revenue ?? 0,
    }));
    for (const planned of report.planned.byTruck) {
      if (rows.some((r) => r.truck_id === planned.truck_id)) continue;
      rows.push({
        truck_id: planned.truck_id,
        truck_name: planned.truck_name,
        sacks: 0,
        bookedDays: 0,
        utilization: report.production.workingDays > 0 ? 0 : null,
        plannedSacks: planned.sacks as number | null,
        plannedRevenue: planned.revenue as number | null,
      });
    }
    return rows;
  }, [report]);

  return (
    <div className="grid grid-cols-1 gap-6">
      {/* 1c. Produktion — vad som faktiskt blåstes */}
      <SectionCard
        title="Produktion — planerat mot utfall"
        subtitle="Planerat arbete i perioden mot vad som faktiskt blåstes. Utfallet läses ur säckboken: finns en egenkontroll är den jobbets sanning, annars summan av delrapporterna. Ett jobbs planerade värde fördelas över de dagar det utförs, så bara den del som ligger i perioden räknas. Beläggningen är bokade arbetsdagar (mån–fre minus röda dagar och aftnar)."
        action={<ExportButton onClick={() => downloadCsv(
          `produktion_${report.range.from}_${report.range.to}.csv`,
          ['Bil', 'Planerade säckar', 'Blåsta säckar', 'Planerad omsättning (ex moms)', 'Bokade arbetsdagar', 'Arbetsdagar i perioden', 'Beläggning (%)'],
          productionTruckRows.map((truck) => [
            truck.truck_name,
            truck.plannedSacks == null ? '' : Math.round(truck.plannedSacks),
            truck.sacks,
            truck.plannedRevenue == null ? '' : Math.round(truck.plannedRevenue),
            truck.bookedDays,
            report.production.workingDays,
            truck.utilization == null ? '' : Math.round(truck.utilization),
          ]),
        )} />}
      >
        {/* Tre tomma lägen med tre olika svar — samma regel som lönsamheten. */}
        {report.production.unavailable ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-8 text-center text-sm text-amber-800">
            Produktionen kunde inte räknas. Övriga siffror på sidan är opåverkade.
          </div>
        ) : report.production.reportCount === 0 && productionTruckRows.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-5 py-8 text-center text-sm text-slate-500">
            Inget rapporterat och inget schemalagt i perioden.
          </div>
        ) : (
          <div className="grid gap-5">
            <PeriodEndsTodayNote activeRangeKey={activeRangeKey} rangeTo={report.range.to} />

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatTile
                label="Säckar planerade"
                value={report.planned.unavailable ? '–' : formatCount(Math.round(report.planned.sacks))}
                sub={report.planned.unavailable ? 'kunde inte räknas' : 'schemalagt i perioden'}
              />
              <StatTile
                label="Säckar blåsta"
                value={formatCount(report.production.totalSacks)}
                sub={`${report.production.reportCount} rapporter som räknas`}
              />
              <StatTile
                label="Planerad omsättning"
                value={report.planned.unavailable ? '–' : formatCurrency(report.planned.revenue)}
                sub={report.planned.unavailable ? 'kunde inte räknas' : 'arbete som utförs i perioden'}
              />
              <StatTile
                label="Jobb rapporterade"
                value={formatCount(report.production.jobs)}
                sub={`${formatCount(report.production.workingDays)} arbetsdagar i perioden`}
              />
            </div>

            {/* ⚠️ BACKLOGGEN HAR INGEN PERIOD. Den svarar på "vad väntar just nu" och ändras
                inte när man byter periodfilter. Utan etiketten läses den som periodens siffra —
                och skulle då säga att det låg 5 Mkr oplanerat i juni, vilket ingen vet. */}
            {report.planned.backlog ? (
              <div className="grid gap-3 rounded-xl border border-dashed border-[#cfdcc9] bg-[#f9fbf7] p-3 sm:grid-cols-2">
                <div className="sm:col-span-2 -mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                  Just nu · oberoende av vald period
                </div>
                <StatTile
                  label="Oplanerat värde"
                  value={formatCurrency(report.planned.backlog.revenue)}
                  sub={`${formatCount(report.planned.backlog.sacks)} säck väntar på planering`}
                />
                <StatTile
                  label="Oplanerade jobb"
                  value={formatCount(report.planned.backlog.count)}
                  sub="väntar på att placeras"
                />
              </div>
            ) : null}

            {/* ⚠️ MÅSTE SYNAS. Utan raden skiljer sig totalen ovan från summan av bilstaplarna
                utan att något ser trasigt ut, och den som räknar efter för hand får fel svar. */}
            {report.production.sacksWithoutTruck > 0 ? (
              <p className="m-0 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
                {formatCount(report.production.sacksWithoutTruck)} säckar kunde inte knytas till
                någon bil och ingår därför i totalen men inte i tabellen nedan.
              </p>
            ) : null}

            {report.production.totalSacks > 0 || report.planned.sacks > 0 ? (
              <div className="grid gap-5 lg:grid-cols-2">
                <div>
                  <p className="mb-2 mt-0 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                    Säckar per månad
                  </p>
                  <div className="h-56 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={productionMonthData} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#eef2f0" vertical={false} />
                        <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#64748b' }} />
                        <YAxis tick={{ fontSize: 12, fill: '#64748b' }} width={44} />
                        <Tooltip formatter={(value, name) => [`${formatCount(Math.round(Number(value)))} säck`, name]} />
                        <Legend wrapperStyle={{ fontSize: 12 }} />
                        <Bar dataKey="planned" name="Planerat" fill={COLOR_PLANNED} radius={[4, 4, 0, 0]} maxBarSize={28} />
                        <Bar dataKey="sacks" name="Blåst" fill={COLOR_SACKS} radius={[4, 4, 0, 0]} maxBarSize={28} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div>
                  <p className="mb-2 mt-0 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                    Säckar per material
                  </p>
                  <div className="h-56 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={productionMaterialData} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#eef2f0" vertical={false} />
                        <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} />
                        <YAxis tick={{ fontSize: 12, fill: '#64748b' }} width={44} />
                        <Tooltip formatter={(value, name) => [`${formatCount(Math.round(Number(value)))} säck`, name]} />
                        <Legend wrapperStyle={{ fontSize: 12 }} />
                        <Bar dataKey="planned" name="Planerat" fill={COLOR_PLANNED} radius={[4, 4, 0, 0]} maxBarSize={36} />
                        {/* `fill` MÅSTE stå här trots att varje Cell sätter sin egen: utan den
                            kan legenden inte härleda seriens färg och ritar en svart ruta. */}
                        <Bar dataKey="sacks" name="Blåst" fill={COLOR_SACKS} radius={[4, 4, 0, 0]} maxBarSize={36}>
                          {productionMaterialData.map((row) => (
                            // Okänt material i grått: det är en lucka i underlaget, inte ett
                            // material som ska konkurrera visuellt med de riktiga.
                            <Cell key={row.label} fill={row.material == null ? '#94a3b8' : COLOR_SACKS} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            ) : null}

            {/* Bilarna som tabell, inte som diagram: raden bär två tal (säckar OCH beläggning)
                som betyder olika saker, och ett diagram hade tvingat fram en gemensam skala. */}
            {productionTruckRows.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[520px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-[11px] font-bold uppercase tracking-[0.1em] text-slate-400">
                      <th className="py-2 pr-3">Bil</th>
                      <th className="py-2 px-3 text-right">Planerat</th>
                      <th className="py-2 px-3 text-right">Blåst</th>
                      <th className="py-2 px-3 text-right">Planerad omsättning</th>
                      <th className="py-2 px-3 text-right">Bokade dagar</th>
                      <th className="py-2 pl-3">Beläggning</th>
                    </tr>
                  </thead>
                  <tbody>
                    {productionTruckRows.map((truck) => (
                      <tr key={truck.truck_id} className="border-b border-slate-100 last:border-b-0">
                        <td className="py-2 pr-3 font-medium text-slate-800">{truck.truck_name}</td>
                        <td className="py-2 px-3 text-right tabular-nums text-slate-500">{truck.plannedSacks == null ? '–' : formatCount(Math.round(truck.plannedSacks))}</td>
                        <td className="py-2 px-3 text-right tabular-nums font-semibold text-slate-800">{formatCount(truck.sacks)}</td>
                        <td className="py-2 px-3 text-right tabular-nums text-slate-600">{truck.plannedRevenue == null ? '–' : formatCurrency(truck.plannedRevenue)}</td>
                        <td className="py-2 px-3 text-right tabular-nums text-slate-600">
                          {formatCount(truck.bookedDays)} / {formatCount(report.production.workingDays)}
                        </td>
                        <td className="py-2 pl-3">
                          {truck.utilization == null ? (
                            <span className="text-slate-400">–</span>
                          ) : (
                            <div className="flex items-center gap-2">
                              <div className="h-1.5 w-full max-w-[120px] rounded-full bg-slate-100">
                                <div
                                  className="h-1.5 rounded-full"
                                  style={{
                                    width: `${Math.max(2, Math.min(100, truck.utilization))}%`,
                                    backgroundColor: 'var(--crm-primary)',
                                  }}
                                />
                              </div>
                              <span className="tabular-nums text-slate-600">{Math.round(truck.utilization)} %</span>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        )}
      </SectionCard>
    </div>
  );
}
