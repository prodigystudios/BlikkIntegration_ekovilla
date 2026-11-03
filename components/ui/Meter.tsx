import { cn } from '@/lib/shared/cn';

// Den tunna mätaren — rapporterat av planerat. Startsidans stoppkort och fältvyns säck- och momentkort.
//
// aria-hidden: talet bredvid ("45 av 120 säckar") bär informationen, mätaren är bara dess bild.
// Höjd och bredd sätter anroparen (`h-1.5 w-full`). Fyllnadens bredd är uträknad geometri, därav
// inline-stilen.
export default function Meter({ percent, className }: { percent: number; className?: string }) {
  return (
    <span aria-hidden="true" className={cn('inline-block overflow-hidden rounded-full bg-[#dfe7dc]', className)}>
      <span className="block h-full bg-[#2f6b45]" style={{ width: `${Math.max(0, Math.min(100, percent))}%` }} />
    </span>
  );
}
