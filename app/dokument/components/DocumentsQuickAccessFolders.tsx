"use client";

import Button from '../../../components/ui/Button';

type QuickAccessFolder = {
  id: string;
  name: string;
  color: string | null;
  created_at: string;
};

type DocumentsQuickAccessFoldersProps = {
  folders: QuickAccessFolder[];
  currentFolderName: string | null;
  effectiveCanEdit: boolean;
  isCompactViewport: boolean;
  disableCreate: boolean;
  onCreateFolder: () => void;
  onOpenFolder: (folderId: string) => void;
  resolveFolderColor: (color: string | null | undefined) => string | null;
};

export default function DocumentsQuickAccessFolders({
  folders,
  currentFolderName,
  effectiveCanEdit,
  isCompactViewport,
  disableCreate,
  onCreateFolder,
  onOpenFolder,
  resolveFolderColor,
}: DocumentsQuickAccessFoldersProps) {
  const folderLabel = currentFolderName || 'Rot';

  return (
    <div
      className="grid gap-2.5 border-b border-slate-100 bg-white"
      style={{ padding: isCompactViewport ? '12px' : '14px' }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="grid gap-0.5">
          <strong className="text-[13px] text-slate-900">Undermappar</strong>
          <span className="text-xs text-slate-500">
            {folders.length > 0
              ? `Snabbåtkomst till ${folders.length} undermappar i ${folderLabel}.`
              : `Det finns inga undermappar i ${folderLabel} just nu.`}
          </span>
        </div>

        {effectiveCanEdit ? (
          <Button size={isCompactViewport ? 'sm' : 'md'} variant="secondary" onClick={onCreateFolder} disabled={disableCreate}>
            + Ny undermapp
          </Button>
        ) : null}
      </div>

      {folders.length > 0 ? (
        <div className="grid gap-2.5 [grid-template-columns:repeat(auto-fit,minmax(180px,1fr))]">
          {folders.map((folder) => {
            const colorDot = resolveFolderColor(folder.color);

            return (
              <button
                key={folder.id}
                type="button"
                onClick={() => onOpenFolder(folder.id)}
                className="grid gap-2 rounded-[14px] border border-ui-border bg-[linear-gradient(180deg,#ffffff_0%,#f8fbff_100%)] px-3 py-[11px] text-left shadow-[0_6px_18px_rgba(15,23,42,0.04)] transition-colors hover:bg-ui-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ui-accent/20"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    aria-hidden
                    className="h-2.5 w-2.5 shrink-0 rounded-full bg-slate-300"
                    style={colorDot ? { background: colorDot } : undefined}
                  />
                  <span aria-hidden className="text-[15px]">
                    📁
                  </span>
                  <span className="truncate text-[13px] font-extrabold text-slate-900">{folder.name}</span>
                </div>

                <div className="flex flex-wrap gap-2">
                  <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-bold text-slate-600">
                    Öppna mapp
                  </span>
                  <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-bold text-slate-600">
                    Skapad {folder.created_at.slice(0, 10)}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="rounded-[14px] border border-dashed border-slate-300 bg-slate-50 px-3 py-3.5 text-[13px] text-slate-500">
          Inga undermappar här ännu.
        </div>
      )}
    </div>
  );
}