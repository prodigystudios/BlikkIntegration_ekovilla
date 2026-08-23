import * as React from 'react';
import { cn } from '@/lib/shared/cn';

type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  /**
   * Låt fältet växa med innehållet i stället för att scrolla internt.
   *
   * En textarea med fast höjd mitt på en lång sida är en scrollfälla: hjulet äts av fältet och
   * sidan står stilla. Det bet på arbetsorderns "Överlämningsnotering", där "Hämta mått från
   * rader" rutinmässigt fyller den med 8–12 rader i en 120 px hög ruta.
   *
   * `min-h` gäller fortfarande som golv; `maxHeight` (px) sätter ett tak där internscroll
   * återinförs medvetet i stället för att fältet ska svälja hela skärmen.
   */
  autoGrow?: boolean;
  /** Tak i px för `autoGrow`. Default 640. */
  autoGrowMaxHeight?: number;
};

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, autoGrow, autoGrowMaxHeight = 640, ...props },
  ref,
) {
  const innerRef = React.useRef<HTMLTextAreaElement | null>(null);

  // Slår ihop den vidarebefordrade ref:en med vår egen — mätningen behöver noden, anroparen
  // ska ändå kunna få tag på den.
  const setRefs = React.useCallback(
    (node: HTMLTextAreaElement | null) => {
      innerRef.current = node;
      if (typeof ref === 'function') ref(node);
      else if (ref) (ref as React.MutableRefObject<HTMLTextAreaElement | null>).current = node;
    },
    [ref],
  );

  // `height: auto` först — annars mäts scrollHeight mot den redan utökade boxen och fältet kan
  // bara växa, aldrig krympa när text tas bort.
  const measure = React.useCallback(() => {
    const el = innerRef.current;
    if (!el) return;
    el.style.height = 'auto';
    // ⚠️ scrollHeight är innehåll + padding men INTE kant. Fältet är `box-sizing: border-box`,
    // så `height = scrollHeight` gör innehållsboxen två pixlar för kort (1 px kant upptill och
    // nedtill) — sista raden kapas och fältet självscrollar när markören står i det.
    const borders = el.offsetHeight - el.clientHeight;
    const full = el.scrollHeight + borders;
    el.style.height = `${Math.min(full, autoGrowMaxHeight)}px`;
    el.style.overflowY = full > autoGrowMaxHeight ? 'auto' : 'hidden';
  }, [autoGrowMaxHeight]);

  React.useEffect(() => {
    if (autoGrow) measure();
  }, [autoGrow, measure, props.value]);

  // ⚠️ Värdet är inte enda skälet att höjden ändras. Blir fältet SMALARE bryts texten om till
  // fler rader, och en höjd som mätts vid den gamla bredden lämnar text utanför boxen — med
  // `resize-none` + `overflow-y: hidden` går den då varken att scrolla eller dra fram. Det
  // händer på riktigt: översikten går från två spalter till en under `lg`.
  //
  // Bara BREDDEN får trigga om mätningen — annars observerar vi vår egen höjdändring och loopar.
  React.useEffect(() => {
    const el = innerRef.current;
    if (!autoGrow || !el || typeof ResizeObserver === 'undefined') return;
    let lastWidth = el.clientWidth;
    const observer = new ResizeObserver(() => {
      if (el.clientWidth === lastWidth) return;
      lastWidth = el.clientWidth;
      measure();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [autoGrow, measure]);

  return (
    <textarea
      ref={setRefs}
      className={cn(
        'min-h-[120px] w-full rounded-lg border border-[#dce4d8] bg-white px-3 py-2 text-sm text-slate-900 transition-colors placeholder:text-slate-400 hover:border-[#c8d4c3] focus:border-[color:var(--ek-accent)] focus:outline-none focus:ring-2 focus:ring-[color:var(--ek-accent-ring)] disabled:cursor-not-allowed disabled:border-transparent disabled:bg-[#eef1ec] disabled:text-slate-500',
        autoGrow ? 'resize-none' : 'resize-y',
        className,
      )}
      {...props}
    />
  );
});

export default Textarea;
