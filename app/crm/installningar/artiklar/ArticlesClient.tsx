"use client";

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useToast } from '@/lib/Toast';
import Button, { buttonVariants } from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Badge from '@/components/ui/Badge';
import EmptyState from '@/components/ui/EmptyState';
import type { CachedFortnoxArticle } from '@/lib/domains/fortnox/types';
import { matchesArticleSearch } from '@/lib/domains/fortnox/articleSearch';

type ArticlesClientProps = {
  initialArticles: CachedFortnoxArticle[];
  fortnoxConnected: boolean;
};

const LIST_BASE = '/crm/installningar/artiklar';

function formatPrice(value: number | null): string {
  if (value === null || value === undefined) return '–';
  return value.toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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

export default function ArticlesClient({ initialArticles, fortnoxConnected }: ArticlesClientProps) {
  const toast = useToast();
  const [articles, setArticles] = useState<CachedFortnoxArticle[]>(initialArticles);
  const [search, setSearch] = useState('');
  const [syncing, setSyncing] = useState(false);

  const filtered = useMemo(() => {
    if (!search.trim()) return articles;
    // Tokenised AND-across-words match, shared with the offer/quote article search.
    return articles.filter((a) => matchesArticleSearch(a, search));
  }, [articles, search]);

  async function handleSync() {
    setSyncing(true);
    try {
      await apiRequest('/api/fortnox/articles/sync', { method: 'POST' });
      const data = await apiRequest<{ items: CachedFortnoxArticle[] }>(
        '/api/fortnox/articles?active_only=false&limit=1000',
      );
      setArticles(data.items);
      toast.success('Artikelregistret synkades från Fortnox');
    } catch (e: any) {
      toast.error(e?.message || 'Synk misslyckades');
    } finally {
      setSyncing(false);
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
          <Button variant="secondary" onClick={handleSync} disabled={!fortnoxConnected || syncing}>
            {syncing ? 'Synkar…' : 'Synka från Fortnox'}
          </Button>
          <Link href={`${LIST_BASE}/ny`} className={buttonVariants({ variant: 'primary' }) + ' no-underline'}>
            Ny artikel
          </Link>
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
      <div className="rounded-2xl border border-[#e0e8dc] bg-[#f9fbf7] p-5 shadow-[0_1px_3px_rgba(20,44,27,0.06),0_18px_36px_-18px_rgba(20,44,27,0.24)]">
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
                    <td className="py-2.5 pr-3 text-slate-500">{a.article_type === 'SERVICE' ? 'Tjänst' : 'Material'}</td>
                    <td className="py-2.5 pr-3 text-slate-500">{a.unit ?? '–'}</td>
                    <td className="py-2.5 pr-3 text-right tabular-nums text-slate-700">{formatPrice(a.sales_price)}</td>
                    <td className="py-2.5 pr-3 text-right tabular-nums text-slate-700">{formatPrice(a.purchase_price)}</td>
                    <td className="py-2.5 pr-3">
                      {a.active ? <Badge variant="accent">Aktiv</Badge> : <Badge variant="neutral">Inaktiv</Badge>}
                    </td>
                    <td className="py-2.5 pr-3 text-right">
                      <Link
                        href={`${LIST_BASE}/${encodeURIComponent(a.article_number)}`}
                        className="inline-flex min-h-9 items-center rounded-xl border border-ui-border bg-white px-3 text-xs font-semibold text-ui-text-strong no-underline transition-colors hover:bg-ui-muted"
                      >
                        Redigera
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
