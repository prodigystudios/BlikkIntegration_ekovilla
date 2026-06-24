"use client";

import { crm } from '../../lib/crmTokens';

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
    <div className="grid gap-2.5 border-b border-[#e0e8dc] bg-white p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="grid gap-0.5">
          <strong className="text-[13px] font-semibold text-slate-800">Undermappar</strong>
          <span className="text-xs text-slate-400">
            {folders.length > 0
              ? `Snabbåtkomst till ${folders.length} undermappar i ${folderLabel}.`
              : `Det finns inga undermappar i ${folderLabel} just nu.`}
          </span>
        </div>

        {effectiveCanEdit ? (
          <button type="button" onClick={onCreateFolder} disabled={disableCreate} className={crm.ghostButton}>
            + Ny undermapp
          </button>
        ) : null}
      </div>

      {folders.length > 0 ? (
        <div className="grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(180px,1fr))]">
          {folders.map((folder) => {
            const colorDot = resolveFolderColor(folder.color);

            return (
              <button
                key={folder.id}
                type="button"
                onClick={() => onOpenFolder(folder.id)}
                className="grid gap-2 rounded-xl border border-[#e3e9df] bg-[#f9fbf7] px-3 py-2.5 text-left shadow-[0_1px_2px_rgba(15,23,42,0.05)] transition hover:border-[#cfdcc9] hover:shadow-[0_8px_20px_-10px_rgba(20,44,27,0.30)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/20"
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
                  <span className="truncate text-[13px] font-bold text-slate-900">{folder.name}</span>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  <span className="inline-flex items-center rounded-full border border-[#e0e8dc] bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-500">
                    Öppna mapp
                  </span>
                  <span className="inline-flex items-center rounded-full border border-[#e0e8dc] bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-500">
                    Skapad {folder.created_at.slice(0, 10)}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-slate-200 px-3 py-3.5 text-[13px] text-slate-400">
          Inga undermappar här ännu.
        </div>
      )}
    </div>
  );
}
