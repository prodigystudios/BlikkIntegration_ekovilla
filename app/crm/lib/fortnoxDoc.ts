// Shared client helpers for fetching/sending Fortnox-generated documents (offer &
// order PDFs + e-mails). Centralised so the popup-safe PDF open and the email POST
// behave identically everywhere (offer modal, order detail) and a fix lands in one place.

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

// POST a Fortnox "email this document to the customer" endpoint. Returns true on success.
export async function postFortnoxEmail(
  url: string,
  onError: (message: string) => void,
): Promise<boolean> {
  try {
    const res = await fetch(url, { method: 'POST' });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.ok) {
      onError(json?.error || 'Kunde inte mejla dokumentet');
      return false;
    }
    return true;
  } catch {
    onError('Kunde inte mejla dokumentet');
    return false;
  }
}
