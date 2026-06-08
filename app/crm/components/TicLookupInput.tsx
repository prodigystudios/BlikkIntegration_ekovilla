"use client";

import { useEffect, useRef, useState } from 'react';
import Input from '../../../components/ui/Input';
import type { TicLookupResult } from '@/lib/domains/tic/types';

// Debounced lookup box backed by tic.io. Typing searches companies (or persons,
// per `mode`) and picking a hit hands the structured result to the caller so it can
// pre-fill a form. Mirrors AddressAutocompleteInput's debounce + race-guard pattern.
// Debounced generously since tic.io is a metered external API. Reusable across forms.
export default function TicLookupInput({
  mode,
  onSelect,
  placeholder,
  minChars = 2,
}: {
  mode: 'company' | 'person';
  onSelect: (result: TicLookupResult) => void;
  placeholder?: string;
  minChars?: number;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<TicLookupResult[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastQueryRef = useRef('');

  const endpoint = mode === 'company' ? '/api/tic/companies/search' : '/api/tic/persons/search';

  useEffect(() => {
    const q = query.trim();
    lastQueryRef.current = q;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!open || q.length < minChars) {
      setResults([]);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`${endpoint}?q=${encodeURIComponent(q)}`, { cache: 'no-store' });
        const json = await res.json().catch(() => ({}));
        if (lastQueryRef.current !== q) return; // a newer keystroke superseded this one
        if (!res.ok || !json?.ok) {
          setResults([]);
          setError(json?.error || 'Uppslaget misslyckades');
          return;
        }
        setResults(Array.isArray(json?.data?.items) ? json.data.items : []);
      } catch {
        if (lastQueryRef.current === q) {
          setResults([]);
          setError('Uppslaget misslyckades');
        }
      } finally {
        if (lastQueryRef.current === q) setLoading(false);
      }
    }, 400);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, open, minChars, endpoint]);

  const showDropdown = open && query.trim().length >= minChars && Boolean(loading || results.length > 0 || error);

  function handlePick(result: TicLookupResult) {
    onSelect(result);
    setQuery('');
    setResults([]);
    setOpen(false);
  }

  return (
    <div className="relative">
      <Input
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder ?? (mode === 'company' ? 'Sök företag på namn eller org.nr' : 'Sök person på namn eller personnr')}
        autoComplete="off"
      />
      {loading ? <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">Söker…</span> : null}
      {showDropdown ? (
        <div className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_16px_32px_rgba(15,23,42,0.10)]">
          <div className="max-h-64 overflow-y-auto">
            {results.length > 0 ? results.map((r, i) => (
              <button
                key={`${r.label}-${i}`}
                type="button"
                onMouseDown={() => handlePick(r)}
                className="flex w-full flex-col items-start gap-0.5 border-b border-slate-100 px-4 py-2.5 text-left transition last:border-b-0 hover:bg-slate-50"
              >
                <span className="flex items-center gap-2 text-sm font-medium text-slate-900">
                  {r.label}
                  {r.inactive ? (
                    <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
                      {r.kind === 'company' ? 'Avregistrerad' : 'Skyddad'}
                    </span>
                  ) : null}
                </span>
                {r.sublabel ? <span className="text-xs text-slate-400">{r.sublabel}</span> : null}
              </button>
            )) : (
              <p className="px-4 py-3 text-sm text-slate-500">{loading ? 'Söker…' : (error ?? 'Inga träffar')}</p>
            )}
          </div>
          <p className="border-t border-slate-100 bg-slate-50/60 px-3 py-1.5 text-[10px] text-slate-400">Företagsdata © tic.io</p>
        </div>
      ) : null}
    </div>
  );
}
