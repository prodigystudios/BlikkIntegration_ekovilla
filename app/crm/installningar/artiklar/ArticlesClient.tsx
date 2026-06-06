"use client";

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useToast } from '@/lib/Toast';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Badge from '@/components/ui/Badge';
import DialogShell from '@/components/ui/DialogShell';
import EmptyState from '@/components/ui/EmptyState';
import type { CachedFortnoxArticle, FortnoxArticleType } from '@/lib/domains/fortnox/types';

type ArticlesClientProps = {
  initialArticles: CachedFortnoxArticle[];
  fortnoxConnected: boolean;
};

type FormState = {
  article_number: string;
  description: string;
  sales_price: string;
  purchase_price: string;
  unit: string;
  type: FortnoxArticleType;
  active: boolean;
};

const EMPTY_FORM: FormState = {
  article_number: '',
  description: '',
  sales_price: '',
  purchase_price: '',
  unit: '',
  type: 'STOCK',
  active: true,
};

// Parse a Swedish-or-plain decimal string to a number, or null when blank.
function parsePrice(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const n = Number(trimmed.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function formatPrice(value: number | null): string {
  if (value === null || value === undefined) return '–';
  return value.toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Unwrap the { ok, data } / { ok: false, error } envelope used by the API routes.
async function apiRequest<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.ok) {
    throw new Error(json?.error || `Begäran misslyckades (${res.status})`);
  }
  return json.data as T;
}

export default function ArticlesClient({ initialArticles, fortnoxConnected }: ArticlesClientProps) {
  const toast = useToast();
  const [articles, setArticles] = useState<CachedFortnoxArticle[]>(initialArticles);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState<null | 'sync' | 'save' | 'delete'>(null);

  // null = closed; { number: null } = create; { number: string } = edit.
  const [editing, setEditing] = useState<null | { number: string | null }>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [confirmDelete, setConfirmDelete] = useState<CachedFortnoxArticle | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return articles;
    return articles.filter(
      (a) =>
        a.article_number.toLowerCase().includes(q) ||
        (a.description ?? '').toLowerCase().includes(q),
    );
  }, [articles, search]);

  async function refresh() {
    const data = await apiRequest<{ items: CachedFortnoxArticle[] }>(
      '/api/fortnox/articles?active_only=false&limit=1000',
    );
    setArticles(data.items);
  }

  async function handleSync() {
    setBusy('sync');
    try {
      await apiRequest('/api/fortnox/articles/sync', { method: 'POST' });
      await refresh();
      toast.success('Artikelregistret synkades från Fortnox');
    } catch (e: any) {
      toast.error(e?.message || 'Synk misslyckades');
    } finally {
      setBusy(null);
    }
  }

  function openCreate() {
    setForm(EMPTY_FORM);
    setEditing({ number: null });
  }

  function openEdit(article: CachedFortnoxArticle) {
    setForm({
      article_number: article.article_number,
      description: article.description ?? '',
      sales_price: article.sales_price?.toString() ?? '',
      purchase_price: article.purchase_price?.toString() ?? '',
      unit: article.unit ?? '',
      type: article.article_type === 'SERVICE' ? 'SERVICE' : 'STOCK',
      active: article.active,
    });
    setEditing({ number: article.article_number });
  }

  async function handleSave() {
    if (!editing) return;
    if (!form.description.trim()) {
      toast.error('Beskrivning krävs');
      return;
    }
    const isCreate = editing.number === null;
    setBusy('save');

    const body = {
      ...(isCreate && form.article_number.trim() ? { article_number: form.article_number.trim() } : {}),
      description: form.description.trim(),
      sales_price: parsePrice(form.sales_price),
      purchase_price: parsePrice(form.purchase_price),
      unit: form.unit.trim() || null,
      type: form.type,
      active: form.active,
    };

    try {
      if (isCreate) {
        await apiRequest('/api/fortnox/articles', { method: 'POST', body: JSON.stringify(body) });
      } else {
        await apiRequest(`/api/fortnox/articles/${encodeURIComponent(editing.number!)}`, {
          method: 'PUT',
          body: JSON.stringify(body),
        });
      }
      await refresh();
      setEditing(null);
      toast.success(isCreate ? 'Artikel skapad' : 'Artikel uppdaterad');
    } catch (e: any) {
      toast.error(e?.message || 'Kunde inte spara artikel');
    } finally {
      setBusy(null);
    }
  }

  async function handleDelete() {
    if (!confirmDelete) return;
    const number = confirmDelete.article_number;
    setBusy('delete');
    try {
      await apiRequest(`/api/fortnox/articles/${encodeURIComponent(number)}`, { method: 'DELETE' });
      await refresh();
      setConfirmDelete(null);
      toast.success(`Artikel ${number} raderad`);
    } catch (e: any) {
      toast.error(e?.message || 'Kunde inte ta bort artikel');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="m-0 text-2xl font-bold tracking-tight text-slate-900">Artiklar</h1>
          <p className="m-0 mt-1 text-sm text-slate-500">
            Skapa och redigera artiklar i Fortnox. Ändringar speglas direkt i appens artikelcache.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={handleSync} disabled={!fortnoxConnected || busy !== null}>
            {busy === 'sync' ? 'Synkar…' : 'Synka från Fortnox'}
          </Button>
          <Button variant="primary" onClick={openCreate} disabled={!fortnoxConnected || busy !== null}>
            Ny artikel
          </Button>
        </div>
      </div>

      {!fortnoxConnected && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Fortnox är inte kopplat. Anslut under{' '}
          <Link href="/crm/installningar" className="font-semibold underline">
            Inställningar
          </Link>{' '}
          för att kunna hantera artiklar.
        </div>
      )}

      {/* Search + table */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_2px_12px_rgba(0,0,0,0.04)]">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="w-full max-w-sm">
            <Input
              type="search"
              placeholder="Sök artikelnummer eller beskrivning…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <span className="text-xs font-semibold text-slate-500">{filtered.length} artiklar</span>
        </div>

        {filtered.length === 0 ? (
          <EmptyState
            title="Inga artiklar"
            description={
              articles.length === 0
                ? 'Synka från Fortnox eller skapa en ny artikel för att komma igång.'
                : 'Inga artiklar matchar din sökning.'
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">
                  <th className="py-2 pr-3">Artikelnr</th>
                  <th className="py-2 pr-3">Beskrivning</th>
                  <th className="py-2 pr-3">Typ</th>
                  <th className="py-2 pr-3">Enhet</th>
                  <th className="py-2 pr-3 text-right">Försäljn.</th>
                  <th className="py-2 pr-3 text-right">Inköp</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3 text-right">Åtgärder</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((a) => (
                  <tr key={a.article_number} className="border-b border-slate-100 last:border-0">
                    <td className="py-2.5 pr-3 font-semibold text-slate-900">{a.article_number}</td>
                    <td className="py-2.5 pr-3 text-slate-700">{a.description ?? '–'}</td>
                    <td className="py-2.5 pr-3 text-slate-500">{a.article_type === 'SERVICE' ? 'Tjänst' : 'Lager'}</td>
                    <td className="py-2.5 pr-3 text-slate-500">{a.unit ?? '–'}</td>
                    <td className="py-2.5 pr-3 text-right tabular-nums text-slate-700">{formatPrice(a.sales_price)}</td>
                    <td className="py-2.5 pr-3 text-right tabular-nums text-slate-700">{formatPrice(a.purchase_price)}</td>
                    <td className="py-2.5 pr-3">
                      {a.active ? <Badge variant="accent">Aktiv</Badge> : <Badge variant="neutral">Inaktiv</Badge>}
                    </td>
                    <td className="py-2.5 pr-3">
                      <div className="flex items-center justify-end gap-2">
                        <Button size="sm" variant="secondary" onClick={() => openEdit(a)} disabled={busy !== null}>
                          Redigera
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          className="border-red-200 text-red-700 hover:bg-red-50"
                          onClick={() => setConfirmDelete(a)}
                          disabled={busy !== null}
                        >
                          Radera
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create / edit dialog */}
      {editing && (
        <DialogShell
          eyebrow={editing.number === null ? 'Ny artikel' : 'Redigera artikel'}
          title={editing.number === null ? 'Skapa artikel' : `Artikel ${editing.number}`}
          description="Fälten sparas till Fortnox och uppdaterar appens artikelcache."
          onClose={() => (busy === null ? setEditing(null) : undefined)}
          panelClassName="max-w-lg"
        >
          <div className="grid gap-4">
            <label className="grid gap-1.5">
              <span className="text-sm font-semibold text-slate-700">Artikelnummer</span>
              <Input
                value={editing.number ?? form.article_number}
                onChange={(e) => setForm((f) => ({ ...f, article_number: e.target.value }))}
                placeholder="Lämna tomt för automatiskt nummer"
                disabled={editing.number !== null}
              />
              {editing.number !== null && (
                <span className="text-xs text-slate-400">Artikelnummer kan inte ändras.</span>
              )}
            </label>

            <label className="grid gap-1.5">
              <span className="text-sm font-semibold text-slate-700">Beskrivning *</span>
              <Input
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="Artikelns benämning"
              />
            </label>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="grid gap-1.5">
                <span className="text-sm font-semibold text-slate-700">Försäljningspris</span>
                <Input
                  inputMode="decimal"
                  value={form.sales_price}
                  onChange={(e) => setForm((f) => ({ ...f, sales_price: e.target.value }))}
                  placeholder="0,00"
                />
              </label>
              <label className="grid gap-1.5">
                <span className="text-sm font-semibold text-slate-700">Inköpspris</span>
                <Input
                  inputMode="decimal"
                  value={form.purchase_price}
                  onChange={(e) => setForm((f) => ({ ...f, purchase_price: e.target.value }))}
                  placeholder="0,00"
                />
              </label>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="grid gap-1.5">
                <span className="text-sm font-semibold text-slate-700">Enhet</span>
                <Input
                  value={form.unit}
                  onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))}
                  placeholder="t.ex. st, m², tim"
                />
              </label>
              <label className="grid gap-1.5">
                <span className="text-sm font-semibold text-slate-700">Typ</span>
                <Select
                  value={form.type}
                  onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as FortnoxArticleType }))}
                >
                  <option value="STOCK">Lagervara</option>
                  <option value="SERVICE">Tjänst</option>
                </Select>
              </label>
            </div>

            <label className="flex items-center gap-2.5">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))}
                className="h-4 w-4 rounded border-slate-300"
              />
              <span className="text-sm font-medium text-slate-700">Aktiv</span>
            </label>

            <div className="flex items-center justify-end gap-2 pt-1">
              <Button variant="secondary" onClick={() => setEditing(null)} disabled={busy !== null}>
                Avbryt
              </Button>
              <Button variant="primary" onClick={handleSave} disabled={busy !== null}>
                {busy === 'save' ? 'Sparar…' : 'Spara'}
              </Button>
            </div>
          </div>
        </DialogShell>
      )}

      {/* Delete confirmation */}
      {confirmDelete && (
        <DialogShell
          eyebrow="Radera artikel"
          title={`Radera ${confirmDelete.article_number}?`}
          description="Artikeln tas bort i Fortnox. Detta går inte att ångra."
          onClose={() => (busy === null ? setConfirmDelete(null) : undefined)}
          panelClassName="max-w-md"
        >
          <div className="grid gap-4">
            <p className="m-0 text-sm text-slate-600">
              {confirmDelete.description || 'Artikel utan beskrivning'}
            </p>
            <p className="m-0 text-xs text-slate-400">
              Fortnox kan neka borttagning om artikeln används på offerter, order eller fakturor.
            </p>
            <div className="flex items-center justify-end gap-2 pt-1">
              <Button variant="secondary" onClick={() => setConfirmDelete(null)} disabled={busy !== null}>
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
