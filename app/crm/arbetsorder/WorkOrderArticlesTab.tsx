"use client";

import { useEffect, useMemo, useState } from 'react';
import Input from '../../../components/ui/Input';
import { cn } from '@/lib/shared/cn';
import { crm } from '@/app/crm/lib/crmTokens';
import { computePricing, lineItemRowTotal, type PricingLineItem } from '@/lib/domains/crm/pricing';
import { lineItemQuantity } from '@/lib/domains/crm/lineItems';
import { inferMaterialFromArticle, sacksFor } from '@/lib/domains/crm/materials';
import { parseDecimal } from '@/lib/shared/number';
import { formatCurrency } from '@/app/crm/lib/format';

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
  // Labour carved out of a material row for ROT — summed onto the "Arbetskostnad ROT" Fortnox row.
  labor_cost?: string;
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
function formatVolume(n: number) {
  return n.toLocaleString('sv-SE', { maximumFractionDigits: 3 });
}

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

// ─── Articles tab (read + edit modes) ──────────────────────────────────────────
type Props = {
  items: ArticleLineItem[];
  currencyCode: string;
  vatPercent: number | string;
  quoteType: 'private' | 'business';
  rotDetails: Record<string, any> | null;
  saving: boolean;
  fortnoxConnected: boolean;
  canEdit?: boolean;
  onSave: (items: ArticleLineItem[]) => Promise<boolean>;
};

export default function WorkOrderArticlesTab({ items, currencyCode, vatPercent, quoteType, rotDetails, saving, fortnoxConnected, canEdit = true, onSave }: Props) {
  const [editing, setEditing] = useState(false);
  const [rows, setRows] = useState<ArticleLineItem[]>(items);

  // Resync from source when the work order reloads (e.g. after a successful save).
  useEffect(() => { setRows(items); }, [items]);

  const dirty = useMemo(() => JSON.stringify(rows) !== JSON.stringify(items), [rows, items]);
  const rotEnabled = quoteType === 'private' && Boolean(rotDetails?.enabled);

  // Summary reflects the live edit when editing, otherwise the saved articles.
  const source = editing ? rows : items;
  const totals = useMemo(
    () => computePricing(source as PricingLineItem[], vatPercent, { isPrivate: quoteType === 'private', rot: rotDetails }),
    [source, vatPercent, quoteType, rotDetails],
  );
  const totalSacks = useMemo(() => items.reduce((sum, it) => sum + sackInfo(it).sacks, 0), [items]);

  function updateRow(id: string, patch: Partial<ArticleLineItem>) {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }
  function removeRow(id: string) {
    setRows((rs) => rs.filter((r) => r.id !== id));
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
    if (ok) setEditing(false);
  }
  function cancel() {
    setRows(items);
    setEditing(false);
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start">
      <div className={cn(crm.cardInner, 'grid gap-3')}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className={crm.sectionTitle}>Artiklar</p>
          {editing
            ? (dirty ? <span className={cn(crm.badge, 'border-amber-200 bg-amber-50 text-amber-700')}>Osparade ändringar</span> : null)
            : (totalSacks > 0 ? <span className={cn(crm.badge, 'border-emerald-200 bg-emerald-50 text-emerald-700')}>{totalSacks} säckar totalt</span> : null)}
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
                return (
                  <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#e0e8dc] bg-[#f1f5ee] px-3 py-2.5 text-sm">
                    <div className="grid min-w-0 gap-0.5">
                      <strong className="truncate text-slate-900">{item.article_name || 'Offert-rad'}</strong>
                      <span className="text-xs text-slate-500">
                        {item.article_number || 'Utan artikelnummer'}
                        {mode === 'm3'
                          ? (item.m2 || item.thickness_mm ? ` · ${item.m2 || '0'} m² × ${item.thickness_mm || '0'} mm` : '')
                          : (item.thickness_mm ? ` · ${item.thickness_mm} mm` : '')}
                        {material ? ` · ${material.short}` : ''}{item.density ? ` · ${item.density} kg/m³` : ''}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      {sacks > 0 ? <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700">{sacks} säck</span> : null}
                      {/* m³ rows are priced per m³, so show the computed volume × à-pris (not the area). */}
                      <span>{mode === 'm3' ? `${formatVolume(lineItemQuantity(item as any))} m³` : `Antal ${item.quantity || '0'}`} · à {formatCurrency(parseDecimal(item.unit_price), currencyCode)}</span>
                      <span className="font-semibold text-slate-900">{formatCurrency(lineItemRowTotal(item as PricingLineItem), currencyCode)}</span>
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
              return (
                <div key={row.id} className="grid gap-2 rounded-xl border border-[#e0e8dc] bg-[#f1f5ee] px-3 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <strong className="block truncate text-sm text-slate-900">{row.article_name || 'Namnlös rad'}</strong>
                      {row.article_number ? <span className="text-xs text-slate-400">{row.article_number}</span> : null}
                    </div>
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => updateRow(row.id, { pricing_mode: mode === 'm3' ? 'item' : 'm3' })}
                        className="rounded-full border border-[#cfdcc9] bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-600 hover:border-slate-300"
                      >
                        {mode === 'm3' ? 'm³' : 'st'}
                      </button>
                      <button type="button" onClick={() => removeRow(row.id)} className="text-xs font-medium text-slate-400 transition hover:text-rose-500">Ta bort</button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {mode === 'm3' ? (
                      <>
                        <label className="grid gap-1">
                          <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-400">m²</span>
                          <Input value={row.m2 || ''} onChange={(e) => updateRow(row.id, { m2: e.target.value })} inputMode="decimal" placeholder="0" />
                        </label>
                        <label className="grid gap-1">
                          <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-400">Tjocklek mm</span>
                          <Input value={row.thickness_mm || ''} onChange={(e) => updateRow(row.id, { thickness_mm: e.target.value })} inputMode="decimal" placeholder="0" />
                        </label>
                        <label className="grid gap-1">
                          <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-400">Densitet kg/m³</span>
                          <Input value={row.density || ''} onChange={(e) => updateRow(row.id, { density: e.target.value })} inputMode="decimal" placeholder="t.ex. 45" />
                        </label>
                      </>
                    ) : (
                      <label className="grid gap-1">
                        <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-400">Antal</span>
                        <Input value={row.quantity || ''} onChange={(e) => updateRow(row.id, { quantity: e.target.value })} inputMode="decimal" placeholder="0" />
                      </label>
                    )}
                    <label className="grid gap-1">
                      <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-400">À-pris</span>
                      <Input value={row.unit_price || ''} onChange={(e) => updateRow(row.id, { unit_price: e.target.value })} inputMode="decimal" placeholder="0" />
                    </label>
                    <label className="grid gap-1">
                      <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-400">Rabatt %</span>
                      <Input value={row.discount_percent || ''} onChange={(e) => updateRow(row.id, { discount_percent: e.target.value })} inputMode="decimal" placeholder="0" />
                    </label>
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    {rotEnabled ? (
                      <label className="flex items-center gap-2 text-xs text-slate-600">
                        <input type="checkbox" checked={!!row.is_rot_work} onChange={(e) => updateRow(row.id, { is_rot_work: e.target.checked })} className="h-3.5 w-3.5 rounded border-slate-300 accent-emerald-600" />
                        ROT-arbete
                      </label>
                    ) : <span />}
                    <span className="text-sm font-semibold text-slate-900">{formatCurrency(rowTotal, currencyCode)}</span>
                  </div>

                  {/* Carve out the labour portion of a material row → the aggregated "Arbetskostnad
                      ROT" Fortnox row (row reduced by it, total unchanged). Hidden when the whole row
                      is flagged as ROT-arbete. */}
                  {rotEnabled && !row.is_rot_work ? (
                    <label className="grid gap-1">
                      <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-400">Varav arbetskostnad (ROT, kr)</span>
                      <Input value={row.labor_cost || ''} onChange={(e) => updateRow(row.id, { labor_cost: e.target.value })} inputMode="decimal" placeholder="0" />
                    </label>
                  ) : null}
                </div>
              );
            })}

            <div className="border-t border-[#e0e8dc] pt-3">
              <ArticleSearch onSelect={addArticle} />
            </div>
          </>
        )}
      </div>

      {/* Summary + actions */}
      <div className={cn(crm.cardInner, 'grid gap-3 lg:content-start')}>
        <p className={crm.sectionTitle}>Summering</p>
        <div className="grid gap-2 text-sm">
          <div className="flex items-center justify-between gap-3"><span className="text-slate-500">Delsumma</span><span className="font-semibold text-slate-900">{formatCurrency(totals.subtotal, currencyCode)}</span></div>
          <div className="flex items-center justify-between gap-3"><span className="text-slate-500">Moms</span><span className="font-semibold text-slate-900">{formatCurrency(totals.vat, currencyCode)}</span></div>
          {totals.rotDeduction > 0 ? (
            <div className="flex items-center justify-between gap-3"><span className="text-slate-500">Avgår ROT</span><span className="font-semibold text-emerald-700">−{formatCurrency(totals.rotDeduction, currencyCode)}</span></div>
          ) : null}
          <div className="flex items-center justify-between gap-3 border-t border-[#e0e8dc] pt-2">
            <span className="font-semibold text-slate-700">{totals.rotDeduction > 0 ? 'Att betala' : 'Total'}</span>
            <span className="text-base font-bold text-slate-900">{formatCurrency(totals.rotDeduction > 0 ? totals.toPay : totals.total, currencyCode)}</span>
          </div>
        </div>

        {editing ? (
          <div className="grid gap-2">
            <button type="button" onClick={save} disabled={saving || !dirty} className={crm.saveButton}>
              {saving ? 'Sparar…' : 'Spara artiklar'}
            </button>
            <button type="button" onClick={cancel} disabled={saving} className={crm.ghostButton}>Avbryt</button>
            <p className="text-xs text-slate-400">
              {fortnoxConnected ? 'Sparar räknar om summorna och uppdaterar Fortnox-ordern.' : 'Sparar räknar om summorna (Fortnox ej anslutet).'}
            </p>
          </div>
        ) : canEdit ? (
          <button type="button" onClick={() => setEditing(true)} className={cn(crm.ghostButton, 'w-full justify-center')}>
            Redigera artiklar
          </button>
        ) : (
          <p className="text-xs text-slate-400">Arbetsordern är fakturerad och kan inte ändras.</p>
        )}
      </div>
    </div>
  );
}
