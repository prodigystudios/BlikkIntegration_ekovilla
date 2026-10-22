"use client";

import { useEffect, useRef, useState } from 'react';
import { crm } from '@/app/crm/lib/crmTokens';
import { cn } from '@/lib/shared/cn';
import type { TicLookupResult } from '@/lib/domains/tic/types';

// Debounced lookup box backed by tic.io. Typing searches companies (or persons,
// per `mode`) and picking a hit hands the structured result to the caller so it can
// pre-fill a form. Mirrors AddressAutocompleteInput's debounce + race-guard pattern.
// Debounced generously since tic.io is a metered external API. Reusable across forms.
//
// Utseendet är registreringens startpunkt: ett stort sökfält och träffarna i en lista UNDER fältet
// (i flödet, inte en flytande meny) — sökningen ÄR kortets innehåll tills ett företag är valt.
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
  // Frågan som senast besvarades utan fel — skiljer "inga träffar" från "inte sökt än".
  const [answeredQuery, setAnsweredQuery] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastQueryRef = useRef('');

  const endpoint = mode === 'company' ? '/api/tic/companies/search' : '/api/tic/persons/search';

  // Söker när FRÅGAN ändras, inte när listan öppnas: `open` styr bara synligheten. Att stänga och
  // öppna listan (fokus ut och in) ska inte kosta ett nytt anrop mot en mätt tjänst.
  useEffect(() => {
    const q = query.trim();
    lastQueryRef.current = q;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (q.length < minChars) {
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
        setAnsweredQuery(q);
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
  }, [query, minChars, endpoint]);

  const trimmed = query.trim();
  const showResults = open && trimmed.length >= minChars
    && Boolean(loading || results.length > 0 || error || answeredQuery === trimmed);

  function handlePick(result: TicLookupResult) {
    onSelect(result);
    setQuery('');
    setResults([]);
    setOpen(false);
  }

  return (
    // 🧨 Listan stängs INTE på blur. Den står i flödet, så när den försvann vid blur hoppade allt under
    // den uppåt mellan mousedown och mouseup — klicket på "Fyll i manuellt istället" landade på fel
    // ställe och gick förlorat. Den stängs med Escape, när en träff väljs och när frågan töms.
    <div>
      <div className="flex h-[60px] items-center gap-3 rounded-xl border-2 border-[color:var(--ek-green)] bg-white px-4 transition focus-within:ring-4 focus-within:ring-[color:var(--ek-accent-ring)]">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0 text-[color:var(--ek-green)]">
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-3.5-3.5" />
        </svg>
        {/* `min-w-0 flex-1`, inte `w-full`: den globala `input { width:100% }` hade annars tryckt ut
            ledtexten till höger. */}
        <input
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }}
          placeholder={placeholder ?? (mode === 'company' ? 'Sök på företagsnamn eller org.nr' : 'Sök person på namn eller personnr')}
          aria-label={mode === 'company' ? 'Sök företag' : 'Sök person'}
          autoComplete="off"
          className="h-full min-w-0 flex-1 border-0 bg-transparent p-0 text-[17px] text-slate-900 placeholder:text-slate-400 focus:outline-none"
        />
        <span className="shrink-0 whitespace-nowrap text-xs text-slate-500" aria-live="polite">
          {loading ? 'Söker…' : 'via tic.io'}
        </span>
      </div>

      {showResults ? (
        <div className={cn(crm.sunken, 'mt-2 overflow-hidden rounded-xl')}>
          {results.length > 0 ? (
            <>
              <p className={`${crm.sectionTitle} px-4 py-2.5`}>
                {results.length === 1 ? '1 träff' : `${results.length} träffar`}
              </p>
              <ul className="max-h-80 overflow-y-auto">
                {results.map((r, i) => (
                  <li key={`${r.label}-${i}`} className="border-t border-[#dde6d9]">
                    <button
                      type="button"
                      onClick={() => handlePick(r)}
                      className="flex min-h-[60px] w-full items-center justify-start gap-3.5 rounded-none px-4 py-3 text-left transition hover:bg-[#e8eee4] focus-visible:bg-[#e8eee4]"
                    >
                      <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#e1e9dd] text-[color:var(--ek-green)]">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                          <path d="M4 21V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v16" />
                          <path d="M15 9h4a1 1 0 0 1 1 1v11" />
                          <path d="M3 21h18" />
                          <path d="M8 8h3M8 12h3M8 16h3" />
                        </svg>
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2 text-[15px] font-semibold text-slate-900">
                          {r.label}
                          {r.inactive ? (
                            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
                              {r.kind === 'company' ? 'Avregistrerad' : 'Skyddad'}
                            </span>
                          ) : null}
                        </span>
                        {r.sublabel ? <span className="block text-[13px] text-slate-500">{r.sublabel}</span> : null}
                      </span>
                      <span className="shrink-0 text-[13px] font-semibold text-[color:var(--ek-accent)]">Välj</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="px-4 py-3.5 text-sm text-slate-600">
              {loading
                ? 'Söker…'
                : error ?? 'Inga träffar. Kontrollera stavningen eller fyll i uppgifterna manuellt nedan.'}
            </p>
          )}
          <p className="border-t border-[#dde6d9] px-4 py-1.5 text-[10px] text-slate-500">Företagsdata © tic.io</p>
        </div>
      ) : null}
    </div>
  );
}
