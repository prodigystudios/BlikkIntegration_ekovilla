"use client";

import DocumentsFileCollection from './DocumentsFileCollection';

type FileRow = {
  id: string;
  folder_id: string | null;
  file_name: string;
  content_type: string | null;
  size_bytes: number | null;
  created_at: string;
};

type SearchFileRow = FileRow & {
  folder_name: string | null;
};

type DocumentsResultsPanelProps = {
  fileSearchMode: 'folder' | 'all';
  fileSearch: string;
  globalSearchLoading: boolean;
  globalSearchError: string | null;
  globalSearchResults: SearchFileRow[] | null;
  folderFiles: FileRow[];
  filteredFiles: FileRow[];
  isCompactViewport: boolean;
  effectiveCanEdit: boolean;
  previewLoading: boolean;
  busy: string | null;
  formatBytes: (value?: number | null) => string;
  onPreviewFile: (file: FileRow | SearchFileRow) => void;
  onDownloadFile: (id: string) => void;
  onOpenPublishStatus: (file: FileRow | SearchFileRow) => void;
  onOpenPublish: (file: FileRow | SearchFileRow) => void;
  onDeleteFile: (id: string) => void;
};

function StatusMessage({ children, tone = 'muted' }: { children: React.ReactNode; tone?: 'muted' | 'danger' }) {
  return <div className={tone === 'danger' ? 'p-3.5 text-red-700' : 'p-3.5 text-ui-text-soft'}>{children}</div>;
}

export default function DocumentsResultsPanel({
  fileSearchMode,
  fileSearch,
  globalSearchLoading,
  globalSearchError,
  globalSearchResults,
  folderFiles,
  filteredFiles,
  isCompactViewport,
  effectiveCanEdit,
  previewLoading,
  busy,
  formatBytes,
  onPreviewFile,
  onDownloadFile,
  onOpenPublishStatus,
  onOpenPublish,
  onDeleteFile,
}: DocumentsResultsPanelProps) {
  const trimmedSearch = String(fileSearch || '').trim();

  if (fileSearchMode === 'all') {
    if (globalSearchError) {
      return <StatusMessage tone="danger">{globalSearchError}</StatusMessage>;
    }

    if (globalSearchLoading) {
      return <StatusMessage>Söker…</StatusMessage>;
    }

    if (trimmedSearch.length < 2) {
      return <StatusMessage>Skriv minst 2 tecken för att söka.</StatusMessage>;
    }

    if (!globalSearchResults || globalSearchResults.length === 0) {
      return <StatusMessage>Inga träffar.</StatusMessage>;
    }

    return (
      <DocumentsFileCollection
        files={globalSearchResults}
        includeFolderName={true}
        isCompactViewport={isCompactViewport}
        effectiveCanEdit={effectiveCanEdit}
        previewLoading={previewLoading}
        busy={busy}
        formatBytes={formatBytes}
        onPreviewFile={onPreviewFile}
        onDownloadFile={onDownloadFile}
        onOpenPublishStatus={onOpenPublishStatus}
        onOpenPublish={onOpenPublish}
        onDeleteFile={onDeleteFile}
      />
    );
  }

  if (folderFiles.length === 0) {
    return <StatusMessage>Inga filer här ännu.</StatusMessage>;
  }

  if (filteredFiles.length === 0) {
    return <StatusMessage>Inga träffar.</StatusMessage>;
  }

  return (
    <DocumentsFileCollection
      files={filteredFiles}
      includeFolderName={false}
      isCompactViewport={isCompactViewport}
      effectiveCanEdit={effectiveCanEdit}
      previewLoading={previewLoading}
      busy={busy}
      formatBytes={formatBytes}
      onPreviewFile={onPreviewFile}
      onDownloadFile={onDownloadFile}
      onOpenPublishStatus={onOpenPublishStatus}
      onOpenPublish={onOpenPublish}
      onDeleteFile={onDeleteFile}
    />
  );
}