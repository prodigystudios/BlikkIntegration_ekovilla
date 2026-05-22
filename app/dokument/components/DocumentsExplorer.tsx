"use client";

import React, { useMemo, useState } from 'react';
import Button from '../../../components/ui/Button';

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
  createFolderNameRef: React.MutableRefObject<HTMLInputElement | null>;
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
      return <div style={{ padding: 10, color: '#6b7280', fontSize: 13 }}>Inga mappar</div>;
    }

    return (
      <div style={{ padding: 10, display: 'grid', gap: 8 }}>
        {list.map((folder) => {
          const active = selectedId === folder.id || (!selectedId && folderId === folder.id);
          const showActions = effectiveCanEdit && (active || hoveredFolderId === folder.id || isCompactViewport);
          const colorDot = folderColorHex(folder.color);

          return (
            <div
              key={folder.id}
              style={{
                display: 'grid',
                gridTemplateColumns: effectiveCanEdit ? 'minmax(0, 1fr) auto' : 'minmax(0, 1fr)',
                gap: 8,
                alignItems: 'stretch',
              }}
              onMouseEnter={() => setHoveredFolderId(folder.id)}
              onMouseLeave={() => setHoveredFolderId((prev) => (prev === folder.id ? null : prev))}
            >
              <button
                type="button"
                onClick={() => onOpenFolder(folder.id)}
                style={{
                  width: '100%',
                  border: `1px solid ${active ? '#bfdbfe' : '#e2e8f0'}`,
                  background: active ? 'linear-gradient(135deg,#eef4ff,#e0ecff)' : '#fff',
                  borderRadius: 12,
                  padding: '10px 12px',
                  cursor: 'pointer',
                  textAlign: 'left',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'flex-start',
                  gap: 8,
                  color: '#111827',
                  fontWeight: active ? 800 : 600,
                  position: 'relative',
                  boxShadow: active ? '0 8px 18px rgba(59,130,246,0.10)' : '0 2px 6px rgba(15,23,42,0.02)',
                }}
              >
                <span aria-hidden style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, borderTopLeftRadius: 12, borderBottomLeftRadius: 12, background: active ? '#3b82f6' : depth > 0 ? '#dbeafe' : '#e5e7eb' }} />
                {depth > 0 ? <span aria-hidden style={{ width: depth * 10, height: 1, background: '#dbe4ef', flex: '0 0 auto' }} /> : null}
                {colorDot ? (
                  <span aria-hidden style={{ width: 10, height: 10, borderRadius: 999, background: colorDot, flex: '0 0 auto' }} />
                ) : (
                  <span aria-hidden style={{ width: 10, height: 10, borderRadius: 999, background: '#e5e7eb', flex: '0 0 auto' }} />
                )}
                <span aria-hidden style={{ fontSize: 14, opacity: active ? 1 : 0.72 }}>📁</span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13 }}>{folder.name}</span>
              </button>

              {effectiveCanEdit ? (
                <div
                  style={{
                    display: 'flex',
                    gap: 6,
                    alignItems: 'center',
                    justifySelf: 'end',
                    opacity: showActions ? 1 : 0,
                    pointerEvents: showActions ? 'auto' : 'none',
                  }}
                  aria-hidden={!showActions}
                >
                  <Button
                    size="sm"
                    variant="secondary"
                    className="min-h-0 rounded-[10px] px-[7px] py-[5px] text-xs font-extrabold"
                    onClick={() => onRenameFolder(folder.id, parentId, folder.name)}
                    disabled={!!busy}
                    title="Byt namn"
                    aria-label="Byt namn"
                  >
                    ✎
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    className="min-h-0 rounded-[10px] px-[7px] py-[5px] text-xs font-extrabold text-red-800"
                    onClick={() => onDeleteFolder(folder.id, parentId)}
                    disabled={!!busy}
                    title="Ta bort (mappen måste vara tom)"
                    aria-label="Ta bort"
                  >
                    🗑
                  </Button>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <aside
      style={{
        display: 'grid',
        gap: 10,
        position: isCompactViewport ? 'static' : 'sticky',
        top: isCompactViewport ? undefined : 84,
      }}
    >
      <div style={{ padding: '12px 14px', border: '1px solid #dbe4ef', borderRadius: 16, background: '#fff', boxShadow: '0 10px 24px rgba(15,23,42,0.04)', display: 'grid', gap: 4 }}>
        <strong style={{ fontSize: 13, color: '#0f172a' }}>Mappnavigering</strong>
        <span style={{ fontSize: 12, color: '#64748b' }}>Hoppa mellan nivåer och skapa nya mappar där du står.</span>
      </div>

      {visibleExplorerColumns.map((col) => (
        <div
          key={col.key}
          style={{
            width: '100%',
            border: '1px solid #dbe4ef',
            borderRadius: 16,
            overflow: 'hidden',
            background: '#fff',
            boxShadow: '0 10px 24px rgba(15,23,42,0.04)',
          }}
        >
          <div style={{ padding: '11px 12px', borderBottom: '1px solid #e5e7eb', background: 'linear-gradient(180deg,#fbfdff,#f8fafc)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <div style={{ display: 'grid', gap: 2, minWidth: 0 }}>
                <div style={{ flex: '1 1 auto', minWidth: 0, fontSize: 12, color: '#6b7280', fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {col.title}
                </div>
                <span style={{ fontSize: 11, color: '#94a3b8' }}>{(folderLists[col.parentId || 'root'] || []).length} mappar</span>
              </div>

              {effectiveCanEdit ? (
                <Button
                  size="sm"
                  variant="secondary"
                  className="rounded-[10px] px-2 py-1 text-xs whitespace-nowrap"
                  onClick={() => onOpenCreateFolder(col.parentId)}
                  disabled={!!busy}
                  title="Skapa ny mapp här"
                >
                  + Ny mapp
                </Button>
              ) : null}
            </div>

            {effectiveCanEdit && createFolderUi && createFolderUi.parentId === col.parentId ? (
              <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid #e5e7eb' }}>
                <div style={{ display: 'grid', gap: 8 }}>
                  <input
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
                    style={{
                      padding: '10px 12px',
                      borderRadius: 10,
                      border: '1px solid #e5e7eb',
                      background: '#fff',
                      fontSize: 14,
                    }}
                    disabled={!!busy}
                  />

                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
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
                          style={{
                            width: 28,
                            height: 28,
                            borderRadius: 999,
                            border: selected ? '2px solid #111827' : '1px solid #e5e7eb',
                            background: hex || '#e5e7eb',
                            cursor: 'pointer',
                            padding: 0,
                          }}
                        />
                      );
                    })}
                    <span style={{ color: '#6b7280', fontSize: 12 }}>(valfritt)</span>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
                    <Button variant="secondary" onClick={onCloseCreateFolder} disabled={!!busy}>
                      Avbryt
                    </Button>
                    <Button
                      variant="primary"
                      onClick={() => onSubmitCreateFolder(createFolderUi.parentId, createFolderUi.name, createFolderUi.color)}
                      disabled={!!busy || !createFolderUi.name.trim()}
                    >
                      Skapa
                    </Button>
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          <div style={{ maxHeight: isCompactViewport ? 'none' : 'calc(100dvh - 320px)', overflowY: 'auto' }}>
            {renderFolderList(col.parentId, col.selectedId)}
          </div>
        </div>
      ))}
    </aside>
  );
}