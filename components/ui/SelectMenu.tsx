'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/shared/cn';

export type SelectMenuOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

type SelectMenuProps = {
  value: string;
  onChange: (value: string) => void;
  options: SelectMenuOption[];
  /** Visas när inget värde matchar — motsvarar en tom förstarad i en <select>. */
  placeholder?: string;
  'aria-label'?: string;
  className?: string;
  disabled?: boolean;
  /** Bredd på listan. Följer knappen som standard. */
  menuClassName?: string;
};

// En RIKTIG listbox — inte en `<select>` med `appearance: none`.
//
// 🧨 SKÄLET DEN FINNS: `appearance: none` stylar bara den STÄNGDA rutan. Listan som fälls ut ur en
// `<select>` ritas av operativsystemet, och ingen CSS i världen når den — på macOS är den grå,
// fyrkantig och har ingenting med appens formspråk att göra. `components/ui/Select` ser alltså rätt
// ut ända tills man klickar på den. Den här komponenten ritar både knappen och listan själv.
//
// ⚠️ Priset är att allt en `<select>` får gratis måste byggas för hand: tangentnavigering,
// typeahead, fokushantering, klick-utanför och placering. Står det nedan är det för att en
// `<select>` gör det, inte för att det är extra.
//
// 📐 Listan renderas i en PORTAL med `position: fixed`. Absolut placering i en `relative`-förälder
// klipps av varje scrollande förfader — och de finns överallt här: backloggpanelen scrollar,
// planeringsadminens områden scrollar, CrmModal scrollar. En portal till `body` undviker dessutom
// att en transformerad förfader kapar `fixed` (då blir den relativ mot förfadern, inte fönstret).
//
// 📐 z-index 3000: CrmModal ligger på 2800 och måste passeras, notisen på 4000 och får inte skymmas.
// Se z-index-noten i [project_crm_toast_redesign].

const MENU_Z = 3000;
const MENU_MARGIN = 6; // luft mellan knapp och lista
const VIEWPORT_PAD = 8; // minsta avstånd till fönsterkanten

export default function SelectMenu({
  value,
  onChange,
  options,
  placeholder = 'Välj…',
  className,
  menuClassName,
  disabled,
  ...rest
}: SelectMenuProps) {
  const ariaLabel = rest['aria-label'];
  const [open, setOpen] = React.useState(false);
  const [activeIndex, setActiveIndex] = React.useState(-1);
  const [pos, setPos] = React.useState<{ left: number; top: number; width: number; maxHeight: number; flipped: boolean } | null>(null);
  const [mounted, setMounted] = React.useState(false);

  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);
  const typeahead = React.useRef<{ buffer: string; at: number }>({ buffer: '', at: 0 });
  const listId = React.useId();

  // Portalen får inte renderas under serverrenderingen — `document` finns inte där.
  React.useEffect(() => setMounted(true), []);

  const selectedIndex = options.findIndex((o) => o.value === value);
  const selected = selectedIndex >= 0 ? options[selectedIndex] : null;

  const firstEnabled = React.useCallback(
    (from: number, step: 1 | -1) => {
      for (let i = from; i >= 0 && i < options.length; i += step) {
        if (!options[i].disabled) return i;
      }
      return -1;
    },
    [options],
  );

  // Placering räknas ur knappens rect. Flippar upp när det inte får plats under, och taket
  // klampas mot fönstret så listan aldrig hamnar delvis utanför skärmen.
  const measure = React.useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const below = window.innerHeight - r.bottom - MENU_MARGIN - VIEWPORT_PAD;
    const above = r.top - MENU_MARGIN - VIEWPORT_PAD;
    // Flippa bara när det är MÄRKBART bättre över — annars hoppar listan omkring vid små
    // storleksändringar medan den är öppen.
    const flipped = below < 160 && above > below;
    const maxHeight = Math.max(120, Math.min(288, flipped ? above : below));
    setPos({
      left: Math.max(VIEWPORT_PAD, Math.min(r.left, window.innerWidth - r.width - VIEWPORT_PAD)),
      top: flipped ? r.top - MENU_MARGIN : r.bottom + MENU_MARGIN,
      width: r.width,
      maxHeight,
      flipped,
    });
  }, []);

  React.useLayoutEffect(() => {
    if (!open) return;
    measure();
    // Capture: en scroll i vilken förfader som helst flyttar knappen, inte bara fönstret.
    const onScroll = () => measure();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open, measure]);

  // Fokus in i listan när den öppnas, tillbaka till knappen när den stängs — annars tappar
  // tangentbordet sin plats i formuläret.
  React.useEffect(() => {
    if (open) listRef.current?.focus();
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || listRef.current?.contains(t)) return;
      setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  // Håll det aktiva alternativet synligt under piltangentsnavigering.
  React.useEffect(() => {
    if (!open || activeIndex < 0) return;
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${activeIndex}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [open, activeIndex]);

  function openMenu(startAt?: number) {
    if (disabled) return;
    const start = startAt ?? (selectedIndex >= 0 ? selectedIndex : firstEnabled(0, 1));
    setActiveIndex(start);
    setOpen(true);
  }

  function close(focusTrigger = true) {
    setOpen(false);
    setActiveIndex(-1);
    if (focusTrigger) triggerRef.current?.focus();
  }

  function pick(index: number) {
    const opt = options[index];
    if (!opt || opt.disabled) return;
    onChange(opt.value);
    close();
  }

  // Typeahead: skriv några bokstäver för att hoppa, precis som i en riktig <select>. Buffern
  // nollställs efter en paus, så "an" letar "an…" medan "a" … paus … "n" letar "n…".
  function runTypeahead(key: string) {
    const now = Date.now();
    const t = typeahead.current;
    t.buffer = now - t.at > 700 ? key : t.buffer + key;
    t.at = now;
    const q = t.buffer.toLocaleLowerCase('sv');
    const from = activeIndex >= 0 ? activeIndex : 0;
    // Sök framåt från nuvarande position och runt, så upprepade tryck stegar mellan träffar.
    for (let n = 1; n <= options.length; n++) {
      const i = (from + (t.buffer.length > 1 ? 0 : n)) % options.length;
      const o = options[i];
      if (!o.disabled && o.label.toLocaleLowerCase('sv').startsWith(q)) {
        setActiveIndex(i);
        if (!open) onChange(o.value);
        return;
      }
    }
  }

  function onTriggerKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openMenu();
    } else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      runTypeahead(e.key);
    }
  }

  function onListKeyDown(e: React.KeyboardEvent) {
    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        close();
        break;
      case 'Tab':
        // Låt fokus lämna som vanligt, men stäng listan — en öppen meny bakom nästa fält
        // är kvarglömd UI.
        close(false);
        break;
      case 'ArrowDown': {
        e.preventDefault();
        const next = firstEnabled(activeIndex + 1, 1);
        if (next >= 0) setActiveIndex(next);
        break;
      }
      case 'ArrowUp': {
        e.preventDefault();
        const prev = firstEnabled(activeIndex - 1, -1);
        if (prev >= 0) setActiveIndex(prev);
        break;
      }
      case 'Home':
        e.preventDefault();
        setActiveIndex(firstEnabled(0, 1));
        break;
      case 'End':
        e.preventDefault();
        setActiveIndex(firstEnabled(options.length - 1, -1));
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        pick(activeIndex);
        break;
      default:
        if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) runTypeahead(e.key);
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={onTriggerKeyDown}
        // Samma recept som <Select>s stängda ruta, så den här går att byta in i samma platser.
        // ⚠️ En lägre variant skrivs `min-h-*`, aldrig `h-*` — se noten i Select.tsx.
        className={cn(
          'flex min-h-11 w-full items-center justify-between gap-2 rounded-lg border border-[#dce4d8] bg-white pl-3 pr-3 py-2 text-left text-sm text-slate-900 transition-colors hover:border-[#c8d4c3] focus:border-[color:var(--ek-accent)] focus:outline-none focus:ring-2 focus:ring-[color:var(--ek-accent-ring)] disabled:cursor-not-allowed disabled:border-transparent disabled:bg-[#eef1ec] disabled:text-slate-500',
          className,
        )}
      >
        <span className={cn('truncate', !selected && 'text-slate-400')}>{selected ? selected.label : placeholder}</span>
        <svg
          aria-hidden
          className={cn('shrink-0 text-slate-400 transition-transform', open && 'rotate-180')}
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="none"
        >
          <path d="M3.5 5.25 7 8.75l3.5-3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {mounted && open && pos
        ? createPortal(
            <div
              ref={listRef}
              id={listId}
              role="listbox"
              tabIndex={-1}
              aria-label={ariaLabel}
              aria-activedescendant={activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
              onKeyDown={onListKeyDown}
              style={{
                position: 'fixed',
                left: pos.left,
                top: pos.flipped ? undefined : pos.top,
                bottom: pos.flipped ? window.innerHeight - pos.top : undefined,
                width: pos.width,
                maxHeight: pos.maxHeight,
                zIndex: MENU_Z,
              }}
              className={cn(
                'overflow-y-auto overscroll-contain rounded-xl border border-[#d6e1d0] bg-[#f9fbf7] p-1.5 shadow-[0_18px_36px_-12px_rgba(20,44,27,0.28)] focus:outline-none',
                menuClassName,
              )}
            >
              {options.length === 0 ? (
                <div className="px-2 py-2 text-xs text-slate-400">Inga val</div>
              ) : (
                options.map((o, i) => {
                  const isSelected = o.value === value;
                  const isActive = i === activeIndex;
                  return (
                    <div
                      key={o.value || `__tom-${i}`}
                      id={`${listId}-${i}`}
                      data-idx={i}
                      role="option"
                      aria-selected={isSelected}
                      aria-disabled={o.disabled || undefined}
                      // onMouseDown, inte onClick: klick-utanför-lyssnaren ligger på mousedown och
                      // hade hunnit stänga listan innan klicket landade.
                      onMouseDown={(e) => {
                        e.preventDefault();
                        pick(i);
                      }}
                      onMouseEnter={() => !o.disabled && setActiveIndex(i)}
                      className={cn(
                        'flex cursor-pointer items-center justify-between gap-2 rounded-lg px-2 py-2 text-sm transition',
                        o.disabled
                          ? 'cursor-not-allowed text-slate-300'
                          : isSelected
                            ? 'bg-emerald-50 font-semibold text-emerald-900'
                            : isActive
                              ? 'bg-[#eef3ea] text-slate-800'
                              : 'text-slate-700',
                      )}
                    >
                      <span className="truncate">{o.label}</span>
                      {isSelected ? (
                        <svg aria-hidden width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-emerald-700">
                          <path d="M20 6L9 17l-5-5" />
                        </svg>
                      ) : null}
                    </div>
                  );
                })
              )}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
