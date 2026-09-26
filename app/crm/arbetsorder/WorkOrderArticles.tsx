"use client";

import { useEffect, useMemo, useState } from 'react';
import { cn } from '@/lib/shared/cn';
import { crm } from '@/app/crm/lib/crmTokens';
import { computePricing, lineItemEffectiveUnitPrice, lineItemRotLabor, lineItemRowTotal, lineItemUnitPrice, type PricingLineItem } from '@/lib/domains/crm/pricing';
import { isBlankLineItem, isConfiguredLineItem, lineItemQuantity, pricingModeFromUnit } from '@/lib/domains/crm/lineItems';
import { workOrderLineItemIssues } from '@/lib/domains/crm/lineItemIssues';
import { inferMaterialFromArticle, materialRenameEffect, sacksFor } from '@/lib/domains/crm/materials';
import { normalizeDecimalInput, parseDecimal } from '@/lib/shared/number';
import { formatCurrency, formatQuantity } from '@/app/crm/lib/format';
import LineItemRow, { LineItemReadRow, type LineItemRowItem, type LineItemRowMetrics } from '@/app/crm/components/LineItemRow';
import { GeneratedRotLaborRow, LineItemTotalsBar } from '@/app/crm/components/LineItemSummary';
import { getArticleUnitName, type ArticleLite } from '@/app/crm/components/ArticlePicker';
import CrmConfirmDialog from '@/app/crm/components/CrmConfirmDialog';

export type ArticleLineItem = {
  id: string;
  article_id?: string | null;
  article_name?: string | null;
  article_number?: string | null;
  article_price?: number | null;
  article_unit_name?: string | null;
  // Artikelns beskrivning ur registret — INTERN hjälptext i artikelväljaren, når aldrig Fortnox.
  article_note?: string | null;
  pricing_mode?: 'm3' | 'item';
  // VAR i huset raden sitter. Sätts av offertformuläret när en artikel väljs ur Fortnox
  // (härledd ur namnet) och följer med hit. ⚠️ Skrivs INTE här: det finns ingen väljare
  // att rätta en felgissning med, och `construction === 'vind'` styr vilken tabell raden
  // hamnar i på den SIGNERADE egenkontrollen (lib/domains/egenkontroll/projectSource.ts).
  // Måttblocket härleder i stället placeringen vid visning, utan att röra datan.
  construction?: string | null;
  quantity?: string;
  m2?: string;
  thickness_mm?: string;
  density?: string;
  unit_price?: string;
  discount_percent?: string;
  // Fritext under artikelraden. Går till Fortnox: som radens Description när artikelnamn saknas,
  // annars som en egen textrad under den (buildOrderRows). Alltså KUNDVÄND text.
  line_note?: string;
  is_rot_work?: boolean;
  house_work_type?: string;
  // Labour carved out of a material row for ROT, as kr PER UNIT — ett à-pris som räknas mot
  // antalet, utbrutet UR à-priset och inte lagt till det. Se splitRowLabor i pricing.ts.
  labor_cost?: string;
  // Avskriven rad: såld men aldrig utförd. Ligger kvar (indexen bär fakturarundornas antal) men
  // räknas bort ur summan och skickas inte till Fortnox.
  written_off?: boolean;
  // Ska raden stå i arbetsbeskrivningen? Gäller BARA antals-/meterrader — ytorna är själva jobbet
  // och följer alltid med. Sätts från artikelregistrets standard när en artikel väljs och fryses här.
  include_in_description?: boolean;
  // Legacy från offertens 900-stub, läses aldrig. Skrivs av A-prisfältet i den delade raden.
  auto_price?: boolean;
};

function newId() {
  try { return crypto.randomUUID(); } catch { return `row-${Date.now()}-${Math.round(Math.random() * 1e6)}`; }
}

// En tom rad att välja artikel på — samma utgångsläge som offertens "+ Lägg till rad".
// ⚠️ Ingen `construction`: se typen ovan.
function createEmptyRow(): ArticleLineItem {
  return {
    id: newId(),
    article_id: null, article_name: null, article_number: null, article_price: null, article_unit_name: null, article_note: null,
    pricing_mode: 'm3',
    quantity: '', m2: '', thickness_mm: '', density: '', unit_price: '', discount_percent: '', line_note: '', labor_cost: '',
    is_rot_work: false, house_work_type: 'CONSTRUCTION', include_in_description: false,
  };
}

function sackInfo(item: ArticleLineItem) {
  const material = inferMaterialFromArticle(item.article_name);
  const sacks = material ? sacksFor(lineItemQuantity(item as PricingLineItem), parseDecimal(item.density), material.bagWeight) : 0;
  return { material, sacks };
}

// Radens tal, ur SAMMA priskällor som computePricing, pushen och delfakturan använder.
function metricsFor(item: ArticleLineItem): LineItemRowMetrics {
  const row = item as PricingLineItem;
  return {
    amount: lineItemQuantity(row),
    unit: lineItemUnitPrice(row),
    effectiveUnit: lineItemEffectiveUnitPrice(row),
    rowTotal: lineItemRowTotal(row),
    isConfigured: isConfiguredLineItem(item),
  };
}

// Andra raden i den hopfällda raden: det installatören och den som granskar behöver utan att fälla
// ut — mått, material, densitet och artikelnummer. Offerten har den inte; där fälls raden ut.
function rowDetails(item: ArticleLineItem): string {
  const { material } = sackInfo(item);
  const mode = item.pricing_mode === 'item' ? 'item' : 'm3';
  const volume = lineItemQuantity(item as PricingLineItem);
  const measure = mode === 'm3'
    ? (item.m2 || item.thickness_mm
      ? `${item.m2 || '0'} m² × ${item.thickness_mm || '0'} mm${volume > 0 ? ` = ${formatQuantity(volume)} m³` : ''}`
      : null)
    : (item.thickness_mm ? `${item.thickness_mm} mm` : null);
  // Måtten FÖRST — det är dem installatören letar efter. Artikelnumret sist, och bara när det finns:
  // "Utan artikelnummer" i en översiktsrad är brus, och på en telefon tog det platsen från måtten.
  return [
    measure,
    material?.short ?? null,
    item.density ? `${item.density} kg/m³` : null,
    item.article_number || null,
  ].filter(Boolean).join(' · ');
}

const pill = 'shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold';

function rowBadges(item: ArticleLineItem) {
  const { sacks } = sackInfo(item);
  if (item.written_off) return <span className={cn(pill, 'border-slate-300 bg-white text-slate-500')}>Avskriven</span>;
  return sacks > 0 ? <span className={cn(pill, 'border-emerald-200 bg-emerald-50 text-emerald-700')}>{sacks} säck</span> : null;
}

// ─── Artiklar (läs- + redigeringsläge) ─────────────────────────────────────────
// Raderna är offertens egen radkomponent (LineItemRow) — hopfällda i en lista, en utfälld i taget,
// artikeln vald I raden med Byt/Rensa och favoriter. Arbetsordern lägger till det offerten saknar:
// säckar och mått i översikten, prisläget m³/st, avskrivning och varningen när en omdöpning slår
// sönder materialet. Två anropsplatser:
//   • WorkOrderDetailClient — `embedded`, avsnitt inne i Ekonomi-kortet, redigerbar.
//   • WorkOrderInstallerClient — fristående kort + summeringskolumn, `canEdit={false}`.
//     ⚠️ Den ytan ligger UTANFÖR `.crm-shell`, så `--crm-*` är odefinierade där.
type Props = {
  items: ArticleLineItem[];
  currencyCode: string;
  vatPercent: number | string;
  quoteType: 'private' | 'business';
  rotDetails: Record<string, any> | null;
  saving: boolean;
  fortnoxConnected: boolean;
  canEdit?: boolean;
  /**
   * Varför raderna är låsta, när `canEdit` är false. Utelämnas den skrivs ingen förklaring alls.
   *
   * ⚠️ Komponenten får INTE gissa skälet. Den skrev tidigare "Arbetsordern är fakturerad och kan
   * inte ändras" så fort `canEdit` var false — men fältvyn skickar false för att installatörer
   * inte får redigera, inte för att ordern är fakturerad. Rutan påstod alltså att en planerad
   * order var fakturerad, för varje installatör som öppnade den.
   */
  lockedReason?: string;
  // Inbäddat läge: listan ligger inne i ett annat kort (arbetsorderns Ekonomi-kort) och ritar
  // därför varken egen kortyta eller egen sidokolumn — summeringen står överst, som i offerten.
  // Fristående anrop (fältvyn) behåller sin summeringskolumn.
  embedded?: boolean;
  // Omvänd skattskyldighet (byggmoms): momsraden läses då som ett eget faktum, inte som
  // "Moms 0 kr". Utelämnas den härleds den ur den beräknade momssatsen — se isReverseCharge.
  reverseCharge?: boolean;
  onSave: (items: ArticleLineItem[]) => Promise<boolean>;
};

export default function WorkOrderArticles({ items, currencyCode, vatPercent, quoteType, rotDetails, saving, fortnoxConnected, canEdit = true, lockedReason, embedded = false, reverseCharge, onSave }: Props) {
  const [editing, setEditing] = useState(false);
  const [rows, setRows] = useState<ArticleLineItem[]>(items);
  // Dragspel som i offerten: EN utfälld rad i taget, ägd här så att en ny rad fäller ihop de andra.
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);
  // Raden som väntar på bekräftelse innan den tas bort. Tomma rader hoppar över frågan.
  const [pendingRemoveId, setPendingRemoveId] = useState<string | null>(null);

  // Resync from source when the work order reloads (e.g. after a successful save).
  //
  // ⚠️ Inte medan raderna redigeras. Vilken omladdning av arbetsordern som helst ger `items` ny
  // identitet, och den här effekten skrev då över utkastet — statusklicket i förloppet ligger
  // ovanför flikremsan och nådde alltså in hit och nollade osparade artikelrader. Sedan
  // artiklarna flyttat in i översiktens Ekonomi-kort når även översiktens egen Spara hit, så
  // vakten bär mer än förut. Efter en lyckad sparning sätts `editing` till false, vilket kör
  // effekten igen med färska rader. (Motsvarande vakt åt andra hållet — att artikelsparningen
  // inte får skriva över översiktens utkast — är `keepDraft` i WorkOrderDetailClient.)
  useEffect(() => { if (!editing) setRows(items); }, [items, editing]);

  const dirty = useMemo(() => JSON.stringify(rows) !== JSON.stringify(items), [rows, items]);
  const isPrivate = quoteType === 'private';
  const rotEnabled = isPrivate && Boolean(rotDetails?.enabled);

  // Summary reflects the live edit when editing, otherwise the saved articles.
  const source = editing ? rows : items;
  // Avskrivna rader räknas inte — varken i pengar eller i säckar. Ordervärdet ska visa det som
  // faktiskt levereras, annars stämmer inte CRM med fakturorna.
  const activeRows = useMemo(() => source.filter((r) => !r.written_off), [source]);
  const totals = useMemo(
    () => computePricing(activeRows as PricingLineItem[], vatPercent, { isPrivate, rot: rotDetails }),
    [activeRows, vatPercent, isPrivate, rotDetails],
  );
  // Arbetet som bryts ut ur materialraderna och blir den genererade "Arbetskostnad ROT"-raden.
  // Samma regel som computePricing och pushen: helt flaggade ROT-rader går inte hit.
  const carvedLabor = useMemo(
    () => (rotEnabled
      ? activeRows.reduce((sum, r) => (r.is_rot_work ? sum : sum + Math.min(lineItemRotLabor(r as PricingLineItem), lineItemRowTotal(r as PricingLineItem))), 0)
      : 0),
    [activeRows, rotEnabled],
  );
  const configuredCount = useMemo(() => activeRows.filter((r) => isConfiguredLineItem(r)).length, [activeRows]);
  // ⚠️ `source`, inte `items`. Räknat på de sparade raderna stod säcktalet stilla medan man
  // redigerade just de fält som bestämmer det — samma fel som `totals` redan undvek.
  const totalSacks = useMemo(() => activeRows.reduce((sum, it) => sum + sackInfo(it).sacks, 0), [activeRows]);

  // Det SPARADE artikelnamnet per rad, för att kunna varna när en omdöpning slår sönder
  // materialhärledningen (se materialRenameEffect). `items` byts bara ut vid omladdning, alltså
  // efter en sparning — precis den referenspunkt jämförelsen behöver.
  const savedNameById = useMemo(
    () => new Map(items.map((it) => [it.id, it.article_name ?? null])),
    [items],
  );

  // Samma spärrar som offertformulärets, med samma ord — se workOrderLineItemIssues.
  const issues = useMemo(
    () => (editing ? workOrderLineItemIssues(rows, { rotEnabled }) : []),
    [editing, rows, rotEnabled],
  );

  function updateRow(id: string, patch: Partial<ArticleLineItem>) {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }
  function removeRow(id: string) {
    setRows((rs) => rs.filter((r) => r.id !== id));
    setPendingRemoveId(null);
    setExpandedRowId((cur) => (cur === id ? null : cur));
  }
  function requestRemove(row: ArticleLineItem) {
    if (isBlankLineItem(row)) removeRow(row.id);
    else setPendingRemoveId(row.id);
  }
  function addRow() {
    const row = createEmptyRow();
    setRows((rs) => [...rs, row]);
    setExpandedRowId(row.id);
  }
  // Artikeln väljs I raden — ny rad eller byte på en befintlig. Samma fält som offertens
  // onSelectArticle, UTOM `construction` (se typen) och `auto_price` (läses aldrig).
  function selectArticle(id: string, article: ArticleLite) {
    const unitName = getArticleUnitName(article.unit);
    const mode = pricingModeFromUnit(unitName);
    setRows((rs) => rs.map((r) => (r.id !== id ? r : {
      ...r,
      article_id: article.id || null,
      article_name: article.name || null,
      article_number: article.articleNumber || null,
      article_price: typeof article.price === 'number' ? article.price : null,
      article_unit_name: unitName || null,
      article_note: article.note ?? null,
      pricing_mode: mode,
      // Artikelregistrets standard skriver ovillkorligt, som prisläget: artikeln ÄR radens
      // identitet, och byter man artikel ska den nya artikelns egenskaper gälla.
      include_in_description: article.includeInWorkDescription ?? false,
      unit_price: article.price != null ? String(article.price) : r.unit_price,
      quantity: mode === 'item' && (!r.quantity || Number(r.quantity) <= 0) ? '1' : r.quantity,
    })));
  }
  function clearArticle(id: string) {
    updateRow(id, { article_id: null, article_name: null, article_number: null, article_price: null, article_unit_name: null, article_note: null });
  }
  // Normalisering vid blur. Skriver BARA när strängen faktiskt ändras — annars hade en tur genom
  // fälten utan att röra något markerat formuläret som ändrat och tänt "Osparade ändringar".
  //
  // ⚠️ BARA MÅTTFÄLTEN. À-pris, rabatt och arbetskostnad är MEDVETET undantagna:
  // `validateLineItemEdit` (lib/domains/fortnox/partialInvoices.ts) jämför pris och rabatt som
  // EXAKTA STRÄNGAR på en delfakturerad order. Att bara tabba förbi À-pris hade skrivit om
  // "1200,00" till "1200" — samma tal, men sparningen nekas med "Rad 1 är fakturerad" och hela
  // redigeringen går förlorad. Måtten jämförs numeriskt (lineItemQuantity) och är därför trygga.
  function normalizeField(id: string, key: 'm2' | 'thickness_mm' | 'density' | 'quantity') {
    setRows((rs) => rs.map((r) => {
      if (r.id !== id) return r;
      const before = r[key] || '';
      const after = normalizeDecimalInput(before);
      return after !== before ? { ...r, [key]: after } : r;
    }));
  }

  async function save() {
    if (issues.length) return;
    // En tom rad är ett oanvänt "+ Lägg till rad" — ingenting att spara, och ingenting Fortnox ska se.
    const ok = await onSave(rows.filter((r) => !isBlankLineItem(r)));
    if (ok) { setEditing(false); setExpandedRowId(null); setPendingRemoveId(null); }
  }
  function cancel() {
    setRows(items);
    setEditing(false);
    setExpandedRowId(null);
    setPendingRemoveId(null);
  }

  // Omvänd skattskyldighet (byggmoms) = företagsorder utan moms. Samma regel som pricing.ts
  // (`!isPrivate && vatPercent === 0`), räknad på samma siffror som summeringen visar, så
  // etiketten aldrig kan motsäga beloppet. Anroparen kan skicka in svaret i stället:
  // arbetsorderns detaljsida härleder det ur den SPARADE prissättningen och är därmed robust
  // mot en vat_percent-kolumn som drivit iväg till 25 på en byggmomsorder.
  const isReverseCharge = reverseCharge ?? (quoteType === 'business' && totals.vatPercent === 0 && totals.subtotal > 0);
  // "25.00" → "25".
  const vatPercentLabel = Number.isFinite(Number(vatPercent)) ? String(Number(vatPercent)) : String(vatPercent ?? '');

  // ⚠️ Säcktalet står kvar UNDER redigering, inte bara i läsläget: medan man ändrar m², tjocklek och
  // densitet — de tre fälten vars enda syfte är säckantalet — ska säckantalet synas.
  const headerBadge = (
    <>
      {totalSacks > 0 ? (
        <span className={cn(crm.badge, 'border-emerald-200 bg-emerald-50 text-emerald-700')}>{totalSacks} säckar totalt</span>
      ) : null}
      {editing && dirty ? (
        <span className={cn(crm.badge, 'border-amber-200 bg-amber-50 text-amber-700')}>Osparade ändringar</span>
      ) : null}
    </>
  );

  const saveHint = fortnoxConnected
    ? 'Sparar räknar om summorna och uppdaterar Fortnox-ordern.'
    : 'Sparar räknar om summorna (Fortnox ej anslutet).';

  const lockedHint = lockedReason ? <p className="text-xs text-slate-500">{lockedReason}</p> : null;

  const editButtons = (
    <div className="flex items-center gap-2">
      <button type="button" onClick={cancel} disabled={saving} className={crm.ghostButton}>Avbryt</button>
      <button type="button" onClick={save} disabled={saving || !dirty || issues.length > 0} className={cn(crm.saveButton, 'h-8 w-auto px-4')}>
        {saving ? 'Sparar…' : 'Spara artiklar'}
      </button>
    </div>
  );

  // Den fristående summeringskolumnen (fältvyn). Inbäddat står summeringsraden överst i stället.
  const summaryRows = (
    <div className="grid gap-2 text-sm">
      <div className="flex items-center justify-between gap-3"><span className="text-slate-500">Delsumma</span><span className="font-semibold text-slate-900">{formatCurrency(totals.subtotal, currencyCode)}</span></div>
      {isReverseCharge ? (
        <div className="flex items-center justify-between gap-3"><span className="text-slate-500">Moms</span><span className="font-semibold text-amber-700">Omvänd skattskyldighet</span></div>
      ) : (
        <div className="flex items-center justify-between gap-3"><span className="text-slate-500">Moms ({vatPercentLabel} %)</span><span className="font-semibold text-slate-900">{formatCurrency(totals.vat, currencyCode)}</span></div>
      )}
      {totals.rotDeduction > 0 ? (
        <div className="flex items-center justify-between gap-3"><span className="text-slate-500">Avgår ROT</span><span className="font-semibold text-emerald-700">−{formatCurrency(totals.rotDeduction, currencyCode)}</span></div>
      ) : null}
      <div className="flex items-center justify-between gap-3 border-t border-[#e0e8dc] pt-2">
        <span className="font-semibold text-slate-700">{totals.rotDeduction > 0 ? 'Att betala' : 'Total'}</span>
        <span className="text-base font-bold text-slate-900">{formatCurrency(totals.rotDeduction > 0 ? totals.toPay : totals.total, currencyCode)}</span>
      </div>
    </div>
  );

  const pendingRemoveRow = pendingRemoveId ? rows.find((r) => r.id === pendingRemoveId) ?? null : null;

  return (
    <div className={embedded ? 'grid gap-3' : 'grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start'}>
      <div className={cn(!embedded && crm.cardInner, 'grid gap-3')}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <p className={crm.sectionTitle}>Artiklar</p>
            {headerBadge}
          </div>
          {editing ? editButtons : canEdit ? (
            <button type="button" onClick={() => setEditing(true)} className={crm.ghostButton}>Redigera artiklar</button>
          ) : null}
        </div>

        {/* Summeringen ÖVERST, som i offerten — och i båda lägena, så att siffrorna står på samma
            ställe när man går in i redigeringen och ser dem ändras. */}
        {embedded && configuredCount > 0 ? (
          <LineItemTotalsBar
            className="mb-0"
            subtotal={totals.subtotal}
            vat={totals.vat}
            vatPercent={totals.vatPercent}
            total={totals.total}
            toPay={totals.toPay}
            rowCount={configuredCount}
            carvedLabor={carvedLabor}
            rotDeduction={totals.rotDeduction}
            isPrivate={isPrivate}
            reverseCharge={isReverseCharge}
          />
        ) : null}

        {source.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[#cfdcc9] bg-[#f1f5ee] px-4 py-6 text-sm text-slate-500">
            {editing ? 'Inga artiklar — lägg till en rad nedan.' : 'Inga artiklar.'}
          </div>
        ) : null}

        {/* ── Läsläge: samma hopfällda rader som editorn, utan fäll ut och ta bort ── */}
        {!editing && items.length > 0 ? (
          <div className="grid gap-2">
            {items.map((item, index) => (
              <LineItemReadRow
                key={item.id}
                row={item as LineItemRowItem}
                index={index}
                metrics={metricsFor(item)}
                details={rowDetails(item)}
                badges={rowBadges(item)}
                struck={!!item.written_off}
              />
            ))}
          </div>
        ) : null}

        {/* ── Redigeringsläge ── */}
        {editing && rows.length > 0 ? (
          <div className="grid gap-2">
            {rows.map((row, index) => {
              const mode = row.pricing_mode === 'item' ? 'item' : 'm3';
              const { sacks, material } = sackInfo(row);
              const savedName = savedNameById.get(row.id);
              // Slår omdöpningen sönder materialhärledningen? Jämförs mot det SPARADE namnet.
              const renameEffect = materialRenameEffect(savedName, row.article_name);
              // …och radens NUVARANDE tillstånd, oberoende av om något just ändrats: en m³-rad med
              // volym vars namn inte ger något material räknar noll säckar, och noll säckar SER UT
              // som ett svar ("inget material gick åt") fast det bara betyder att namnet inte gick
              // att tyda. Måste vara tillståndsbaserat — en jämförelse mot det sparade namnet tystnar
              // i samma stund den trasiga omdöpningen sparas.
              const noMaterialOnVolumeRow = mode === 'm3' && !material && lineItemQuantity(row as PricingLineItem) > 0;
              return (
                <LineItemRow
                  key={row.id}
                  row={row as LineItemRowItem}
                  index={index}
                  metrics={metricsFor(row)}
                  rotEnabled={rotEnabled}
                  documentNoun="ordern"
                  // Benämningen visas när raden har ett SPARAT namn eller en vald artikel — aldrig
                  // villkorat på utkastets namn, som fältet självt redigerar (en backspace till tomt
                  // hade avmonterat det). En sparad ren TEXTRAD (bara radtext, ingen artikel) får
                  // inget namnfält: med ett namn blir den `isConfiguredLineItem` utan att bli
                  // prissatt, och pushen svarar 409 efter att sparningen redan gått igenom.
                  nameEditable={Boolean(savedName) || Boolean(row.article_number)}
                  // 🧨 NAMNET ÄR BÄRANDE, INTE EN ETIKETT. Det är enda källan till radens material,
                  // och materialet ger säckvikten. Tappas varumärkesordet blir säckantalet NOLL — tyst.
                  // Gult = du håller på att ändra något; grått = radens tillstånd, står kvar efter
                  // sparning.
                  nameHint={renameEffect ? (
                    <span className="text-[11px] leading-snug text-amber-700">
                      {renameEffect.kind === 'lost'
                        ? `Namnet känns inte längre igen som ${renameEffect.from} — raden ger inga säckar och materialrubriken faller ur arbetsbeskrivningen. Behåll materialnamnet i benämningen.`
                        : `Materialet läses nu som ${renameEffect.to} i stället för ${renameEffect.from} — säckvikten skiljer, så antalet säckar ändras.`}
                    </span>
                  ) : noMaterialOnVolumeRow ? (
                    <span className="text-[11px] leading-snug text-slate-500">
                      Inget material känns igen i benämningen, så raden ger inga säckar.
                    </span>
                  ) : null}
                  // Prisläget går att byta här, till skillnad från offerten där det följer artikelns
                  // enhet: på ordern rättas ofta en rad som sålts per styck till en yta, eller tvärtom.
                  headerActions={(
                    <button
                      type="button"
                      onClick={() => updateRow(row.id, { pricing_mode: mode === 'm3' ? 'item' : 'm3' })}
                      title={`Byt till pris per ${mode === 'm3' ? 'styck' : 'm³'}`}
                      // ⚠️ Aria-etiketten måste INNEHÅLLA den synliga texten (WCAG 2.5.3).
                      aria-label={`Pris per ${mode === 'm3' ? 'm³' : 'st'} — byt till pris per ${mode === 'm3' ? 'styck' : 'm³'}`}
                      className="rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-[11px] font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
                    >
                      Pris per {mode === 'm3' ? 'm³' : 'st'}
                    </button>
                  )}
                  details={rowDetails(row)}
                  badges={rowBadges(row)}
                  totalAside={(
                    <>
                      {mode === 'm3' ? (
                        <span className="text-xs font-normal tabular-nums text-slate-500">{formatQuantity(lineItemQuantity(row as PricingLineItem))} m³</span>
                      ) : null}
                      {sacks > 0 && !row.written_off ? (
                        <span className={cn(pill, 'border-emerald-200 bg-emerald-50 text-emerald-700')}>{sacks} säck</span>
                      ) : null}
                    </>
                  )}
                  // Avskriven = såld men aldrig utförd. Räknas bort ur summan och skickas inte till
                  // Fortnox, men raden ligger kvar så skillnaden mot offerten går att förklara. En rad
                  // som aldrig fakturerats kan lika gärna tas bort helt.
                  extraFlags={(
                    <label className="inline-flex w-auto items-center gap-2 text-xs text-slate-500">
                      <input type="checkbox" checked={!!row.written_off} onChange={(e) => updateRow(row.id, { written_off: e.target.checked })} className="h-3.5 w-3.5 accent-slate-500" />
                      Avskriven (utförs ej)
                    </label>
                  )}
                  struck={!!row.written_off}
                  onMeasureBlur={(key) => normalizeField(row.id, key)}
                  expanded={expandedRowId === row.id}
                  onToggle={(next) => setExpandedRowId(next ? row.id : null)}
                  onChange={(patch) => updateRow(row.id, patch as Partial<ArticleLineItem>)}
                  onSelectArticle={(article) => selectArticle(row.id, article)}
                  onClearArticle={() => clearArticle(row.id)}
                  onRemove={() => requestRemove(row)}
                />
              );
            })}
          </div>
        ) : null}

        {/* Den genererade arbetskostnadsraden — sist, som på Fortnox-ordern. Se GeneratedRotLaborRow. */}
        {rotEnabled && carvedLabor > 0 ? (
          <GeneratedRotLaborRow position={source.length + 1} amount={carvedLabor} documentLabel="Fortnox-ordern" />
        ) : null}

        {editing ? (
          <>
            <div>
              <button
                type="button"
                onClick={addRow}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 transition hover:border-slate-300 hover:bg-slate-50"
              >
                + Lägg till rad
              </button>
            </div>

            {issues.length ? (
              <div className="grid gap-1 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5">
                {issues.map((issue) => (
                  <p key={issue} className="m-0 text-xs font-medium text-rose-700">{issue}</p>
                ))}
              </div>
            ) : null}

            {/* Spara/Avbryt EN GÅNG TILL, här nere. Knapparna i rubrikraden räcker inte: med ett
                dussin rader och en utfälld är de långt utanför skärmen när man är klar. Bottenknappar
                i stället för en klistrad rad — översiktens redigering har redan en klistrad rad högst
                upp, och två sådana samtidigt (lägena är oberoende) hade legat på varandra. */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#e0e8dc] pt-3">
              <p className="m-0 text-xs text-slate-400">{saveHint}</p>
              {editButtons}
            </div>
          </>
        ) : canEdit ? null : lockedHint}
      </div>

      {/* Fristående (fältvyn): summeringen i egen kolumn, som förut. */}
      {embedded ? null : (
        <div className={cn(crm.cardInner, 'grid gap-3 lg:content-start')}>
          <p className={crm.sectionTitle}>Summering</p>
          {summaryRows}
        </div>
      )}

      {pendingRemoveRow ? (
        <CrmConfirmDialog
          title="Ta bort raden?"
          message={
            pendingRemoveRow.article_name
              ? `${pendingRemoveRow.article_name} tas bort från ordern.`
              : 'Raden tas bort från ordern.'
          }
          confirmLabel="Ta bort rad"
          tone="danger"
          onConfirm={() => removeRow(pendingRemoveRow.id)}
          onCancel={() => setPendingRemoveId(null)}
        />
      ) : null}
    </div>
  );
}
