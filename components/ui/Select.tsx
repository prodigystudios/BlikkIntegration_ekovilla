import * as React from 'react';
import { cn } from '@/lib/shared/cn';

type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement>;

const Select = React.forwardRef<HTMLSelectElement, SelectProps>(function Select({ className, children, ...props }, ref) {
  return (
    <select
      ref={ref}
      className={cn(
        'min-h-11 w-full rounded-xl border border-ui-border bg-white px-3 py-2 text-sm text-ui-text-strong transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ui-accent/20',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
});

export default Select;