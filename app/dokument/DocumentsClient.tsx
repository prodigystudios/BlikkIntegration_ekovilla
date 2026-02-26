"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useToast } from '../../lib/Toast';

type FolderRow = { id: string; parent_id: string | null; name: string; color: string | null; created_at: string };
type FileRow = { id: string; folder_id: string | null; file_name: string; content_type: string | null; size_bytes: number | null; created_at: string };
type SearchFileRow = FileRow & { folder_name: string | null };

type ListResponse = {
  ok: true;
  canEdit: boolean;
  folder: { id: string; parent_id: string | null; name: string; color?: string | null } | null;
  breadcrumbs: Array<{ id: string; name: string }>;
  folders: FolderRow[];
  files: FileRow[];
} | { ok: false; error: string };

function formatBytes(n?: number | null) {
  if (!n || !Number.isFinite(n)) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export default function DocumentsClient({ canEdit }: { canEdit: boolean }) {
  const toast = useToast();
  const router = useRouter();
  const sp = useSearchParams();
  const folderId = (sp.get('folderId') || '').trim();

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<Extract<ListResponse, { ok: true }> | null>(null);
  const [folderLists, setFolderLists] = useState<Record<string, FolderRow[]>>({});
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number } | null>(null);
  const [preview, setPreview] = useState<{ id: string; url: string; fileName: string; contentType: string | null } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [hoveredFolderId, setHoveredFolderId] = useState<string | null>(null);
  const [createFolderUi, setCreateFolderUi] = useState<{ parentId: string | null; name: string; color: string | null } | null>(null);
  const [fileSearch, setFileSearch] = useState('');
  const [fileSearchMode, setFileSearchMode] = useState<'folder' | 'all'>('folder');
  const [globalSearchLoading, setGlobalSearchLoading] = useState(false);
  const [globalSearchError, setGlobalSearchError] = useState<string | null>(null);
  const [globalSearchResults, setGlobalSearchResults] = useState<SearchFileRow[] | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const createFolderNameRef = useRef<HTMLInputElement | null>(null);

  const effectiveCanEdit = canEdit && (data?.canEdit ?? true);
  const showInitialLoading = loading && !data;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = folderId ? `?folderId=${encodeURIComponent(folderId)}` : '';
      const res = await fetch(`/api/documents/list${qs}`, { cache: 'no-store' });
      const json = (await res.json()) as ListResponse;
      if (!res.ok || !json || (json as any).ok === false) throw new Error((json as any).error || 'Failed to load');
      setData(json as any);
    } catch (e: any) {
      setError(e?.message || 'Kunde inte ladda dokument');
    } finally {
      setLoading(false);
    }
  }, [folderId]);

  useEffect(() => {
    load();
  }, [load]);

  // Clear preview on navigation between folders
  useEffect(() => {
    setPreview(null);
    setPreviewError(null);
    setPreviewLoading(false);
  }, [folderId]);

  // Reset file search when navigating between folders
  useEffect(() => {
    setFileSearch('');
  }, [folderId]);

  const breadcrumbs = useMemo(() => data?.breadcrumbs || [], [data]);

  const filteredFiles = useMemo(() => {
    const files = data?.files || [];
    const q = String(fileSearch || '').trim().toLocaleLowerCase('sv-SE');
    if (!q) return files;
    return files.filter(f => String(f.file_name || '').toLocaleLowerCase('sv-SE').includes(q));
  }, [data?.files, fileSearch]);

  // Global search (across all folders)
  useEffect(() => {
    if (fileSearchMode !== 'all') {
      setGlobalSearchLoading(false);
      setGlobalSearchError(null);
      setGlobalSearchResults(null);
      return;
    }

    const q = String(fileSearch || '').trim();
    if (!q || q.length < 2) {
      setGlobalSearchLoading(false);
      setGlobalSearchError(null);
      setGlobalSearchResults([]);
      return;
    }

    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        setGlobalSearchLoading(true);
        setGlobalSearchError(null);
        const res = await fetch(`/api/documents/files/search?q=${encodeURIComponent(q)}&limit=80`, { cache: 'no-store' });
        const j = await res.json();
        if (!res.ok || !j?.ok) throw new Error(j?.error || 'Kunde inte söka');
        if (!cancelled) setGlobalSearchResults((j.results || []) as SearchFileRow[]);
      } catch (e: any) {
        if (!cancelled) {
          setGlobalSearchError(e?.message || 'Kunde inte söka');
          setGlobalSearchResults(null);
        }
      } finally {
        if (!cancelled) setGlobalSearchLoading(false);
      }
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [fileSearch, fileSearchMode]);

  const loadFolderChildren = useCallback(async (parentId: string | null) => {
    const key = parentId || 'root';
    try {
      const qs = parentId ? `?folderId=${encodeURIComponent(parentId)}` : '';
      const res = await fetch(`/api/documents/list${qs}`, { cache: 'no-store' });
      const json = (await res.json()) as ListResponse;
      if (!res.ok || !json || (json as any).ok === false) return;
      const ok = json as Extract<ListResponse, { ok: true }>;
      setFolderLists(prev => ({ ...prev, [key]: ok.folders || [] }));
    } catch {
      // ignore
    }
  }, []);

  // Keep sidebar folder columns hydrated for each breadcrumb level
  useEffect(() => {
    if (loading) return;
    const parentIds: Array<string | null> = [null, ...breadcrumbs.map(b => b.id)];
    parentIds.forEach(pid => {
      const key = pid || 'root';
      if (folderLists[key]) return;
      loadFolderChildren(pid);
    });
  }, [breadcrumbs, loading, folderLists, loadFolderChildren]);

  const goRoot = () => router.push('/dokument', { scroll: false });
  const openFolder = (id: string) => router.push(`/dokument?folderId=${encodeURIComponent(id)}`, { scroll: false });

  const folderColorHex = useCallback((color: string | null | undefined) => {
    switch (String(color || '').toLowerCase()) {
      case 'blue':
        return '#3b82f6';
      case 'green':
        return '#22c55e';
      case 'yellow':
        return '#eab308';
      case 'red':
        return '#ef4444';
      case 'purple':
        return '#a855f7';
      case 'gray':
        return '#9ca3af';
      default:
        return null;
    }
  }, []);

  const openCreateFolder = useCallback((parentId: string | null) => {
    setCreateFolderUi({ parentId, name: '', color: null });
    // focus after render
    setTimeout(() => createFolderNameRef.current?.focus(), 0);
  }, []);

  const closeCreateFolder = useCallback(() => {
    setCreateFolderUi(null);
  }, []);

  const submitCreateFolder = async (parentId: string | null, name: string, color: string | null) => {
    if (!effectiveCanEdit) return;
    const trimmed = String(name || '').trim();
    if (!trimmed) return;
    setBusy('folder');
    try {
      const res = await fetch('/api/documents/folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parentId, name: trimmed, color: color || null }),
      });
      const j = await res.json();
      if (!res.ok || !j?.ok) {
        const msg = j?.error === 'name_exists' ? 'Det finns redan en mapp med det namnet.' : (j?.error || 'Kunde inte skapa mapp');
        throw new Error(msg);
      }
      toast.success('Mapp skapad');
      closeCreateFolder();
      await load();
      await loadFolderChildren(parentId);
    } catch (e: any) {
      toast.error(e?.message || 'Kunde inte skapa mapp');
    } finally {
      setBusy(null);
    }
  };

  const onUploadFiles = async (files: FileList | null) => {
    if (!effectiveCanEdit) return;
    if (!files || files.length === 0) return;
    const total = files.length;
    setUploadProgress({ current: 0, total });
    setBusy('upload');
    try {
      const arr = Array.from(files);
      for (let i = 0; i < arr.length; i++) {
        const f = arr[i];
        setUploadProgress({ current: i + 1, total });
        const fd = new FormData();
        if (folderId) fd.set('folderId', folderId);
        fd.set('file', f);
        const res = await fetch('/api/documents/files', { method: 'POST', body: fd });
        const j = await res.json();
        if (!res.ok || !j?.ok) throw new Error(j?.error || `Kunde inte ladda upp: ${f.name}`);
      }
      toast.success('Uppladdning klar');
      if (fileInputRef.current) fileInputRef.current.value = '';
      await load();
    } catch (e: any) {
      toast.error(e?.message || 'Kunde inte ladda upp');
    } finally {
      setBusy(null);
      setUploadProgress(null);
    }
  };

  const downloadFile = async (id: string) => {
    try {
      const res = await fetch(`/api/documents/files/download?id=${encodeURIComponent(id)}&download=1`, { cache: 'no-store' });
      const j = await res.json();
      if (!res.ok || !j?.ok || !j?.url) throw new Error(j?.error || 'Kunde inte skapa nedladdningslänk');
      window.open(j.url, '_blank', 'noopener,noreferrer');
    } catch (e: any) {
      toast.error(e?.message || 'Kunde inte ladda ner');
    }
  };

  const getSignedUrl = useCallback(async (id: string) => {
    const res = await fetch(`/api/documents/files/download?id=${encodeURIComponent(id)}`, { cache: 'no-store' });
    const j = await res.json();
    if (!res.ok || !j?.ok || !j?.url) throw new Error(j?.error || 'Kunde inte skapa länk');
    return j.url as string;
  }, []);

  const previewFile = useCallback(async (file: FileRow) => {
    setPreviewError(null);
    setPreviewLoading(true);
    try {
      const url = await getSignedUrl(file.id);
      setPreview({ id: file.id, url, fileName: file.file_name, contentType: file.content_type });
    } catch (e: any) {
      setPreview(null);
      setPreviewError(e?.message || 'Kunde inte förhandsgranska');
    } finally {
      setPreviewLoading(false);
    }
  }, [getSignedUrl]);

  const deleteFile = async (id: string) => {
    if (!effectiveCanEdit) return;
    if (!window.confirm('Ta bort filen?')) return;
    setBusy('delete-file');
    try {
      const res = await fetch(`/api/documents/files?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      const j = await res.json();
      if (!res.ok || !j?.ok) throw new Error(j?.error || 'Kunde inte ta bort fil');
      toast.success('Filen är borttagen');
      await load();
    } catch (e: any) {
      toast.error(e?.message || 'Kunde inte ta bort fil');
    } finally {
      setBusy(null);
    }
  };

  const deleteFolder = async (id: string, parentId: string | null) => {
    if (!effectiveCanEdit) return;
    if (!window.confirm('Ta bort mappen? (Mappen måste vara tom)')) return;
    setBusy('delete-folder');
    try {
      const res = await fetch(`/api/documents/folders?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      const j = await res.json();
      if (!res.ok || !j?.ok) {
        const msg = j?.error === 'folder_not_empty' ? 'Mappen är inte tom.' : (j?.error || 'Kunde inte ta bort mapp');
        throw new Error(msg);
      }
      toast.success('Mapp borttagen');
      await load();
      await loadFolderChildren(parentId);
      if (folderId === id || breadcrumbs.some(b => b.id === id)) {
        router.push(parentId ? `/dokument?folderId=${encodeURIComponent(parentId)}` : '/dokument');
      }
    } catch (e: any) {
      toast.error(e?.message || 'Kunde inte ta bort mapp');
    } finally {
      setBusy(null);
    }
  };

  const renameFolder = async (id: string, parentId: string | null, currentName: string) => {
    if (!effectiveCanEdit) return;
    const name = window.prompt('Nytt mappnamn:', currentName);
    if (!name) return;
    setBusy('rename-folder');
    try {
      const res = await fetch('/api/documents/folders', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, name }),
      });
      const j = await res.json();
      if (!res.ok || !j?.ok) {
        const msg = j?.error === 'name_exists' ? 'Det finns redan en mapp med det namnet.' : (j?.error || 'Kunde inte byta namn');
        throw new Error(msg);
      }
      toast.success('Mapp uppdaterad');
      await load();
      await loadFolderChildren(parentId);
    } catch (e: any) {
      toast.error(e?.message || 'Kunde inte byta namn');
    } finally {
      setBusy(null);
    }
  };

  const buttonStyle: React.CSSProperties = {
    padding: '10px 12px',
    borderRadius: 10,
    fontSize: 14,
    border: '1px solid #111827',
    background: '#111827',
    color: '#fff',
    fontWeight: 600,
    cursor: 'pointer',
    opacity: busy ? 0.85 : 1,
  };
  const buttonSecondary: React.CSSProperties = {
    padding: '10px 12px',
    borderRadius: 10,
    fontSize: 14,
    border: '1px solid #e5e7eb',
    background: '#fff',
    color: '#111827',
    fontWeight: 600,
    cursor: 'pointer',
  };

  const currentFolderName = data?.folder?.name || null;

  const explorerColumns: Array<{ key: string; title: string; parentId: string | null; selectedId: string | null }> = useMemo(() => {
    // Column 1: root children
    const cols: Array<{ key: string; title: string; parentId: string | null; selectedId: string | null }> = [];
    const rootSelected = breadcrumbs[0]?.id || null;
    cols.push({ key: 'root', title: 'Mappar', parentId: null, selectedId: rootSelected });
    // For each breadcrumb, show its children (subfolders)
    for (let i = 0; i < breadcrumbs.length; i++) {
      const parent = breadcrumbs[i];
      const selectedNext = breadcrumbs[i + 1]?.id || null;
      cols.push({ key: parent.id, title: parent.name, parentId: parent.id, selectedId: selectedNext });
    }
    // If no folder selected, don't add extra columns
    return cols;
  }, [breadcrumbs]);

  function renderFolderList(parentId: string | null, selectedId: string | null) {
    const key = parentId || 'root';
    const list = folderLists[key] || [];
    if (!list.length) {
      return <div style={{ padding: 10, color: '#6b7280', fontSize: 13 }}>Inga mappar</div>;
    }
    return (
      <div style={{ padding: 10, display: 'grid', gap: 8 }}>
        {list.map(f => {
          const active = selectedId === f.id || (!selectedId && folderId === f.id);
          const showActions = effectiveCanEdit && (active || hoveredFolderId === f.id);
          const colorDot = folderColorHex(f.color);
          return (
            <div
              key={f.id}
              style={{
                display: 'grid',
                gridTemplateColumns: effectiveCanEdit ? 'minmax(0, 1fr) auto' : 'minmax(0, 1fr)',
                gap: 8,
                alignItems: 'stretch',
              }}
              onMouseEnter={() => setHoveredFolderId(f.id)}
              onMouseLeave={() => setHoveredFolderId(prev => (prev === f.id ? null : prev))}
            >
              <button
                type="button"
                onClick={() => openFolder(f.id)}
                style={{
                  width: '100%',
                  border: '1px solid ' + (active ? '#c7d2fe' : 'transparent'),
                  background: active ? 'linear-gradient(135deg,#eef2ff,#e0e7ff)' : 'transparent',
                  borderRadius: 10,
                  padding: '10px 12px',
                  cursor: 'pointer',
                  textAlign: 'left',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'flex-start',
                  gap: 8,
                  color: '#111827',
                  fontWeight: active ? 800 : 600,
                }}
              >
                {colorDot ? (
                  <span aria-hidden style={{ width: 10, height: 10, borderRadius: 999, background: colorDot, flex: '0 0 auto' }} />
                ) : (
                  <span aria-hidden style={{ width: 10, height: 10, borderRadius: 999, background: '#e5e7eb', flex: '0 0 auto' }} />
                )}
                <span aria-hidden style={{ fontSize: 14 }}>📁</span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
              </button>

              {effectiveCanEdit && (
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
                  <button
                    type="button"
                    onClick={() => renameFolder(f.id, parentId, f.name)}
                    disabled={!!busy}
                    title="Byt namn"
                    aria-label="Byt namn"
                    style={{
                      padding: '6px 8px',
                      borderRadius: 10,
                      fontSize: 13,
                      border: '1px solid #e5e7eb',
                      background: '#fff',
                      color: '#111827',
                      fontWeight: 800,
                      cursor: 'pointer',
                    }}
                  >
                    ✎
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteFolder(f.id, parentId)}
                    disabled={!!busy}
                    title="Ta bort (mappen måste vara tom)"
                    aria-label="Ta bort"
                    style={{
                      padding: '6px 8px',
                      borderRadius: 10,
                      fontSize: 13,
                      border: '1px solid #e5e7eb',
                      background: '#fff',
                      color: '#991b1b',
                      fontWeight: 900,
                      cursor: 'pointer',
                    }}
                  >
                    🗑
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <section style={{ marginTop: 14 }}>
      {/* Top bar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        flexWrap: 'wrap',
        border: '1px solid #e5e7eb',
        background: 'linear-gradient(145deg,#ffffff,#f8fafc)',
        borderRadius: 14,
        padding: '10px 12px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" onClick={goRoot} style={buttonSecondary} disabled={loading}>
            Dokument
          </button>
          {breadcrumbs.map((b) => (
            <React.Fragment key={b.id}>
              <span style={{ color: '#9ca3af' }}>/</span>
              <button
                type="button"
                onClick={() => openFolder(b.id)}
                style={{ ...buttonSecondary, padding: '8px 10px' }}
                disabled={loading}
              >
                {b.name}
              </button>
            </React.Fragment>
          ))}
          {!breadcrumbs.length && (
            <span style={{ color: '#6b7280', fontSize: 13 }}>Rot</span>
          )}
        </div>

        {effectiveCanEdit && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <span style={{ ...buttonSecondary, padding: '10px 12px' }}>
                {busy === 'upload' && uploadProgress
                  ? `Laddar upp (${uploadProgress.current}/${uploadProgress.total})…`
                  : 'Ladda upp'}
              </span>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                onChange={(e) => onUploadFiles(e.target.files)}
                disabled={!!busy}
                style={{ display: 'none' }}
              />
            </label>
          </div>
        )}
      </div>

      {showInitialLoading && (
        <div style={{ marginTop: 14, color: '#6b7280' }}>Laddar…</div>
      )}
      {!showInitialLoading && error && (
        <div style={{ marginTop: 14, color: '#b91c1c', border: '1px solid #fecaca', background: '#fef2f2', padding: 12, borderRadius: 12 }}>
          {error}
        </div>
      )}

      {data && (
        <div style={{
          marginTop: 14,
          display: 'flex',
          gap: 12,
          alignItems: 'stretch',
        }}>
          {/* Left explorer */}
          <aside style={{
            flex: '0 0 auto',
            display: 'flex',
            gap: 12,
            overflowX: 'auto',
            paddingBottom: 4,
            maxWidth: 'min(75vw, 980px)',
          }}>
            {explorerColumns.map(col => (
              <div key={col.key} style={{
                width: 450,
                border: '1px solid #e5e7eb',
                borderRadius: 14,
                overflow: 'hidden',
                background: '#fff',
                boxShadow: '0 4px 10px rgba(0,0,0,0.03)',
              }}>
                <div style={{ padding: '10px 10px', borderBottom: '1px solid #e5e7eb', background: '#f9fafb' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <div style={{ flex: '1 1 auto', minWidth: 0, fontSize: 12, color: '#6b7280', fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {col.title}
                    </div>
                    {effectiveCanEdit && (
                      <button
                        type="button"
                        onClick={() => openCreateFolder(col.parentId)}
                        disabled={!!busy}
                        title="Skapa ny mapp här"
                        style={{
                          ...buttonSecondary,
                          flex: '0 0 auto',
                          padding: '6px 8px',
                          fontSize: 12,
                          borderRadius: 10,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        + Ny mapp
                      </button>
                    )}
                  </div>

                  {effectiveCanEdit && createFolderUi && createFolderUi.parentId === col.parentId && (
                    <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid #e5e7eb' }}>
                      <div style={{ display: 'grid', gap: 8 }}>
                        <input
                          ref={createFolderNameRef}
                          value={createFolderUi.name}
                          onChange={(e) => setCreateFolderUi(prev => (prev ? { ...prev, name: e.target.value } : prev))}
                          placeholder="Mappnamn"
                          onKeyDown={(e) => {
                            if (e.key === 'Escape') closeCreateFolder();
                            if (e.key === 'Enter') {
                              submitCreateFolder(createFolderUi.parentId, createFolderUi.name, createFolderUi.color);
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
                          {(
                            [
                              { key: 'gray', label: 'Grå' },
                              { key: 'blue', label: 'Blå' },
                              { key: 'green', label: 'Grön' },
                              { key: 'yellow', label: 'Gul' },
                              { key: 'red', label: 'Röd' },
                              { key: 'purple', label: 'Lila' },
                            ] as const
                          ).map((c) => {
                            const hex = folderColorHex(c.key);
                            const selected = createFolderUi.color === c.key;
                            return (
                              <button
                                key={c.key}
                                type="button"
                                onClick={() => setCreateFolderUi(prev => (prev ? { ...prev, color: selected ? null : c.key } : prev))}
                                title={c.label}
                                aria-label={c.label}
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
                          <button type="button" onClick={closeCreateFolder} style={buttonSecondary} disabled={!!busy}>
                            Avbryt
                          </button>
                          <button
                            type="button"
                            onClick={() => submitCreateFolder(createFolderUi.parentId, createFolderUi.name, createFolderUi.color)}
                            style={buttonStyle}
                            disabled={!!busy || !createFolderUi.name.trim()}
                          >
                            Skapa
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
                <div style={{ maxHeight: 'calc(100dvh - 280px)', overflowY: 'auto' }}>
                  {renderFolderList(col.parentId, col.selectedId)}
                </div>
              </div>
            ))}
          </aside>

          {/* Main documents pane */}
          <div style={{
            flex: '1 1 auto',
            minWidth: 0,
            border: '1px solid #e5e7eb',
            borderRadius: 14,
            overflow: 'hidden',
            background: '#fff',
            boxShadow: '0 4px 10px rgba(0,0,0,0.03)',
          }}>
            <div style={{
              padding: '12px 12px',
              borderBottom: '1px solid #e5e7eb',
              background: '#f9fafb',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 10,
              flexWrap: 'wrap',
            }}>
              <div>
                <div style={{ fontWeight: 800, color: '#111827' }}>
                  {currentFolderName ? currentFolderName : 'Rot'}
                </div>
                <div style={{ fontSize: 12, color: '#6b7280' }}>
                  {loading
                    ? 'Uppdaterar…'
                    : (fileSearch.trim()
                      ? `${filteredFiles.length} av ${data.files.length} filer`
                      : `${data.files.length} filer`
                    )}
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={() => setFileSearchMode(m => (m === 'folder' ? 'all' : 'folder'))}
                  style={{
                    ...buttonSecondary,
                    padding: '10px 12px',
                    background: fileSearchMode === 'all' ? 'linear-gradient(135deg,#eef2ff,#e0e7ff)' : '#fff',
                    border: '1px solid ' + (fileSearchMode === 'all' ? '#c7d2fe' : '#e5e7eb'),
                  }}
                  title={fileSearchMode === 'all' ? 'Söker i alla mappar' : 'Söker i aktuell mapp'}
                >
                  {fileSearchMode === 'all' ? 'Sök: Alla mappar' : 'Sök: Denna mapp'}
                </button>

                <input
                  value={fileSearch}
                  onChange={(e) => setFileSearch(e.target.value)}
                  placeholder={fileSearchMode === 'all' ? 'Sök filer i alla mappar…' : 'Sök filer…'}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') setFileSearch('');
                  }}
                  style={{
                    padding: '10px 12px',
                    borderRadius: 10,
                    border: '1px solid #e5e7eb',
                    background: '#fff',
                    fontSize: 14,
                    minWidth: 260,
                  }}
                />
                {fileSearch.trim() && (
                  <button type="button" onClick={() => setFileSearch('')} style={buttonSecondary}>
                    Rensa
                  </button>
                )}
              </div>
            </div>

            {(previewLoading || previewError || preview) && (
              <div style={{ padding: 12, borderBottom: '1px solid #e5e7eb', background: '#ffffff' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                  <div style={{ fontWeight: 800, color: '#111827' }}>
                    Förhandsvisning
                    {preview?.fileName ? (
                      <span style={{ fontWeight: 700, color: '#6b7280' }}> — {preview.fileName}</span>
                    ) : null}
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {preview?.id && (
                      <button type="button" onClick={() => downloadFile(preview.id)} style={buttonSecondary}>
                        Ladda ner
                      </button>
                    )}
                    <button type="button" onClick={() => { setPreview(null); setPreviewError(null); }} style={buttonSecondary}>
                      Stäng
                    </button>
                  </div>
                </div>

                {previewLoading && (
                  <div style={{ marginTop: 10, color: '#6b7280', fontSize: 13 }}>Laddar förhandsvisning…</div>
                )}
                {!previewLoading && previewError && (
                  <div style={{ marginTop: 10, color: '#b91c1c', fontSize: 13 }}>{previewError}</div>
                )}

                {!previewLoading && preview && (
                  <div style={{ marginTop: 10 }}>
                    {preview.contentType?.startsWith('image/') ? (
                      <div style={{ display: 'grid', placeItems: 'center', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 12, padding: 10 }}>
                        <img
                          src={preview.url}
                          alt={preview.fileName}
                          style={{ maxWidth: '100%', maxHeight: 520, objectFit: 'contain', borderRadius: 10 }}
                        />
                      </div>
                    ) : (
                      <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden', background: '#fff' }}>
                        <iframe
                          title={preview.fileName}
                          src={preview.url}
                          style={{ width: '100%', height: 520, border: 'none', display: 'block' }}
                        />
                      </div>
                    )}

                    <div style={{ marginTop: 8, color: '#6b7280', fontSize: 12 }}>
                      Om förhandsvisningen inte fungerar för filtypen, använd “Ladda ner”.
                    </div>
                  </div>
                )}
              </div>
            )}

            {fileSearchMode === 'all' ? (
              <div>
                <div style={{ display: 'grid', gridTemplateColumns: effectiveCanEdit ? '1fr 220px 120px 160px 340px' : '1fr 220px 120px 160px 240px', padding: '10px 12px', background: '#ffffff', fontSize: 12, color: '#6b7280', fontWeight: 800 }}>
                  <div>Namn</div>
                  <div>Mapp</div>
                  <div>Storlek</div>
                  <div>Skapad</div>
                  <div>Åtgärder</div>
                </div>

                {globalSearchError && (
                  <div style={{ padding: 14, color: '#b91c1c' }}>{globalSearchError}</div>
                )}
                {globalSearchLoading && (
                  <div style={{ padding: 14, color: '#6b7280' }}>Söker…</div>
                )}

                {!globalSearchLoading && !globalSearchError && (String(fileSearch || '').trim().length < 2) && (
                  <div style={{ padding: 14, color: '#6b7280' }}>Skriv minst 2 tecken för att söka.</div>
                )}

                {!globalSearchLoading && !globalSearchError && (String(fileSearch || '').trim().length >= 2) && (globalSearchResults?.length === 0) && (
                  <div style={{ padding: 14, color: '#6b7280' }}>Inga träffar.</div>
                )}

                {!globalSearchLoading && !globalSearchError && (globalSearchResults && globalSearchResults.length > 0) && (
                  globalSearchResults.map(file => (
                    <div key={file.id} style={{ display: 'grid', gridTemplateColumns: effectiveCanEdit ? '1fr 220px 120px 160px 340px' : '1fr 220px 120px 160px 240px', padding: '10px 12px', borderTop: '1px solid #e5e7eb', alignItems: 'center', gap: 10 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                        <span aria-hidden style={{ fontSize: 16 }}>📄</span>
                        <button type="button" onClick={() => previewFile(file)} style={{ border: 'none', background: 'transparent', padding: 0, cursor: 'pointer', textAlign: 'left', fontWeight: 800, color: '#111827', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {file.file_name}
                        </button>
                      </div>
                      <div style={{ color: '#6b7280', fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{file.folder_name || 'Rot'}</div>
                      <div style={{ color: '#6b7280', fontSize: 13 }}>{formatBytes(file.size_bytes)}</div>
                      <div style={{ color: '#6b7280', fontSize: 13 }}>{new Date(file.created_at).toLocaleString('sv-SE')}</div>
                      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                        <button type="button" onClick={() => previewFile(file)} disabled={previewLoading} style={buttonSecondary}>
                          Förhandsgranska
                        </button>
                        <button type="button" onClick={() => downloadFile(file.id)} style={buttonSecondary}>
                          Ladda ner
                        </button>
                        {effectiveCanEdit && (
                          <button type="button" onClick={() => deleteFile(file.id)} disabled={!!busy} style={{ ...buttonSecondary, color: '#991b1b' }}>
                            Ta bort
                          </button>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            ) : data.files.length === 0 ? (
              <div style={{ padding: 14, color: '#6b7280' }}>Inga filer här ännu.</div>
            ) : filteredFiles.length === 0 ? (
              <div style={{ padding: 14, color: '#6b7280' }}>Inga träffar.</div>
            ) : (
              <div>
                <div style={{ display: 'grid', gridTemplateColumns: effectiveCanEdit ? '1fr 120px 160px 340px' : '1fr 120px 160px 240px', padding: '10px 12px', background: '#ffffff', fontSize: 12, color: '#6b7280', fontWeight: 800 }}>
                  <div>Namn</div>
                  <div>Storlek</div>
                  <div>Skapad</div>
                  <div>Åtgärder</div>
                </div>
                {filteredFiles.map(file => (
                  <div key={file.id} style={{ display: 'grid', gridTemplateColumns: effectiveCanEdit ? '1fr 120px 160px 340px' : '1fr 120px 160px 240px', padding: '10px 12px', borderTop: '1px solid #e5e7eb', alignItems: 'center', gap: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                      <span aria-hidden style={{ fontSize: 16 }}>📄</span>
                      <button type="button" onClick={() => previewFile(file)} style={{ border: 'none', background: 'transparent', padding: 0, cursor: 'pointer', textAlign: 'left', fontWeight: 800, color: '#111827', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {file.file_name}
                      </button>
                    </div>
                    <div style={{ color: '#6b7280', fontSize: 13 }}>{formatBytes(file.size_bytes)}</div>
                    <div style={{ color: '#6b7280', fontSize: 13 }}>{new Date(file.created_at).toLocaleString('sv-SE')}</div>
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                      <button type="button" onClick={() => previewFile(file)} disabled={previewLoading} style={buttonSecondary}>
                        Förhandsgranska
                      </button>
                      <button type="button" onClick={() => downloadFile(file.id)} style={buttonSecondary}>
                        Ladda ner
                      </button>
                      {effectiveCanEdit && (
                        <button type="button" onClick={() => deleteFile(file.id)} disabled={!!busy} style={{ ...buttonSecondary, color: '#991b1b' }}>
                          Ta bort
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
