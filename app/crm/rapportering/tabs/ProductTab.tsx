"use client";

import { cn } from '@/lib/shared/cn';
import type { SalesReport } from '@/lib/domains/crm/reports';
// Bara typer ur domänen: reportProduct.ts drar in serverkod, och en körtidsimport hade tagit med den i
// klientpaketet. Allt räknas i rutten.
import type { DepotRow } from '@/lib/domains/crm/reportProduct';
import { constructionLabel } from '@/lib/domains/crm/constructions';
import {
  BAR_FILL,
  BAR_FILL_MUTED,
  BAR_TRACK,
  BarList,
  BarRow,
  EmptyChart,
  ExportButton,
  KpiCard,
  KpiNote,
  ScopeChip,
  SectionCard,
  Unavailable,
  downloadCsv,
  formatCount,
  formatCurrency,
  formatM3,
  formatMonthLong,
  formatPercent,
} from '../reportUi';
import VolumeByMonthChart from './VolumeByMonthChart';

// Produkt & marknad: "Vad säljer vi, och var?" (spec 2026-10-07, 4.5). Sålda m³ och kr/m³, per
// konstruktion och per material, m³ per månad — och fakturerat och orderstock per depå.

function formatPrice(value: number | null) {
  return value == null ? '–' : `${formatCurrency(value)}/m³`;
}

/** "363 kr/m³ · 12 order" under en rad i en stapellista. */
function volumeSub(row: { pricePerM3: number | null; orders: number }) {
  return `${formatPrice(row.pricePerM3)} · ${formatCount(row.orders)} order`;
}

// Okänt material heter "Övrigt/okänt" här (specen); materialen själva står med sina kortnamn, som under
// Produktion, så att samma material heter samma sak på båda flikarna.
const MATERIAL_UNKNOWN_LABEL = 'Övrigt/okänt';
const CONSTRUCTION_MISSING_LABEL = 'Saknas';

const DEPOT_SPECIAL: Record<Exclude<DepotRow['kind'], 'depot'>, { label: string; sub: string }> = {
  no_depot: { label: 'Bil utan depå', sub: 'Bilen saknar depå under Planering' },
  unplanned: { label: 'Ej planerad', sub: 'Inget på schemat' },
};

function depotLabel(row: DepotRow) {
  return row.kind === 'depot' ? row.name ?? 'Okänd depå' : DEPOT_SPECIAL[row.kind].label;
}

/** En stapel med sitt tal, i en tabellcell. `share` null ritar ett tomt spår. */
function DepotBar({ share, value, orders, muted }: { share: number | null; value: string; orders: number | null; muted: boolean }) {
  return (
    // Talets kolumn har fast bredd, så att spåren blir lika långa på alla rader och staplarna går att jämföra.
    <div className="grid grid-cols-[minmax(3rem,1fr)_8.75rem] items-center gap-3">
      <span className={cn('h-2.5 overflow-hidden rounded-full', BAR_TRACK)} aria-hidden="true">
        {share != null ? (
          <span
            className={cn('block h-full rounded-full', muted ? BAR_FILL_MUTED : BAR_FILL)}
            style={{ width: `${Math.max(0, Math.min(100, share))}%` }}
          />
        ) : null}
      </span>
      <span className="whitespace-nowrap text-right font-semibold tabular-nums text-slate-800">
        {value}
        {orders != null ? <span className="ml-1.5 font-normal text-slate-500">{formatCount(orders)} st</span> : null}
      </span>
    </div>
  );
}

function DepotTable({ rows, periodLabel }: { rows: DepotRow[]; periodLabel: string }) {
  const invoicedMax = Math.max(0, ...rows.map((r) => r.invoiced));
  const stockMax = Math.max(0, ...rows.map((r) => r.stock ?? 0));
  const stockAvailable = rows.every((r) => r.stock != null);
  const invoicedTotal = rows.reduce((t, r) => t + r.invoiced, 0);
  const stockTotal = rows.reduce((t, r) => t + (r.stock ?? 0), 0);
  const firstSpecial = rows.findIndex((r) => r.kind !== 'depot');
  // Tre kolumner från sm och uppåt; på en telefon står de två talen under depånamnet, var och ett med
  // sin rubrik — en tabell som rullar i sidled gömmer beloppen utanför skärmen.
  const columns = 'sm:grid-cols-[minmax(8rem,24%)_minmax(0,1fr)_minmax(0,1fr)] sm:gap-6';
  // Versalerna bara på rubriken, inte på chippet — det står med gemener på alla andra kort.
  const headClass = 'text-[11px] font-bold uppercase tracking-[0.1em] text-slate-500';
  const invoicedHead = <span className="inline-flex items-center gap-2"><span className={headClass}>Fakturerat</span><ScopeChip>{periodLabel}</ScopeChip></span>;
  const stockHead = <span className="inline-flex items-center gap-2"><span className={headClass}>Orderstock</span><ScopeChip now>Nu</ScopeChip></span>;

  return (
    <div className="grid gap-3">
      <div className={cn('hidden items-center border-b border-slate-200 pb-2 sm:grid', columns)} aria-hidden="true">
        <span className={headClass}>Depå</span>
        {invoicedHead}
        {stockHead}
      </div>
      <ul className="m-0 grid list-none gap-0 p-0">
        {rows.map((row, index) => {
          const special = row.kind !== 'depot';
          return (
            <li
              key={row.kind === 'depot' ? row.depotId ?? index : row.kind}
              // Linjen skiljer depåerna från de två raderna som inte är någon depå.
              className={cn(
                'grid gap-2 border-b border-slate-100 py-2.5 text-[13px] last:border-b-0 sm:items-center',
                columns,
                index === firstSpecial && index > 0 && 'border-t border-t-slate-300',
              )}
            >
              <span className="min-w-0">
                <span className={cn('block font-medium leading-tight', special ? 'text-slate-500' : 'text-slate-800')}>{depotLabel(row)}</span>
                {special ? <span className="block text-[11px] text-slate-500">{DEPOT_SPECIAL[row.kind as Exclude<DepotRow['kind'], 'depot'>].sub}</span> : null}
              </span>
              <span className="grid gap-1">
                <span className="sm:hidden">{invoicedHead}</span>
                <DepotBar
                  share={invoicedMax > 0 ? (row.invoiced / invoicedMax) * 100 : 0}
                  value={formatCurrency(row.invoiced)}
                  orders={row.invoicedOrders}
                  muted={special}
                />
              </span>
              <span className="grid gap-1">
                <span className="sm:hidden">{stockHead}</span>
                {row.stock == null ? (
                  <span className="text-slate-400">–</span>
                ) : (
                  <DepotBar
                    share={stockMax > 0 ? (row.stock / stockMax) * 100 : 0}
                    value={formatCurrency(row.stock)}
                    orders={row.stockOrders}
                    muted={special}
                  />
                )}
              </span>
            </li>
          );
        })}
      </ul>
      {stockAvailable ? null : <Unavailable>Orderstocken kunde inte räknas. Fakturerat per depå är opåverkat.</Unavailable>}
      <p className="m-0 text-[12px] text-slate-500">
        Fakturerat summerar till periodens fakturerat, {formatCurrency(invoicedTotal)}
        {stockAvailable ? <>, och orderstocken till Översiktens orderstock, {formatCurrency(stockTotal)}</> : null}.
        En order på flera depåer räknas till den depå där den har flest arbetsdagar på schemat; vid lika den där jobbet började.
      </p>
    </div>
  );
}

export default function ProductTab({ report, periodLabel }: { report: SalesReport; periodLabel: string }) {
  const product = report.product;
  const volume = product?.volume ?? null;
  const months = product?.volumeByMonth ?? null;
  const depots = product?.depots ?? null;
  const period = <ScopeChip>{periodLabel}</ScopeChip>;
  const constructionMax = volume ? Math.max(0, ...volume.byConstruction.map((c) => c.m3)) : 0;
  const materialMax = volume ? Math.max(0, ...volume.byMaterial.map((m) => m.m3)) : 0;
  const nothingSold = volume != null && volume.total.m3 === 0;

  return (
    <div className="grid grid-cols-1 gap-6">
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-5">
        <div className="min-w-0 xl:col-span-2">
          <SectionCard title="Nyckeltal" subtitle="Det som sålts på order skapade i perioden, inte det som blåsts — blåsta säckar står under Produktion. Exklusive moms. Avbrutna order räknas inte.">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-1">
              <KpiCard
                label="Sålda m³"
                scope={period}
                value={volume ? formatM3(volume.total.m3) : '–'}
                muted={volume == null}
                definition="Kubikmeter på orderrader som prissätts per m³ (yta × tjocklek), på order skapade i perioden. Styckrader som etablering och vindduk räknas inte."
              >
                {!volume ? (
                  <Unavailable />
                ) : nothingSold ? (
                  <KpiNote>Inga m³-rader på periodens order</KpiNote>
                ) : (
                  <KpiNote>{formatCount(volume.total.orders)} order · {formatCurrency(volume.total.value)}</KpiNote>
                )}
              </KpiCard>

              <KpiCard
                label="Snittpris"
                scope={period}
                value={formatPrice(volume?.total.pricePerM3 ?? null)}
                muted={volume?.total.pricePerM3 == null}
                definition="m³-radernas pris delat med antal m³: summan delad med summan, så en stor rad väger mer än en liten. Exklusive moms och före ROT-avdraget — arbetskostnad som bryts ut för ROT är en del av radens pris."
              >
                {!volume ? <Unavailable /> : nothingSold ? <KpiNote>Inga m³ sålda i perioden</KpiNote> : <KpiNote>exklusive moms, före ROT-avdrag</KpiNote>}
              </KpiCard>
            </div>
          </SectionCard>
        </div>

        <div className="min-w-0 xl:col-span-3">
          <SectionCard
            title="Sålda m³ per månad"
            subtitle={months && months.length > 0
              ? `${formatMonthLong(months[0].period)} till ${formatMonthLong(months[months.length - 1].period)}, oavsett vald period. Order skapade i månaden.`
              : undefined}
            action={months ? (
              <ExportButton onClick={() => downloadCsv(
                `salda-m3-per-manad_${months[0]?.period ?? ''}_${months.at(-1)?.period ?? ''}.csv`,
                ['Månad', 'm³', 'Värde (ex moms)', 'kr/m³ (ex moms)', 'Delmånad'],
                months.map((m) => [
                  m.period, Math.round(m.m3 * 100) / 100, Math.round(m.value), m.pricePerM3 != null ? Math.round(m.pricePerM3) : '',
                  m.partial ? `${m.partial.from} – ${m.partial.to}` : '',
                ]),
              )} />
            ) : undefined}
          >
            {months ? <VolumeByMonthChart months={months} /> : <Unavailable />}
          </SectionCard>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <div className="min-w-0">
          <SectionCard
            title="Per konstruktion"
            subtitle="Var i huset isoleringen sitter, enligt orderraden. Rader utan konstruktion står som Saknas."
            action={volume && !nothingSold ? (
              <ExportButton onClick={() => downloadCsv(
                `per-konstruktion_${report.range.from}_${report.range.to}.csv`,
                ['Konstruktion', 'm³', 'Värde (ex moms)', 'kr/m³ (ex moms)', 'Order'],
                volume.byConstruction.map((c) => [
                  c.construction ? constructionLabel(c.construction) : CONSTRUCTION_MISSING_LABEL,
                  Math.round(c.m3 * 100) / 100, Math.round(c.value), c.pricePerM3 != null ? Math.round(c.pricePerM3) : '', c.orders,
                ]),
              )} />
            ) : undefined}
          >
            {!volume ? <Unavailable /> : nothingSold ? <EmptyChart /> : (
              <BarList>
                {volume.byConstruction.map((row) => (
                  <BarRow
                    key={row.construction ?? 'saknas'}
                    label={row.construction ? constructionLabel(row.construction) : CONSTRUCTION_MISSING_LABEL}
                    sub={volumeSub(row)}
                    share={constructionMax > 0 ? (row.m3 / constructionMax) * 100 : 0}
                    value={formatM3(row.m3)}
                    muted={row.construction == null}
                  />
                ))}
              </BarList>
            )}
          </SectionCard>
        </div>

        <div className="min-w-0">
          <SectionCard
            title="Per material"
            subtitle="Materialet känns igen på artikelnamnet. Andelen är av periodens sålda m³."
            action={volume && !nothingSold ? (
              <ExportButton onClick={() => downloadCsv(
                `per-material_${report.range.from}_${report.range.to}.csv`,
                ['Material', 'm³', 'Andel av m³ (%)', 'Värde (ex moms)', 'kr/m³ (ex moms)', 'Order'],
                volume.byMaterial.map((m) => [
                  m.material ?? MATERIAL_UNKNOWN_LABEL,
                  Math.round(m.m3 * 100) / 100, m.share != null ? Math.round(m.share * 10) / 10 : '', Math.round(m.value),
                  m.pricePerM3 != null ? Math.round(m.pricePerM3) : '', m.orders,
                ]),
              )} />
            ) : undefined}
          >
            {!volume ? <Unavailable /> : nothingSold ? <EmptyChart /> : (
              <BarList>
                {volume.byMaterial.map((row) => (
                  <BarRow
                    key={row.material ?? 'okant'}
                    label={row.material ?? MATERIAL_UNKNOWN_LABEL}
                    sub={volumeSub(row)}
                    share={materialMax > 0 ? (row.m3 / materialMax) * 100 : 0}
                    value={formatM3(row.m3)}
                    extra={formatPercent(row.share)}
                    muted={row.material == null}
                  />
                ))}
              </BarList>
            )}
          </SectionCard>
        </div>
      </div>

      <SectionCard
        title="Per depå"
        subtitle="Order → schemat → bilen → bilens depå. Fakturerat följer perioden; orderstocken är läget just nu. Exklusive moms."
        action={depots ? (
          <ExportButton onClick={() => downloadCsv(
            `per-depa_${report.range.from}_${report.range.to}.csv`,
            ['Depå', 'Fakturerat i perioden (ex moms)', 'Order fakturerade', 'Orderstock nu (ex moms)', 'Order i orderstocken'],
            depots.map((d) => [depotLabel(d), Math.round(d.invoiced), d.invoicedOrders, d.stock != null ? Math.round(d.stock) : '', d.stockOrders ?? '']),
          )} />
        ) : undefined}
      >
        {!depots ? <Unavailable /> : depots.length === 0 ? <EmptyChart /> : <DepotTable rows={depots} periodLabel={periodLabel} />}
      </SectionCard>
    </div>
  );
}
