"use client";

import { useEffect, useState } from 'react';
import Input from '../../../components/ui/Input';
import { formatUnitPrice, displayUnit } from './lineItemTable';

// Artikelväljaren på en artikelrad — söker i artikelcachen, visar "Senaste artiklar" vid tomt fält,
// ★-favoriter (delade mellan säljare), och den valda artikeln som en rad fakta med Byt/Rensa.
//
// Delad mellan offertformuläret och arbetsorderns artikeleditor (via LineItemRow). Tidigare hade
// arbetsordern en egen, enklare sökruta som bara kunde LÄGGA TILL rader — en befintlig rads artikel
// gick inte att byta alls, och de två editorerna såg ut som två olika program.

export type ArticleLite = {
  id?: string;
  name?: string;
  articleNumber?: string;
  price?: number | null;
  unit?: string | { name?: string | null; objectiveName?: string | null } | null;
  isFavorite?: boolean;
  // Artikelns beskrivning ur registret. INTERN hjälptext för säljaren — se article_note på raden.
  note?: string | null;
  // Inköpspris ur artikelcachen, för täckningsgraden. Lagras ALDRIG på offertraden (se pricing.ts):
  // line_items följer med till fältvyn, och där har installatörerna inget med inköpspriser att göra.
  purchasePrice?: number | null;
  // Artikelregistrets standard för "ta med i arbetsbeskrivningen". Bara ett utgångsläge för en NY
  // rad — se include_in_description på QuoteLineItem.
  includeInWorkDescription?: boolean;
};

export function getArticleUnitName(unit: ArticleLite['unit']) {
  if (!unit) return '';
  if (typeof unit === 'string') return unit;
  return String(unit.name || unit.objectiveName || '');
}

export default function ArticlePicker({ value, articleNumber, price, unit, note, purchasePrice, onSelect, onClear, locked = false }: {
  value: string;
  articleNumber?: string | null;
  price?: number | null;
  unit?: string | null;
  /** Artikelns beskrivning ur registret — INTERN hjälptext, når aldrig Fortnox. */
  note?: string | null;
  /** Inköpspris per enhet ur artikelregistret. Visas som underlag till täckningsgraden — utan
   *  kronorna är procenten svår att förhandla mot. Lagras aldrig på raden (se pricing.ts). */
  purchasePrice?: number | null;
  onSelect: (article: ArticleLite) => void;
  onClear: () => void;
  /** Artikeln kan inte bytas (raden står på en utställd faktura): kortet utan Byt/Rensa. */
  locked?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<ArticleLite[]>([]);
  const [error, setError] = useState<string | null>(null);
  // When an article is picked we show a solid "selected" card instead of the search box.
  // "Byt" flips into search mode; selecting or cancelling returns to the card.
  const [searching, setSearching] = useState(false);

  // Toggle a global favorite (shared across sellers). Optimistic; floats favorites to the top.
  // onMouseDown + preventDefault so the star click doesn't blur the search input (which would
  // close the dropdown before the toggle registers), and doesn't select the article.
  async function toggleFavorite(item: ArticleLite, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const articleNumber = item.articleNumber;
    if (!articleNumber) return;
    const next = !item.isFavorite;
    setItems((prev) => {
      const updated = prev.map((a) => (a.articleNumber === articleNumber ? { ...a, isFavorite: next } : a));
      return [...updated.filter((a) => a.isFavorite), ...updated.filter((a) => !a.isFavorite)];
    });
    try {
      await fetch(`/api/fortnox/articles/${encodeURIComponent(articleNumber)}/favorite`, { method: next ? 'POST' : 'DELETE' });
    } catch { /* best-effort — keep the optimistic state */ }
  }

  useEffect(() => {
    // Open with no query → default list (recent articles); typed query → search.
    if (!open) { setItems([]); return; }
    let cancelled = false;
    setLoading(true);
    setError(null);
    const q = query.trim();
    // Debounce typed queries so a fast typist doesn't fire a cache query per keystroke;
    // the initial open (empty query) loads immediately.
    const timer = setTimeout(() => {
      const url = q.length >= 1
        ? `/api/fortnox/articles?q=${encodeURIComponent(q)}&limit=20`
        : `/api/fortnox/articles?limit=20`;
      fetch(url, { cache: 'no-store' })
        .then((r) => r.json().catch(() => ({})))
        .then((json) => {
          if (!cancelled) {
            const raw: Array<{ article_number: string; description: string | null; note?: string | null; sales_price: number | null; purchase_price?: number | null; unit: string | null; is_favorite?: boolean; include_in_work_description?: boolean }> =
              Array.isArray(json?.data?.items) ? json.data.items : [];
            setItems(raw.map((a) => ({
              id: a.article_number,
              name: a.description ?? undefined,
              articleNumber: a.article_number,
              price: a.sales_price,
              unit: a.unit ?? undefined,
              isFavorite: a.is_favorite ?? false,
              note: a.note ?? null,
              purchasePrice: a.purchase_price ?? null,
              includeInWorkDescription: a.include_in_work_description ?? false,
            })));
          }
        })
        .catch(() => { if (!cancelled) { setError('Kunde inte hämta artiklar'); setItems([]); } })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, q.length >= 1 ? 250 : 0);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [open, query]);

  // Den valda artikeln som EN rad fakta med Byt/Rensa. Namnet står inte här: det står redan i
  // tabellraden ovanför och i fältet "Benämning" under. Ett grönt kort med namnet en tredje gång var
  // det som gjorde den utfällda raden rörig (mockupen 2026-10-07). "Byt artikel" öppnar sökningen,
  // "Rensa" tömmer radens artikel.
  if ((value || locked) && !searching) {
    const unitName = displayUnit(getArticleUnitName(unit));
    const perUnit = unitName ? `/${unitName}` : '';
    const facts = [
      articleNumber ? `Art.nr ${articleNumber}` : 'Utan artikelnummer',
      typeof price === 'number' ? `Listpris ${formatUnitPrice(price)}${perUnit}` : null,
      // Inköpspriset som underlag till TG-märket på raden: procenten säger att marginalen är tunn,
      // kronorna säger hur mycket utrymme som faktiskt finns kvar att förhandla med.
      typeof purchasePrice === 'number' ? `Inköp ${formatUnitPrice(purchasePrice)}${perUnit}` : null,
    ].filter(Boolean).join('. ');
    return (
      <div className="grid gap-1">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <p className="m-0 min-w-0 text-[13px] tabular-nums text-slate-600">{facts}</p>
          {locked ? null : (
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={() => { setSearching(true); setQuery(''); setOpen(true); }}
                className="rounded-md px-2 py-1 text-[13px] font-semibold text-[color:var(--ek-accent)] transition hover:bg-[#e9f1eb]"
              >
                Byt artikel
              </button>
              <button
                type="button"
                onClick={onClear}
                className="rounded-md px-2 py-1 text-[13px] font-semibold text-slate-500 transition hover:bg-rose-50 hover:text-rose-700"
              >
                Rensa
              </button>
            </div>
          )}
        </div>
        {/* Artikelns beskrivning ur registret — INTERN. Ett stöd för säljaren att se vad artikeln
            faktiskt innehåller; den skickas aldrig med till Fortnox och syns inte på offerten.
            Inte truncate: hela poängen är att kunna läsa texten. Tre rader räcker för de
            beskrivningar som finns och hindrar en lång text från att svälla ut raden.
            text-xs/slate-500, inte 11px/slate-400: slate-400 ligger kring 3:1 i kontrast. */}
        {note?.trim() ? (
          <p className="m-0 line-clamp-3 text-xs leading-relaxed text-slate-500">{note.trim()}</p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="flex gap-2">
        <Input
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => { setOpen(false); setSearching(false); }, 150)}
          placeholder="Sök eller välj artikel…"
          autoFocus={searching}
        />
        {value ? (
          <button type="button" onClick={() => setSearching(false)} className="shrink-0 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-500 transition-colors hover:border-slate-300">
            Avbryt
          </button>
        ) : null}
      </div>
      {open ? (
        <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-72 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-[0_16px_32px_rgba(15,23,42,0.10)]">
          {loading ? <div className="px-4 py-3 text-sm text-slate-400">Söker…</div> : null}
          {error ? <div className="px-4 py-3 text-sm text-rose-600">{error}</div> : null}
          {!loading && !error && items.length === 0 ? <div className="px-4 py-3 text-sm text-slate-400">Inga artiklar hittades.</div> : null}
          {!loading && !error && query.trim().length === 0 && items.length > 0 ? (
            <p className="px-4 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">Senaste artiklar</p>
          ) : null}
          {!loading && !error ? items.map((item) => (
            <div
              key={item.id || item.articleNumber || item.name}
              className="flex items-center gap-1 border-b border-slate-100 pr-2 transition last:border-b-0 hover:bg-slate-50"
            >
              <button
                type="button"
                aria-label={item.isFavorite ? 'Ta bort favorit' : 'Markera som favorit'}
                aria-pressed={item.isFavorite}
                title={item.isFavorite ? 'Favorit — visas överst' : 'Markera som favorit'}
                onMouseDown={(e) => toggleFavorite(item, e)}
                className="shrink-0 rounded-md px-2 py-2 text-lg leading-none transition-colors hover:bg-amber-50"
              >
                <span className={item.isFavorite ? 'text-amber-400' : 'text-slate-300'}>{item.isFavorite ? '★' : '☆'}</span>
              </button>
              <button
                type="button"
                // onMouseDown (not onClick) so the selection commits on press — before the
                // input's blur-timeout closes the list and before a pending debounce refetch
                // swaps the row out from under the click. Mirrors CustomerSearchPicker and the
                // favorite star above. preventDefault keeps input focus so no blur fires.
                onMouseDown={(e) => { e.preventDefault(); onSelect(item); setOpen(false); setQuery(''); setSearching(false); }}
                className="flex min-w-0 flex-1 flex-col items-start gap-0.5 py-2.5 pr-2 text-left"
              >
                <span className="truncate text-sm font-medium text-slate-900">{item.name || 'Artikel'}</span>
                <span className="text-xs text-slate-400">
                  {item.articleNumber || 'Utan artikelnummer'}
                  {typeof item.price === 'number' ? ` · ${item.price.toFixed(2)} kr` : ''}
                  {getArticleUnitName(item.unit) ? ` · ${getArticleUnitName(item.unit)}` : ''}
                </span>
              </button>
            </div>
          )) : null}
        </div>
      ) : null}
    </div>
  );
}
