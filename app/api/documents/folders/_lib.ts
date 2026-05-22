import { z } from 'zod';
import { sanitizeFolderColor, sanitizeFolderName, type FolderColor } from '../_util';

const trimStringValue = (value: unknown) => {
  if (typeof value === 'string') {
    return value.trim();
  }

  return value;
};

const requiredTrimmedString = (message: string) => z.preprocess(trimStringValue, z.string().min(1, message));

const optionalTrimmedString = z
  .preprocess((value) => {
    const trimmed = trimStringValue(value);
    return typeof trimmed === 'string' && trimmed.length === 0 ? undefined : trimmed;
  }, z.string().optional())
  .transform((value) => value ?? null);

const sanitizedFolderName = z.preprocess((value) => sanitizeFolderName(String(value || '')), z.string())
  .refine((value) => value.length > 0, 'name_required')
  .refine((value) => value !== '.' && value !== '..', 'invalid_name')
  .refine((value) => value.length <= 120, 'name_too_long');

const sanitizedFolderColor = z.preprocess((value) => sanitizeFolderColor(value), z.custom<FolderColor | null>((value) => value === null || typeof value === 'string'));

export const createFolderInputSchema = z.object({
  parentId: optionalTrimmedString,
  name: sanitizedFolderName,
  color: sanitizedFolderColor.optional().default(null),
});

export const renameFolderInputSchema = z.object({
  id: requiredTrimmedString('missing_id'),
  name: sanitizedFolderName,
});

export const deleteFolderQuerySchema = z.object({
  id: requiredTrimmedString('missing_id'),
});

export type CreateFolderInput = z.infer<typeof createFolderInputSchema>;
export type RenameFolderInput = z.infer<typeof renameFolderInputSchema>;
export type DeleteFolderInput = z.infer<typeof deleteFolderQuerySchema>;