"use client";

import { cn } from '@/lib/shared/cn';

// Delad sorteringskontroll för CRM:s listvyer (offerter, arbetsorder). Den ligger bredvid
// AssigneeFilter och bär medvetet exakt samma yta som dess knapp: de två urvalskontrollerna ska
// läsas som ett par, inte som två olika filter på var sitt ställe i raden.
//
// Native <select> med `appearance-none` och egen chevron — annars ritar Safari sin egen
// kontrollchrome bredvid en som inte gör det, och paret slutar se ut som ett par.
//
// Höjden är låst i px och sätts INTE av padding + radhöjd: globals.css tvingar 16px på <select>
// under iOS (annars zoomar Safari in vid fokus och zoomar aldrig ut igen), medan AssigneeFilter är
// en <button> som stannar på 14px. Med en höjd som beror på teckenstorleken skulle de två
// kontrollerna få olika höjd på iPad — 38px är exakt knappens höjd (py-2 + text-sm + ram).
//
// Sorteringen som skickas hit hör hemma på servern i varje paginerad lista: sidkapet skär raderna
// innan webbläsaren ser dem, så att sortera i klienten ordnar bara det som råkade överleva kapet.
export default function SortFilter<T extends string>({
  value,
  onChange,
  options,
  label = 'Sortera',
  className,
}: {
  value: T;
  onChange: (value: T) => void;
  options: ReadonlyArray<{ value: T; label: string }>;
  // Skärmläsaretikett. Kontrollen bär sitt val som synlig text, precis som AssigneeFilter.
  label?: string;
  className?: string;
}) {
  return (
    <div className={cn('relative', className ?? 'w-[180px]')}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        aria-label={label}
        className="h-[38px] w-full appearance-none rounded-lg border border-[#dce4d8] bg-white pl-3 pr-9 text-left text-sm font-medium text-slate-700 transition hover:border-[#c8d4c3] focus:border-[color:var(--ek-accent)] focus:outline-none focus:ring-2 focus:ring-[color:var(--ek-accent-ring)]"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400"
      >
        <path d="M6 9l6 6 6-6" />
      </svg>
    </div>
  );
}
