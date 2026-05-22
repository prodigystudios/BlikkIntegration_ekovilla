import type { FolderColor } from '../_util';
import type { CreateFolderInput, RenameFolderInput } from './_lib';

type DocumentsSessionClient = {
  from: (table: string) => any;
};

export class DocumentsFoldersRouteError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function normalizeWriteError(message: string) {
  const normalized = String(message || '').toLowerCase();
  if (normalized.includes('duplicate') || normalized.includes('unique')) {
    return new DocumentsFoldersRouteError('name_exists', 409);
  }

  return new DocumentsFoldersRouteError(message, 500);
}

async function ensureParentFolder(sessionSupabase: DocumentsSessionClient, parentId: string | null) {
  if (!parentId) {
    return;
  }

  const { data, error } = await sessionSupabase
    .from('documents_folders')
    .select('id')
    .eq('id', parentId)
    .maybeSingle();

  if (error) {
    throw new DocumentsFoldersRouteError(error.message, 500);
  }

  if (!data) {
    throw new DocumentsFoldersRouteError('parent_not_found', 404);
  }
}

async function ensureFolderExists(sessionSupabase: DocumentsSessionClient, id: string) {
  const { data, error } = await sessionSupabase
    .from('documents_folders')
    .select('id')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    throw new DocumentsFoldersRouteError(error.message, 500);
  }

  if (!data) {
    throw new DocumentsFoldersRouteError('not_found', 404);
  }
}

export async function createFolder(
  sessionSupabase: DocumentsSessionClient,
  params: CreateFolderInput & { createdBy: string },
) {
  await ensureParentFolder(sessionSupabase, params.parentId);

  const { data, error } = await sessionSupabase
    .from('documents_folders')
    .insert({
      parent_id: params.parentId,
      name: params.name,
      color: params.color as FolderColor | null,
      created_by: params.createdBy,
    })
    .select('id, parent_id, name, color, created_at')
    .single();

  if (error) {
    throw normalizeWriteError(error.message);
  }

  return data;
}

export async function deleteFolder(sessionSupabase: DocumentsSessionClient, id: string) {
  const [{ data: childFolder, error: childFolderError }, { data: childFile, error: childFileError }] = await Promise.all([
    sessionSupabase.from('documents_folders').select('id').eq('parent_id', id).limit(1),
    sessionSupabase.from('documents_files').select('id').eq('folder_id', id).limit(1),
  ]);

  if (childFolderError) {
    throw new DocumentsFoldersRouteError(childFolderError.message, 500);
  }

  if (childFileError) {
    throw new DocumentsFoldersRouteError(childFileError.message, 500);
  }

  if ((childFolder && childFolder.length) || (childFile && childFile.length)) {
    throw new DocumentsFoldersRouteError('folder_not_empty', 400);
  }

  const { error } = await sessionSupabase.from('documents_folders').delete().eq('id', id);
  if (error) {
    throw new DocumentsFoldersRouteError(error.message, 500);
  }
}

export async function renameFolder(sessionSupabase: DocumentsSessionClient, input: RenameFolderInput) {
  await ensureFolderExists(sessionSupabase, input.id);

  const { data, error } = await sessionSupabase
    .from('documents_folders')
    .update({ name: input.name })
    .eq('id', input.id)
    .select('id, parent_id, name, color, created_at')
    .single();

  if (error) {
    throw normalizeWriteError(error.message);
  }

  return data;
}