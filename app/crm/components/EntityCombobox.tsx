"use client";

import { useEffect, useRef, useState } from 'react';
import Input from '../../../components/ui/Input';

export type EntityResult = { id: string; label: string; sublabel?: string };

// Searchable, debounced entity picker. The caller supplies the `search` fetcher so
// the component stays generic (customers, quotes, prospects, …). Server-side search
// means it scales to any table size instead of preloading every row into a <select>.
// When a value is set it shows a compact chip with an "Ändra" action.
export default function EntityCombobox({
  value,
  valueLabel,
  onChange,
  onClear,
  search,
  placeholder = 'Sök…',
  disabled = false,
  minChars = 1,
}: {
  value: string;
  valueLabel: string;
  onChange: (id: string, label: string) => void;
  onClear: () => void;
  search: (query: string) => Promise<EntityResult[]>;
  placeholder?: string;
  disabled?: boolean;
  minChars?: number;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<EntityResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  // Keep the latest fetcher without making it a debounce-effect dependency
  // (callers pass an inline function whose identity changes every render).
  const searchRef = useRef(search);
  searchRef.current = search;

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  useEffect(() => {
    if (disabled || value) return;
    const q = query.trim();
    if (q.length < minChars) { setResults([]); setOpen(false); return; }
    let active = true;
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const r = await searchRef.current(q);
        if (active) { setResults(r); setOpen(true); }
      } catch {
        if (active) setResults([]);
      } finally {
        if (active) setLoading(false);
      }
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [query, disabled, value, minChars]);

  if (value) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5">
        <span className="truncate text-sm font-semibold text-slate-900">{valueLabel || 'Vald post'}</span>
        <button
          type="button"
          onClick={onClear}
          disabled={disabled}
          className="!p-0 shrink-0 text-xs font-semibold text-slate-500 transition hover:text-rose-600"
        >
          Ändra
        </button>
      </div>
    );
  }

  return (
    <div ref={ref} className="relative">
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete="off"
        onFocus={() => { if (results.length > 0) setOpen(true); }}
      />
      {loading ? (
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">Söker…</span>
      ) : null}
      {open && results.length > 0 ? (
        <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-xl border border-[#e0e8dc] bg-white p-1 shadow-[0_18px_36px_-12px_rgba(20,44,27,0.28)]">
          {results.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => { onChange(r.id, r.label); setOpen(false); setQuery(''); }}
              className="flex w-full flex-col items-start justify-center gap-0.5 rounded-lg px-3 py-2 text-left transition hover:bg-[#eef3ea]"
            >
              <span className="text-sm font-semibold text-slate-900">{r.label}</span>
              {r.sublabel ? <span className="text-xs text-slate-500">{r.sublabel}</span> : null}
            </button>
          ))}
        </div>
      ) : open && !loading && query.trim().length >= minChars ? (
        <div className="absolute left-0 right-0 top-full z-20 mt-1 rounded-xl border border-[#e0e8dc] bg-white px-3 py-2 text-sm text-slate-500 shadow-[0_18px_36px_-12px_rgba(20,44,27,0.28)]">
          Ingen träff
        </div>
      ) : null}
    </div>
  );
}
