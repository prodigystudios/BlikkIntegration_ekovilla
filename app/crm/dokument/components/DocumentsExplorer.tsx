"use client";

import { useMemo, useState, type MutableRefObject } from 'react';
import { cn } from '@/lib/shared/cn';
import Input from '../../../../components/ui/Input';
import { crm } from '../../lib/crmTokens';

type FolderRow = {
  id: string;
  parent_id: string | null;
  name: string;
  color: string | null;
  created_at: string;
};

type Breadcrumb = {
  id: string;
  name: string;
};

type CreateFolderState = {
  parentId: string | null;
  name: string;
  color: string | null;
} | null;

type DocumentsExplorerProps = {
  folderId: string;
  breadcrumbs: Breadcrumb[];
  folderLists: Record<string, FolderRow[]>;
  createFolderUi: CreateFolderState;
  effectiveCanEdit: boolean;
  busy: string | null;
  isCompactViewport: boolean;
  createFolderNameRef: MutableRefObject<HTMLInputElement | null>;
  folderColorHex: (color: string | null | undefined) => string | null;
  onOpenFolder: (id: string) => void;
  onOpenCreateFolder: (parentId: string | null) => void;
  onCloseCreateFolder: () => void;
  onSetCreateFolderName: (name: string) => void;
  onToggleCreateFolderColor: (color: string) => void;
  onSubmitCreateFolder: (parentId: string | null, name: string, color: string | null) => void;
  onRenameFolder: (id: string, parentId: string | null, currentName: string) => void;
  onDeleteFolder: (id: string, parentId: string | null) => void;
};

type ExplorerColumn = {
  key: string;
  title: string;
  parentId: string | null;
  selectedId: string | null;
};

const folderColors = [
  { key: 'gray', label: 'Grå' },
  { key: 'blue', label: 'Blå' },
  { key: 'green', label: 'Grön' },
  { key: 'yellow', label: 'Gul' },
  { key: 'red', label: 'Röd' },
  { key: 'purple', label: 'Lila' },
] as const;

const cardClass = 'rounded-2xl border border-[#e0e8dc] bg-[#f9fbf7] shadow-[0_1px_3px_rgba(20,44,27,0.06),0_18px_36px_-18px_rgba(20,44,27,0.24)]';
const iconButtonClass =
  'inline-flex h-7 items-center justify-center rounded-lg border border-slate-200 bg-white px-2 text-xs font-bold text-slate-500 transition hover:border-slate-300 hover:text-slate-800 disabled:opacity-50';

export default function DocumentsExplorer({
  folderId,
  breadcrumbs,
  folderLists,
  createFolderUi,
  effectiveCanEdit,
  busy,
  isCompactViewport,
  createFolderNameRef,
  folderColorHex,
  onOpenFolder,
  onOpenCreateFolder,
  onCloseCreateFolder,
  onSetCreateFolderName,
  onToggleCreateFolderColor,
  onSubmitCreateFolder,
  onRenameFolder,
  onDeleteFolder,
}: DocumentsExplorerProps) {
  const [hoveredFolderId, setHoveredFolderId] = useState<string | null>(null);

  const explorerColumns: ExplorerColumn[] = useMemo(() => {
    const cols: ExplorerColumn[] = [];
    const rootSelected = breadcrumbs[0]?.id || null;
    cols.push({ key: 'root', title: 'Mappar', parentId: null, selectedId: rootSelected });
    for (let index = 0; index < breadcrumbs.length; index += 1) {
      const parent = breadcrumbs[index];
      const selectedNext = breadcrumbs[index + 1]?.id || null;
      cols.push({ key: parent.id, title: parent.name, parentId: parent.id, selectedId: selectedNext });
    }
    return cols;
  }, [breadcrumbs]);

  const visibleExplorerColumns = useMemo(() => {
    return explorerColumns.filter((col, index) => {
      if (index === 0) return true;
      const hasFolders = (folderLists[col.parentId || 'root'] || []).length > 0;
      const isCreateTarget = createFolderUi?.parentId === col.parentId;
      return hasFolders || isCreateTarget;
    });
  }, [createFolderUi?.parentId, explorerColumns, folderLists]);

  function renderFolderList(parentId: string | null, selectedId: string | null) {
    const key = parentId || 'root';
    const list = folderLists[key] || [];
    const depth = parentId ? Math.min(breadcrumbs.findIndex((item) => item.id === parentId) + 1, 3) : 0;
    if (!list.length) {
      return <div className="px-2.5 py-2.5 text-[13px] text-slate-400">Inga mappar</div>;
    }

    return (
      <div className="grid gap-1.5 p-2.5">
        {list.map((folder) => {
          const active = selectedId === folder.id || (!selectedId && folderId === folder.id);
          const showActions = effectiveCanEdit && (active || hoveredFolderId === folder.id || isCompactViewport);
          const colorDot = folderColorHex(folder.color);

          return (
            <div
              key={folder.id}
              className={cn(
                'grid items-stretch gap-2',
                effectiveCanEdit ? '[grid-template-columns:minmax(0,1fr)_auto]' : 'grid-cols-1',
              )}
              onMouseEnter={() => setHoveredFolderId(folder.id)}
              onMouseLeave={() => setHoveredFolderId((prev) => (prev === folder.id ? null : prev))}
            >
              <button
                type="button"
                onClick={() => onOpenFolder(folder.id)}
                className={cn(
                  'relative flex w-full items-center justify-start gap-2 overflow-hidden rounded-xl border px-3 py-2 text-left text-slate-900 transition-colors',
                  active
                    ? 'border-emerald-200 bg-emerald-50 font-bold hover:border-emerald-300'
                    : 'border-[#e3e9df] bg-white font-semibold shadow-[0_1px_2px_rgba(15,23,42,0.04)] hover:border-[#cfdcc9] hover:bg-[#f9fbf7]',
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    'absolute inset-y-0 left-0 w-1',
                    active ? 'bg-emerald-500' : depth > 0 ? 'bg-emerald-100' : 'bg-slate-200',
                  )}
                />
                {depth > 0 ? <span aria-hidden className="h-px shrink-0 bg-slate-200" style={{ width: depth * 10 }} /> : null}
                {colorDot ? (
                  <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: colorDot }} />
                ) : (
                  <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full bg-slate-200" />
                )}
                <span aria-hidden className={cn('text-sm', active ? 'opacity-100' : 'opacity-70')}>📁</span>
                <span className="truncate text-[13px]">{folder.name}</span>
              </button>

              {effectiveCanEdit ? (
                <div
                  className={cn(
                    'flex items-center gap-1.5 justify-self-end transition-opacity',
                    showActions ? 'opacity-100' : 'pointer-events-none opacity-0',
                  )}
                  aria-hidden={!showActions}
                >
                  <button
                    type="button"
                    className={iconButtonClass}
                    onClick={() => onRenameFolder(folder.id, parentId, folder.name)}
                    disabled={!!busy}
                    title="Byt namn"
                    aria-label="Byt namn"
                  >
                    ✎
                  </button>
                  <button
                    type="button"
                    className={cn(iconButtonClass, 'hover:border-rose-300 hover:text-rose-600')}
                    onClick={() => onDeleteFolder(folder.id, parentId)}
                    disabled={!!busy}
                    title="Ta bort (mappen måste vara tom)"
                    aria-label="Ta bort"
                  >
                    🗑
                  </button>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <aside className={cn('grid gap-2.5', !isCompactViewport && 'sticky top-[84px] self-start')}>
      <div className={cn(cardClass, 'grid gap-1 px-3.5 py-3')}>
        <strong className="text-[13px] font-semibold text-slate-800">Mappnavigering</strong>
        <span className="text-xs text-slate-400">Hoppa mellan nivåer och skapa nya mappar där du står.</span>
      </div>

      {visibleExplorerColumns.map((col) => (
        <div key={col.key} className={cn(cardClass, 'w-full overflow-hidden')}>
          <div className="border-b border-[#e0e8dc] bg-[#f6f9f3] px-3 py-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="grid min-w-0 gap-0.5">
                <div className="min-w-0 truncate text-xs font-bold text-slate-600">
                  {col.title}
                </div>
                <span className="text-[11px] text-slate-400">{(folderLists[col.parentId || 'root'] || []).length} mappar</span>
              </div>

              {effectiveCanEdit ? (
                <button
                  type="button"
                  className="inline-flex h-7 items-center whitespace-nowrap rounded-lg border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-800 disabled:opacity-50"
                  onClick={() => onOpenCreateFolder(col.parentId)}
                  disabled={!!busy}
                  title="Skapa ny mapp här"
                >
                  + Ny mapp
                </button>
              ) : null}
            </div>

            {effectiveCanEdit && createFolderUi && createFolderUi.parentId === col.parentId ? (
              <div className="mt-2.5 border-t border-[#e0e8dc] pt-2.5">
                <div className="grid gap-2">
                  <Input
                    ref={createFolderNameRef}
                    value={createFolderUi.name}
                    onChange={(event) => onSetCreateFolderName(event.target.value)}
                    placeholder="Mappnamn"
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') onCloseCreateFolder();
                      if (event.key === 'Enter') {
                        onSubmitCreateFolder(createFolderUi.parentId, createFolderUi.name, createFolderUi.color);
                      }
                    }}
                    disabled={!!busy}
                  />

                  <div className="flex flex-wrap items-center gap-2">
                    {folderColors.map((color) => {
                      const hex = folderColorHex(color.key);
                      const selected = createFolderUi.color === color.key;
                      return (
                        <button
                          key={color.key}
                          type="button"
                          onClick={() => onToggleCreateFolderColor(color.key)}
                          title={color.label}
                          aria-label={color.label}
                          disabled={!!busy}
                          className={cn(
                            'h-7 w-7 rounded-full p-0 transition-colors',
                            selected ? 'border-2 border-slate-900' : 'border border-slate-200',
                          )}
                          style={{ background: hex || '#e5e7eb' }}
                        />
                      );
                    })}
                    <span className="text-xs text-slate-400">(valfritt)</span>
                  </div>

                  <div className="flex flex-wrap justify-end gap-2">
                    <button type="button" className={crm.ghostButton} onClick={onCloseCreateFolder} disabled={!!busy}>
                      Avbryt
                    </button>
                    <button
                      type="button"
                      className={crm.formButton}
                      style={{ backgroundColor: 'var(--crm-primary)' }}
                      onClick={() => onSubmitCreateFolder(createFolderUi.parentId, createFolderUi.name, createFolderUi.color)}
                      disabled={!!busy || !createFolderUi.name.trim()}
                    >
                      Skapa
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          <div className={cn(!isCompactViewport && 'max-h-[calc(100dvh-320px)] overflow-y-auto')}>
            {renderFolderList(col.parentId, col.selectedId)}
          </div>
        </div>
      ))}
    </aside>
  );
}
