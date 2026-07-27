// Shared client helpers for fetching Fortnox-generated document PDFs (offer & order
// confirmation). Centralised so the popup-safe open and the to-disk download behave
// identically everywhere (offer modal, order detail) and a fix lands in one place.
//
// Sending is NOT here: documents are e-mailed from the user's own mail client — see
// `useDocumentEmail`. Fortnox's own send endpoints were removed (2026-07-27) because they
// picked the recipient themselves.

// Fetch a Fortnox PDF (GET endpoint returning application/pdf) and open it in a new tab.
// The tab is opened synchronously (before the await) so it isn't blocked as a
// non-gesture popup; falls back to a post-fetch open if the pre-open was blocked.
export async function openFortnoxPdf(url: string, onError: (message: string) => void): Promise<void> {
  const win = window.open('', '_blank');
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      win?.close();
      onError(json?.error || 'Kunde inte hämta PDF:en');
      return;
    }
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    if (win) win.location.href = objectUrl;
    else window.open(objectUrl, '_blank');
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  } catch {
    win?.close();
    onError('Kunde inte hämta PDF:en');
  }
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
