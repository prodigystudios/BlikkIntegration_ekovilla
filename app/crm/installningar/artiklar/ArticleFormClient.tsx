"use client";

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useToast } from '@/lib/Toast';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import DialogShell from '@/components/ui/DialogShell';
import type { FortnoxArticlePriceRow } from '@/lib/domains/fortnox/types';

export type ArticleFormInitial = {
  article_number: string;
  description: string;
  purchase_price: number | null;
  unit: string | null;
  type: 'STOCK' | 'SERVICE';
  active: boolean;
  vat: number | null;
  ean: string | null;
  manufacturer: string | null;
  manufacturer_article_number: string | null;
  note: string | null;
};

type ArticleFormClientProps = {
  mode: 'create' | 'edit';
  fortnoxConnected: boolean;
  priceLists: FortnoxArticlePriceRow[];
  units: { code: string; description: string }[];
  initial?: ArticleFormInitial;
  articleNumber?: string;
};

const VAT_OPTIONS = ['25', '12', '6', '0'];
const LIST_BASE = '/crm/installningar/artiklar';

// Parse a Swedish-or-plain decimal string to a number, or null when blank.
function parseNum(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const n = Number(trimmed.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

// Show a stored number in the input using a Swedish comma.
function toInput(value: number | null): string {
  return value === null || value === undefined ? '' : String(value).replace('.', ',');
}

async function apiRequest<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.ok) throw new Error(json?.error || `Begäran misslyckades (${res.status})`);
  return json.data as T;
}

export default function ArticleFormClient({
  mode,
  fortnoxConnected,
  priceLists,
  units,
  initial,
  articleNumber,
}: ArticleFormClientProps) {
  const router = useRouter();
  const toast = useToast();
  const isCreate = mode === 'create';

  const [form, setForm] = useState({
    article_number: initial?.article_number ?? '',
    description: initial?.description ?? '',
    note: initial?.note ?? '',
    type: initial?.type ?? ('STOCK' as 'STOCK' | 'SERVICE'),
    vat: initial?.vat != null ? String(initial.vat) : '',
    unit: initial?.unit ?? '',
    purchase_price: toInput(initial?.purchase_price ?? null),
    ean: initial?.ean ?? '',
    manufacturer: initial?.manufacturer ?? '',
    manufacturer_article_number: initial?.manufacturer_article_number ?? '',
    inactive: initial ? !initial.active : false,
  });

  // Per-price-list input values keyed by list code; seeded from current prices.
  const initialPriceMap = useMemo(
    () => Object.fromEntries(priceLists.map((p) => [p.code, p.price])),
    [priceLists],
  );
  const [priceInputs, setPriceInputs] = useState<Record<string, string>>(
    () => Object.fromEntries(priceLists.map((p) => [p.code, toInput(p.price)])),
  );

  const [busy, setBusy] = useState<null | 'save' | 'delete'>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Unit options from the Fortnox register; keep the article's current unit
  // selectable even if it is no longer in the register.
  const unitOptions = useMemo(() => {
    const codes = new Set(units.map((u) => u.code));
    const extra = form.unit && !codes.has(form.unit) ? [{ code: form.unit, description: form.unit }] : [];
    return [...extra, ...units];
  }, [units, form.unit]);

  function setField<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  // Only price lists whose value changed are sent (null = clear, number = upsert).
  function changedPrices() {
    return priceLists
      .map((p) => ({ price_list: p.code, price: parseNum(priceInputs[p.code] ?? '') }))
      .filter((p) => p.price !== (initialPriceMap[p.price_list] ?? null));
  }

  async function handleSave() {
    if (!form.description.trim()) {
      toast.error('Namn krävs');
      return;
    }
    setBusy('save');

    const body = {
      ...(isCreate && form.article_number.trim() ? { article_number: form.article_number.trim() } : {}),
      description: form.description.trim(),
      purchase_price: parseNum(form.purchase_price),
      unit: form.unit.trim() || null,
      type: form.type,
      active: !form.inactive,
      vat: form.vat === '' ? null : Number(form.vat),
      ean: form.ean.trim() || null,
      manufacturer: form.manufacturer.trim() || null,
      manufacturer_article_number: form.manufacturer_article_number.trim() || null,
      note: form.note.trim() || null,
      prices: changedPrices(),
    };

    try {
      if (isCreate) {
        await apiRequest('/api/fortnox/articles', { method: 'POST', body: JSON.stringify(body) });
      } else {
        await apiRequest(`/api/fortnox/articles/${encodeURIComponent(articleNumber!)}`, {
          method: 'PUT',
          body: JSON.stringify(body),
        });
      }
      toast.success(isCreate ? 'Artikel skapad' : 'Artikel uppdaterad');
      router.push(LIST_BASE);
      router.refresh();
    } catch (e: any) {
      toast.error(e?.message || 'Kunde inte spara artikel');
    } finally {
      setBusy(null);
    }
  }

  async function handleDelete() {
    if (!articleNumber) return;
    setBusy('delete');
    try {
      await apiRequest(`/api/fortnox/articles/${encodeURIComponent(articleNumber)}`, { method: 'DELETE' });
      toast.success(`Artikel ${articleNumber} raderad`);
      router.push(LIST_BASE);
      router.refresh();
    } catch (e: any) {
      toast.error(e?.message || 'Kunde inte ta bort artikel');
      setConfirmDelete(false);
    } finally {
      setBusy(null);
    }
  }

  const title = isCreate ? 'Ny artikel' : `Redigera artikel ${articleNumber ?? ''}`.trim();

  return (
    <div className="grid grid-cols-1 gap-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href={LIST_BASE} className="text-xs font-semibold text-slate-500 no-underline hover:text-slate-800">
            ← Tillbaka till artiklar
          </Link>
          <h1 className="m-0 mt-1 text-2xl font-bold tracking-tight text-slate-900">{title}</h1>
        </div>
        <div className="hidden gap-2 sm:flex">
          <Button variant="secondary" onClick={() => router.push(LIST_BASE)} disabled={busy !== null}>
            Avbryt
          </Button>
          <Button variant="primary" onClick={handleSave} disabled={!fortnoxConnected || busy !== null}>
            {busy === 'save' ? 'Sparar…' : 'Spara'}
          </Button>
        </div>
      </div>

      {!fortnoxConnected && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Fortnox är inte kopplat. Anslut under{' '}
          <Link href="/crm/installningar" className="font-semibold underline">
            Inställningar
          </Link>{' '}
          för att kunna spara artiklar.
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(280px,0.9fr)]">
        {/* Article fields */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_2px_12px_rgba(0,0,0,0.04)]">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-1.5">
              <span className="text-sm font-semibold text-slate-700">Artikelnummer</span>
              <Input
                value={isCreate ? form.article_number : articleNumber ?? ''}
                onChange={(e) => setField('article_number', e.target.value)}
                placeholder={isCreate ? 'Lämna tomt för automatiskt nummer' : ''}
                disabled={!isCreate}
              />
              {!isCreate && <span className="text-xs text-slate-400">Artikelnummer kan inte ändras.</span>}
            </label>

            <label className="grid gap-1.5">
              <span className="text-sm font-semibold text-slate-700">Artikeltyp *</span>
              <Select value={form.type} onChange={(e) => setField('type', e.target.value as 'STOCK' | 'SERVICE')}>
                <option value="STOCK">Material (lagervara)</option>
                <option value="SERVICE">Tjänst</option>
              </Select>
            </label>

            <label className="grid gap-1.5 sm:col-span-2">
              <span className="text-sm font-semibold text-slate-700">Namn *</span>
              <Input
                value={form.description}
                onChange={(e) => setField('description', e.target.value)}
                placeholder="Artikelns benämning"
              />
            </label>

            <label className="grid gap-1.5 sm:col-span-2">
              <span className="text-sm font-semibold text-slate-700">Beskrivning</span>
              <textarea
                value={form.note}
                onChange={(e) => setField('note', e.target.value)}
                rows={3}
                className="w-full rounded-xl border border-ui-border bg-white px-3 py-2 text-sm text-ui-text-strong transition-colors placeholder:text-ui-text-soft hover:border-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ui-accent/20"
              />
            </label>

            <label className="grid gap-1.5">
              <span className="text-sm font-semibold text-slate-700">Moms</span>
              <Select value={form.vat} onChange={(e) => setField('vat', e.target.value)}>
                <option value="">—</option>
                {VAT_OPTIONS.map((v) => (
                  <option key={v} value={v}>{v}%</option>
                ))}
              </Select>
            </label>

            <label className="grid gap-1.5">
              <span className="text-sm font-semibold text-slate-700">Enhet</span>
              {units.length === 0 ? (
                <Input value={form.unit} onChange={(e) => setField('unit', e.target.value)} placeholder="t.ex. st, m², tim" />
              ) : (
                <Select value={form.unit} onChange={(e) => setField('unit', e.target.value)}>
                  <option value="">—</option>
                  {unitOptions.map((u) => (
                    <option key={u.code} value={u.code}>
                      {u.description && u.description !== u.code ? `${u.code} – ${u.description}` : u.code}
                    </option>
                  ))}
                </Select>
              )}
            </label>

            <label className="grid gap-1.5">
              <span className="text-sm font-semibold text-slate-700">Inköpspris / kostnad</span>
              <Input
                inputMode="decimal"
                value={form.purchase_price}
                onChange={(e) => setField('purchase_price', e.target.value)}
                placeholder="0,00"
              />
            </label>

            <label className="grid gap-1.5">
              <span className="text-sm font-semibold text-slate-700">EAN-kod</span>
              <Input value={form.ean} onChange={(e) => setField('ean', e.target.value)} />
            </label>

            <label className="grid gap-1.5">
              <span className="text-sm font-semibold text-slate-700">Tillverkare</span>
              <Input value={form.manufacturer} onChange={(e) => setField('manufacturer', e.target.value)} />
            </label>

            <label className="grid gap-1.5">
              <span className="text-sm font-semibold text-slate-700">Tillverkarens art.nr</span>
              <Input
                value={form.manufacturer_article_number}
                onChange={(e) => setField('manufacturer_article_number', e.target.value)}
              />
            </label>

            <label className="mt-1 flex items-center gap-2.5 sm:col-span-2">
              <input
                type="checkbox"
                checked={form.inactive}
                onChange={(e) => setField('inactive', e.target.checked)}
                className="h-4 w-4 rounded border-slate-300"
              />
              <span className="text-sm font-medium text-slate-700">Inaktiv</span>
            </label>
          </div>
        </div>

        {/* Prices per price list */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_2px_12px_rgba(0,0,0,0.04)]">
          <h2 className="m-0 mb-1 text-base font-bold text-slate-900">Priser (ex moms)</h2>
          <p className="m-0 mb-4 text-sm text-slate-500">Försäljningspris per prislista. Lämna tomt för inget pris.</p>

          {priceLists.length === 0 ? (
            <p className="m-0 text-sm text-slate-400">
              {fortnoxConnected ? 'Inga prislistor hittades i Fortnox.' : 'Anslut Fortnox för att se prislistor.'}
            </p>
          ) : (
            <div className="grid gap-3">
              {priceLists.map((list) => (
                <label key={list.code} className="grid gap-1.5">
                  <span className="text-sm font-medium text-slate-700">{list.description || list.code}</span>
                  <Input
                    inputMode="decimal"
                    value={priceInputs[list.code] ?? ''}
                    onChange={(e) => setPriceInputs((p) => ({ ...p, [list.code]: e.target.value }))}
                    placeholder="0,00"
                  />
                </label>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Footer actions (mobile-friendly, delete on edit) */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          {!isCreate && (
            <Button
              variant="secondary"
              className="border-red-200 text-red-700 hover:bg-red-50"
              onClick={() => setConfirmDelete(true)}
              disabled={busy !== null}
            >
              Ta bort
            </Button>
          )}
        </div>
        <div className="flex flex-1 justify-end gap-2 sm:flex-none">
          <Button variant="secondary" fullWidth className="sm:w-auto" onClick={() => router.push(LIST_BASE)} disabled={busy !== null}>
            Avbryt
          </Button>
          <Button variant="primary" fullWidth className="sm:w-auto" onClick={handleSave} disabled={!fortnoxConnected || busy !== null}>
            {busy === 'save' ? 'Sparar…' : 'Spara'}
          </Button>
        </div>
      </div>

      {confirmDelete && (
        <DialogShell
          eyebrow="Radera artikel"
          title={`Radera ${articleNumber}?`}
          description="Artikeln tas bort i Fortnox. Detta går inte att ångra."
          onClose={() => (busy === null ? setConfirmDelete(false) : undefined)}
          panelClassName="max-w-md"
        >
          <div className="grid gap-4">
            <p className="m-0 text-xs text-slate-400">
              Fortnox kan neka borttagning om artikeln används på offerter, order eller fakturor.
            </p>
            <div className="flex items-center justify-end gap-2">
              <Button variant="secondary" onClick={() => setConfirmDelete(false)} disabled={busy !== null}>
                Avbryt
              </Button>
              <Button
                variant="primary"
                className="border-red-600 bg-red-600 hover:bg-red-700"
                onClick={handleDelete}
                disabled={busy !== null}
              >
                {busy === 'delete' ? 'Raderar…' : 'Radera'}
              </Button>
            </div>
          </div>
        </DialogShell>
      )}
    </div>
  );
}
