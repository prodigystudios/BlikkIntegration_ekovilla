import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/shared/cn';

type LoadingStateProps = HTMLAttributes<HTMLDivElement> & {
  label?: string;
  description?: ReactNode;
};

export default function LoadingState({
  className,
  label = 'Laddar…',
  description = 'Hämtar innehållet och förbereder vyn.',
  ...props
}: LoadingStateProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn('flex items-start gap-3 rounded-2xl border border-ui-border bg-slate-50/80 p-4 text-ui-text-strong', className)}
      {...props}
    >
      <span aria-hidden="true" className="mt-0.5 inline-flex h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700" />
      <div className="grid gap-1">
        <strong className="text-sm font-semibold text-slate-900">{label}</strong>
        {description ? <p className="m-0 text-sm text-slate-500">{description}</p> : null}
      </div>
    </div>
  );
}