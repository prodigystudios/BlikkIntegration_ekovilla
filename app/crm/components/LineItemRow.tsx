"use client";

import Input from '../../../components/ui/Input';
import Select from '../../../components/ui/Select';
import { cn } from '@/lib/shared/cn';
import { parseDecimal } from '@/lib/shared/number';
import { splitRowLabor, marginTier, MARGIN_THRESHOLDS, type MarginTier } from '@/lib/domains/crm/pricing';
import { ROT_HOUSE_WORK_TYPES, ROT_HOUSE_WORK_LABELS } from '@/lib/domains/fortnox/types';
import { formatCurrency, formatQuantity } from '@/app/crm/lib/format';
import ArticlePicker, { type ArticleLite } from './ArticlePicker';

// En artikelrad: hopfälld översiktsrad (nr · namn · mängd × pris · summa) och utfälld redigerare.
//
// Delad mellan offertformuläret och arbetsorderns artikeleditor. De var två egna implementationer
// som gled isär tills orderns rader var svåra att jämföra med offertens de kom ifrån — andra
// etiketter, annan fältordning, och ingen väg att byta artikel på en befintlig rad.

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
export function MarginBadge({ marginPercent, className }: { marginPercent: number | null; className?: string }) {
  const tier = marginTier(marginPercent);
  if (tier === 'unknown' || marginPercent == null) return null;

  // Egna klasser i stället för Badge-primitiven: den här ska vara liten och sifferorienterad
  // (tabular-nums så procenten inte hoppar i sidled när säljaren skriver i prisfältet).
  const styles: Record<Exclude<MarginTier, 'unknown'>, string> = {
    good: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    watch: 'border-amber-200 bg-amber-50 text-amber-700',
    bad: 'border-rose-200 bg-rose-50 text-rose-700',
  };
  const titles: Record<Exclude<MarginTier, 'unknown'>, string> = {
    good: `Täckningsgrad ${marginPercent.toFixed(1)} % – över ${MARGIN_THRESHOLDS.good} %`,
    watch: `Täckningsgrad ${marginPercent.toFixed(1)} % – grönt kräver över ${MARGIN_THRESHOLDS.good} %, se över priset`,
    bad: `Täckningsgrad ${marginPercent.toFixed(1)} % – under ${MARGIN_THRESHOLDS.watch} %, offerten kräver godkännande`,
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
      TG {marginPercent.toFixed(1)} %
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

export default function LineItemRow({
  row,
  index,
  metrics,
  rotEnabled,
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
  /** Fler knappar i den utfällda radens huvud, före "Fäll ihop" (arbetsordern: prisläget). */
  headerActions?: React.ReactNode;
  /** En andra rad under namnet i den hopfällda raden (arbetsordern: mått, material, densitet). */
  details?: React.ReactNode;
  /** Märken i den hopfällda raden efter ROT-märket (arbetsordern: säckar, Avskriven). */
  badges?: React.ReactNode;
  /** Visas bredvid radsumman i den utfällda raden (arbetsordern: volym och säckar). */
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
  // The ROT labour carve-out field sits on the economy row next to A-pris/Rabatt, but only when ROT
  // is on and the row isn't already flagged as full ROT work (its whole price is then the labour).
  const showLaborField = rotEnabled && !row.is_rot_work;
  // Samma enhet som raden prissätts i, så "kr/m³" respektive "kr/st" står bredvid rätt tal.
  const laborUnitLabel = isM3 ? 'm³' : (row.article_unit_name?.trim() || 'st');
  const showNameField = nameEditable ?? Boolean(row.article_number || row.article_name);
  const blur = (key: MeasureKey) => (onMeasureBlur ? () => onMeasureBlur(key) : undefined);

  // ── Collapsed: single overview line ──────────────────────────────────────────
  if (!expanded) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-slate-100 px-3.5 py-2.5 transition-colors hover:border-slate-200">
        {dragHandle}
        <button type="button" onClick={() => onToggle(true)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <CollapsedContent row={row} index={index} metrics={metrics} details={details} badges={badges} struck={struck} />
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden className="shrink-0 text-slate-300">
            <path d="M3 5l4 4 4-4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        {invoicedLock ? (
          // Platshållare i krysset bredd, så summorna står i linje med raderna som har ett.
          <span aria-hidden className="w-[22px] shrink-0" />
        ) : (
          <button type="button" onClick={onRemove} aria-label="Ta bort rad" className="shrink-0 px-1 text-slate-300 transition-colors hover:text-rose-600">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
              <path d="M3.5 3.5l7 7M10.5 3.5l-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        )}
      </div>
    );
  }

  // ── Expanded: full editor ────────────────────────────────────────────────────
  return (
    <div className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50/40 p-4">
      {/* flex-wrap + nowrap: med arbetsorderns prislägesknapp rymdes huvudet inte på en telefon, och
          knapparna bröts mitt i ordet ("Fäll / ihop"). Nu bryts raden MELLAN dem. */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <span className="flex items-center gap-2 whitespace-nowrap text-xs font-semibold text-slate-400">{dragHandle}Rad {index + 1}</span>
        <div className="flex flex-wrap items-center gap-3">
          {headerActions}
          <button type="button" onClick={() => onToggle(false)} className="whitespace-nowrap text-xs font-medium text-slate-500 transition-colors hover:text-slate-800">
            Fäll ihop ▴
          </button>
          {invoicedLock ? null : (
            <button type="button" onClick={onRemove} className="whitespace-nowrap text-xs text-slate-400 transition-colors hover:text-rose-600">
              Ta bort
            </button>
          )}
        </div>
      </div>

      {invoicedLock ? (
        <p className="m-0 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-snug text-amber-800">
          Raden är fakturerad. Artikel, pris, rabatt, prisläge och ROT kan inte ändras — lägg det som
          skiljer på en ny rad. Antalet kan höjas, eller sänkas ner till det som fakturerats.
        </p>
      ) : null}

      {/* Kortet "Vald artikel" står kvar på artikelnumret när benämningen töms — annars byttes det
          mot en tom sökruta mitt i skrivandet i fältet under. */}
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

      {/* Editable display name (Description) for the picked article — e.g. rename a generic
          "Övrigt" article to something descriptive. Only the row's Description changes; the
          article number/price/unit stay intact, and this text is what the push sends to
          Fortnox as the row Description. Shown once an article is selected. */}
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

      {/* Mätning: area/thickness/density (m³) or quantity (styckepris). */}
      <div className="grid gap-3 sm:grid-cols-3">
        {isM3 ? (
          <>
            <Field label="m²"><Input value={row.m2 ?? ''} onChange={(e) => onChange({ m2: e.target.value })} onBlur={blur('m2')} inputMode="decimal" placeholder="0" /></Field>
            <Field label="Tjocklek mm"><Input value={row.thickness_mm ?? ''} onChange={(e) => onChange({ thickness_mm: e.target.value })} onBlur={blur('thickness_mm')} inputMode="decimal" placeholder="0" /></Field>
            <Field label="Densitet (kg/m³)"><Input value={row.density ?? ''} onChange={(e) => onChange({ density: e.target.value })} onBlur={blur('density')} inputMode="decimal" placeholder="t.ex. 45" /></Field>
          </>
        ) : (
          <Field label="Antal"><Input value={row.quantity ?? ''} onChange={(e) => onChange({ quantity: e.target.value })} onBlur={blur('quantity')} inputMode="decimal" placeholder="0" /></Field>
        )}
      </div>

      {/* Ekonomi: A-pris, (ROT-arbetskostnad), rabatt on one straight row. */}
      <div className={cn('grid gap-3', showLaborField ? 'sm:grid-cols-3' : 'sm:grid-cols-2')}>
        {/* A-priset är ETT fält, alltid skrivbart. Att välja en artikel kopierar in dess pris i
            `unit_price` (se onSelectArticle), så en artikelrad ser ut precis som förut — men
            fältet är inte längre låst mot ett påhittat värde. Kryssrutan "Manuellt pris" som stod
            här växlade bara mellan 900-stubben och ett skrivet pris och har därför tagits bort.

            ⚠️ Fältet speglar `unit_price` RAKT AV och får aldrig falla tillbaka på `article_price` i
            renderingen. En sådan reserv gör fältet omöjligt att tömma: tomt värde → artikelpriset
            fylls i igen → nästa tecken läggs till på slutet (900 blir 900750). En sparad rad som
            bär artikelpris utan A-pris normaliseras i stället EN gång vid inläsningen. */}
        <Field label="A-pris">
          <Input
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
        {/* Carve out the labour portion of a material row for ROT: the amount here is moved onto the
            separate "Arbetskostnad ROT" row and deducted from this row (total unchanged).

            ⚠️ Hjälptexten under fältet är inte pynt. "Varav" har lästs som "plus": säljaren sänkte
            A-priset från 500 till 300 kr/m³ och skrev 200 här i tron att raden landade på 500 igen.
            Den gör den inte — raden blir 300 kr/m³, offerten blir billigare än den skulle, och ROT
            begärs på 200 kr i stället för 200 kr × volymen. Texten visar delningen i kronor så fort
            ett belopp finns, så felet syns i samma ögonblick det görs. */}
        {showLaborField ? (
          <Field label={`Varav arbetskostnad (ROT, kr/${laborUnitLabel})`}>
            {/* Låst på en fakturerad rad: en utbrytning där gör hela orderns nästa delfakturarunda
                omöjlig (hasCarvedRotLabor), och den påstår att arbete bröts ut ur en redan
                utställd del. */}
            <Input value={row.labor_cost ?? ''} onChange={(e) => onChange({ labor_cost: e.target.value })} disabled={invoicedLock} inputMode="decimal" placeholder="0" />
            <LaborCarveoutHint
              laborCost={row.labor_cost ?? ''}
              unitPrice={metrics?.unit ?? 0}
              discountPercent={parseDecimal(row.discount_percent)}
              quantity={metrics?.amount ?? 0}
              unitLabel={laborUnitLabel}
            />
          </Field>
        ) : null}
        <Field label="Rabatt %"><Input value={row.discount_percent ?? ''} onChange={(e) => onChange({ discount_percent: e.target.value })} disabled={invoicedLock} inputMode="decimal" placeholder="0" /></Field>
      </div>

      {/* 🧨 `w-auto` PÅ VARJE ETIKETT HÄR — utan den staplas raden vertikalt. `app/globals.css`
          sätter `:where(label) { width: 100% }`; selektorn har noll specificitet men ingen klass
          satte bredd här, så varje etikett fyllde sin rad. En klass slår `:where()`. */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        {/* Bara antals-/meterrader. En yta är själva jobbet och står alltid i beskrivningen — ett
            kryss där hade varit ett dött val, eller värre: en väg att råka dölja måttet. */}
        {!isM3 ? (
          <label
            className="inline-flex w-auto items-center gap-2 text-xs text-slate-500"
            title="Tas med som eget moment i arbetsbeskrivningen installatören läser"
          >
            <input
              type="checkbox"
              checked={!!row.include_in_description}
              onChange={(e) => onChange({ include_in_description: e.target.checked })}
              className="h-3.5 w-3.5 accent-[color:var(--ek-accent)]"
            />
            I arbetsbeskrivningen
          </label>
        ) : null}
        {rotEnabled ? (
          <label className="inline-flex w-auto items-center gap-2 text-xs text-slate-500">
            <input type="checkbox" checked={!!row.is_rot_work} onChange={(e) => onChange({ is_rot_work: e.target.checked })} disabled={invoicedLock} className="h-3.5 w-3.5 rounded border-slate-300" />
            ROT-arbete
          </label>
        ) : null}
        {rotEnabled && row.is_rot_work ? (
          <label className="inline-flex w-auto items-center gap-2 text-xs text-slate-500">
            Typ
            <Select value={row.house_work_type || 'CONSTRUCTION'} onChange={(e) => onChange({ house_work_type: e.target.value })} disabled={invoicedLock} className="min-h-8 py-0 text-xs">
              {ROT_HOUSE_WORK_TYPES.map((type) => (<option key={type} value={type}>{ROT_HOUSE_WORK_LABELS[type]}</option>))}
            </Select>
          </label>
        ) : null}
        {extraFlags}
        {/* ml-auto MÅSTE sitta på summan, inte på märket: MarginBadge renderar null när
            inköpspriset saknas (61 av 289 artiklar, plus varje rad utan vald artikel), och då
            tappade beloppet sin högerställning och hoppade i sidled mellan raderna. */}
        <span className="ml-auto flex items-center gap-2 text-sm font-semibold tabular-nums text-slate-900">
          {totalAside}
          <MarginBadge marginPercent={marginPercent} />
          <span className={cn(struck && 'line-through decoration-slate-400')}>{formatCurrency(metrics?.rowTotal ?? 0, 'SEK')}</span>
        </span>
      </div>

      <Field label="Radtext"><Input value={row.line_note ?? ''} onChange={(e) => onChange({ line_note: e.target.value })} placeholder="Fritext för raden" /></Field>
    </div>
  );
}
