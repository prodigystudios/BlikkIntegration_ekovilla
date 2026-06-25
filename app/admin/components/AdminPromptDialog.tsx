"use client";

import { useEffect, useRef, useState } from 'react';
import CrmModal from '../../crm/components/CrmModal';
import { crm } from '../../crm/lib/crmTokens';
import { cn } from '../../../lib/shared/cn';

// Small admin confirmation / prompt dialog built on the canonical CrmModal, so admin
// stops relying on native window.confirm/prompt. Pass `defaultValue` (incl. "") to get
// an input (prompt mode); omit it for a plain confirm. `onConfirm` receives the trimmed
// input value (empty string in confirm mode).
export default function AdminPromptDialog({
  title,
  message,
  confirmLabel = 'Bekräfta',
  danger = false,
  defaultValue,
  inputLabel,
  placeholder,
  busy = false,
  onConfirm,
  onClose,
}: {
  title: string;
  message?: string;
  confirmLabel?: string;
  danger?: boolean;
  defaultValue?: string;
  inputLabel?: string;
  placeholder?: string;
  busy?: boolean;
  onConfirm: (value: string) => void;
  onClose: () => void;
}) {
  const isPrompt = defaultValue !== undefined;
  const [value, setValue] = useState(defaultValue ?? '');
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (isPrompt) inputRef.current?.focus();
  }, [isPrompt]);

  function submit() {
    const trimmed = value.trim();
    if (isPrompt && !trimmed) return;
    onConfirm(trimmed);
  }

  return (
    <CrmModal
      onClose={onClose}
      ariaLabel={title}
      maxWidth="sm:max-w-[420px]"
      header={<h2 className="text-base font-bold text-slate-900">{title}</h2>}
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" className={crm.ghostButton} onClick={onClose} disabled={busy}>
            Avbryt
          </button>
          <button
            type="button"
            form="admin-prompt-form"
            onClick={submit}
            disabled={busy}
            className={cn(
              crm.formButton,
              danger
                ? 'border border-rose-600 bg-rose-600 hover:brightness-95'
                : '',
            )}
            style={danger ? undefined : { backgroundColor: 'var(--crm-primary)' }}
          >
            {busy ? '…' : confirmLabel}
          </button>
        </div>
      }
    >
      <form
        id="admin-prompt-form"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="grid gap-3"
      >
        {message && <p className="m-0 text-sm leading-[1.55] text-slate-600">{message}</p>}
        {isPrompt && (
          <label className="grid gap-1">
            {inputLabel && <span className={crm.label}>{inputLabel}</span>}
            <input
              ref={inputRef}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={placeholder}
              className={crm.input}
            />
          </label>
        )}
      </form>
    </CrmModal>
  );
}
