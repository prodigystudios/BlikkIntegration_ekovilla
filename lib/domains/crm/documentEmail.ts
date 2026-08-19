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
const DOCUMENT_LABELS: Record<CrmDocumentKind, {
  subject: string;
  sentence: string;
  definite: string;
}> = {
  offer: { subject: 'Offert', sentence: 'offert', definite: 'Offerten' },
  order: { subject: 'Orderbekräftelse', sentence: 'orderbekräftelse', definite: 'Orderbekräftelsen' },
};

// Ett filnamn passerar tre lager som alla har egna åsikter: `a.download` på en blob,
// Content-Disposition på PDF-rutten, och mottagarens filsystem. Håll det på ren ASCII —
// å/ä/ö renderas olika per webbläsare — och släpp inte igenom tecken som är otillåtna i
// ett filnamn (eller som `#`, som dessutom kommer med gratis ur `documentRef()`).
function asciiFilenamePart(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // diakriter bort: å→a, ä→a, ö→o, é→e
    .replace(/[^\x20-\x7e]/g, '') // kvarvarande icke-ASCII (ex. ß) bort helt
    .replace(/[\\/:*?"<>|#]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const MAX_PROJECT_NAME_IN_FILENAME = 60;

/**
 * Filnamnet på dokumentets PDF: dokumenttyp + nummer + projektnamn, t.ex.
 * `Offert 12345 - Takisolering villa.pdf`. Delas av mejlbilagan och av
 * Content-Disposition på PDF-rutterna, så samma dokument heter samma sak överallt.
 */
export function buildDocumentFilename(input: {
  kind: CrmDocumentKind;
  /** Document number, typically a `documentRef()` result or a bare Fortnox number. */
  ref: string;
  projectName?: string | null;
}): string {
  const label = asciiFilenamePart(DOCUMENT_LABELS[input.kind].subject);
  const ref = asciiFilenamePart(input.ref);
  const project = asciiFilenamePart(input.projectName).slice(0, MAX_PROJECT_NAME_IN_FILENAME).trim();

  const base = [label, ref].filter(Boolean).join(' ');
  return `${project ? `${base} - ${project}` : base}.pdf`;
}

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
    filename: buildDocumentFilename(input),
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
