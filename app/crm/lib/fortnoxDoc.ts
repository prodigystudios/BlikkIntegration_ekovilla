// Shared client helpers for Fortnox-generated document PDFs (offer & order confirmation).
// Centralised so the open-in-tab and the to-disk download behave identically everywhere
// (offer modal, order detail) and a fix lands in one place.
//
// Sending is NOT here: documents are e-mailed from the user's own mail client — see
// `useDocumentEmail`. Fortnox's own send endpoints were removed (2026-07-27) because they
// picked the recipient themselves.

// Open a Fortnox PDF (GET endpoint returning application/pdf) in a new tab.
//
// Fliken navigeras till RUTTEN, inte till en blob-URL. En blob-URL bär inget filnamn, så
// webbläsaren föreslog "Unknown" när säljaren sparade dokumentet från förhandsgranskningen.
// Genom att navigera dit får webbläsaren se ruttens `Content-Disposition` och sparar med
// rätt namn (offertnummer + offertnamn). Priset: ett fel landar i fliken i stället för i en
// toast — därför svarar PDF-rutterna med en HTML-sida på just fliknavigeringar.
export function openFortnoxPdf(url: string): void {
  window.open(url, '_blank');
}

// Fetch a Fortnox PDF and DOWNLOAD it to disk (for the "email from my own mail client"
// flow — mailto can't attach files, so we drop the PDF in Downloads for the user to attach).
// Returns true on success.
export async function downloadFortnoxPdf(
  url: string,
  filename: string,
  onError: (message: string) => void,
): Promise<boolean> {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      onError(json?.error || 'Kunde inte hämta PDF:en');
      return false;
    }
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    return true;
  } catch {
    onError('Kunde inte hämta PDF:en');
    return false;
  }
}
