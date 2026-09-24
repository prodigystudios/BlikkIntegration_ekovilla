"use client";

import { useRef, type KeyboardEvent } from 'react';
import { cn } from '@/lib/shared/cn';

// Ett val av flera, som en rad stora knappar — checklistans OK / Delvis / Brist / Ej relevant,
// risknivån och "Förs till handlingsplan?".
//
// Ronden görs STÅENDE PÅ ARBETSPLATSEN, ofta med handskar och i dagsljus. Därför knappar och inte en
// rullista: ett tryck i stället för tre, minst 44 px höga, och det valda syns på avstånd som en fylld
// yta i sin egen färg. En rullista hade dessutom dolt de andra valen — här ser man vad man INTE valt.
//
// Semantiken är en radiogrupp (en av flera), med piltangenterna som flyttar valet — samma som en
// grupp radioknappar i webbläsaren.
//
// ⚠️ LÄSLÄGET ÄR `aria-disabled`, INTE `disabled`. globals.css har `button:disabled { opacity: .6 }`
// på (0,1,1), som ingen Tailwind-klass slår — i en slutförd rond hade det VALDA svaret blivit blekt,
// och det är just det man läser av. Fokusringen är den globala (`button:focus-visible`); ingen egen.
export type SegmentedOption<V extends string> = {
  value: V;
  label: string;
  /** Klasser för den FYLLDA formen när alternativet är valt. */
  selectedClassName: string;
};

type Props<V extends string> = {
  options: ReadonlyArray<SegmentedOption<V>>;
  value: V | null;
  onChange: (value: V) => void;
  /** Namnet skärmläsaren läser för gruppen ("Status för punkt 4"). */
  label: string;
  disabled?: boolean;
  /** 'lg' = checklistans huvudval, 'md' = detaljernas val. */
  size?: 'lg' | 'md';
  /**
   * Egna kolumnklasser i stället för "alla på en rad" — för en skala som inte ryms på en smal
   * telefon (riskens fem steg: 'grid-cols-3 sm:grid-cols-5').
   */
  columnsClassName?: string;
  className?: string;
};

export default function SegmentedChoice<V extends string>({
  options,
  value,
  onChange,
  label,
  disabled = false,
  size = 'md',
  columnsClassName,
  className,
}: Props<V>) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedIndex = options.findIndex((o) => o.value === value);
  // Roving tabindex: gruppen är ETT tabbstopp — på det valda, annars det första.
  const focusIndex = selectedIndex >= 0 ? selectedIndex : 0;

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    const delta = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!delta || disabled) return;
    e.preventDefault();
    const next = (index + delta + options.length) % options.length;
    refs.current[next]?.focus();
    onChange(options[next].value);
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn('grid gap-1.5', columnsClassName, className)}
      style={columnsClassName ? undefined : { gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((option, index) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            ref={(node) => {
              refs.current[index] = node;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={index === focusIndex ? 0 : -1}
            aria-disabled={disabled || undefined}
            onClick={() => {
              if (!disabled) onChange(option.value);
            }}
            onKeyDown={(e) => onKeyDown(e, index)}
            className={cn(
              // ⚠️ p-0 + egen padding: globals.css har en button-regel med padding som annars vinner
              // över Tailwinds (se minnet om den globala knapp-paddingen).
              'inline-flex min-w-0 items-center justify-center rounded-xl border border-solid p-0 px-1 text-center font-semibold leading-tight transition',
              size === 'lg' ? 'min-h-12 text-sm' : 'min-h-11 text-[13px]',
              selected
                ? option.selectedClassName
                : 'border-[#dce4d8] bg-white text-slate-700 hover:border-[#c8d4c3] hover:text-slate-900',
              disabled && 'cursor-default',
              disabled && !selected && 'opacity-60 hover:border-[#dce4d8] hover:text-slate-700',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
