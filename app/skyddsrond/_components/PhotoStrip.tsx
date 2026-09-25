"use client";

import { useEffect, useState, type ReactNode } from 'react';
import { cn } from '@/lib/shared/cn';
import { crm } from '@/app/crm/lib/crmTokens';
import { MAX_PHOTOS_PER_ROUND } from '@/lib/domains/safetyRounds/photoRules';
import type { SafetyRoundPhoto } from '@/lib/domains/safetyRounds/types';
import type { PhotoUploadProgress } from '../[id]/useSafetyRound';

// Fotona på en punkt i checklistan — miniatyrer med sitt "Foto-nr" och en knapp som öppnar
// telefonens kamera eller bildbibliotek (ingen `capture`: då hade man inte kunnat välja ett foto man
// redan tagit). Ett tryck på en miniatyr öppnar den fulla bilden i en ny flik.
//
// Ta bort kräver två tryck: fotot försvinner ur lagringen och går inte att ångra, och en miniatyr på
// en telefon med handskar är lätt att träffa av misstag.

type Props = {
  photos: SafetyRoundPhoto[];
  urls: Record<string, string | null>;
  readOnly: boolean;
  /** "punkt 4" — till skärmläsarens bildtexter. */
  itemLabel: string;
  uploading: PhotoUploadProgress | undefined;
  /** Ronden har nått taket (MAX_PHOTOS_PER_ROUND). */
  limitReached: boolean;
  onUpload: (files: File[]) => void;
  onRemove: (photoId: string) => void;
  /**
   * Något som ska stå på samma rad som "+ Foto" — radens "+ Kommentar". Två små knappar på var sin
   * rad hade gjort varje punkt i checklistan en rad högre.
   */
  addonBefore?: ReactNode;
};

/** Samma form som radens "+ Kommentar", så att de två läses som ett par. */
export const INLINE_ACTION_CLASS = 'inline-flex min-h-11 w-fit items-center p-0 px-1 text-sm font-semibold text-slate-600 hover:text-slate-900';

export default function PhotoStrip({ photos, urls, readOnly, itemLabel, uploading, limitReached, onUpload, onRemove, addonBefore }: Props) {
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  // Bekräftelsen ångrar sig själv efter en stund — ett kvarglömt "Bekräfta" är en fälla.
  useEffect(() => {
    if (!confirmingId) return;
    const timer = window.setTimeout(() => setConfirmingId(null), 4000);
    return () => window.clearTimeout(timer);
  }, [confirmingId]);

  if (readOnly && photos.length === 0) return null;

  return (
    <div className="grid gap-2 sm:ml-10">
      {photos.length > 0 ? (
        <ul className="m-0 flex list-none flex-wrap gap-3 p-0" aria-label={`Foton på ${itemLabel}`}>
          {photos.map((photo) => {
            const url = urls[photo.id];
            const confirming = confirmingId === photo.id;
            return (
              <li key={photo.id} className="grid w-20 gap-1">
                {url ? (
                  <a href={url} target="_blank" rel="noopener noreferrer" className="block h-20 w-20 overflow-hidden rounded-xl border border-solid border-[#dce4d8] bg-white">
                    {/* <img> och inte next/image: en signerad URL till en privat bucket går inte att optimera. */}
                    <img src={url} alt={`Foto ${photo.photo_no} på ${itemLabel}`} className="h-full w-full object-cover" loading="lazy" />
                  </a>
                ) : (
                  <div className="flex h-20 w-20 items-center justify-center rounded-xl border border-solid border-[#dce4d8] bg-[#f1f5ef] p-1 text-center text-[11px] leading-tight text-slate-500">
                    Kunde inte visas
                  </div>
                )}
                <span className={cn('text-center tabular-nums', crm.micro)}>Foto {photo.photo_no}</span>
                {!readOnly ? (
                  <button
                    type="button"
                    onClick={() => (confirming ? onRemove(photo.id) : setConfirmingId(photo.id))}
                    className={cn(
                      'min-h-9 rounded-lg border border-solid p-0 px-1 text-[12px] font-semibold',
                      confirming ? 'border-rose-300 bg-rose-50 text-rose-700' : 'border-transparent text-slate-500 hover:text-rose-700',
                    )}
                    aria-label={confirming ? `Bekräfta: ta bort foto ${photo.photo_no}` : `Ta bort foto ${photo.photo_no}`}
                  >
                    {confirming ? 'Bekräfta' : 'Ta bort'}
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      {!readOnly ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {addonBefore}
          {limitReached ? (
            <p className={cn('m-0', crm.meta)}>Ronden har {MAX_PHOTOS_PER_ROUND} foton, som är taket.</p>
          ) : (
            // ⚠️ w-fit: globals.css ger :where(label) width: 100%, och en fotoknapp över hela raden
            // hade sett ut som ett fält.
            <label className={cn(INLINE_ACTION_CLASS, 'cursor-pointer', uploading && 'pointer-events-none opacity-60')}>
              + Foto
              <input
                type="file"
                accept="image/*"
                multiple
                className="sr-only"
                disabled={Boolean(uploading)}
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  // Nollställs direkt, så att samma bild kan väljas igen efter ett misslyckande.
                  e.target.value = '';
                  if (files.length > 0) onUpload(files);
                }}
              />
            </label>
          )}
          {uploading ? (
            <p className={cn('m-0', crm.meta)} role="status" aria-live="polite">
              Sparar foto {Math.min(uploading.done + 1, uploading.total)} av {uploading.total}…
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
