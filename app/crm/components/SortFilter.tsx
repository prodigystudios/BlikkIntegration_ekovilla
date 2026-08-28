"use client";

import { cn } from '@/lib/shared/cn';
import SelectMenu from '@/components/ui/SelectMenu';

// Delad sorteringskontroll för CRM:s listvyer (offerter, arbetsorder). Den ligger bredvid
// AssigneeFilter och bär medvetet exakt samma yta som dess knapp: de två urvalskontrollerna ska
// läsas som ett par, inte som två olika filter på var sitt ställe i raden.
//
// `SelectMenu`, inte en `<select>`: en `<select>` får sin utfällda lista ritad av operativsystemet,
// och den når ingen CSS. Kontrollen ritar nu både knappen och listan själv, chevron inkluderad.
//
// 🧨 HÖJDEN ÄR LÅST I PX OCH FÅR INTE SÄTTAS AV PADDING + RADHÖJD. globals.css tvingar 16px under
// iOS på `input, select, textarea` OCH på `button[role='combobox']` — alltså på den här kontrollen —
// medan AssigneeFilter är en vanlig `<button>` som stannar på 14px. En höjd som beror av
// teckenstorleken hade därför gett de två kontrollerna olika höjd på iPad. 38px är exakt knappens
// höjd (py-2 + text-sm + ram).
//
// 📐 Låsningen skrivs `min-h-0 h-[38px] py-0` — alla tre behövs. `h-*` och `min-h-*` ligger i OLIKA
// tailwind-merge-grupper, så bara `h-[38px]` hade lämnat basens `min-h-11` vid liv och kontrollen
// blivit 44px. `py-0` för att innehållet vid 16px annars är högre än den låsta boxen.
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
      <SelectMenu
        value={value}
        onChange={(next) => onChange(next as T)}
        options={options}
        aria-label={label}
        className="min-h-0 h-[38px] py-0 font-medium text-slate-700"
      />
    </div>
  );
}
