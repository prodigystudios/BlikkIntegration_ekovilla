import { z } from 'zod';
import { TICKET_AREAS, TICKET_KINDS, TICKET_STATUSES } from './types';

// Fritextlängder. Titeln är en etikett i en lista, inte en beskrivning — taket hindrar att någon
// klistrar in hela buggen där och gör backloggen oläslig. Beskrivningens tak är generöst men
// ändligt, så en klistrad stacktrace inte blir en obegränsad kolumn.
const TITLE_MAX = 120;
const DESCRIPTION_MAX = 4000;
const RESOLUTION_MAX = 4000;
const CHANGELOG_NOTE_MAX = 500;
const PAGE_PATH_MAX = 500;

// Tomt → null, annars trimmat. Används på varje valfritt textfält så "   " aldrig lagras som text.
const optionalText = (max: number) =>
  z.preprocess(
    (v) => {
      if (v == null) return null;
      const t = String(v).trim();
      return t.length > 0 ? t.slice(0, max) : null;
    },
    z.string().max(max).nullable(),
  );

export const createTicketSchema = z.object({
  kind: z.enum(TICKET_KINDS, { errorMap: () => ({ message: 'Välj om det är en bugg eller ett förslag' }) }),
  area: z.enum(TICKET_AREAS, { errorMap: () => ({ message: 'Välj vilken del av appen det gäller' }) }),
  title: z.string().trim().min(1, 'Skriv en kort rubrik').max(TITLE_MAX, `Rubriken får vara högst ${TITLE_MAX} tecken`),
  description: z
    .string()
    .trim()
    .min(1, 'Beskriv vad som händer')
    .max(DESCRIPTION_MAX, `Beskrivningen får vara högst ${DESCRIPTION_MAX} tecken`),
  // Fylls av klienten (window.location.pathname), inte av användaren. Valideras ändå: en absolut
  // URL eller ett protokoll-relativt värde här hade blivit en öppen redirect om vyn någon gång
  // gör den klickbar. Bara app-interna sökvägar accepteras.
  page_path: z.preprocess(
    (v) => {
      if (v == null) return null;
      const t = String(v).trim();
      if (!t.startsWith('/') || t.startsWith('//')) return null;
      return t.slice(0, PAGE_PATH_MAX);
    },
    z.string().max(PAGE_PATH_MAX).nullable(),
  ),
});

export type CreateTicketInput = z.infer<typeof createTicketSchema>;

// Admin-uppdatering. Alla fält är valfria — routen skriver bara det klienten faktiskt skickade
// (pickProvidedFields), så en statusändring inte nollar ett resolution-svar.
export const updateTicketSchema = z.object({
  status: z.enum(TICKET_STATUSES, { errorMap: () => ({ message: 'Ogiltig status' }) }).optional(),
  resolution: optionalText(RESOLUTION_MAX).optional(),
  changelog_note: optionalText(CHANGELOG_NOTE_MAX).optional(),
  // true = publicera i changeloggen, false = ta tillbaka. Tidsstämpeln sätts serverside.
  publish_to_changelog: z.boolean().optional(),
});

export type UpdateTicketInput = z.infer<typeof updateTicketSchema>;

export const listTicketsQuerySchema = z.object({
  scope: z.enum(['mine', 'all']).optional().default('mine'),
  status: z.enum(TICKET_STATUSES).optional(),
  kind: z.enum(TICKET_KINDS).optional(),
  // 'open' (default i backloggen) döljer klara/avvisade; 'closed' visar bara dem; 'any' allt.
  // Skilt från `status` så vyn kan visa "det som återstår" utan att välja en enda status.
  state: z.enum(['open', 'closed', 'any']).optional().default('any'),
});

export type ListTicketsQuery = z.infer<typeof listTicketsQuerySchema>;

// Skärmbilden. Bara bilder, och ett tak som rymmer en telefonskärmdump utan att bli en
// uppladdningskanal. Filen kommer som en del av en multipart-POST (FormData), aldrig som base64
// i JSON — det senare hade svällt kroppen ~33 %.
export const SCREENSHOT_MAX_BYTES = 10 * 1024 * 1024;
export const SCREENSHOT_CONTENT_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/heic', 'image/heif'] as const;

export function validateScreenshot(file: { size: number; type: string; name: string }): string | null {
  if (file.size === 0) return 'Skärmbilden är tom.';
  if (file.size > SCREENSHOT_MAX_BYTES) return 'Skärmbilden är för stor (max 10 MB).';
  // Vissa mobilbrowsers skickar tom type för HEIC — fall tillbaka på filändelsen.
  const type = (file.type || '').toLowerCase();
  if (type) {
    if (!SCREENSHOT_CONTENT_TYPES.includes(type as (typeof SCREENSHOT_CONTENT_TYPES)[number])) {
      return 'Bara bildfiler kan bifogas (png, jpg, webp, gif, heic).';
    }
    return null;
  }
  if (!/\.(png|jpe?g|webp|gif|heic|heif)$/i.test(file.name)) {
    return 'Bara bildfiler kan bifogas (png, jpg, webp, gif, heic).';
  }
  return null;
}
