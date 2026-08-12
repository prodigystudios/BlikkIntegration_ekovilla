import { z } from 'zod';
import { CHANGELOG_CATEGORIES } from './types';

// En changelog-rad ska gå att läsa på en rad. Taket är där för att hålla det löftet — inte för att
// spara plats.
const TITLE_MAX = 160;
const BODY_MAX = 2000;

const optionalBody = z.preprocess(
  (v) => {
    if (v == null) return null;
    const t = String(v).trim();
    return t.length > 0 ? t.slice(0, BODY_MAX) : null;
  },
  z.string().max(BODY_MAX).nullable(),
);

export const createChangelogEntrySchema = z.object({
  category: z.enum(CHANGELOG_CATEGORIES, { errorMap: () => ({ message: 'Välj Fixat, Nytt eller Förbättrat' }) }),
  title: z.string().trim().min(1, 'Skriv vad som ändrats').max(TITLE_MAX, `Rubriken får vara högst ${TITLE_MAX} tecken`),
  body: optionalBody.optional().default(null),
  // true = publicera direkt, false/utelämnat = spara som utkast. Tidsstämpeln sätts serverside.
  publish: z.boolean().optional().default(false),
});

export type CreateChangelogEntryInput = z.infer<typeof createChangelogEntrySchema>;

// Alla fält valfria — routen skriver bara det klienten faktiskt skickade, så en publicering inte
// nollar en text ingen rört.
export const updateChangelogEntrySchema = z.object({
  category: z.enum(CHANGELOG_CATEGORIES, { errorMap: () => ({ message: 'Ogiltig kategori' }) }).optional(),
  title: z.string().trim().min(1, 'Skriv vad som ändrats').max(TITLE_MAX).optional(),
  body: optionalBody.optional(),
  publish: z.boolean().optional(),
});

export type UpdateChangelogEntryInput = z.infer<typeof updateChangelogEntrySchema>;

export const listChangelogQuerySchema = z.object({
  // 'published' (default) = det alla ser. 'drafts' = adminvyn, som också vill se det oskrivna.
  scope: z.enum(['published', 'drafts']).optional().default('published'),
  limit: z.coerce.number().int().min(1).max(200).optional().default(100),
});

export type ListChangelogQuery = z.infer<typeof listChangelogQuerySchema>;
