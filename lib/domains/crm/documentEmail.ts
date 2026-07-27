// Building the e-mail draft for a CRM document (offer / order confirmation).
//
// We send documents from the user's own mail client rather than through Fortnox's send
// service, so the recipient is ours to choose. `mailto:` cannot carry an attachment
// (RFC 6068 has no attachment field), so the PDF is downloaded to disk alongside the draft
// and the user attaches it — see `downloadFortnoxPdf` in `app/crm/lib/fortnoxDoc.ts`.
//
// Pure and dependency-free so the wording and the URL encoding are unit-testable.

export type CrmDocumentKind = 'offer' | 'order';

// `definite` is spelled out rather than built by appending "en" — "Orderbekräftelse" takes
// only an -n, and the naive suffix produced "Orderbekräftelseen".
// `file` stays ASCII: å/ä/ö in a blob download's filename render differently per browser.
const DOCUMENT_LABELS: Record<CrmDocumentKind, {
  subject: string;
  sentence: string;
  definite: string;
  file: string;
}> = {
  offer: { subject: 'Offert', sentence: 'offert', definite: 'Offerten', file: 'offert' },
  order: { subject: 'Orderbekräftelse', sentence: 'orderbekräftelse', definite: 'Orderbekräftelsen', file: 'orderbekraftelse' },
};

export type DocumentEmailDraft = {
  subject: string;
  body: string;
  /** Filename for the downloaded PDF the user attaches. */
  filename: string;
};

export function buildDocumentEmailDraft(input: {
  kind: CrmDocumentKind;
  /** Document number, typically a `documentRef()` result. */
  ref: string;
  projectName?: string | null;
}): DocumentEmailDraft {
  const label = DOCUMENT_LABELS[input.kind];
  const project = input.projectName?.trim();
  const suffix = project ? ` – ${project}` : '';
  const regarding = project ? ` gällande ${project}` : '';

  return {
    subject: `${label.subject} ${input.ref}${suffix}`,
    body: [
      'Hej,',
      '',
      `Här kommer ${label.sentence} ${input.ref}${regarding}. ${label.definite} bifogas som PDF.`,
      '',
      'Hör gärna av dig vid frågor.',
      '',
      'Med vänliga hälsningar',
    ].join('\n'),
    filename: `${label.file}-${input.ref}.pdf`,
  };
}

/**
 * A `mailto:` URL. Every part is percent-encoded: an unencoded subject or body would end the
 * URL at the first `&` or `#`, silently truncating the draft.
 */
export function buildMailtoUrl(to: string, draft: Pick<DocumentEmailDraft, 'subject' | 'body'>): string {
  const query = `subject=${encodeURIComponent(draft.subject)}&body=${encodeURIComponent(draft.body)}`;
  return `mailto:${encodeURIComponent(to)}?${query}`;
}
