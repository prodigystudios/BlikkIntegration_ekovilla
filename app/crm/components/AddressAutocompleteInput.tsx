"use client";

import { useEffect, useRef, useState } from 'react';
import Input from '../../../components/ui/Input';

export type AddressSuggestion = { label: string; street: string; postal_code: string; city: string };

// OSM often only knows a street at name level (no house number). If the user already
// typed a house number, keep it so picking a suggestion doesn't drop "Industrivägen 4"
// back to "Industrivägen". No-op when the suggestion already carries a number.
function preserveHouseNumber(street: string, typed: string): string {
  if (/\d/.test(street)) return street;
  const m = typed.match(/\b(\d+\s?[a-zA-Z]?)\b/);
  return m ? `${street} ${m[1].replace(/\s/g, '')}` : street;
}

// Street-address input with autocomplete. Typing in the street field queries the
// free Nominatim/OSM geocoder (via /api/geocode/search) and, on selecting a hit,
// hands back the structured address so the caller can fill postal code + city.
// Debounced generously to respect the Nominatim usage policy. Reusable across forms.
export default function AddressAutocompleteInput({
  value,
  onChange,
  onSelect,
  placeholder,
  minChars = 3,
}: {
  value: string;
  onChange: (street: string) => void;
  onSelect: (suggestion: AddressSuggestion) => void;
  placeholder?: string;
  minChars?: number;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<AddressSuggestion[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastQueryRef = useRef('');

  useEffect(() => {
    const q = value.trim();
    lastQueryRef.current = q;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!open || q.length < minChars) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/geocode/search?q=${encodeURIComponent(q)}`, { cache: 'no-store' });
        const json = await res.json().catch(() => ({}));
        if (lastQueryRef.current !== q) return; // a newer keystroke superseded this one
        setResults(json?.ok && Array.isArray(json?.data?.items) ? json.data.items : []);
      } catch {
        if (lastQueryRef.current === q) setResults([]);
      } finally {
        if (lastQueryRef.current === q) setLoading(false);
      }
    }, 500);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [value, open, minChars]);

  const showDropdown = open && value.trim().length >= minChars && (loading || results.length > 0);

  return (
    <div className="relative">
      <Input
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder}
        autoComplete="off"
      />
      {loading ? <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">Söker…</span> : null}
      {showDropdown ? (
        <div className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_16px_32px_rgba(15,23,42,0.10)]">
          <div className="max-h-64 overflow-y-auto">
            {results.length > 0 ? results.map((s, i) => (
              <button
                key={`${s.label}-${i}`}
                type="button"
                onMouseDown={() => { onSelect({ ...s, street: preserveHouseNumber(s.street, value) }); setResults([]); setOpen(false); }}
                className="flex w-full flex-col items-start gap-0.5 border-b border-slate-100 px-4 py-2.5 text-left transition last:border-b-0 hover:bg-slate-50"
              >
                <span className="text-sm font-medium text-slate-900">{s.street || s.label}</span>
                {[s.postal_code, s.city].filter(Boolean).length > 0 ? (
                  <span className="text-xs text-slate-400">{[s.postal_code, s.city].filter(Boolean).join(' ')}</span>
                ) : null}
              </button>
            )) : (
              <p className="px-4 py-3 text-sm text-slate-500">{loading ? 'Söker…' : 'Ingen adress hittades'}</p>
            )}
          </div>
          <p className="border-t border-slate-100 bg-slate-50/60 px-3 py-1.5 text-[10px] text-slate-400">Adressdata © OpenStreetMap</p>
        </div>
      ) : null}
    </div>
  );
}
