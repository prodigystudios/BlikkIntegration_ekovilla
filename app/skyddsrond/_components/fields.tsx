"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import Input from '@/components/ui/Input';
import Textarea from '@/components/ui/Textarea';
import KmaNameCombobox from '@/app/crm/arbetsorder/KmaNameCombobox';
import type { KmaDirectoryEntry } from '@/lib/domains/crm/kmaPlans/directory';
import { cn } from '@/lib/shared/cn';
import { crm } from '@/app/crm/lib/crmTokens';

// Fälten i skyddsronden. Text sparas när man LÄMNAR fältet (inte per tangent — en PATCH per bokstav
// hade dränkt en dålig mobiluppkoppling), och bara om värdet faktiskt ändrats.
//
// Utkastet följer serverns värde så länge fältet inte har fokus. Med fokus får serverns svar inte
// skriva över det man håller på att skriva — svaret på en TIDIGARE sparning kan landa mitt i nästa.

/** Utkastet till ett textfält, med sparning när fokus lämnar det. */
function useDraft(value: string | null, commit: (next: string) => void) {
  const current = value ?? '';
  const [draft, setDraft] = useState(current);
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setDraft(current);
  }, [current]);

  return {
    draft,
    setDraft,
    onFocus: () => {
      focused.current = true;
    },
    onBlur: () => {
      focused.current = false;
      if (draft.trim() !== current.trim()) commit(draft);
    },
  };
}

export function Field({ label, htmlFor, hint, children, className }: {
  label: string;
  htmlFor: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('grid min-w-0 content-start gap-1', className)}>
      <label htmlFor={htmlFor} className={cn('m-0', crm.label)}>
        {label}
      </label>
      {children}
      {hint ? <p className={cn('m-0', crm.micro)}>{hint}</p> : null}
    </div>
  );
}

type TextProps = {
  label: string;
  value: string | null;
  onCommit: (next: string) => void;
  readOnly?: boolean;
  placeholder?: string;
  hint?: string;
  maxLength?: number;
  className?: string;
  type?: 'text' | 'time';
};

export function TextField({ label, value, onCommit, readOnly, placeholder, hint, maxLength = 200, className, type = 'text' }: TextProps) {
  const id = useId();
  const draft = useDraft(value, onCommit);
  return (
    <Field label={label} htmlFor={id} hint={hint} className={className}>
      <Input
        id={id}
        type={type}
        value={draft.draft}
        onChange={(e) => draft.setDraft(e.target.value)}
        onFocus={draft.onFocus}
        onBlur={draft.onBlur}
        readOnly={readOnly}
        placeholder={readOnly ? undefined : placeholder}
        maxLength={maxLength}
        className={cn(readOnly && 'border-transparent bg-[#eef1ec] text-slate-700')}
      />
    </Field>
  );
}

export function TextAreaField({ label, value, onCommit, readOnly, placeholder, hint, maxLength = 1000, className }: Omit<TextProps, 'type'>) {
  const id = useId();
  const draft = useDraft(value, onCommit);
  return (
    <Field label={label} htmlFor={id} hint={hint} className={className}>
      <Textarea
        id={id}
        autoGrow
        autoGrowMaxHeight={320}
        rows={2}
        value={draft.draft}
        onChange={(e) => draft.setDraft(e.target.value)}
        onFocus={draft.onFocus}
        onBlur={draft.onBlur}
        readOnly={readOnly}
        placeholder={readOnly ? undefined : placeholder}
        maxLength={maxLength}
        className={cn(readOnly && 'border-transparent bg-[#eef1ec] text-slate-700')}
      />
    </Field>
  );
}

/**
 * Namn med förslag ur Kontaktlistan (samma lista och komponent som KMA-planen). Ett val ur listan
 * sparas direkt; ett namn som skrivs för hand sparas när man lämnar fältet.
 *
 * Fokus följs på OMSLAGET: kombinationsrutan tar inte emot onFocus/onBlur, men båda bubblar i React.
 * Ett val i listan görs på mousedown med preventDefault, så fältet tappar aldrig fokus på vägen.
 */
export function NameField({ label, value, onCommit, readOnly, placeholder, hint, directory, className }: Omit<TextProps, 'type' | 'maxLength'> & {
  directory: readonly KmaDirectoryEntry[];
}) {
  const id = useId();
  const draft = useDraft(value, onCommit);

  if (readOnly) {
    return <TextField label={label} value={value} onCommit={onCommit} readOnly hint={hint} className={className} />;
  }

  return (
    <Field label={label} htmlFor={id} hint={hint} className={className}>
      <div onFocus={draft.onFocus} onBlur={draft.onBlur}>
        <KmaNameCombobox
          id={id}
          value={draft.draft}
          onChange={draft.setDraft}
          onPick={(entry) => {
            draft.setDraft(entry.name);
            if (entry.name.trim() !== (value ?? '').trim()) onCommit(entry.name);
          }}
          entries={directory}
          placeholder={placeholder}
        />
      </div>
    </Field>
  );
}
