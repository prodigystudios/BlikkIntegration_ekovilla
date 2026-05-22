"use client";

import Badge from '../../../components/ui/Badge';
import Button from '../../../components/ui/Button';
import type { FileRow, SearchFileRow } from '../types';

type DocumentsFileCollectionProps = {
  files: Array<FileRow | SearchFileRow>;
  includeFolderName: boolean;
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

export default function DocumentsFileCollection({
  files,
  includeFolderName,
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
}: DocumentsFileCollectionProps) {
  const renderFileActions = (file: FileRow | SearchFileRow) => (
    <div className={isCompactViewport ? 'flex flex-wrap gap-2 justify-stretch' : 'flex flex-wrap justify-end gap-2'}>
      <Button size={isCompactViewport ? 'sm' : 'md'} variant="secondary" onClick={() => onPreviewFile(file)} disabled={previewLoading}>
        Förhandsgranska
      </Button>
      <Button size={isCompactViewport ? 'sm' : 'md'} variant="secondary" onClick={() => onDownloadFile(file.id)}>
        Ladda ner
      </Button>
      {effectiveCanEdit && (
        <Button size={isCompactViewport ? 'sm' : 'md'} variant="secondary" onClick={() => onOpenPublishStatus(file)} disabled={!!busy}>
          Status
        </Button>
      )}
      {effectiveCanEdit && (
        <Button size={isCompactViewport ? 'sm' : 'md'} variant="secondary" onClick={() => onOpenPublish(file)} disabled={!!busy}>
          Publicera
        </Button>
      )}
      {effectiveCanEdit && (
        <Button
          size={isCompactViewport ? 'sm' : 'md'}
          variant="secondary"
          className="text-red-800"
          onClick={() => onDeleteFile(file.id)}
          disabled={!!busy}
        >
          Ta bort
        </Button>
      )}
    </div>
  );

  if (isCompactViewport) {
    return (
      <div className="grid gap-2.5 p-3">
        {files.map((file) => {
          const folderName = includeFolderName && 'folder_name' in file ? file.folder_name : null;
          return (
            <div key={file.id} className="grid gap-2.5 rounded-[14px] border border-slate-200 bg-white px-3 py-[10px] shadow-[0_6px_18px_rgba(15,23,42,0.04)]">
              <div className="flex min-w-0 items-start gap-2.5">
                <span aria-hidden className="text-[18px] leading-none">📄</span>
                <div className="grid min-w-0 flex-1 gap-1.5">
                  <button
                    type="button"
                    onClick={() => onPreviewFile(file)}
                    className="truncate border-none bg-transparent p-0 text-left text-sm font-extrabold text-slate-900"
                  >
                    {file.file_name}
                  </button>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {folderName ? <Badge>Mapp: {folderName || 'Rot'}</Badge> : null}
                    <Badge>{formatBytes(file.size_bytes) || 'Okänd storlek'}</Badge>
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 text-xs text-ui-text-soft">
                <span>Skapad {new Date(file.created_at).toLocaleString('sv-SE')}</span>
              </div>
              <div className="grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(132px,1fr))]">
                {renderFileActions(file)}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  const columns = includeFolderName
    ? (effectiveCanEdit ? '1fr 220px 120px 160px 340px' : '1fr 220px 120px 160px 240px')
    : (effectiveCanEdit ? '1fr 120px 160px 340px' : '1fr 120px 160px 240px');

  return (
    <div>
      <div
        className="grid bg-[linear-gradient(180deg,#ffffff,#f8fafc)] px-3 py-2 text-[11px] font-extrabold uppercase tracking-[0.3px] text-ui-text-soft"
        style={{ gridTemplateColumns: columns }}
      >
        <div>Dokument</div>
        {includeFolderName ? <div>Plats</div> : null}
        <div>Storlek</div>
        <div>Skapad</div>
        <div>Åtgärder</div>
      </div>
      {files.map((file) => {
        const folderName = includeFolderName && 'folder_name' in file ? file.folder_name : null;
        const extension = file.file_name.split('.').pop()?.toUpperCase() || 'FIL';
        return (
          <div
            key={file.id}
            className="grid items-center gap-2.5 border-t border-slate-100 bg-white px-3 py-3"
            style={{ gridTemplateColumns: columns }}
          >
            <div className="flex min-w-0 items-center gap-3">
              <div className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-[10px] border border-ui-border bg-[linear-gradient(180deg,#ffffff,#f8fafc)] text-[10px] font-extrabold text-slate-700">
                {extension}
              </div>
              <div className="grid min-w-0 gap-1">
                <button
                  type="button"
                  onClick={() => onPreviewFile(file)}
                  className="truncate border-none bg-transparent p-0 text-left text-[13px] font-extrabold text-slate-900"
                >
                  {file.file_name}
                </button>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant="info">{extension}</Badge>
                  {!includeFolderName ? <Badge>{formatBytes(file.size_bytes) || 'Okänd storlek'}</Badge> : null}
                </div>
              </div>
            </div>
            {includeFolderName ? <div className="truncate text-[13px] text-ui-text-soft">{folderName || 'Rot'}</div> : null}
            <div className="text-[13px] font-semibold text-slate-600">{formatBytes(file.size_bytes)}</div>
            <div className="text-[13px] text-ui-text-soft">{new Date(file.created_at).toLocaleString('sv-SE')}</div>
            {renderFileActions(file)}
          </div>
        );
      })}
    </div>
  );
}