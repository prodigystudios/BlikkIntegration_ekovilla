import { z } from 'zod';
import { SYSTEM_NOTICE_AREAS, SYSTEM_NOTICE_KINDS } from './types';

// En banner ska gå att läsa i förbifarten. Taket håller det löftet — samma som CHECK-villkoret i databasen.
const MESSAGE_MAX = 500;

const kindSchema = z.enum(SYSTEM_NOTICE_KINDS, {
  errorMap: () => ({ message: 'Välj Uppdatering pågår, Planerat underhåll, Driftstörning eller Information' }),
});

const messageSchema = z
  .string()
  .trim()
  .min(1, 'Skriv vad som händer')
  .max(MESSAGE_MAX, `Meddelandet får vara högst ${MESSAGE_MAX} tecken`);

// Dubbletter tas bort; ordningen följer listan i types.ts, så brickorna alltid står i samma ordning.
const areasSchema = z
  .array(z.enum(SYSTEM_NOTICE_AREAS, { errorMap: () => ({ message: 'Okänd del av appen' }) }))
  .transform((areas) => SYSTEM_NOTICE_AREAS.filter((a) => areas.includes(a)));

const endsAtSchema = z.string().datetime({ offset: true, message: 'Sluttiden skrivs ISO 8601.' }).nullable();

export const createSystemNoticeSchema = z.object({
  kind: kindSchema,
  message: messageSchema,
  affected_areas: areasSchema.optional().default([]),
  // Null = tills admin slår av det.
  ends_at: endsAtSchema.optional().default(null),
});

export type CreateSystemNoticeInput = z.infer<typeof createSystemNoticeSchema>;

// Allt valfritt: routen skriver bara det som skickades. `end: true` slår av meddelandet nu.
export const updateSystemNoticeSchema = z.object({
  kind: kindSchema.optional(),
  message: messageSchema.optional(),
  affected_areas: areasSchema.optional(),
  ends_at: endsAtSchema.optional(),
  end: z.literal(true).optional(),
});

export type UpdateSystemNoticeInput = z.infer<typeof updateSystemNoticeSchema>;
