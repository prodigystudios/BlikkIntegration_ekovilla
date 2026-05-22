import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/shared/cn';

type ErrorStateProps = HTMLAttributes<HTMLDivElement> & {
  title?: string;
  message: ReactNode;
  action?: ReactNode;
};

export default function ErrorState({ className, title = 'Något gick fel', message, action, ...props }: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn('grid gap-2 rounded-2xl border border-red-200 bg-red-50 p-4 text-ui-text-strong', className)}
      {...props}
    >
      <strong className="text-sm font-semibold text-red-900">{title}</strong>
      <p className="m-0 text-sm text-red-700">{message}</p>
      {action ? <div className="pt-1">{action}</div> : null}
    </div>
  );
}