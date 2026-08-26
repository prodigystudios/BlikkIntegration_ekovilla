import { cn } from '@/lib/shared/cn';

// Planning's search box: magnifier tucked inside a h-9 field. There are two of them — one over the
// schedule, one over the backlog — and they have to stay identical, so the markup lives here rather
// than as two hand-copies that drift apart.
export default function SearchField({
  value,
  onChange,
  placeholder,
  ariaLabel,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  ariaLabel: string;
  className?: string;
}) {
  return (
    <div className={cn('relative', className)}>
      <svg
        className="pointer-events-none absolute left-3 top-1/2 h-[15px] w-[15px] -translate-y-1/2 text-slate-400"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden="true"
      >
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel}
        className="h-9 w-full rounded-lg border border-[#dce4d8] bg-white pl-9 pr-3 text-[13px] text-slate-900 outline-none transition focus:border-[color:var(--ek-accent)] focus:ring-2 focus:ring-[color:var(--ek-accent-ring)]"
      />
    </div>
  );
}
