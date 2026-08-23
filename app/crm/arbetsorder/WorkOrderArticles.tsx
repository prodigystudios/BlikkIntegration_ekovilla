"use client";

import { useEffect, useMemo, useState } from 'react';
import Input from '../../../components/ui/Input';
import { cn } from '@/lib/shared/cn';
import { crm } from '@/app/crm/lib/crmTokens';
import { computePricing, lineItemRowTotal, lineItemUnitPrice, splitRowLabor, type PricingLineItem } from '@/lib/domains/crm/pricing';
import { lineItemQuantity } from '@/lib/domains/crm/lineItems';
import { inferMaterialFromArticle, sacksFor } from '@/lib/domains/crm/materials';
import { normalizeDecimalInput, parseDecimal } from '@/lib/shared/number';
import { formatCurrency, formatQuantity } from '@/app/crm/lib/format';

export type ArticleLineItem = {
  id: string;
  article_id?: string | null;
  article_name?: string | null;
  article_number?: string | null;
  article_price?: number | null;
  article_unit_name?: string | null;
  pricing_mode?: 'm3' | 'item';
  quantity?: string;
  m2?: string;
  thickness_mm?: string;
  density?: string;
  unit_price?: string;
  discount_percent?: string;
  is_rot_work?: boolean;
  house_work_type?: string;
  // Labour carved out of a material row for ROT, as kr PER UNIT — ett à-pris som räknas mot
  // antalet, utbrutet UR à-priset och inte lagt till det. Se splitRowLabor i pricing.ts.
  labor_cost?: string;
  // Avskriven rad: såld men aldrig utförd. Ligger kvar (indexen bär fakturarundornas antal) men
  // räknas bort ur summan och skickas inte till Fortnox.
  written_off?: boolean;
};

type FortnoxArticle = { article_number: string; description: string | null; sales_price: number | null; unit: string | null };

function newId() {
  try { return crypto.randomUUID(); } catch { return `row-${Date.now()}-${Math.round(Math.random() * 1e6)}`; }
}
function pricingModeFromUnit(unit: string | null): 'm3' | 'item' {
  const u = (unit || '').trim().toLowerCase();
  return u === 'm3' || u === 'm³' || /m\s*³/.test(u) ? 'm3' : 'item';
}
function sackInfo(item: ArticleLineItem) {
  const material = inferMaterialFromArticle(item.article_name);
  const sacks = material ? sacksFor(lineItemQuantity(item as any), parseDecimal(item.density), material.bagWeight) : 0;
  return { material, sacks };
}
// Swedish-formatted volume (m³) — m³ rows are priced per cubic metre, so the calculation shows
// the computed volume (m² × thickness), not the area.
// ─── Article search (compact Fortnox picker) ───────────────────────────────────
function ArticleSearch({ onSelect }: { onSelect: (a: FortnoxArticle) => void }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<FortnoxArticle[]>([]);

  useEffect(() => {
    if (!open) { setItems([]); return; }
    let cancelled = false;
    setLoading(true);
    const q = query.trim();
    const url = q.length >= 1 ? `/api/fortnox/articles?q=${encodeURIComponent(q)}&limit=20` : '/api/fortnox/articles?limit=20';
    fetch(url, { cache: 'no-store' })
      .then((r) => r.json().catch(() => ({})))
      .then((json) => { if (!cancelled) setItems(Array.isArray(json?.data?.items) ? json.data.items : []); })
      .catch(() => { if (!cancelled) setItems([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, query]);

  return (
    <div className="relative">
      <Input
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Sök artikel att lägga till…"
      />
      {open ? (
        <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-72 overflow-y-auto rounded-xl border border-[#e0e8dc] bg-white shadow-[0_16px_32px_rgba(15,23,42,0.10)]">
          {loading ? <div className="px-4 py-3 text-sm text-slate-400">Söker…</div> : null}
          {!loading && items.length === 0 ? <div className="px-4 py-3 text-sm text-slate-400">Inga artiklar.</div> : null}
          {items.map((a) => (
            <button
              key={a.article_number}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); onSelect(a); setQuery(''); setOpen(false); }}
              className="flex w-full flex-col items-start gap-0.5 border-b border-slate-100 px-4 py-2.5 text-left transition last:border-b-0 hover:bg-[#f1f5ee]"
            >
              <span className="text-sm font-medium text-slate-800">{a.description || a.article_number}</span>
              <span className="text-xs text-slate-400">{a.article_number}{a.sales_price != null ? ` · ${formatCurrency(a.sales_price, 'SEK')}` : ''}{a.unit ? ` / ${a.unit}` : ''}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ─── Artiklar (läs- + redigeringsläge) ─────────────────────────────────────────
// Hette WorkOrderArticlesTab. Den är ingen flik längre — Ekonomi och Artiklar slutade
// vara egna flikar när de flyttade in i översiktens Ekonomi-kort. Två anropsplatser:
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
  // Inbäddat läge: fliken ligger inne i ett annat kort (arbetsorderns Ekonomi-kort) och ritar
  // därför varken egen kortyta eller egen sidokolumn — rubrik, rader och summering staplas i en
  // spalt och knapparna flyttar upp i rubrikraden. Fristående anrop (fältvyn) är oförändrade.
  embedded?: boolean;
  // Omvänd skattskyldighet (byggmoms): momsraden läses då som ett eget faktum, inte som
  // "Moms 0 kr". Utelämnas den härleds den ur den beräknade momssatsen — se isReverseCharge.
  reverseCharge?: boolean;
  onSave: (items: ArticleLineItem[]) => Promise<boolean>;
};

export default function WorkOrderArticles({ items, currencyCode, vatPercent, quoteType, rotDetails, saving, fortnoxConnected, canEdit = true, lockedReason, embedded = false, reverseCharge, onSave }: Props) {
  const [editing, setEditing] = useState(false);
  const [rows, setRows] = useState<ArticleLineItem[]>(items);

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
  const rotEnabled = quoteType === 'private' && Boolean(rotDetails?.enabled);

  // Summary reflects the live edit when editing, otherwise the saved articles.
  const source = editing ? rows : items;
  // Avskrivna rader räknas inte — varken i pengar eller i säckar. Ordervärdet ska visa det som
  // faktiskt levereras, annars stämmer inte CRM med fakturorna.
  const totals = useMemo(
    () => computePricing(source.filter((r) => !r.written_off) as PricingLineItem[], vatPercent, { isPrivate: quoteType === 'private', rot: rotDetails }),
    [source, vatPercent, quoteType, rotDetails],
  );
  // ⚠️ `source`, inte `items`. Räknat på de sparade raderna stod säcktalet stilla medan man
  // redigerade just de fält som bestämmer det — samma fel som `totals` redan undvek.
  const totalSacks = useMemo(
    () => source.filter((it) => !it.written_off).reduce((sum, it) => sum + sackInfo(it).sacks, 0),
    [source],
  );

  // Bekräftelse innan en prissatt rad försvinner. Samma inline-mönster som grannflikarna
  // (WorkOrderTimeTab, WorkOrderCommentsTab) — "Ta bort" var här radens SVAGASTE kontroll och
  // samtidigt den enda destruktiva.
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);

  function updateRow(id: string, patch: Partial<ArticleLineItem>) {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }
  function removeRow(id: string) {
    setRows((rs) => rs.filter((r) => r.id !== id));
    setConfirmRemoveId(null);
  }
  // Normalisering vid blur. Skriver BARA när strängen faktiskt ändras — annars hade en tur genom
  // fälten utan att röra något markerat formuläret som ändrat och tänt "Osparade ändringar".
  //
  // ⚠️ BARA MÅTTFÄLTEN. À-pris, rabatt och arbetskostnad är MEDVETET undantagna:
  // `validateLineItemEdit` (lib/domains/fortnox/partialInvoices.ts) jämför pris och rabatt som
  // EXAKTA STRÄNGAR på en delfakturerad order. Att bara tabba förbi À-pris hade skrivit om
  // "1200,00" till "1200" — samma tal, men sparningen nekas med "Rad 1 är fakturerad" och hela
  // redigeringen går förlorad. Måtten jämförs numeriskt (lineItemQuantity) och är därför trygga.
  function normalizeField(id: string, key: 'm2' | 'thickness_mm' | 'density' | 'quantity', current: string | undefined) {
    const before = current || '';
    const after = normalizeDecimalInput(before);
    if (after !== before) updateRow(id, { [key]: after });
  }
  function addArticle(a: FortnoxArticle) {
    setRows((rs) => [...rs, {
      id: newId(),
      article_number: a.article_number,
      article_name: a.description || a.article_number,
      article_price: typeof a.sales_price === 'number' ? a.sales_price : null,
      article_unit_name: a.unit || null,
      unit_price: a.sales_price != null ? String(a.sales_price) : '',
      pricing_mode: pricingModeFromUnit(a.unit),
      quantity: '', m2: '', thickness_mm: '', discount_percent: '', is_rot_work: false,
    }]);
  }

  async function save() {
    const ok = await onSave(rows);
    if (ok) { setEditing(false); setConfirmRemoveId(null); }
  }
  function cancel() {
    setRows(items);
    setEditing(false);
    setConfirmRemoveId(null);
  }

  // ── Delar som ser olika ut fristående och inbäddat ────────────────────────

  // Omvänd skattskyldighet (byggmoms) = företagsorder utan moms. Samma regel som pricing.ts
  // (`!isPrivate && vatPercent === 0`), räknad på samma siffror som summeringen visar, så
  // etiketten aldrig kan motsäga beloppet. Anroparen kan skicka in svaret i stället:
  // arbetsorderns detaljsida härleder det ur den SPARADE prissättningen och är därmed robust
  // mot en vat_percent-kolumn som drivit iväg till 25 på en byggmomsorder.
  const isReverseCharge = reverseCharge ?? (quoteType === 'business' && totals.vatPercent === 0 && totals.subtotal > 0);
  // "25.00" → "25". Momssatsen står i etiketten så summeringen bär det Ekonomi-flikens egen
  // ruta bar innan den slogs ihop hit.
  const vatPercentLabel = Number.isFinite(Number(vatPercent)) ? String(Number(vatPercent)) : String(vatPercent ?? '');

  // ⚠️ Säcktalet står kvar UNDER redigering, inte bara i läsläget. Förut byttes det mot
  // "Osparade ändringar", vilket betydde att medan man ändrade m², tjocklek och densitet — de
  // tre fälten vars enda syfte är säckantalet — fanns säckantalet ingenstans på sidan. Nu räknar
  // det live (se totalSacks) och står bredvid ändringsmarkören i stället för under den.
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

  return (
    <div className={embedded ? 'grid gap-3' : 'grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start'}>
      <div className={cn(!embedded && crm.cardInner, 'grid gap-3')}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <p className={crm.sectionTitle}>Artiklar</p>
            {headerBadge}
          </div>
          {/* Inbäddat finns ingen sidokolumn att lägga knapparna i — de hör till artiklarna och
              sitter därför i deras rubrikrad, skilda från översiktens egen Spara högst upp. */}
          {embedded ? (
            editing ? (
              <div className="flex items-center gap-2">
                <button type="button" onClick={cancel} disabled={saving} className={crm.ghostButton}>Avbryt</button>
                <button type="button" onClick={save} disabled={saving || !dirty} className={cn(crm.saveButton, 'h-8 w-auto px-4')}>
                  {saving ? 'Sparar…' : 'Spara artiklar'}
                </button>
              </div>
            ) : canEdit ? (
              <button type="button" onClick={() => setEditing(true)} className={crm.ghostButton}>Redigera artiklar</button>
            ) : null
          ) : null}
        </div>

        {/* ── Read mode ── */}
        {!editing ? (
          items.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[#cfdcc9] bg-[#f1f5ee] px-4 py-6 text-sm text-slate-500">Inga artiklar.</div>
          ) : (
            <div className="grid gap-2">
              {items.map((item) => {
                const { material, sacks } = sackInfo(item);
                const mode = item.pricing_mode === 'item' ? 'item' : 'm3';
                const writtenOff = !!item.written_off;
                return (
                  <div key={item.id} className={cn(
                    'flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2.5 text-sm',
                    writtenOff ? 'border-transparent bg-[#eef1ec] text-slate-500' : 'border-[#e0e8dc] bg-[#f1f5ee]',
                  )}>
                    <div className="grid min-w-0 gap-0.5">
                      <strong className={cn('truncate text-slate-900', writtenOff && 'line-through decoration-slate-400')}>{item.article_name || 'Offert-rad'}</strong>
                      <span className="text-xs text-slate-500">
                        {item.article_number || 'Utan artikelnummer'}
                        {mode === 'm3'
                          ? (item.m2 || item.thickness_mm ? ` · ${item.m2 || '0'} m² × ${item.thickness_mm || '0'} mm` : '')
                          : (item.thickness_mm ? ` · ${item.thickness_mm} mm` : '')}
                        {material ? ` · ${material.short}` : ''}{item.density ? ` · ${item.density} kg/m³` : ''}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      {writtenOff ? <span className="rounded-full border border-slate-300 bg-white px-2 py-0.5 font-semibold text-slate-500">Avskriven</span> : null}
                      {sacks > 0 && !writtenOff ? <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700">{sacks} säck</span> : null}
                      {/* m³ rows are priced per m³, so show the computed volume × à-pris (not the area). */}
                      <span>{mode === 'm3' ? `${formatQuantity(lineItemQuantity(item as any))} m³` : `Antal ${item.quantity || '0'}`} · à {formatCurrency(parseDecimal(item.unit_price), currencyCode)}</span>
                      <span className={cn('font-semibold text-slate-900', writtenOff && 'line-through decoration-slate-400')}>{formatCurrency(lineItemRowTotal(item as PricingLineItem), currencyCode)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )
        ) : (
          /* ── Edit mode ── */
          <>
            {rows.length === 0 ? (
              <div className="rounded-xl border border-dashed border-[#cfdcc9] bg-[#f1f5ee] px-4 py-6 text-sm text-slate-500">Inga artiklar — lägg till nedan.</div>
            ) : null}

            {rows.map((row) => {
              const mode = row.pricing_mode === 'item' ? 'item' : 'm3';
              const rowTotal = lineItemRowTotal(row as PricingLineItem);
              const rowSacks = sackInfo(row).sacks;
              const laborUnitLabel = mode === 'm3' ? 'm³' : (row.article_unit_name?.trim() || 'st');
              const laborSplit = splitRowLabor({
                laborCostPerUnit: row.labor_cost,
                // Samma priskälla som rowTotal ovan, computePricing i den här fliken och pushen:
                // explicit unit_price när det finns, annars artikelns pris. Läste vi bara
                // unit_price här skulle en rad som prissätts av artikeln visa "inget material blir
                // kvar" bredvid en radtotal som säger något helt annat.
                unitPrice: lineItemUnitPrice(row as PricingLineItem),
                discountPercent: parseDecimal(row.discount_percent),
                quantity: lineItemQuantity(row as PricingLineItem),
              });
              return (
                <div key={row.id} className="grid gap-2 rounded-xl border border-[#e0e8dc] bg-[#f1f5ee] px-3 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <strong className="block truncate text-sm text-slate-900">{row.article_name || 'Namnlös rad'}</strong>
                      {row.article_number ? <span className="text-xs text-slate-400">{row.article_number}</span> : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      {/* Knappen bytte prissättningsläge — och därmed VILKA FÄLT som visas — men
                          såg ut som en etikett: ett litet pill med bara "m³" i, granne med
                          "Ta bort". Nu står det vad den betyder, och title/aria säger vad ett
                          klick gör. */}
                      <button
                        type="button"
                        onClick={() => updateRow(row.id, { pricing_mode: mode === 'm3' ? 'item' : 'm3' })}
                        title={`Byt till pris per ${mode === 'm3' ? 'styck' : 'm³'}`}
                        // ⚠️ Aria-etiketten måste INNEHÅLLA den synliga texten (WCAG 2.5.3):
                        // röststyrning aktiverar knappen på det som står på den, och en etikett
                        // utan "Pris per m³" gör den omöjlig att träffa med rösten.
                        aria-label={`Pris per ${mode === 'm3' ? 'm³' : 'st'} — byt till pris per ${mode === 'm3' ? 'styck' : 'm³'}`}
                        className="rounded-full border border-[#cfdcc9] bg-white px-2.5 py-0.5 text-[11px] font-semibold text-slate-600 transition hover:border-[#1a3f26] hover:bg-[#eef3ec] hover:text-slate-900"
                      >
                        Pris per {mode === 'm3' ? 'm³' : 'st'}
                      </button>
                      {confirmRemoveId === row.id ? (
                        <span className="flex items-center gap-2 text-xs">
                          <span className="text-slate-500">Ta bort raden?</span>
                          <button type="button" onClick={() => removeRow(row.id)} className="font-semibold text-rose-600 transition hover:text-rose-700">Ja</button>
                          <button type="button" onClick={() => setConfirmRemoveId(null)} className="text-slate-500 transition hover:text-slate-700">Nej</button>
                        </span>
                      ) : (
                        <button type="button" onClick={() => setConfirmRemoveId(row.id)} className="text-xs font-medium text-slate-500 transition hover:text-rose-600">Ta bort</button>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {mode === 'm3' ? (
                      <>
                        <label className="grid gap-1">
                          <span className={crm.sectionTitle}>m²</span>
                          <Input value={row.m2 || ''} onChange={(e) => updateRow(row.id, { m2: e.target.value })} onBlur={() => normalizeField(row.id, 'm2', row.m2)} inputMode="decimal" placeholder="0" />
                        </label>
                        <label className="grid gap-1">
                          <span className={crm.sectionTitle}>Tjocklek mm</span>
                          <Input value={row.thickness_mm || ''} onChange={(e) => updateRow(row.id, { thickness_mm: e.target.value })} onBlur={() => normalizeField(row.id, 'thickness_mm', row.thickness_mm)} inputMode="decimal" placeholder="0" />
                        </label>
                        <label className="grid gap-1">
                          <span className={crm.sectionTitle}>Densitet kg/m³</span>
                          <Input value={row.density || ''} onChange={(e) => updateRow(row.id, { density: e.target.value })} onBlur={() => normalizeField(row.id, 'density', row.density)} inputMode="decimal" placeholder="t.ex. 45" />
                        </label>
                      </>
                    ) : (
                      <label className="grid gap-1">
                        <span className={crm.sectionTitle}>Antal</span>
                        <Input value={row.quantity || ''} onChange={(e) => updateRow(row.id, { quantity: e.target.value })} onBlur={() => normalizeField(row.id, 'quantity', row.quantity)} inputMode="decimal" placeholder="0" />
                      </label>
                    )}
                    <label className="grid gap-1">
                      <span className={crm.sectionTitle}>À-pris</span>
                      <Input value={row.unit_price || ''} onChange={(e) => updateRow(row.id, { unit_price: e.target.value })} inputMode="decimal" placeholder="0" />
                    </label>
                    <label className="grid gap-1">
                      <span className={crm.sectionTitle}>Rabatt %</span>
                      <Input value={row.discount_percent || ''} onChange={(e) => updateRow(row.id, { discount_percent: e.target.value })} inputMode="decimal" placeholder="0" />
                    </label>
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-3">
                      {rotEnabled ? (
                        <label className="flex items-center gap-2 text-xs text-slate-600">
                          <input type="checkbox" checked={!!row.is_rot_work} onChange={(e) => updateRow(row.id, { is_rot_work: e.target.checked })} className="h-4 w-4 accent-[color:var(--ek-accent)]" />
                          ROT-arbete
                        </label>
                      ) : null}
                      {/* Avskriven = såld men aldrig utförd. Räknas bort ur summan och skickas inte
                          till Fortnox, men raden ligger kvar så skillnaden mot offerten går att
                          förklara. En rad som aldrig fakturerats kan lika gärna tas bort helt. */}
                      <label className="flex items-center gap-2 text-xs text-slate-600">
                        <input type="checkbox" checked={!!row.written_off} onChange={(e) => updateRow(row.id, { written_off: e.target.checked })} className="h-4 w-4 accent-slate-500" />
                        Avskriven (utförs ej)
                      </label>
                    </div>
                    {/* ⚠️ Uträkningen syns nu MEDAN den redigeras. Läsläget visade
                        "115 säck · 30,78 m³", editorn bara kronbeloppet — alltså försvann
                        säckantalet och volymen precis när man ändrade m², tjocklek och densitet,
                        de tre fälten vars enda syfte är att ge dem. */}
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      {mode === 'm3' ? (
                        <span className="text-xs tabular-nums text-slate-500">{formatQuantity(lineItemQuantity(row as PricingLineItem))} m³</span>
                      ) : null}
                      {rowSacks > 0 && !row.written_off ? (
                        <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">{rowSacks} säck</span>
                      ) : null}
                      <span className={cn('text-sm font-semibold tabular-nums text-slate-900', row.written_off && 'line-through decoration-slate-400')}>{formatCurrency(rowTotal, currencyCode)}</span>
                    </div>
                  </div>

                  {/* Carve out the labour portion of a material row → the aggregated "Arbetskostnad
                      ROT" Fortnox row (row reduced by it, total unchanged). Hidden when the whole row
                      is flagged as ROT-arbete.

                      ⚠️ Beloppet är ett À-PRIS som räknas mot antalet, precis som À-priset ovanför,
                      och det bryts UT ur det — det läggs inte till. Samma fält och samma räkning som
                      i offertformuläret; texten under står här av samma skäl som där. */}
                  {rotEnabled && !row.is_rot_work ? (
                    <label className="grid gap-1">
                      <span className={crm.sectionTitle}>
                        Varav arbetskostnad (ROT, kr/{laborUnitLabel})
                      </span>
                      <Input value={row.labor_cost || ''} onChange={(e) => updateRow(row.id, { labor_cost: e.target.value })} inputMode="decimal" placeholder="0" />
                      {laborSplit.leavesNoMaterial ? (
                        <span className="text-[11px] leading-snug text-rose-700">
                          Arbetet är hela à-priset ({formatCurrency(lineItemUnitPrice(row as PricingLineItem), currencyCode)}/{laborUnitLabel}) — inget material blir kvar. Ingen arbetskostnad bryts ut förrän det rättas.
                        </span>
                      ) : laborSplit.labor > 0 ? (
                        <span className="text-[11px] leading-snug text-slate-500">
                          {formatCurrency(laborSplit.labor, currencyCode)} arbete av radens {formatCurrency(rowTotal, currencyCode)}.
                        </span>
                      ) : (
                        <span className="text-[11px] leading-snug text-slate-400">
                          Per {laborUnitLabel}, som à-priset. Bryts ut ur det.
                        </span>
                      )}
                    </label>
                  ) : null}
                </div>
              );
            })}

            <div className="border-t border-[#e0e8dc] pt-3">
              <ArticleSearch onSelect={addArticle} />
            </div>

            {/* Spara/Avbryt EN GÅNG TILL, här nere.
                Knapparna i rubrikraden räcker inte: sex rader à ~200 px plus ROT-fältet gör att
                de är långt utanför skärmen när man är klar. Bottenknappar i stället för en
                klistrad rad — översiktens redigering har redan en klistrad rad högst upp, och två
                sådana samtidigt (lägena är oberoende) hade legat på varandra. */}
            {embedded ? (
              <div className="flex items-center justify-end gap-2 border-t border-[#e0e8dc] pt-3">
                <button type="button" onClick={cancel} disabled={saving} className={crm.ghostButton}>Avbryt</button>
                <button type="button" onClick={save} disabled={saving || !dirty} className={cn(crm.saveButton, 'h-8 w-auto px-4')}>
                  {saving ? 'Sparar…' : 'Spara artiklar'}
                </button>
              </div>
            ) : null}
          </>
        )}
      </div>

      {/* Summering — egen kortkolumn fristående, ett avsnitt under raderna inbäddat. */}
      <div className={embedded ? 'grid gap-2 border-t border-[#e0e8dc] pt-3' : cn(crm.cardInner, 'grid gap-3 lg:content-start')}>
        {embedded ? null : <p className={crm.sectionTitle}>Summering</p>}
        {summaryRows}

        {embedded ? (
          editing ? <p className="text-xs text-slate-400">{saveHint}</p> : canEdit ? null : lockedHint
        ) : editing ? (
          <div className="grid gap-2">
            <button type="button" onClick={save} disabled={saving || !dirty} className={crm.saveButton}>
              {saving ? 'Sparar…' : 'Spara artiklar'}
            </button>
            <button type="button" onClick={cancel} disabled={saving} className={crm.ghostButton}>Avbryt</button>
            <p className="text-xs text-slate-400">{saveHint}</p>
          </div>
        ) : canEdit ? (
          <button type="button" onClick={() => setEditing(true)} className={cn(crm.ghostButton, 'w-full justify-center')}>
            Redigera artiklar
          </button>
        ) : (
          lockedHint
        )}
      </div>
    </div>
  );
}
