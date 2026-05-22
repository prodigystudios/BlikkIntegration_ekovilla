import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/shared/cn';

type EmptyStateProps = HTMLAttributes<HTMLDivElement> & {
  title?: string;
  description?: ReactNode;
  action?: ReactNode;
};

export default function EmptyState({
  className,
  title = 'Inget att visa',
  description = 'Det finns inget innehåll här just nu.',
  action,
  ...props
}: EmptyStateProps) {
  return (
    <div
      className={cn('grid gap-2 rounded-2xl border border-dashed border-ui-border bg-slate-50/60 p-4 text-ui-text-strong', className)}
      {...props}
    >
      <strong className="text-sm font-semibold text-slate-900">{title}</strong>
      {description ? <p className="m-0 text-sm text-slate-500">{description}</p> : null}
      {action ? <div className="pt-1">{action}</div> : null}
    </div>
  );
}