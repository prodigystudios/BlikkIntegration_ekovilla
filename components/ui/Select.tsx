import * as React from 'react';
import { cn } from '@/lib/shared/cn';

type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement>;

// Native <select> styling differs heavily across browsers (Safari renders its own
// control chrome unless `appearance` is reset). We reset it and draw our own chevron
// so the field looks identical in Chrome, Safari and Firefox and matches <Input>.
const Select = React.forwardRef<HTMLSelectElement, SelectProps>(function Select({ className, children, ...props }, ref) {
  return (
    <div className="relative">
      <select
        ref={ref}
        className={cn(
          'min-h-11 w-full appearance-none rounded-xl border border-ui-border bg-white pl-3 pr-9 py-2 text-sm text-ui-text-strong transition-colors hover:border-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ui-accent/20 disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <svg
        aria-hidden
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ui-text-soft"
        width="14"
        height="14"
        viewBox="0 0 14 14"
        fill="none"
      >
        <path d="M3.5 5.25 7 8.75l3.5-3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
});

export default Select;