import { prepareFileForUpload } from '@/lib/shared/imageCompression';

// Kvittouppladdningens två första steg, från klienten.
//
// Steg 1 ber servern om en engångs-URL (den gatar skrivrätten och periodlåset), steg 2 laddar upp
// direkt till lagringen. Steg 3 — att koppla kvittot till en post — sker i samma anrop som sparar
// eller uppdaterar utlägget, så en avbruten uppladdning aldrig lämnar en halv post i löneunderlaget.
//
// BYTENA PASSERAR ALDRIG EN ROUTE HANDLER. Ett kvitto fotograferat med en modern telefon är 3-5 MB
// rått och skulle slå i request-gränsen; samma skäl som ritningarna på arbetsordern.
//
// prepareFileForUpload gör två saker som spelar roll här: den komprimerar bilden till ~2 MB (en
// installatör i fält står ofta på 4G), och den konverterar HEIC till JPEG. Utan konverteringen hade
// ett kvitto fotograferat på iPhone inte gått att VISA för kontoret alls — varken Chrome eller
// Firefox på desktop renderar HEIC i en <img>. En PDF passerar orört.

export type UploadedReceipt = { storage_path: string; file_name: string };

// Bara den skiva av supabase-klienten som faktiskt används. Strukturell typ och inte
// `ReturnType<typeof createClientComponentClient>`: den senare löser ut till klientens
// DEFAULTGENERIK (`SupabaseClient<unknown, never, GenericSchema>`), som inte tar emot den faktiska
// `SupabaseClient<any, 'public', any>` anroparen har — ett fel som bara syns i type-check, inte i
// lint eller test. Skivan gör dessutom funktionen testbar utan en riktig klient.
type SignedUploadClient = {
  storage: {
    from(bucket: string): {
      uploadToSignedUrl(path: string, token: string, body: Blob): Promise<{ error: { message?: string } | null }>;
    };
  };
};

export async function uploadReceipt(
  supabase: SignedUploadClient,
  file: File,
  entryDate: string,
): Promise<UploadedReceipt> {
  const prepared = await prepareFileForUpload(file);

  const urlRes = await fetch('/api/time/compensations/receipt-upload-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      file_name: prepared.fileName,
      content_type: prepared.contentType,
      size_bytes: prepared.blob.size,
      // Datumet avgör vilken period kvittot hör till. Servern nekar redan här om månaden är
      // inlämnad, så användaren slipper ladda upp över mobilnätet och få sitt nej efteråt.
      entry_date: entryDate,
    }),
  });
  const urlJson = await urlRes.json().catch(() => ({}));
  if (!urlRes.ok || !urlJson.ok) throw new Error(urlJson?.error || 'Kunde inte förbereda uppladdningen');

  const { bucket, path, token } = urlJson.data as { bucket: string; path: string; token: string };

  const { error } = await supabase.storage.from(bucket).uploadToSignedUrl(path, token, prepared.blob);
  if (error) throw new Error(error.message || 'Uppladdningen misslyckades');

  // Servern litar inte på filnamnet mer än som visningsnamn — storlek och mimetype läser den ur
  // lagringen när posten sparas.
  return { storage_path: path, file_name: prepared.fileName };
}
