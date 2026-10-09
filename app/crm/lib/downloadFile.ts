// Hämta en fil från en egen rutt och spara den på disk. Delas av Fortnox-PDF:erna (fortnoxDoc.ts) och
// rapportens Excel-export, så att nedladdningen beter sig likadant överallt och en rättelse landar på
// ett ställe.
//
// fetch i stället för en vanlig länk: ett fel ska bli ett meddelande hos anroparen, inte en nedladdad
// JSON-fil eller en tom sida.

/** Filnamnet ur ruttens `Content-Disposition`, eller null. */
export function filenameFromDisposition(disposition: string | null): string | null {
  return disposition?.match(/filename="([^"]+)"/)?.[1] ?? null;
}

/**
 * Laddar ner `url` till disk. Filnamnet är `filename` om det ges, annars ruttens `Content-Disposition`,
 * annars `fallbackName`. Returnerar true när filen sparades.
 */
export async function downloadFile(
  url: string,
  opts: { filename?: string; fallbackName?: string; errorMessage: string; onError: (message: string) => void },
): Promise<boolean> {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      opts.onError(json?.error || opts.errorMessage);
      return false;
    }
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = opts.filename || filenameFromDisposition(res.headers.get('Content-Disposition')) || opts.fallbackName || 'fil';
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Generöst: en stor fil på en långsam lina får inte förlora sin URL mitt i sparandet.
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    return true;
  } catch {
    opts.onError(opts.errorMessage);
    return false;
  }
}
