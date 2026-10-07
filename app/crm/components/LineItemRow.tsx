"use client";

import Input from '../../../components/ui/Input';
import Select from '../../../components/ui/Select';
import { cn } from '@/lib/shared/cn';
import { parseDecimal } from '@/lib/shared/number';
import { splitRowLabor, marginTier, marginPercentForDisplay, MARGIN_THRESHOLDS, type MarginTier } from '@/lib/domains/crm/pricing';
import { ROT_HOUSE_WORK_TYPES, ROT_HOUSE_WORK_LABELS } from '@/lib/domains/fortnox/types';
import { formatCurrency, formatQuantity } from '@/app/crm/lib/format';
import ArticlePicker, { type ArticleLite } from './ArticlePicker';
import {
  lineItemSubline, lineItemUnitLabel, formatUnitPrice, formatDiscount, ROW_OUTER, INNER_BASE, innerColumns,
} from './lineItemTable';

// En artikelrad i en tabell (# · Artikel · Mängd · À-pris · Rabatt · [TG] · Belopp) som fälls ut till en
// redigerare på plats. Delad mellan offertformuläret och arbetsorderns artikeleditor. De var två egna
// implementationer som gled isär tills orderns rader var svåra att jämföra med offertens de kom ifrån —
// andra etiketter, annan fältordning, och ingen väg att byta artikel på en befintlig rad.
//
// Montörens fältvy behåller listan (LineItemReadRow): där är det nästan alltid en telefon,
// och montören behöver måtten och säckarna, inte kolumner för à-pris och rabatt (William 2026-10-07).

/** Fälten raden läser och skriver. Offertens rad har alla, arbetsorderns ett urval (valfria). */
export type LineItemRowItem = {
  id: string;
  article_name?: string | null;
  article_number?: string | null;
  article_price?: number | null;
  article_unit_name?: string | null;
  /** Artikelns beskrivning ur registret — INTERN hjälptext, når aldrig Fortnox. */
  article_note?: string | null;
  pricing_mode?: 'm3' | 'item';
  quantity?: string;
  m2?: string;
  thickness_mm?: string;
  density?: string;
  unit_price?: string;
  discount_percent?: string;
  line_note?: string;
  is_rot_work?: boolean;
  house_work_type?: string;
  labor_cost?: string;
  include_in_description?: boolean;
  auto_price?: boolean;
};

/** Radens beräknade tal. Anroparen räknar — offerten och ordern har var sin väg dit. */
export type LineItemRowMetrics = {
  amount: number;
  /** À-pris före rabatt. */
  unit: number;
  /** À-pris efter rabatt. */
  effectiveUnit: number;
  rowTotal: number;
  isConfigured: boolean;
};

// Samma etikettrecept som offertformulärets Field — varje fil i repot bär sin egen lilla variant.
//
// `content-start` på båda nivåerna: i ekonomiraden står "Varav arbetskostnad" med hjälptext under
// sig, gridraden blir högre, och utan det töjdes A-pris- och rabattfältens INPUTS ut till samma höjd.
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid content-start gap-1.5">
      <label className="grid content-start gap-1.5">
        <span className="text-xs font-semibold text-slate-600">{label}</span>
        {children}
      </label>
    </div>
  );
}

// ─── MarginBadge ──────────────────────────────────────────────────────────────
//
// Täckningsgrad per rad, färgad efter MARGIN_THRESHOLDS. Ett stöd för säljaren att se när en
// rabatt äter marginalen — inte en spärr: rött hindrar ingen från att spara eller skicka, det
// säger att offerten behöver godkännas.
//
// Saknas inköpspris visas INGET märke alls (61 av 289 artiklar har inget). Ett grått "?" på var
// femte rad hade blivit brus, och en avsaknad av pris är inte en dålig affär.
export function MarginBadge({ marginPercent, className, bare = false }: {
  marginPercent: number | null;
  className?: string;
  /** Utan "TG" framför — i tabellens TG-kolumn står det redan i kolumnrubriken. */
  bare?: boolean;
}) {
  const tier = marginTier(marginPercent);
  if (tier === 'unknown' || marginPercent == null) return null;

  // Egna klasser i stället för Badge-primitiven: den här ska vara liten och sifferorienterad
  // (tabular-nums så procenten inte hoppar i sidled när säljaren skriver i prisfältet).
  const styles: Record<Exclude<MarginTier, 'unknown'>, string> = {
    good: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    watch: 'border-amber-200 bg-amber-50 text-amber-700',
    bad: 'border-rose-200 bg-rose-50 text-rose-700',
  };
  // Avrundad mot färgens sida om gränsen — 24,96 % fick annars ett rött "25.0 %". Samma tal som
  // offertens TG-mätare, se marginPercentForDisplay.
  const shown = marginPercentForDisplay(marginPercent).toFixed(1).replace('.', ',');
  const titles: Record<Exclude<MarginTier, 'unknown'>, string> = {
    good: `Täckningsgrad ${shown} % – över ${MARGIN_THRESHOLDS.good} %`,
    watch: `Täckningsgrad ${shown} % – grönt kräver över ${MARGIN_THRESHOLDS.good} %, se över priset`,
    bad: `Täckningsgrad ${shown} % – under ${MARGIN_THRESHOLDS.watch} %, offerten kräver godkännande`,
  };

  return (
    <span
      title={titles[tier]}
      className={cn(
        // En decimal, inte toFixed(0): 34,6 % är rött men avrundades till "TG 35 %" — märket
        // påstod exakt den tröskel det låg under. Siffran måste hamna på samma sida som färgen.
        'inline-flex items-center gap-1 rounded-md border border-solid px-1.5 py-0.5 text-[11px] font-semibold tabular-nums',
        styles[tier],
        className,
      )}
    >
      {bare ? null : 'TG '}{shown} %
    </span>
  );
}

// Hur "Varav arbetskostnad" delar radens pris, i klartext under fältet.
//
// Två saker har lästs fel i verkligheten, och raden här finns för att båda ska synas direkt:
// beloppet är ett À-PRIS som räknas mot kubiken (500 kr arbete på 10 m³ blir 5 000 kr, på 30 m³
// blir det 15 000), och det är en UTBRYTNING ur A-priset, inte ett tillägg ovanpå det.
function LaborCarveoutHint({
  laborCost, unitPrice, discountPercent, quantity, unitLabel,
}: {
  laborCost: string;
  unitPrice: number;
  discountPercent: number;
  quantity: number;
  unitLabel: string;
}) {
  const { labor, material, rowTotal, leavesNoMaterial } = splitRowLabor({
    laborCostPerUnit: laborCost, unitPrice, discountPercent, quantity,
  });

  if (leavesNoMaterial) {
    return (
      <p className="m-0 mt-1 text-[11px] leading-snug text-rose-700">
        Arbetet är hela A-priset ({formatCurrency(unitPrice, 'SEK')}/{unitLabel}) — inget material blir
        kvar. Ingen arbetskostnad bryts ut förrän det rättas. A-priset ska vara HELA priset, och det
        här beloppet den del av det som är arbete.
      </p>
    );
  }
  if (labor > 0) {
    return (
      <p className="m-0 mt-1 text-[11px] leading-snug text-slate-500">
        {formatCurrency(labor, 'SEK')} arbete av radens {formatCurrency(rowTotal, 'SEK')} — resten,
        {' '}{formatCurrency(material, 'SEK')}, är material.
      </p>
    );
  }
  return (
    <p className="m-0 mt-1 text-[11px] leading-snug text-slate-400">
      Per {unitLabel}, som A-priset. Bryts ut ur det — höjer det inte.
    </p>
  );
}

type MeasureKey = 'm2' | 'thickness_mm' | 'density' | 'quantity';

// De delar av den hopfällda raden som läsraden och den klickbara raden har gemensamt: nummer, namn,
// mängd × pris, märken och summa.
function CollapsedContent({
  row, index, metrics, details, badges, struck, emptyName,
}: {
  row: LineItemRowItem;
  index: number;
  metrics: LineItemRowMetrics | undefined;
  details?: React.ReactNode;
  badges?: React.ReactNode;
  struck?: boolean;
  /** Vad som står när raden saknar namn. Editorn uppmanar; en läsvy kan inte välja något. */
  emptyName?: string;
}) {
  const strike = struck ? 'line-through decoration-slate-400' : '';
  const name = row.article_name || <span className="text-slate-400">{emptyName ?? 'Välj artikel…'}</span>;
  return (
    <>
      <span className="shrink-0 text-xs font-semibold tabular-nums text-slate-300">{index + 1}</span>
      {details ? (
        <span className="grid min-w-0 flex-1 gap-0.5">
          <span className={cn('truncate text-sm font-medium', struck ? 'text-slate-500' : 'text-slate-800', strike)}>{name}</span>
          {/* Radbryts, kapas inte: på telefonen är det här måtten installatören läser. */}
          <span className="text-xs leading-snug text-slate-500 [overflow-wrap:anywhere]">{details}</span>
        </span>
      ) : (
        <span className={cn('min-w-0 flex-1 truncate text-sm font-medium', struck ? 'text-slate-500' : 'text-slate-800', strike)}>
          {name}
        </span>
      )}
      {metrics?.isConfigured ? (
        <span className="hidden shrink-0 text-xs tabular-nums text-slate-400 sm:inline">
          {formatQuantity(metrics.amount)} × {formatCurrency(metrics.effectiveUnit, 'SEK')}
        </span>
      ) : null}
      {row.is_rot_work ? (
        <span className="shrink-0 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">ROT</span>
      ) : null}
      {badges}
      <span className={cn('w-24 shrink-0 text-right text-sm font-semibold tabular-nums text-slate-900', strike)}>
        {formatCurrency(metrics?.rowTotal ?? 0, 'SEK')}
      </span>
    </>
  );
}

/**
 * En artikelrad i läsläge — samma hopfällda rad som i editorn, utan fäll ut och ta bort.
 * Arbetsordern visar sina rader så utanför redigeringen, så att läs- och redigeringsläget är samma
 * lista och man ser vad man ändrar ifrån.
 */
export function LineItemReadRow({
  row, index, metrics, details, badges, struck,
}: {
  row: LineItemRowItem;
  index: number;
  metrics: LineItemRowMetrics | undefined;
  details?: React.ReactNode;
  badges?: React.ReactNode;
  struck?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-100 px-3.5 py-2.5">
      {/* En namnlös rad är en ren textrad — visa texten, inte editorns uppmaning "Välj artikel…". */}
      <CollapsedContent row={row} index={index} metrics={metrics} details={details} badges={badges} struck={struck} emptyName={row.line_note?.trim() || 'Offert-rad'} />
    </div>
  );
}

// ─── Tabellen ─────────────────────────────────────────────────────────────────

/** Kolumnrubrikerna. `marginColumn` och `interactive` ska vara desamma som radernas. */
export function LineItemTableHeader({ marginColumn = false, interactive = true }: { marginColumn?: boolean; interactive?: boolean }) {
  return (
    <div className="hidden grid-cols-[1.5rem_minmax(0,1fr)] items-center gap-x-3 px-3 pb-1 pt-2 text-xs font-semibold text-slate-500 md:grid">
      <span className="text-center">#</span>
      <span className={cn(INNER_BASE, innerColumns(marginColumn, interactive))}>
        <span>Artikel</span>
        <span className="text-right">Mängd</span>
        <span className="text-right">À-pris</span>
        <span className="text-right">Rabatt</span>
        {marginColumn ? <span className="text-right">TG</span> : null}
        <span className="text-right">Belopp</span>
        {interactive ? <span /> : null}
      </span>
    </div>
  );
}

// Cellerna efter numret — samma i den klickbara raden och i läsraden.
function TableCells({
  row, metrics, marginColumn, marginPercent, details, badges, struck, emptyName, chevron,
}: {
  row: LineItemRowItem;
  metrics: LineItemRowMetrics | undefined;
  marginColumn: boolean;
  marginPercent: number | null;
  details?: React.ReactNode;
  badges?: React.ReactNode;
  struck?: boolean;
  emptyName: string;
  chevron?: React.ReactNode;
}) {
  const strike = struck ? 'line-through decoration-slate-400' : '';
  const configured = Boolean(metrics?.isConfigured);
  const unit = lineItemUnitLabel(row);
  const quantity = configured ? `${formatQuantity(metrics!.amount)} ${unit}` : '–';
  const unitPrice = configured ? formatUnitPrice(metrics!.unit) : '–';
  // Arbetsordern skickar en egen andra rad (mått, material, densitet); offerten får artikelnumret
  // och måtten volymen räknas ur.
  const subline = details ?? (lineItemSubline(row) || null);
  return (
    <>
      <span className="min-w-0">
        <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
          <span className={cn('min-w-0 truncate text-sm font-semibold', struck ? 'text-slate-500' : 'text-slate-900', strike)}>
            {row.article_name || <span className="font-medium text-slate-400">{emptyName}</span>}
          </span>
          {row.is_rot_work ? (
            <span className="shrink-0 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">ROT</span>
          ) : null}
          {badges}
        </span>
        {/* Radbryts, kapas inte: på arbetsordern är det här måtten och materialet man läser. */}
        {subline ? <span className="block text-xs leading-snug text-slate-500 [overflow-wrap:anywhere]">{subline}</span> : null}
      </span>
      <span className="hidden text-right text-sm tabular-nums text-slate-700 md:block">{quantity}</span>
      <span className="hidden text-right text-sm tabular-nums text-slate-700 md:block">{unitPrice}</span>
      <span className="hidden text-right text-sm tabular-nums text-slate-500 md:block">{formatDiscount(row.discount_percent)}</span>
      {marginColumn ? (
        <span className="hidden justify-end md:flex">
          {marginPercent == null ? <span className="text-xs text-slate-400">–</span> : <MarginBadge marginPercent={marginPercent} bare />}
        </span>
      ) : null}
      <span className={cn('text-right text-sm font-semibold tabular-nums text-slate-900', strike)}>
        {formatCurrency(metrics?.rowTotal ?? 0, 'SEK')}
      </span>
      {chevron}
      {configured ? (
        <span className="col-span-2 text-xs tabular-nums text-slate-500 md:hidden">{quantity} × {unitPrice}</span>
      ) : null}
    </>
  );
}

// Numret, och draghandtaget i dess ställe när raden hovras eller har fokus. På en pekskärm finns ingen
// hovring, så där står handtaget alltid framme.
function NumberCell({ index, dragHandle }: { index: number; dragHandle?: React.ReactNode }) {
  return (
    <span className="relative flex h-7 items-center justify-center">
      <span
        className={cn(
          'text-xs font-semibold tabular-nums text-slate-400',
          dragHandle && 'group-focus-within/row:invisible group-hover/row:invisible [@media(hover:none)]:invisible',
        )}
      >
        {index + 1}
      </span>
      {dragHandle ? (
        <span className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-focus-within/row:opacity-100 group-hover/row:opacity-100 motion-reduce:transition-none [@media(hover:none)]:opacity-100">
          {dragHandle}
        </span>
      ) : null}
    </span>
  );
}

/**
 * En tabellrad i läsläge — arbetsorderns rader utanför redigeringen, på kontorets vy. Samma kolumner
 * som redigeringens tabell, så man ser vad man ändrar ifrån. (Fältvyn har kvar LineItemReadRow.)
 */
export function LineItemTableReadRow({
  row, index, metrics, details, badges, struck,
}: {
  row: LineItemRowItem;
  index: number;
  metrics: LineItemRowMetrics | undefined;
  details?: React.ReactNode;
  badges?: React.ReactNode;
  struck?: boolean;
}) {
  return (
    <div className={ROW_OUTER}>
      <NumberCell index={index} />
      <div className={cn(INNER_BASE, innerColumns(false, false), 'py-3')}>
        {/* En namnlös rad är en ren textrad — visa texten, inte editorns uppmaning "Välj artikel…". */}
        <TableCells row={row} metrics={metrics} marginColumn={false} marginPercent={null} details={details} badges={badges} struck={struck} emptyName={row.line_note?.trim() || 'Offert-rad'} />
      </div>
    </div>
  );
}

// Ett fält med enheten inne i rutan ("m²", "kr/m³"). Fältet självt är appens vanliga Input.
function UnitInput({ unit, ...props }: React.ComponentProps<typeof Input> & { unit: string }) {
  return (
    <span className="relative block">
      <Input {...props} className="pr-16 tabular-nums" />
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-500">{unit}</span>
    </span>
  );
}

// Ett uträknat värde (volymen, radsumman): en ton mörkare än den utfällda raden, inte ett fält.
function Readout({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid content-start gap-1.5">
      <span className="text-xs font-semibold text-slate-600">{label}</span>
      <div className="flex min-h-11 flex-wrap items-center justify-between gap-2 rounded-lg bg-[#e6ede3] px-3 py-2">{children}</div>
    </div>
  );
}

export default function LineItemRow({
  row,
  index,
  metrics,
  rotEnabled,
  marginColumn = false,
  marginPercent = null,
  purchasePrice = null,
  expanded,
  onToggle,
  onChange,
  onSelectArticle,
  onClearArticle,
  onRemove,
  dragHandle,
  documentNoun = 'offerten',
  nameEditable,
  nameHint,
  headerActions,
  details,
  badges,
  totalAside,
  extraFlags,
  struck,
  onMeasureBlur,
  invoicedLock = false,
}: {
  row: LineItemRowItem;
  index: number;
  metrics: LineItemRowMetrics | undefined;
  rotEnabled: boolean;
  /** Tabellen har en TG-kolumn. Bara offerten — arbetsordern visar aldrig TG. Samma som rubrikens. */
  marginColumn?: boolean;
  /** Radens täckningsgrad i procent, eller null när artikeln saknar inköpspris. Bara offerten. */
  marginPercent?: number | null;
  /** Artikelns inköpspris per enhet, visat som underlag till täckningsgraden. Bara offerten. */
  purchasePrice?: number | null;
  // Accordion: which row is open is owned by the parent so opening one collapses the rest.
  expanded: boolean;
  onToggle: (next: boolean) => void;
  onChange: (patch: Partial<LineItemRowItem>) => void;
  onSelectArticle: (article: ArticleLite) => void;
  onClearArticle: () => void;
  onRemove: () => void;
  dragHandle?: React.ReactNode;
  /** Dokumentet i etiketterna: "Benämning på offerten" eller "…på ordern". */
  documentNoun?: 'offerten' | 'ordern';
  /**
   * Visas benämningsfältet? Standard: så fort raden har en vald artikel.
   *
   * 🧨 VILLKORA ALDRIG PÅ VÄRDET FÄLTET SJÄLVT REDIGERAR. Standardregeln frågade förut bara efter
   * `article_name` — samma sträng fältet ändrar — så en backspace till tomt AVMONTERADE fältet mitt i
   * skrivandet, och namnet gick inte att skriva tillbaka. `article_number` rörs inte av fältet och är
   * därför en stabil grund. Arbetsordern skickar en egen regel på det SPARADE namnet (se där).
   */
  nameEditable?: boolean;
  /** Text under benämningsfältet (arbetsordern: varningen när materialet inte längre känns igen). */
  nameHint?: React.ReactNode;
  /** Knappar bredvid artikeln i den utfällda raden (arbetsordern: prisläget). */
  headerActions?: React.ReactNode;
  /** Raden under namnet i tabellen, i stället för artikelnummer och mått (arbetsordern: mått, material, densitet). */
  details?: React.ReactNode;
  /** Märken efter namnet i tabellen, efter ROT-märket (arbetsordern: säckar, Fakturerad, Avskriven). */
  badges?: React.ReactNode;
  /** Visas i radsumman i den utfällda raden (arbetsordern: säckar). */
  totalAside?: React.ReactNode;
  /** Fler kryssrutor i flaggraden (arbetsordern: Avskriven). */
  extraFlags?: React.ReactNode;
  /** Raden räknas inte (avskriven): namn och summa stryks. */
  struck?: boolean;
  /** När ett måttfält lämnas (arbetsordern normaliserar decimaltecknet då). */
  onMeasureBlur?: (key: MeasureKey) => void;
  /**
   * Raden står redan på en utställd delfaktura. Samma lås som servern (validateLineItemEdit):
   * artikel, pris, rabatt och ROT kan inte ändras, och raden kan inte tas bort. Antalet får höjas,
   * eller sänkas ner till det fakturerade. Utan låset i UI:t nekades HELA sparningen med 409 —
   * alla andra ändringar i samma redigering gick förlorade.
   */
  invoicedLock?: boolean;
}) {
  const isM3 = (row.pricing_mode ?? 'm3') === 'm3';
  // The ROT labour carve-out field sits on the price row next to À-pris/Rabatt, but only when ROT
  // is on and the row isn't already flagged as full ROT work (its whole price is then the labour).
  const showLaborField = rotEnabled && !row.is_rot_work;
  // Samma enhet som raden prissätts i, så "kr/m³" respektive "kr/st" står bredvid rätt tal.
  const unitLabel = lineItemUnitLabel(row);
  const showNameField = nameEditable ?? Boolean(row.article_number || row.article_name);
  const blur = (key: MeasureKey) => (onMeasureBlur ? () => onMeasureBlur(key) : undefined);

  return (
    <div
      className={cn(
        'group/row rounded-xl transition-colors motion-reduce:transition-none',
        // Den utfällda raden: en ton mörkare än kortet, aldrig vitare (William, mockupen).
        expanded ? 'bg-[#f1f5ee] shadow-[inset_0_0_0_1px_#dde6d9]' : 'hover:bg-[#f1f5ee]',
      )}
    >
      <div className={ROW_OUTER}>
        <NumberCell index={index} dragHandle={dragHandle} />
        {/* px-0: knappens globala padding (globals.css) hade annars flyttat cellerna ur linje med rubriken. */}
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => onToggle(!expanded)}
          className={cn(INNER_BASE, innerColumns(marginColumn, true), 'w-full rounded-lg px-0 py-3 text-left')}
        >
          <TableCells
            row={row}
            metrics={metrics}
            marginColumn={marginColumn}
            marginPercent={marginPercent}
            details={details}
            badges={badges}
            struck={struck}
            emptyName="Välj artikel…"
            chevron={(
              <span className="hidden justify-end text-slate-400 md:flex">
                <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden className={cn('transition-transform motion-reduce:transition-none', expanded && 'rotate-180')}>
                  <path d="M3 5l4 4 4-4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
            )}
          />
        </button>
      </div>

      {expanded ? (
        // pl-12 på bred skärm: redigeraren börjar under Artikel-kolumnen (px-3 + numret + mellanrummet).
        <div className="grid gap-5 border-t border-[#dde6d9] px-3 pb-4 pt-4 md:pl-12 md:pr-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            {/* Kortet "Vald artikel" står kvar på artikelnumret när benämningen töms — annars byttes det
                mot en tom sökruta mitt i skrivandet i fältet under. */}
            <div className="min-w-0 flex-1">
              <ArticlePicker
                value={row.article_name || row.article_number || ''}
                articleNumber={row.article_number}
                price={row.article_price}
                unit={row.article_unit_name}
                note={row.article_note}
                purchasePrice={purchasePrice}
                onSelect={onSelectArticle}
                onClear={onClearArticle}
                locked={invoicedLock}
              />
            </div>
            {headerActions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{headerActions}</div> : null}
          </div>

          {invoicedLock ? (
            <p className="m-0 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-snug text-amber-800">
              Raden är fakturerad. Artikel, pris, rabatt, prisläge och ROT kan inte ändras — lägg det som
              skiljer på en ny rad. Antalet kan höjas, eller sänkas ner till det som fakturerats.
            </p>
          ) : null}

          {/* Editable display name (Description) for the picked article — e.g. rename a generic
              "Övrigt" article to something descriptive. Only the row's Description changes; the
              article number/price/unit stay intact, and this text is what the push sends to
              Fortnox as the row Description. Shown once an article is selected.
              Radtexten blir en egen textrad under raden på Fortnox-dokumentet (offers.ts/orders.ts). */}
          <div className="grid gap-4 sm:grid-cols-2">
            {showNameField ? (
              <Field label={`Benämning på ${documentNoun}`}>
                <Input
                  value={row.article_name ?? ''}
                  onChange={(e) => onChange({ article_name: e.target.value })}
                  placeholder={`Namn som visas på ${documentNoun}`}
                />
                {nameHint}
              </Field>
            ) : null}
            <Field label="Radtext">
              <Input value={row.line_note ?? ''} onChange={(e) => onChange({ line_note: e.target.value })} placeholder={`Visas under raden på ${documentNoun}`} />
            </Field>
          </div>

          {/* Mätning: yta/tjocklek/densitet och den uträknade volymen (m³), eller antal (styckpris). */}
          <fieldset className="m-0 grid gap-2 border-0 p-0">
            <legend className="mb-2 p-0 text-xs font-semibold text-slate-500">{isM3 ? 'Mått' : 'Mängd'}</legend>
            <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
              {isM3 ? (
                <>
                  <Field label="Yta"><UnitInput unit="m²" value={row.m2 ?? ''} onChange={(e) => onChange({ m2: e.target.value })} onBlur={blur('m2')} inputMode="decimal" placeholder="0" /></Field>
                  <Field label="Tjocklek"><UnitInput unit="mm" value={row.thickness_mm ?? ''} onChange={(e) => onChange({ thickness_mm: e.target.value })} onBlur={blur('thickness_mm')} inputMode="decimal" placeholder="0" /></Field>
                  <Field label="Densitet"><UnitInput unit="kg/m³" value={row.density ?? ''} onChange={(e) => onChange({ density: e.target.value })} onBlur={blur('density')} inputMode="decimal" placeholder="t.ex. 45" /></Field>
                  <Readout label="Volym">
                    <span className="text-sm font-semibold tabular-nums text-slate-800">{formatQuantity(metrics?.amount ?? 0)} m³</span>
                  </Readout>
                </>
              ) : (
                <Field label="Antal"><UnitInput unit={unitLabel} value={row.quantity ?? ''} onChange={(e) => onChange({ quantity: e.target.value })} onBlur={blur('quantity')} inputMode="decimal" placeholder="0" /></Field>
              )}
            </div>
          </fieldset>

          {/* Pris: À-pris, rabatt, (ROT-arbetskostnad) och den uträknade radsumman. */}
          <fieldset className="m-0 grid gap-2 border-0 p-0">
            <legend className="mb-2 p-0 text-xs font-semibold text-slate-500">Pris</legend>
            <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
              {/* A-priset är ETT fält, alltid skrivbart. Att välja en artikel kopierar in dess pris i
                  `unit_price` (se onSelectArticle), så en artikelrad ser ut precis som förut — men
                  fältet är inte längre låst mot ett påhittat värde. Kryssrutan "Manuellt pris" som stod
                  här växlade bara mellan 900-stubben och ett skrivet pris och har därför tagits bort.

                  ⚠️ Fältet speglar `unit_price` RAKT AV och får aldrig falla tillbaka på `article_price` i
                  renderingen. En sådan reserv gör fältet omöjligt att tömma: tomt värde → artikelpriset
                  fylls i igen → nästa tecken läggs till på slutet (900 blir 900750). En sparad rad som
                  bär artikelpris utan A-pris normaliseras i stället EN gång vid inläsningen. */}
              <Field label="À-pris">
                <UnitInput
                  unit={`kr/${unitLabel}`}
                  value={row.unit_price ?? ''}
                  onChange={(e) => onChange({ unit_price: e.target.value, auto_price: false })}
                  disabled={invoicedLock}
                  inputMode="decimal"
                  // ⚠️ ALDRIG "0" som platshållare här. Ett tomt fält renderade då en grå nolla, och en
                  // säljare som läste den som ett satt pris rörde aldrig fältet — så sparades raden utan
                  // prisuppgift. Det har hänt skarpt: en fraktrad som skulle vara "ingår" blev en rad helt
                  // utan pris, vilket ser likadant ut i summan men betyder något annat. Vill man verkligen
                  // ha noll ska nollan SKRIVAS, för då är den ett beslut och inte en tom ruta.
                  placeholder="t.ex. 750"
                />
              </Field>
              <Field label="Rabatt"><UnitInput unit="%" value={row.discount_percent ?? ''} onChange={(e) => onChange({ discount_percent: e.target.value })} disabled={invoicedLock} inputMode="decimal" placeholder="0" /></Field>
              {/* Carve out the labour portion of a material row for ROT: the amount here is moved onto the
                  separate "Arbetskostnad ROT" row and deducted from this row (total unchanged).

                  ⚠️ Hjälptexten under fältet är inte pynt. "Varav" har lästs som "plus": säljaren sänkte
                  A-priset från 500 till 300 kr/m³ och skrev 200 här i tron att raden landade på 500 igen.
                  Den gör den inte — raden blir 300 kr/m³, offerten blir billigare än den skulle, och ROT
                  begärs på 200 kr i stället för 200 kr × volymen. Texten visar delningen i kronor så fort
                  ett belopp finns, så felet syns i samma ögonblick det görs. */}
              {showLaborField ? (
                <Field label="Varav arbete (ROT)">
                  {/* Låst på en fakturerad rad: en utbrytning där gör hela orderns nästa delfakturarunda
                      omöjlig (hasCarvedRotLabor), och den påstår att arbete bröts ut ur en redan
                      utställd del. */}
                  <UnitInput unit={`kr/${unitLabel}`} value={row.labor_cost ?? ''} onChange={(e) => onChange({ labor_cost: e.target.value })} disabled={invoicedLock} inputMode="decimal" placeholder="0" />
                  <LaborCarveoutHint
                    laborCost={row.labor_cost ?? ''}
                    unitPrice={metrics?.unit ?? 0}
                    discountPercent={parseDecimal(row.discount_percent)}
                    quantity={metrics?.amount ?? 0}
                    unitLabel={unitLabel}
                  />
                </Field>
              ) : null}
              <Readout label="Radsumma">
                <span className={cn('text-sm font-semibold tabular-nums text-slate-900', struck && 'line-through decoration-slate-400')}>
                  {formatCurrency(metrics?.rowTotal ?? 0, 'SEK')}
                </span>
                {/* MarginBadge renderar null när inköpspriset saknas (61 av 289 artiklar) — då står
                    bara summan, och den står kvar till vänster. */}
                <span className="flex flex-wrap items-center gap-1.5">
                  {totalAside}
                  <MarginBadge marginPercent={marginPercent} />
                </span>
              </Readout>
            </div>
          </fieldset>

          {/* 🧨 `w-auto` PÅ VARJE ETIKETT HÄR — utan den staplas raden vertikalt. `app/globals.css`
              sätter `:where(label) { width: 100% }`; selektorn har noll specificitet men ingen klass
              satte bredd här, så varje etikett fyllde sin rad. En klass slår `:where()`. */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#dde6d9] pt-3">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
              {/* Bara antals-/meterrader. En yta är själva jobbet och står alltid i beskrivningen — ett
                  kryss där hade varit ett dött val, eller värre: en väg att råka dölja måttet. */}
              {!isM3 ? (
                <label
                  className="inline-flex w-auto items-center gap-2 text-[13px] text-slate-700"
                  title="Tas med som eget moment i arbetsbeskrivningen installatören läser"
                >
                  <input
                    type="checkbox"
                    checked={!!row.include_in_description}
                    onChange={(e) => onChange({ include_in_description: e.target.checked })}
                    className="h-4 w-4 accent-[color:var(--ek-accent)]"
                  />
                  I arbetsbeskrivningen
                </label>
              ) : null}
              {rotEnabled ? (
                <label className="inline-flex w-auto items-center gap-2 text-[13px] text-slate-700">
                  <input type="checkbox" checked={!!row.is_rot_work} onChange={(e) => onChange({ is_rot_work: e.target.checked })} disabled={invoicedLock} className="h-4 w-4 accent-[color:var(--ek-accent)]" />
                  Hela raden är ROT-arbete
                </label>
              ) : null}
              {rotEnabled && row.is_rot_work ? (
                <label className="inline-flex w-auto items-center gap-2 text-[13px] text-slate-700">
                  Typ
                  <Select value={row.house_work_type || 'CONSTRUCTION'} onChange={(e) => onChange({ house_work_type: e.target.value })} disabled={invoicedLock} className="min-h-8 py-0 text-xs">
                    {ROT_HOUSE_WORK_TYPES.map((type) => (<option key={type} value={type}>{ROT_HOUSE_WORK_LABELS[type]}</option>))}
                  </Select>
                </label>
              ) : null}
              {extraFlags}
            </div>
            <div className="flex items-center gap-2">
              {/* Bara här, inte i den hopfällda raden: ett kryss intill beloppet var lätt att råka
                  trycka på i en tät tabell (William 2026-10-07). Fakturerade rader kan inte tas bort. */}
              {invoicedLock ? null : (
                <button type="button" onClick={onRemove} className="rounded-lg px-3 py-1.5 text-[13px] font-semibold text-slate-500 transition hover:bg-rose-50 hover:text-rose-700">
                  Ta bort rad
                </button>
              )}
              <button type="button" onClick={() => onToggle(false)} className="rounded-lg border border-[#d3ddcf] bg-white px-3.5 py-1.5 text-[13px] font-semibold text-slate-800 transition hover:border-slate-400">
                Klar
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
