import type { ChangelogCategory } from '@/lib/domains/changelog/types';

// Visuella tokens för changeloggen. Delade mellan kortet på CRM-översikten och adminvyn.
//
// Tecknet gör mer jobb än färgen här: raderna är korta och ligger tätt, och en läsare som skannar
// "vad har hänt" vill se SORTEN direkt — inte tolka en nyans. Färgen förstärker bara.
export const changelogCategoryMeta: Record<ChangelogCategory, { glyph: string; badge: string; glyphClass: string }> = {
  fixed: {
    glyph: '✓',
    badge: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    glyphClass: 'bg-emerald-100 text-emerald-700',
  },
  new: {
    glyph: '+',
    badge: 'border-sky-200 bg-sky-50 text-sky-800',
    glyphClass: 'bg-sky-100 text-sky-700',
  },
  improved: {
    glyph: '↑',
    badge: 'border-violet-200 bg-violet-50 text-violet-700',
    glyphClass: 'bg-violet-100 text-violet-700',
  },
};

// Dagsrubrik i listan: "12 augusti" — året bara när det inte är innevarande, så den vanliga raden
// blir så kort som möjligt. Tar emot ISO-datum (ÅÅÅÅ-MM-DD) ur groupChangelogByDay.
export function formatChangelogDay(isoDay: string, today = new Date()): string {
  const date = new Date(`${isoDay}T00:00:00`);
  if (Number.isNaN(date.getTime())) return isoDay;

  const sameYear = date.getFullYear() === today.getFullYear();
  return new Intl.DateTimeFormat('sv-SE', {
    day: 'numeric',
    month: 'long',
    ...(sameYear ? {} : { year: 'numeric' }),
  }).format(date);
}

// Kompakt datum för kortets rader, där dagsrubriker inte får plats.
export function formatChangelogStamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('sv-SE', { day: 'numeric', month: 'short' }).format(date);
}
