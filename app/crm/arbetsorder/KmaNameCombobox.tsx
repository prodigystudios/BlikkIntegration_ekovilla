"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Input from '@/components/ui/Input';
import { cn } from '@/lib/shared/cn';
import { matchDirectory, type KmaDirectoryEntry } from '@/lib/domains/crm/kmaPlans/directory';

// Namnfält med förslag ur Kontaktlistan — KMA-dialogens KMA-ansvarig, kontakter och signerare.
//
// 🧨 VARFÖR INTE `<datalist>`: listan som fälls ut ritas av webbläsaren och ingen CSS når den. I
// Chrome blev det en grå OS-ruta med en svart ▼ i fältet, rollen som grå text bredvid varje namn och
// samma person två gånger — ingenting av CRM:ets formspråk. Samma skäl som SelectMenu finns.
//
// Placeringen följer SelectMenu (components/ui/SelectMenu.tsx), där varje del är betald med ett fel:
//   * PORTAL till `body` med `position: fixed`, räknad ur fältets rect. Absolut placering hade
//     klippts av CrmModals scrollande kropp, och en transformerad förfader kapar `fixed`.
//   * z-index 3000: över CrmModal (2800), under notisen (4000).
//   * Fälls UPP när det inte ryms under, och taket klampas mot fönstret — en lista utanför skärmen
//     går inte att nå.
//   * Alternativen väljs på MOUSEDOWN med preventDefault: annars tappar fältet fokus först, listan
//     stängs och klicket landar på ingenting.
//
// Ett val lämnar HELA posten (namn + nummer) till anroparen, inte bara namnet: två personer med
// samma namn och olika nummer går då att skilja åt — en namnuppslagning hade svarat tomt för båda.

const MENU_Z = 3000;
const MENU_MARGIN = 6;
const VIEWPORT_PAD = 8;

type Props = {
  id: string;
  value: string;
  onChange: (value: string) => void;
  onPick: (entry: KmaDirectoryEntry) => void;
  /** Redan fri från dubbletter (dedupeDirectory). */
  entries: readonly KmaDirectoryEntry[];
  placeholder?: string;
  invalid?: boolean;
  describedBy?: string;
};

type Position = { left: number; top: number; width: number; maxWidth: number; maxHeight: number; flipped: boolean };

export default function KmaNameCombobox({ id, value, onChange, onPick, entries, placeholder, invalid, describedBy }: Props) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [pos, setPos] = useState<Position | null>(null);
  const [mounted, setMounted] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = `${useId()}-kma-namn`;

  useEffect(() => setMounted(true), []);

  const matches = useMemo(() => matchDirectory(entries, value), [entries, value]);
  const showList = open && matches.length > 0;

  const measure = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    // Utrymmet räknas mot DIALOGENS kanter, inte bara fönstrets: mätt i en 1267 px hög flik fanns
    // 271 px under ett fält nära dialogens botten, och listan hängde ut under dialogen över den mörka
    // bakgrunden. Innanför dialogen fälls den i stället upp när det är där platsen finns.
    const bounds = el.closest('[role="dialog"]')?.getBoundingClientRect();
    // Den SYNLIGA ytan, inte layoutens: på en telefon krymper inte `innerHeight` när tangentbordet
    // fälls upp, och listan hade öppnats nedåt in under tangenterna. `visualViewport` gör det.
    const vv = window.visualViewport;
    const viewTop = vv ? vv.offsetTop : 0;
    const viewBottom = vv ? Math.min(window.innerHeight, vv.offsetTop + vv.height) : window.innerHeight;
    const floor = bounds ? Math.min(viewBottom, bounds.bottom) : viewBottom;
    const ceiling = bounds ? Math.max(viewTop, bounds.top) : viewTop;
    const below = floor - r.bottom - MENU_MARGIN - VIEWPORT_PAD;
    const above = r.top - ceiling - MENU_MARGIN - VIEWPORT_PAD;
    // Personraderna är höga (namn, nummer, roll) och listan når 300 px: fälls den ned med bara ~200 px
    // kvar under fältet hänger den ut över dialogens knappar. Uppåt när det ryms bättre där.
    const flipped = below < 240 && above > below;
    // Taket får aldrig överstiga utrymmet på den valda sidan (SelectMenus läxa: ett golv på 120 px
    // lade en uppfälld lista utanför skärmen i ett lågt fönster).
    const maxHeight = Math.min(300, Math.max(flipped ? above : below, 0));
    const left = Math.max(VIEWPORT_PAD, Math.min(r.left, window.innerWidth - r.width - VIEWPORT_PAD));
    setPos({
      left,
      top: flipped ? r.top - MENU_MARGIN : r.bottom + MENU_MARGIN,
      width: r.width,
      maxWidth: Math.max(r.width, Math.min(420, window.innerWidth - left - VIEWPORT_PAD)),
      maxHeight,
      flipped,
    });
  }, []);

  useLayoutEffect(() => {
    if (!showList) return;
    measure();
    // Capture: en scroll i vilken förfader som helst (dialogens kropp) flyttar fältet.
    const onMove = () => measure();
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    // Tangentbordet som fälls upp eller ned ändrar bara den synliga ytan.
    window.visualViewport?.addEventListener('resize', onMove);
    window.visualViewport?.addEventListener('scroll', onMove);
    return () => {
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
      window.visualViewport?.removeEventListener('resize', onMove);
      window.visualViewport?.removeEventListener('scroll', onMove);
    };
  }, [showList, measure]);

  // Håll den markerade raden synlig under piltangenterna.
  useEffect(() => {
    if (!showList || activeIndex < 0) return;
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${activeIndex}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [showList, activeIndex]);

  function pick(entry: KmaDirectoryEntry) {
    onPick(entry);
    setOpen(false);
    setActiveIndex(-1);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) setOpen(true);
      setActiveIndex((i) => (matches.length === 0 ? -1 : Math.min(i + 1, matches.length - 1)));
    } else if (e.key === 'ArrowUp') {
      // Bara i en ÖPPEN lista. I en stängd flyttade den tyst markeringen till första raden, och när
      // listan sedan öppnades valde nästa Enter den — en person man aldrig pekat på.
      if (!showList) return;
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      // Enter väljer den markerade raden — och gör annars ingenting: formuläret sparar aldrig på
      // Enter (en revision går inte att ta bort).
      if (showList && activeIndex >= 0 && matches[activeIndex]) {
        e.preventDefault();
        pick(matches[activeIndex]);
      }
    } else if (e.key === 'Escape') {
      if (showList) {
        // Stänger listan, inte dialogen: CrmModals Escape får vänta till nästa tryck.
        //
        // 🧨 `stopPropagation` räcker INTE. CrmModal (useTopmostEscape) lyssnar på `document`, och i
        // App Router ligger Reacts egen lyssnare på samma nod — en stoppad bubbling når aldrig en
        // ANNAN nod, men andra lyssnare på SAMMA nod körs ändå. `stopImmediatePropagation` stoppar
        // dem; Reacts lyssnare registrerades vid hydreringen, alltså före dialogens.
        e.preventDefault();
        e.stopPropagation();
        e.nativeEvent.stopImmediatePropagation();
        setOpen(false);
        setActiveIndex(-1);
      }
    }
  }

  const activeId = showList && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined;

  return (
    <>
      <Input
        ref={inputRef}
        id={id}
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={showList}
        aria-controls={showList ? listId : undefined}
        aria-activedescendant={activeId}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        // Öppnas på KLICK, skrivning och pil ned — inte på fokus. 🧨 Sparningen fokuserar det första
        // felaktiga fältet, och en lista som öppnades på fokus lade sig då över felmeddelandet den
        // skulle visa. Ett klick fångar också fältet som redan har fokus (efter Escape eller ett val).
        onClick={() => {
          setOpen(true);
          setActiveIndex(-1);
        }}
        onBlur={() => {
          setOpen(false);
          setActiveIndex(-1);
        }}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setActiveIndex(-1);
        }}
        onKeyDown={onKeyDown}
        className={cn('min-h-10', invalid && 'border-rose-400')}
      />

      {mounted && showList && pos
        ? createPortal(
            <div
              ref={listRef}
              id={listId}
              role="listbox"
              aria-label="Förslag ur Kontaktlistan"
              // Hela listan, inte bara raderna: ett klick på kanten eller scrollisten hade annars tagit
              // fokus från fältet, blur hade stängt listan mitt i en scrollning.
              onMouseDown={(e) => e.preventDefault()}
              style={{
                position: 'fixed',
                left: pos.left,
                top: pos.flipped ? undefined : pos.top,
                bottom: pos.flipped ? window.innerHeight - pos.top : undefined,
                minWidth: pos.width,
                maxWidth: pos.maxWidth,
                width: 'max-content',
                maxHeight: pos.maxHeight,
                zIndex: MENU_Z,
              }}
              className="overflow-y-auto overscroll-contain rounded-xl border border-solid border-[#d6e1d0] bg-[#f9fbf7] p-1.5 shadow-[0_18px_36px_-12px_rgba(20,44,27,0.28)]"
            >
              {matches.map((entry, index) => {
                const active = index === activeIndex;
                return (
                  <div
                    key={`${entry.name}|${entry.phone ?? ''}`}
                    id={`${listId}-${index}`}
                    data-idx={index}
                    role="option"
                    aria-selected={active}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      pick(entry);
                    }}
                    onMouseEnter={() => setActiveIndex(index)}
                    className={cn(
                      'grid cursor-pointer gap-0.5 rounded-lg px-2.5 py-2 transition',
                      active ? 'bg-[#eef3ea]' : 'bg-transparent',
                    )}
                  >
                    <span className="flex items-baseline justify-between gap-4">
                      <span className="truncate text-sm font-semibold text-slate-900">{entry.name}</span>
                      {entry.phone ? <span className="shrink-0 text-xs tabular-nums text-slate-500">{entry.phone}</span> : null}
                    </span>
                    {entry.role ? <span className="truncate text-xs text-slate-500">{entry.role}</span> : null}
                  </div>
                );
              })}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
