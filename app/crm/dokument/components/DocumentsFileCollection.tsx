"use client";

import { cn } from '@/lib/shared/cn';
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

const actionButtonClass =
  'inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[13px] font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-50';
const chipClass =
  'inline-flex items-center rounded-full border border-[#e0e8dc] bg-[#f9fbf7] px-2 py-0.5 text-[11px] font-semibold text-slate-500';

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
      <button type="button" className={actionButtonClass} onClick={() => onPreviewFile(file)} disabled={previewLoading}>
        Förhandsgranska
      </button>
      <button type="button" className={actionButtonClass} onClick={() => onDownloadFile(file.id)}>
        Ladda ner
      </button>
      {effectiveCanEdit && (
        <button type="button" className={actionButtonClass} onClick={() => onOpenPublishStatus(file)} disabled={!!busy}>
          Status
        </button>
      )}
      {effectiveCanEdit && (
        <button type="button" className={actionButtonClass} onClick={() => onOpenPublish(file)} disabled={!!busy}>
          Publicera
        </button>
      )}
      {effectiveCanEdit && (
        <button
          type="button"
          className={cn(actionButtonClass, 'hover:border-rose-300 hover:text-rose-600')}
          onClick={() => onDeleteFile(file.id)}
          disabled={!!busy}
        >
          Ta bort
        </button>
      )}
    </div>
  );

  if (isCompactViewport) {
    return (
      <div className="grid gap-2 p-3">
        {files.map((file) => {
          const folderName = includeFolderName && 'folder_name' in file ? file.folder_name : null;
          return (
            <div key={file.id} className="grid gap-2.5 rounded-xl border border-[#e3e9df] bg-white px-3 py-2.5 shadow-[0_1px_2px_rgba(15,23,42,0.05)]">
              <div className="flex min-w-0 items-start gap-2.5">
                <span aria-hidden className="text-[18px] leading-none">📄</span>
                <div className="grid min-w-0 flex-1 gap-1.5">
                  <button
                    type="button"
                    onClick={() => onPreviewFile(file)}
                    className="truncate border-none bg-transparent p-0 text-left text-[13px] font-bold text-slate-900"
                  >
                    {file.file_name}
                  </button>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {folderName ? <span className={chipClass}>Mapp: {folderName || 'Rot'}</span> : null}
                    <span className={chipClass}>{formatBytes(file.size_bytes) || 'Okänd storlek'}</span>
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 text-xs text-slate-400">
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
        className="grid bg-[#f6f9f3] px-3 py-2 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400"
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
            className="grid items-center gap-2.5 border-t border-[#eef2ec] bg-white px-3 py-2.5 transition-colors hover:bg-[#f9fbf7]"
            style={{ gridTemplateColumns: columns }}
          >
            <div className="flex min-w-0 items-center gap-3">
              <div className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-lg border border-[#e0e8dc] bg-[#f9fbf7] text-[10px] font-bold text-slate-600">
                {extension}
              </div>
              <div className="grid min-w-0 gap-1">
                <button
                  type="button"
                  onClick={() => onPreviewFile(file)}
                  className="truncate border-none bg-transparent p-0 text-left text-[13px] font-bold text-slate-900"
                >
                  {file.file_name}
                </button>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="inline-flex items-center rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-700">{extension}</span>
                  {!includeFolderName ? <span className={chipClass}>{formatBytes(file.size_bytes) || 'Okänd storlek'}</span> : null}
                </div>
              </div>
            </div>
            {includeFolderName ? <div className="truncate text-[13px] text-slate-500">{folderName || 'Rot'}</div> : null}
            <div className="text-[13px] font-semibold text-slate-600">{formatBytes(file.size_bytes)}</div>
            <div className="text-[13px] text-slate-400">{new Date(file.created_at).toLocaleString('sv-SE')}</div>
            {renderFileActions(file)}
          </div>
        );
      })}
    </div>
  );
}
