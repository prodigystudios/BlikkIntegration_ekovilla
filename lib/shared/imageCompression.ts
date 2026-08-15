// Klientsidig bildkomprimering.
//
// Lyft ur app/egenkontroll/page.tsx (som fortsätter använda sin egen data-URL-variant — PDF:en den
// bygger behöver en data-URL, och den här skivan rör inte egenkontrollen). Skillnaden här är
// `canvas.toBlob` i stället för `toDataURL`: resultatet ska laddas upp som binär fil, och en
// data-URL hade svällt den ~33 % på vägen.
//
// Ingen "use client" behövs — modulen importeras bara av klientkomponenter, men den rör inga React-
// API:er och kan därför enhetstestas som vanlig kod.

// createImageBitmap med `imageOrientation: 'from-image'` är raden som gör att mobilfoton inte
// kommer in liggande: telefonen lagrar bilden i sensorns riktning och rotationen i EXIF, och en
// canvas som ritar bitmappen rakt av tappar den. Fallbacken via <img> finns för äldre webbläsare.
async function loadBitmap(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  try {
    if (typeof createImageBitmap === 'function') {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    }
  } catch {
    /* faller igenom till <img> nedan */
  }
  const img = new Image();
  img.decoding = 'async';
  const url = URL.createObjectURL(file);
  return await new Promise((resolve, reject) => {
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}

export async function compressImageToBlob(file: Blob, maxDim = 1600, quality = 0.72): Promise<Blob> {
  const bmp = await loadBitmap(file);
  const sw = 'width' in bmp ? (bmp as any).width : (bmp as any).naturalWidth;
  const sh = 'height' in bmp ? (bmp as any).height : (bmp as any).naturalHeight;
  const scale = Math.min(1, maxDim / Math.max(sw, sh));
  const tw = Math.max(1, Math.round(sw * scale));
  const th = Math.max(1, Math.round(sh * scale));

  const canvas = document.createElement('canvas');
  canvas.width = tw;
  canvas.height = th;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas stöds inte');
  ctx.imageSmoothingQuality = 'high';
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(bmp as any, 0, 0, tw, th);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  try { (bmp as any).close?.(); } catch { /* ignoreras */ }
  if (!blob) throw new Error('Kunde inte komprimera bilden');
  return blob;
}

// Trappa nedåt tills filen ryms under taket. Samma steg som egenkontrollen använder — de är
// intrimmade mot riktiga mobilbilder.
export async function compressImageUnderCap(file: Blob, capBytes = 2_000_000): Promise<Blob> {
  const attempts = [
    { maxDim: 1600, q: 0.72 },
    { maxDim: 1280, q: 0.65 },
    { maxDim: 1024, q: 0.6 },
    { maxDim: 800, q: 0.6 },
  ];
  let last: Blob | null = null;
  for (const attempt of attempts) {
    const blob = await compressImageToBlob(file, attempt.maxDim, attempt.q);
    last = blob;
    if (blob.size <= capBytes) return blob;
  }
  if (!last) throw new Error('Kunde inte komprimera bilden');
  return last;
}

// Härleder mimetype ur filändelsen när webbläsaren inte satte någon. Safari och en del
// Android-webbläsare skickar tom `type` för HEIC.
const EXTENSION_CONTENT_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
};

export function guessContentTypeFromName(name: string): string {
  const ext = (name.split('.').pop() || '').toLowerCase();
  return EXTENSION_CONTENT_TYPES[ext] || 'application/octet-stream';
}

// Förbereder en vald fil för uppladdning.
//
// PDF passerar orört — en ritning går inte att komprimera och ska inte heller behöva det.
//
// Bilder konverteras till JPEG, vilket gör mer än att spara bandbredd: det löser HEIC-visningen.
// Chrome och Firefox på desktop renderar inte HEIC i <img>, så ett okonverterat fältfoto hade
// blivit en trasig miniatyr för kontoret. Misslyckas konverteringen (Chrome kan inte avkoda HEIC
// alls) laddas originalet upp — hellre en fil utan miniatyr än ingen fil.
//
// ⚠️ BLOBBEN MÅSTE BÄRA RÄTT `type`. `uploadToSignedUrl` lägger en Blob i en FormData-del utan att
// sätta content-type (fileOptions.contentType används BARA för strömmar, se storage-js 2.7.0), så
// lagringen härleder mimetypen ur blobbens egen type. En HEIC med tom type hade blivit
// application/octet-stream i bucketen — och sedan avvisats av vår egen validering på vägen
// tillbaka. Därför packas fallbacken om med en härledd type.
export async function prepareFileForUpload(file: File): Promise<{ blob: Blob; fileName: string; contentType: string }> {
  const declaredType = (file.type || '').toLowerCase();
  const type = declaredType || guessContentTypeFromName(file.name);

  if (type === 'application/pdf') {
    const blob = declaredType ? file : new Blob([file], { type });
    return { blob, fileName: file.name, contentType: type };
  }

  try {
    const blob = await compressImageUnderCap(file);
    const fileName = file.name.replace(/\.[^.]+$/, '') + '.jpg';
    return { blob, fileName, contentType: 'image/jpeg' };
  } catch {
    const blob = declaredType ? file : new Blob([file], { type });
    return { blob, fileName: file.name, contentType: type };
  }
}
