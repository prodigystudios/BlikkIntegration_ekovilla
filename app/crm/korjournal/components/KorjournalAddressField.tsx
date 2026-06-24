"use client";

import { useId } from 'react';
import { crm } from '../../lib/crmTokens';

// One address input with geolocation, a favourites dropdown, an inline
// autocomplete suggestion and a native datalist. Used for both start and end so
// the (previously duplicated) logic lives in one place.
type Props = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  auto: string | null;
  onAcceptAuto: () => void;
  favorites: string[];
  counts: Record<string, number>;
  menuTitle: string;
  onPickFavorite: (addr: string) => void;
  menuOpen: boolean;
  onToggleMenu: () => void;
  onCloseMenu: () => void;
  locating: boolean;
  onFillLocation: () => void;
};

export default function KorjournalAddressField({
  label,
  value,
  onChange,
  placeholder,
  auto,
  onAcceptAuto,
  favorites,
  counts,
  menuTitle,
  onPickFavorite,
  menuOpen,
  onToggleMenu,
  onCloseMenu,
  locating,
  onFillLocation,
}: Props) {
  const listId = useId();

  return (
    <label className="grid gap-1.5">
      <span className={crm.label}>{label}</span>
      <div className="relative">
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <input
            className={crm.input}
            list={listId}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (!auto) return;
              const el = e.currentTarget;
              const caretAtEnd = (el.selectionStart ?? el.value.length) === el.value.length;
              const accept = (e.key === 'ArrowRight' && caretAtEnd) || (e.key === ' ' && e.ctrlKey);
              if (!accept) return;
              e.preventDefault();
              onAcceptAuto();
            }}
            placeholder={placeholder}
          />
          <button
            type="button"
            className={crm.ghostButton}
            onClick={onFillLocation}
            disabled={locating}
            title="Hämta nuvarande plats"
          >
            {locating ? 'Hämtar…' : 'Hämta plats'}
          </button>
        </div>

        {favorites.length > 0 ? (
          <div className="mt-1.5 flex justify-end">
            <button
              type="button"
              className="text-xs font-semibold text-emerald-700 transition hover:text-emerald-800"
              aria-haspopup="listbox"
              aria-expanded={menuOpen}
              onClick={onToggleMenu}
              title="Välj från favoriter"
            >
              Favoriter ▾
            </button>
          </div>
        ) : null}

        {auto ? (
          <div className="mt-1.5 flex items-center gap-2 text-xs text-slate-500">
            <span>Förslag:</span>
            <button
              type="button"
              onClick={onAcceptAuto}
              title="Klicka för att fylla i (eller → vid radslut / Ctrl+Mellanslag)"
              className="max-w-full truncate font-semibold text-slate-700 transition hover:text-slate-900"
            >
              {auto}
            </button>
            <span className="ml-auto whitespace-nowrap text-[11px] text-slate-400">→ / Ctrl+Mellanslag</span>
          </div>
        ) : null}

        {menuOpen && favorites.length > 0 ? (
          <>
            <div onClick={onCloseMenu} className="fixed inset-0 z-[2105]" aria-hidden="true" />
            <div
              role="listbox"
              className="absolute right-0 top-[calc(100%+6px)] z-[2106] w-[min(520px,92vw)] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_10px_30px_rgba(0,0,0,0.15)]"
            >
              <div className="border-b border-slate-100 bg-[#f9fbf7] px-3 py-2 text-xs font-bold text-slate-600">{menuTitle}</div>
              <div className="max-h-60 overflow-auto">
                {favorites.map((addr) => (
                  <button
                    key={addr}
                    type="button"
                    onClick={() => onPickFavorite(addr)}
                    title={addr}
                    className="flex w-full items-baseline gap-2 border-b border-slate-50 px-3 py-2.5 text-left text-sm transition last:border-b-0 hover:bg-slate-50"
                  >
                    <span className="flex-1 break-words">{addr}</span>
                    <span className="text-xs text-slate-400">({counts[addr] || 0})</span>
                  </button>
                ))}
              </div>
            </div>
          </>
        ) : null}
      </div>

      {favorites.length > 0 ? (
        <datalist id={listId}>
          {favorites.map((addr) => (
            <option key={addr} value={addr}>
              {addr} ({counts[addr] || 0})
            </option>
          ))}
        </datalist>
      ) : null}
    </label>
  );
}
