type DocumentsSessionClient = {
  from: (table: string) => any;
};

type FolderRow = {
  id: string;
  parent_id: string | null;
  name: string;
  color: string | null;
  created_at: string;
};

type FileRow = {
  id: string;
  folder_id: string | null;
  file_name: string;
  content_type: string | null;
  size_bytes: number | null;
  created_at: string;
};

type FolderSummary = Pick<FolderRow, 'id' | 'parent_id' | 'name' | 'color'>;

export class DocumentsListRouteError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function loadFolder(sessionSupabase: DocumentsSessionClient, folderId: string) {
  const { data, error } = await sessionSupabase
    .from('documents_folders')
    .select('id, parent_id, name, color')
    .eq('id', folderId)
    .maybeSingle();

  if (error) {
    throw new DocumentsListRouteError(error.message, 500);
  }

  if (!data) {
    throw new DocumentsListRouteError('folder_not_found', 404);
  }

  return data as FolderSummary;
}

async function buildBreadcrumbs(sessionSupabase: DocumentsSessionClient, folder: FolderSummary | null) {
  const breadcrumbs: Array<{ id: string; name: string }> = [];

  if (!folder) {
    return breadcrumbs;
  }

  let current: FolderSummary | null = folder;
  let guard = 0;

  while (current && guard++ < 30) {
    breadcrumbs.push({ id: current.id, name: current.name });
    if (!current.parent_id) {
      break;
    }

    const parentFolderResult: { data: FolderSummary | null; error: { message: string } | null } = await sessionSupabase
      .from('documents_folders')
      .select('id, parent_id, name, color')
      .eq('id', current.parent_id)
      .maybeSingle();
    const { data: parentFolder, error } = parentFolderResult;

    if (error) {
      throw new DocumentsListRouteError(error.message, 500);
    }

    current = (parentFolder as FolderSummary | null) || null;
  }

  breadcrumbs.reverse();
  return breadcrumbs;
}

export async function getDocumentsListData(sessionSupabase: DocumentsSessionClient, params: { folderId: string | null; canEdit: boolean }) {
  const { folderId, canEdit } = params;
  const folder = folderId ? await loadFolder(sessionSupabase, folderId) : null;

  const folderQuery = sessionSupabase
    .from('documents_folders')
    .select('id, parent_id, name, color, created_at')
    .order('name', { ascending: true });
  const filesQuery = sessionSupabase
    .from('documents_files')
    .select('id, folder_id, file_name, content_type, size_bytes, created_at')
    .order('file_name', { ascending: true });

  const [{ data: folders, error: foldersError }, { data: files, error: filesError }, breadcrumbs] = await Promise.all([
    folderId ? folderQuery.eq('parent_id', folderId) : folderQuery.is('parent_id', null),
    folderId ? filesQuery.eq('folder_id', folderId) : filesQuery.is('folder_id', null),
    buildBreadcrumbs(sessionSupabase, folder),
  ]);

  if (foldersError) {
    throw new DocumentsListRouteError(foldersError.message, 500);
  }

  if (filesError) {
    throw new DocumentsListRouteError(filesError.message, 500);
  }

  return {
    canEdit,
    folder,
    breadcrumbs,
    folders: (folders || []) as FolderRow[],
    files: (files || []) as FileRow[],
  };
}