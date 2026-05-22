import { z } from 'zod';
import { sanitizeFileName } from '../_util';

const trimStringValue = (value: unknown) => {
  if (typeof value === 'string') {
    return value.trim();
  }

  return value;
};

const truthyFlagSchema = z.preprocess((value) => {
  const trimmed = trimStringValue(value);
  if (typeof trimmed === 'string') {
    return trimmed === '1' || trimmed.toLowerCase() === 'true';
  }

  return false;
}, z.boolean());

const optionalTrimmedStringSchema = z.preprocess((value) => {
  const trimmed = trimStringValue(value);
  return typeof trimmed === 'string' && trimmed.length > 0 ? trimmed : null;
}, z.string().nullable());

export const searchFilesQuerySchema = z.object({
  q: z.preprocess((value) => {
    const trimmed = trimStringValue(value);
    return typeof trimmed === 'string' ? trimmed : '';
  }, z.string()),
  limit: z.preprocess((value) => {
    const numberValue = Number(value ?? 50);
    if (!Number.isFinite(numberValue)) {
      return 50;
    }

    return Math.max(1, Math.min(100, Math.floor(numberValue)));
  }, z.number()),
});

export const downloadFileQuerySchema = z.object({
  id: z.preprocess(trimStringValue, z.string().min(1, 'missing_id')),
  download: truthyFlagSchema,
  redirect: truthyFlagSchema,
});

export const uploadFileInputSchema = z.object({
  file: z.custom<File>((value): value is File => value instanceof File, 'missing_file'),
  folderId: optionalTrimmedStringSchema,
});

export const deleteFileQuerySchema = z.object({
  id: z.preprocess(trimStringValue, z.string().min(1, 'missing_id')),
});

export function splitFileExtension(name: string) {
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) {
    return { stem: name, ext: '' };
  }

  return { stem: name.slice(0, dot), ext: name.slice(dot) };
}

export function guessFileContentType(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  switch (ext) {
    case 'pdf':
      return 'application/pdf';
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    case 'txt':
      return 'text/plain';
    case 'csv':
      return 'text/csv';
    case 'json':
      return 'application/json';
    default:
      return 'application/octet-stream';
  }
}

export function sanitizeUploadedFileName(fileName: string) {
  return sanitizeFileName(fileName);
}

export type SearchFilesQuery = z.infer<typeof searchFilesQuerySchema>;
export type DownloadFileQuery = z.infer<typeof downloadFileQuerySchema>;
export type UploadFileInput = z.infer<typeof uploadFileInputSchema>;
export type DeleteFileQuery = z.infer<typeof deleteFileQuerySchema>;