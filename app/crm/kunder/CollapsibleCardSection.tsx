import { crm } from '@/app/crm/lib/crmTokens';
import { cn } from '@/lib/shared/cn';

// Samma kortchrome som ett vanligt `crm.cardInner`-kort, men hopfällbart (native <details>).
// Hopfällt som standard; summeringsraden bär rubriken, en valfri ledtext och en chevron.
//
// Bor här — bredvid sina två anropsplatser (kundkortets editor och registreringsformuläret) —
// i stället för i components/ui: den finns för fältgrupper som är MASKINÄGDA (tic.io-uppslaget
// fyller dem) och därför inte ska konkurrera med de fält säljaren faktiskt skriver i.
export default function CollapsibleCardSection({
  title, hint, children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <details className={cn(crm.cardInner, 'group')}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ek-accent-ring)]">
        <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className={crm.sectionTitle}>{title}</span>
          {hint ? <span className="text-xs text-slate-500">{hint}</span> : null}
        </span>
        <svg
          width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden
          className="shrink-0 text-slate-400 transition-transform group-open:rotate-180"
        >
          <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </summary>
      <div className="mt-4">{children}</div>
    </details>
  );
}
