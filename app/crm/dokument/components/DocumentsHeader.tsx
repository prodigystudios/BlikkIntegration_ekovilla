"use client";

import React from 'react';
import { cn } from '@/lib/shared/cn';
import { crm } from '../../lib/crmTokens';

type DocumentsHeaderProps = {
  breadcrumbs: Array<{ id: string; name: string }>;
  currentFolderName: string | null;
  isCompactViewport: boolean;
  showExplorerOnMobile: boolean;
  effectiveCanEdit: boolean;
  loading: boolean;
  busy: string | null;
  uploadProgress: { current: number; total: number } | null;
  fileSearchMode: 'folder' | 'all';
  folderCount: number;
  fileCount: number;
  fileInputRef: React.RefObject<HTMLInputElement>;
  onUploadFiles: (files: FileList | null) => void;
  onToggleExplorer: () => void;
  onGoRoot: () => void;
  onOpenFolder: (id: string) => void;
};

const metaChipClass =
  'inline-flex items-center rounded-full border border-[#e0e8dc] bg-[#f9fbf7] px-2.5 py-0.5 text-[11px] font-semibold text-slate-500';

const crumbChipClass =
  'inline-flex items-center rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[13px] font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-800 disabled:opacity-50';

export default function DocumentsHeader({
  breadcrumbs,
  currentFolderName,
  isCompactViewport,
  showExplorerOnMobile,
  effectiveCanEdit,
  loading,
  busy,
  uploadProgress,
  fileSearchMode,
  folderCount,
  fileCount,
  fileInputRef,
  onUploadFiles,
  onToggleExplorer,
  onGoRoot,
  onOpenFolder,
}: DocumentsHeaderProps) {
  return (
    <div className="grid grid-cols-1 gap-3">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="m-0 text-lg font-bold tracking-tight text-slate-900">Dokument</h1>
          <p className="m-0 mt-1 text-sm text-slate-500">
            Bibliotek för mappar, filer och publicering
            {currentFolderName ? (
              <span className="ml-2 rounded-full border border-[#e0e8dc] bg-[#f9fbf7] px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                {currentFolderName}
              </span>
            ) : null}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {isCompactViewport ? (
            <button type="button" onClick={onToggleExplorer} className={crm.ghostButton}>
              {showExplorerOnMobile ? 'Dölj mappar' : 'Visa mappar'}
            </button>
          ) : null}

          {effectiveCanEdit ? (
            <>
              <button
                type="button"
                disabled={!!busy}
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                style={{ backgroundColor: 'var(--crm-primary)' }}
              >
                {busy === 'upload' && uploadProgress
                  ? `Laddar upp (${uploadProgress.current}/${uploadProgress.total})…`
                  : '+ Ladda upp'}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                onChange={(event) => onUploadFiles(event.target.files)}
                disabled={!!busy}
                className="hidden"
              />
            </>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={onGoRoot}
            disabled={loading}
            className={cn(crumbChipClass, breadcrumbs.length === 0 && 'border-emerald-200 bg-emerald-50 text-emerald-700')}
          >
            Dokument
          </button>
          {breadcrumbs.map((breadcrumb) => (
            <React.Fragment key={breadcrumb.id}>
              <span className="text-sm font-bold text-slate-300">/</span>
              <button type="button" onClick={() => onOpenFolder(breadcrumb.id)} disabled={loading} className={crumbChipClass}>
                {breadcrumb.name}
              </button>
            </React.Fragment>
          ))}
        </div>

        <div className="flex flex-wrap gap-1.5 sm:ml-auto">
          <span className={metaChipClass}>{folderCount} mappar</span>
          <span className={metaChipClass}>{fileCount} filer</span>
          <span className={metaChipClass}>{fileSearchMode === 'all' ? 'Söker i alla mappar' : 'Söker i aktuell mapp'}</span>
        </div>
      </div>
    </div>
  );
}
