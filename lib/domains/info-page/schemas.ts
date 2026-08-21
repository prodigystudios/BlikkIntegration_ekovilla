import { z } from 'zod';

// Zod-scheman för skrivvägen till /dokument-information.
//
// `body` valideras MEDVETET bara som "något alls" här. normalizeBlocks i blocks.ts är
// whitelisten och äger vad ett block är; två sanningar om den formen hade drivit isär, och
// den som satt i ett Zod-schema hade varit den som ingen testade.

export const createGroupSchema = z.object({
  title: z.string().trim().min(1, 'Namn på avsnittet saknas.').max(120),
});

export const updateGroupSchema = z
  .object({
    title: z.string().trim().min(1, 'Namn på avsnittet saknas.').max(120).optional(),
    sortOrder: z.number().int().min(0).max(9999).optional(),
  })
  .refine((v) => v.title !== undefined || v.sortOrder !== undefined, { message: 'Inget att ändra.' });

export const createSectionSchema = z.object({
  groupId: z.string().uuid('Avsnittet saknas.'),
  title: z.string().trim().min(1, 'Rubrik saknas.').max(200),
  body: z.unknown().optional(),
});

export const updateSectionSchema = z.object({
  title: z.string().trim().min(1, 'Rubrik saknas.').max(200).optional(),
  groupId: z.string().uuid().optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
  body: z.unknown().optional(),
});

// contentType valideras bara som "en sträng" här. VAD som får laddas upp avgörs av
// resolveFileKind i storage.ts, som är samma funktion som läsvägen väljer renderare med — en
// lista i ett Zod-schema hade varit en andra sanning, och den som inte används vid renderingen
// är den som glider isär.
export const uploadUrlSchema = z.object({
  fileName: z.string().trim().min(1, 'Filnamn saknas.').max(200),
  contentType: z.string().trim().max(200).optional(),
});

export const registerImageSchema = z.object({
  bucket: z.string().trim().min(1),
  path: z.string().trim().min(1),
  fileName: z.string().trim().min(1).max(200),
  contentType: z.union([z.string().trim().max(200), z.null()]).optional(),
  caption: z.union([z.string().trim().max(300), z.null()]).optional(),
});
