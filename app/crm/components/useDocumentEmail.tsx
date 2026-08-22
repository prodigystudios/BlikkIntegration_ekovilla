"use client";

import { useState, type ReactNode } from 'react';
import Input from '@/components/ui/Input';
import CrmModal from '@/app/crm/components/CrmModal';
import { useToast } from '@/lib/Toast';
import { cn } from '@/lib/shared/cn';
import { downloadFortnoxPdf } from '@/app/crm/lib/fortnoxDoc';
import { documentRecipients, type CrmContactSource } from '@/lib/domains/crm/contacts';
import { buildDocumentEmailDraft, buildMailtoUrl, type CrmDocumentKind } from '@/lib/domains/crm/documentEmail';
import DocumentEmailProgress, { type DocumentEmailPhase } from '@/app/crm/components/DocumentEmailProgress';

// Mailing a CRM document (offer / order confirmation) from the user's own mail client, with
// the recipient resolved — and only asked for when there is a genuine choice.
//
// Shared because all three send buttons (offer + order confirmation in the quote modal, order
// confirmation on the work-order page) must behave identically; they used to diverge.

export type EmailableDocument = {
  /** Drives the per-row busy state; typically the quote or work-order id. */
  id: string;
  kind: CrmDocumentKind;
  /** Document number, typically a `documentRef()` result. */
  ref: string;
  projectName?: string | null;
  customerName?: string | null;
  /** Address on the document's own snapshot — the point-in-time truth. */
  snapshotEmail?: string | null;
  /** Linked customer, for its current contacts/card address. */
  customerId?: string | null;
  /** Endpoint returning the document PDF. */
  pdfUrl: string;
};

// Radio value for the hand-typed address — an explicit sentinel, so an empty text field can
// still be the selected option (deriving it from the text meant the row could never be picked).
const CUSTOM_RECIPIENT = '__custom__';

// What the document's own stored address is called in the picker.
const DOCUMENT_SNAPSHOT_LABEL: Record<CrmDocumentKind, string> = {
  offer: 'Från offerten',
  order: 'Från ordern',
};

type PickerState = {
  doc: EmailableDocument;
  options: Array<{ email: string; label: string }>;
  selected: string;
  custom: string;
};

async function fetchCustomer(customerId: string): Promise<CrmContactSource | null> {
  try {
    const res = await fetch(`/api/crm/customers/${customerId}`, { cache: 'no-store' });
    const json = await res.json().catch(() => ({}));
    return (json?.data?.item as CrmContactSource | undefined) ?? null;
  } catch {
    return null;
  }
}

export default function useDocumentEmail(): {
  /** Id of the document currently being prepared, for the button's busy state. */
  sendingId: string | null;
  /** Entry point for a "Mejla …" button. */
  start: (doc: EmailableDocument) => void;
  /** Render this once in the component tree. */
  modal: ReactNode;
} {
  const toast = useToast();
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [picker, setPicker] = useState<PickerState | null>(null);
  // Which step of the prepare-the-draft sequence is running, and which steps this run has.
  // The contact lookup is skipped for a document with no linked customer.
  const [progress, setProgress] = useState<{ steps: DocumentEmailPhase[]; phase: DocumentEmailPhase } | null>(null);

  const pickedEmail = !picker
    ? ''
    : picker.selected === CUSTOM_RECIPIENT
      ? picker.custom.trim()
      : picker.selected;

  async function openMailDraft(doc: EmailableDocument, to: string, steps: DocumentEmailPhase[]) {
    const draft = buildDocumentEmailDraft(doc);

    setSendingId(doc.id);
    setProgress({ steps, phase: 'pdf' });
    // Best-effort: drop the PDF in Downloads so it can be attached to the draft.
    const pdfOk = await downloadFortnoxPdf(doc.pdfUrl, draft.filename, toast.error);
    setSendingId(null);
    if (pdfOk) toast.success('PDF nedladdad – bifoga den i mejlet som öppnades.');

    // Open the mail client with the draft (recipient/subject/body pre-filled). Deferred so
    // the just-started blob download commits first — setting location.href immediately can
    // otherwise cancel the in-flight download. The mailto is a convenience, not required.
    setProgress({ steps, phase: 'mail' });
    const mailto = buildMailtoUrl(to, draft);
    setTimeout(() => {
      window.location.href = mailto;
      // mailto hands off to an external app without unloading the page, so the overlay has
      // to be dismissed explicitly — otherwise it would sit there for good.
      setProgress(null);
    }, pdfOk ? 800 : 0);
  }

  // Resolves who the document can go to and only asks when there is more than one candidate,
  // so a private customer (one address) goes straight through without an extra click.
  async function start(doc: EmailableDocument) {
    const snapshotEmail = doc.snapshotEmail?.trim() || '';
    if (!doc.customerId) {
      void openMailDraft(doc, snapshotEmail, ['pdf', 'mail']);
      return;
    }

    const steps: DocumentEmailPhase[] = ['contact', 'pdf', 'mail'];
    setSendingId(doc.id);
    setProgress({ steps, phase: 'contact' });
    const customer = await fetchCustomer(doc.customerId);
    setSendingId(null);

    const options = documentRecipients(snapshotEmail, customer, DOCUMENT_SNAPSHOT_LABEL[doc.kind]);
    if (options.length > 1) {
      // Hand over to the picker — the overlay must not sit on top of it.
      setProgress(null);
      setPicker({ doc, options, selected: options[0].email, custom: '' });
      return;
    }
    // One candidate (or none — then the seller fills it in themselves).
    void openMailDraft(doc, options[0]?.email || '', steps);
  }

  const modal = picker ? (
    <CrmModal
      onClose={() => setPicker(null)}
      ariaLabel="Välj mottagare"
      maxWidth="sm:max-w-[460px]"
      header={
        <div className="grid gap-0.5">
          <h2 className="m-0 text-base font-bold text-slate-900">
            Vem ska ha {picker.doc.kind === 'offer' ? 'offerten' : 'orderbekräftelsen'}?
          </h2>
          <p className="m-0 text-xs text-slate-500">
            {picker.doc.customerName?.trim() || 'Kunden'} har flera adresser.
          </p>
        </div>
      }
      footer={
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setPicker(null)}
            className="flex-1 rounded-xl border border-solid border-slate-200 bg-white py-2.5 text-sm font-semibold text-slate-600 transition hover:border-slate-300 sm:flex-none sm:px-5"
          >
            Avbryt
          </button>
          <button
            type="button"
            disabled={!pickedEmail}
            onClick={() => {
              const { doc } = picker;
              const to = pickedEmail;
              setPicker(null);
              void openMailDraft(doc, to, ['pdf', 'mail']);
            }}
            className="flex-1 rounded-xl py-2.5 text-sm font-semibold text-white shadow-sm transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50 sm:ml-auto sm:flex-none sm:px-5"
            style={{ backgroundColor: 'var(--crm-primary)' }}
          >
            Öppna mejl
          </button>
        </div>
      }
    >
      <div className="grid gap-1.5">
        {picker.options.map((option) => (
          <label
            key={option.email}
            className={cn(
              'flex cursor-pointer items-center gap-3 rounded-xl border border-solid px-3.5 py-2.5 transition',
              picker.selected === option.email
                ? 'border-emerald-300 bg-emerald-50'
                : 'border-slate-200 bg-white hover:border-slate-300',
            )}
          >
            <input
              type="radio"
              name="document-recipient"
              checked={picker.selected === option.email}
              onChange={() => setPicker((p) => (p ? { ...p, selected: option.email } : p))}
              className="h-4 w-4 shrink-0 accent-[color:var(--ek-accent)]"
            />
            <span className="grid min-w-0 gap-0.5">
              <span className="truncate text-sm font-semibold text-slate-900">{option.email}</span>
              <span className="text-[11px] text-slate-500">{option.label}</span>
            </span>
          </label>
        ))}

        <label
          className={cn(
            'grid cursor-pointer gap-2 rounded-xl border border-solid px-3.5 py-2.5 transition',
            picker.selected === CUSTOM_RECIPIENT ? 'border-emerald-300 bg-emerald-50' : 'border-slate-200 bg-white',
          )}
        >
          <span className="flex items-center gap-3">
            <input
              type="radio"
              name="document-recipient"
              checked={picker.selected === CUSTOM_RECIPIENT}
              onChange={() => setPicker((p) => (p ? { ...p, selected: CUSTOM_RECIPIENT } : p))}
              className="h-4 w-4 shrink-0 accent-[color:var(--ek-accent)]"
            />
            <span className="text-sm font-semibold text-slate-900">Annan adress</span>
          </span>
          <Input
            type="email"
            value={picker.custom}
            onChange={(e) => setPicker((p) => (p ? { ...p, selected: CUSTOM_RECIPIENT, custom: e.target.value } : p))}
            placeholder="namn@foretag.se"
          />
        </label>
      </div>
    </CrmModal>
  ) : null;

  return {
    sendingId,
    start,
    modal: (
      <>
        {modal}
        {progress ? <DocumentEmailProgress steps={progress.steps} phase={progress.phase} onDismiss={() => setProgress(null)} /> : null}
      </>
    ),
  };
}
