import { cn } from '@/lib/shared/cn';

// Small label-card that makes an offer/order number stand out at the left of a list row.
// `value` is typically a documentRef() result (Fortnox "#5232" or our "OFF-…"/"AO-…").
export default function DocumentNumberBadge({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex min-w-[56px] shrink-0 flex-col items-center justify-center rounded-lg border border-[#dce4d8] bg-[#f6f9f3] px-2.5 py-1 text-center leading-none shadow-[0_1px_2px_rgba(15,23,42,0.05)]',
        className,
      )}
    >
      <span className="text-[8px] font-bold uppercase tracking-[0.14em] text-slate-400">{label}</span>
      <span className="mt-0.5 text-sm font-bold tabular-nums tracking-tight text-slate-800">{value}</span>
    </div>
  );
}
