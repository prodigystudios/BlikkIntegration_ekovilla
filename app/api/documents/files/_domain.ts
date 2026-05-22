import crypto from 'node:crypto';
import { getDocsBucket } from '../_util';
import {
  guessFileContentType,
  sanitizeUploadedFileName,
  splitFileExtension,
  type UploadFileInput,
} from './_lib';
import { getOptionalSupabaseAdmin } from '@/lib/supabase/server';

type DocumentsSessionClient = {
  from: (table: string) => any;
};

type FolderRow = { id: string; name: string; parent_id: string | null };
type FileRow = {
  id: string;
  folder_id: string | null;
  file_name: string;
  content_type: string | null;
  size_bytes: number | null;
  created_at: string;
};

export class DocumentsFilesRouteError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

type FileStorageRow = {
  id: string;
  storage_bucket: string | null;
  storage_path: string | null;
  file_name: string | null;
};

function getSupabaseAdminOrThrow() {
  const supabase = getOptionalSupabaseAdmin();
  if (!supabase) {
    throw new DocumentsFilesRouteError('service role not configured', 500);
  }

  return supabase;
}

async function ensureFolderExists(sessionSupabase: DocumentsSessionClient, folderId: string) {
  const { data, error } = await sessionSupabase
    .from('documents_folders')
    .select('id')
    .eq('id', folderId)
    .maybeSingle();

  if (error) {
    throw new DocumentsFilesRouteError(error.message, 500);
  }

  if (!data) {
    throw new DocumentsFilesRouteError('folder_not_found', 404);
  }
}

async function allocateFileName(sessionSupabase: DocumentsSessionClient, folderId: string | null, originalFileName: string) {
  const safeOriginal = sanitizeUploadedFileName(originalFileName);
  const { stem, ext } = splitFileExtension(safeOriginal);

  let finalName = safeOriginal;
  for (let index = 0; index < 30; index += 1) {
    const suffix = index === 0 ? '' : `-${index}`;
    const candidate = `${stem}${suffix}${ext}`;
    const query = sessionSupabase.from('documents_files').select('id').limit(1);
    const { data: existing, error } = folderId
      ? await query.eq('folder_id', folderId).ilike('file_name', candidate)
      : await query.is('folder_id', null).ilike('file_name', candidate);

    if (error) {
      throw new DocumentsFilesRouteError(error.message, 500);
    }

    if (!existing || existing.length === 0) {
      finalName = candidate;
      break;
    }
  }

  return finalName;
}

export async function searchFiles(sessionSupabase: DocumentsSessionClient, params: { q: string; limit: number }) {
  const { q, limit } = params;
  if (!q || q.length < 2) {
    return [] as Array<FileRow & { folder_name: string | null }>;
  }

  const { data: files, error } = await sessionSupabase
    .from('documents_files')
    .select('id, folder_id, file_name, content_type, size_bytes, created_at')
    .ilike('file_name', `%${q}%`)
    .order('file_name', { ascending: true })
    .limit(limit);

  if (error) {
    throw new DocumentsFilesRouteError(error.message, 500);
  }

  const rows = (files || []) as FileRow[];
  const folderIds = Array.from(new Set(rows.map((row) => row.folder_id).filter(Boolean))) as string[];

  let folderById = new Map<string, FolderRow>();
  if (folderIds.length > 0) {
    const { data: folders, error: foldersError } = await sessionSupabase
      .from('documents_folders')
      .select('id, name, parent_id')
      .in('id', folderIds);

    if (foldersError) {
      throw new DocumentsFilesRouteError(foldersError.message, 500);
    }

    folderById = new Map(((folders || []) as FolderRow[]).map((folder) => [folder.id, folder]));
  }

  return rows.map((row) => ({
    ...row,
    folder_name: row.folder_id ? folderById.get(row.folder_id)?.name ?? null : null,
  }));
}

export async function createFileDownloadUrl(
  sessionSupabase: DocumentsSessionClient,
  params: { id: string; download: boolean },
) {
  const { id, download } = params;

  const { data, error } = await sessionSupabase
    .from('documents_files')
    .select('storage_bucket, storage_path, file_name')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    throw new DocumentsFilesRouteError(error.message, 500);
  }

  if (!data) {
    throw new DocumentsFilesRouteError('not_found', 404);
  }

  const bucket = String((data as any).storage_bucket);
  const path = String((data as any).storage_path);
  const fileName = String((data as any).file_name || 'file');

  const admin = getSupabaseAdminOrThrow();
  const { data: signed, error: signedError } = await admin.storage
    .from(bucket)
    .createSignedUrl(path, 60 * 30, download ? { download: fileName } : undefined);

  if (signedError || !signed?.signedUrl) {
    throw new DocumentsFilesRouteError(signedError?.message || 'failed_signed_url', 500);
  }

  return signed.signedUrl;
}

export async function uploadFile(
  sessionSupabase: DocumentsSessionClient,
  params: UploadFileInput & { currentUserId: string },
) {
  const { file, folderId, currentUserId } = params;
  if (folderId) {
    await ensureFolderExists(sessionSupabase, folderId);
  }

  const finalName = await allocateFileName(sessionSupabase, folderId, file.name);
  const bytes = Buffer.from(await file.arrayBuffer());
  const bucket = getDocsBucket();
  const uid = crypto.randomUUID();
  const prefix = folderId ? `Documents/${folderId}` : 'Documents/root';
  const storagePath = `${prefix}/${uid}-${finalName}`;
  const contentType = file.type || guessFileContentType(finalName);

  const admin = getSupabaseAdminOrThrow();
  const { error: uploadError } = await admin.storage.from(bucket).upload(storagePath, bytes, {
    contentType,
    upsert: false,
  });
  if (uploadError) {
    throw new DocumentsFilesRouteError(uploadError.message, 500);
  }

  const { data: inserted, error: insertError } = await sessionSupabase
    .from('documents_files')
    .insert({
      folder_id: folderId,
      file_name: finalName,
      storage_bucket: bucket,
      storage_path: storagePath,
      content_type: contentType,
      size_bytes: bytes.byteLength,
      created_by: currentUserId,
    })
    .select('id, folder_id, file_name, content_type, size_bytes, created_at')
    .single();

  if (insertError) {
    try {
      await admin.storage.from(bucket).remove([storagePath]);
    } catch {}

    throw new DocumentsFilesRouteError(insertError.message, 500);
  }

  return inserted;
}

export async function deleteFile(sessionSupabase: DocumentsSessionClient, id: string) {
  const { data, error } = await sessionSupabase
    .from('documents_files')
    .select('id, storage_bucket, storage_path, file_name')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    throw new DocumentsFilesRouteError(error.message, 500);
  }

  if (!data) {
    throw new DocumentsFilesRouteError('not_found', 404);
  }

  const fileRow = data as FileStorageRow;
  const bucket = String(fileRow.storage_bucket || '');
  const path = String(fileRow.storage_path || '');
  const admin = getSupabaseAdminOrThrow();

  try {
    await admin.storage.from(bucket).remove([path]);
  } catch {
  }

  const { error: deleteError } = await sessionSupabase.from('documents_files').delete().eq('id', id);
  if (deleteError) {
    throw new DocumentsFilesRouteError(deleteError.message, 500);
  }
}