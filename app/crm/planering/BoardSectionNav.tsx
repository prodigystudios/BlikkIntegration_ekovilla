import { cn } from '@/lib/shared/cn';

// Pager under the board. The header's ‹ Idag › sits at the very top of the page, and the board is
// tall — a stacked "Hela månaden" renders one WeekBoard per week — so reaching the end of a period
// meant scrolling all the way back up just to step forward. This puts navigation where you actually
// finish reading.
//
// It is not a copy of the header: these buttons move a whole SECTION (a month's stack in "Hela
// månaden") while the header's arrows keep their one-week step for fine adjustment. That is why the
// step is spelled out on the button rather than left as a bare glyph.
//
// Laid out as a classic pager (back left, forward right) rather than a copy of the header's tight
// button cluster: at the end of a long list the two directions want to be far apart and clearly
// labelled, not three glyphs that need a tooltip.
export default function BoardSectionNav({
  label,
  stepNoun,
  onPrev,
  onToday,
  onNext,
}: {
  // Where the board sits now, e.g. "September 2026".
  label: string;
  // What one press moves — 'månad' or 'vecka'. Names the step on the buttons so the jump length is
  // visible before you press, since it changes with the view.
  stepNoun: string;
  onPrev: () => void;
  onToday: () => void;
  onNext: () => void;
}) {
  const button =
    'inline-flex h-9 items-center gap-1.5 rounded-xl border border-[#e0e8dc] bg-white px-3 text-[12.5px] font-semibold text-slate-600 transition hover:border-[#c8d4c3] hover:text-slate-900';
  return (
    <nav
      aria-label="Bläddra i kalendern"
      className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-[#e0e8dc] bg-[#f9fbf7] px-3 py-2.5"
    >
      <button type="button" onClick={onPrev} className={button}>
        <span aria-hidden="true">‹</span>
        Föregående {stepNoun}
      </button>

      <div className="flex items-center gap-2">
        <span className="text-[12.5px] font-bold text-slate-700">{label}</span>
        <button type="button" onClick={onToday} className={cn(button, 'h-8 px-2.5')}>
          Idag
        </button>
      </div>

      <button type="button" onClick={onNext} className={button}>
        Nästa {stepNoun}
        <span aria-hidden="true">›</span>
      </button>
    </nav>
  );
}
