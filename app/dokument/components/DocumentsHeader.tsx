"use client";

import React from 'react';
import Button from '../../../components/ui/Button';
import SectionCard from '../../../components/ui/SectionCard';

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

function metaChip(label: string) {
  return (
    <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600">
      {label}
    </span>
  );
}

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
    <SectionCard className="grid gap-3 bg-[linear-gradient(180deg,#ffffff_0%,#f7fbff_100%)] p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="grid max-w-[760px] gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center rounded-full border border-blue-200 bg-blue-100 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.25em] text-blue-700">
              Dokumentcenter
            </span>
            <span className="text-xs text-ui-text-soft">
              {currentFolderName ? `Aktiv mapp: ${currentFolderName}` : 'Rotnivå'}
            </span>
          </div>
          <div className="text-[28px] font-extrabold leading-none text-ui-text-strong sm:text-[32px]">Dokument</div>
          <p className="max-w-[760px] text-sm leading-6 text-ui-text-muted">
            Navigera mappar, undermappar och filer i en tydligare arbetsyta. Pa mobil kan mappanelen doljas sa att fillistan far mer utrymme.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {isCompactViewport ? (
            <Button size="sm" onClick={onToggleExplorer}>
              {showExplorerOnMobile ? 'Dolj mappar' : 'Visa mappar'}
            </Button>
          ) : null}

          {effectiveCanEdit ? (
            <>
              <Button
                variant="primary"
                size={isCompactViewport ? 'sm' : 'md'}
                disabled={!!busy}
                onClick={() => fileInputRef.current?.click()}
              >
                {busy === 'upload' && uploadProgress
                  ? `Laddar upp (${uploadProgress.current}/${uploadProgress.total})...`
                  : 'Ladda upp'}
              </Button>
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
        <Button variant={breadcrumbs.length ? 'secondary' : 'accent'} size="sm" onClick={onGoRoot} disabled={loading}>
          Dokument
        </Button>
        {breadcrumbs.length === 0 ? <span className="text-xs text-ui-text-soft">Rot</span> : null}
        {breadcrumbs.map((breadcrumb) => (
          <React.Fragment key={breadcrumb.id}>
            <span className="text-sm font-bold text-slate-300">/</span>
            <Button size="sm" onClick={() => onOpenFolder(breadcrumb.id)} disabled={loading}>
              {breadcrumb.name}
            </Button>
          </React.Fragment>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        {metaChip(`${folderCount} mappar i nivan`)}
        {metaChip(`${fileCount} filer i vyn`)}
        {metaChip(fileSearchMode === 'all' ? 'Sokning i alla mappar' : 'Sokning i aktuell mapp')}
      </div>
    </SectionCard>
  );
}