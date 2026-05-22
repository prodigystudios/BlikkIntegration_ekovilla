export type FolderRow = {
  id: string;
  parent_id: string | null;
  name: string;
  color: string | null;
  created_at: string;
};

export type FileRow = {
  id: string;
  folder_id: string | null;
  file_name: string;
  content_type: string | null;
  size_bytes: number | null;
  created_at: string;
};

export type SearchFileRow = FileRow & {
  folder_name: string | null;
};

export type PublishMeta = {
  users: Array<{ id: string; name: string; role: string }>;
  tags: string[];
};

export type PublicationSummary = {
  id: string;
  title: string;
  description: string | null;
  version_label: string | null;
  due_at: string | null;
  requires_approval: boolean;
  created_at: string;
  documents_files?: { id: string; file_name: string } | null;
};

export type PublicationStatusItem = {
  userId: string;
  name: string;
  role: string;
  sourceType: 'user' | 'tag';
  sourceValue: string | null;
  assignedAt: string;
  firstOpenedAt: string | null;
  lastOpenedAt: string | null;
  approvedAt: string | null;
  approvalNote: string | null;
};

export type PublicationStatusResponse = {
  publication: PublicationSummary;
  summary: { total: number; unread: number; read: number; approved: number };
  items: PublicationStatusItem[];
};

export type PublishUiState = {
  file: FileRow;
  title: string;
  description: string;
  versionLabel: string;
  dueAt: string;
  requiresApproval: boolean;
  selectedUserIds: string[];
  selectedTags: string[];
};

export type PublishStatusUiState = {
  file: FileRow;
  publications: PublicationSummary[];
  selectedPublicationId: string | null;
  status: PublicationStatusResponse | null;
  loadingPublications: boolean;
  loadingStatus: boolean;
  error: string | null;
};

export type ListResponse =
  | {
      ok: true;
      canEdit: boolean;
      folder: { id: string; parent_id: string | null; name: string; color?: string | null } | null;
      breadcrumbs: Array<{ id: string; name: string }>;
      folders: FolderRow[];
      files: FileRow[];
    }
  | { ok: false; error: string };