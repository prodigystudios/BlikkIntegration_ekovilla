import * as React from 'react';
import { cn } from '@/lib/shared/cn';
import Button from './Button';

type DialogShellProps = {
  eyebrow?: string;
  title: string;
  description?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  panelClassName?: string;
  contentClassName?: string;
};

export default function DialogShell({
  eyebrow,
  title,
  description,
  onClose,
  children,
  panelClassName,
  contentClassName,
}: DialogShellProps) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/50 p-5"
      onClick={onClose}
    >
      <div
        className={cn(
          'grid max-h-[90vh] w-full overflow-auto rounded-[22px] border border-ui-border bg-white shadow-[0_24px_60px_rgba(15,23,42,0.22)]',
          panelClassName,
        )}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 bg-[linear-gradient(180deg,#fbfdff,#f8fafc)] px-5 py-[18px]">
          <div className="grid gap-1.5">
            {eyebrow ? <span className="text-[11px] font-bold uppercase tracking-[0.3px] text-blue-600">{eyebrow}</span> : null}
            <h3 className="m-0 text-[22px] font-bold text-slate-900">{title}</h3>
            {description ? <p className="m-0 text-ui-text-soft">{description}</p> : null}
          </div>
          <Button variant="secondary" onClick={onClose}>
            Stäng
          </Button>
        </div>

        <div className={cn('grid gap-[18px] p-5', contentClassName)}>{children}</div>
      </div>
    </div>
  );
}