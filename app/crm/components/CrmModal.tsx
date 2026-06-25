"use client";

import { useEffect, type ReactNode } from 'react';
import { cn } from '@/lib/shared/cn';

// Canonical CRM modal shell: full-screen bottom-sheet on phone, centered dialog on
// desktop. Sticky header (with built-in close), scrollable body, optional sticky
// footer for actions. Use this for every CRM modal so they share one structure.
//
// For forms: wrap the body fields in <form id="my-form" onSubmit=...> and give the
// footer submit button form="my-form" so Enter-to-submit and the footer action both
// trigger the same submit while staying visually in the sticky footer.
export default function CrmModal({
  onClose,
  ariaLabel,
  header,
  footer,
  children,
  maxWidth = 'sm:max-w-[600px]',
  bodyClassName,
}: {
  onClose: () => void;
  ariaLabel: string;
  header: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  /** Desktop max width, e.g. "sm:max-w-[760px]". */
  maxWidth?: string;
  bodyClassName?: string;
}) {
  // Close on Escape.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="crm-overlay-in fixed inset-0 z-[2800] flex items-end justify-center bg-slate-950/50 [backdrop-filter:blur(4px)] sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        onClick={(e) => e.stopPropagation()}
        className={cn(
          'crm-sheet-in flex h-[100dvh] max-h-[100dvh] w-full flex-col overflow-hidden rounded-none bg-white shadow-[0_-12px_50px_rgba(15,23,42,0.30)] sm:h-auto sm:max-h-[88vh] sm:rounded-2xl sm:shadow-[0_30px_80px_rgba(15,23,42,0.28)]',
          maxWidth,
        )}
      >
        {/* Sticky header */}
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 pb-4 [padding-top:calc(1rem+env(safe-area-inset-top))] sm:pt-4">
          <div className="min-w-0 flex-1">{header}</div>
          <button
            type="button"
            aria-label="Stäng"
            onClick={onClose}
            className="!h-9 !w-9 shrink-0 !rounded-full !border !border-slate-200 !bg-white !p-0 text-slate-500 transition hover:!border-slate-300 hover:text-slate-700"
          >
            <svg className="mx-auto" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Scrollable body */}
        <div className={cn('flex-1 overflow-y-auto px-5 py-5', bodyClassName)}>{children}</div>

        {/* Sticky footer */}
        {footer ? (
          <div className="flex items-center gap-2 border-t border-slate-100 px-5 py-3 [padding-bottom:calc(0.75rem+env(safe-area-inset-bottom))] sm:[padding-bottom:0.75rem]">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}
