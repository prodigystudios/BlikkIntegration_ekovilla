import * as React from 'react';
import { cn } from '@/lib/shared/cn';

type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input({ className, type = 'text', ...props }, ref) {
  return (
    <input
      ref={ref}
      type={type}
      className={cn(
        'min-h-11 w-full rounded-xl border border-ui-border bg-white px-3 py-2 text-sm text-ui-text-strong transition-colors placeholder:text-ui-text-soft hover:border-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ui-accent/20 disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
});

export default Input;