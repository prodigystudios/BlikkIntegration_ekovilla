"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useToast } from '../../../lib/Toast';
import { cn } from '@/lib/shared/cn';
import Input from '../../../components/ui/Input';
import CrmModal from '../components/CrmModal';
import { crm } from '../lib/crmTokens';
import DocumentsHeader from './components/DocumentsHeader';
import DocumentsExplorer from './components/DocumentsExplorer';
import DocumentsFileCollection from './components/DocumentsFileCollection';
import DocumentsMainPanelHeader from './components/DocumentsMainPanelHeader';
import DocumentsPublishDialog from './components/DocumentsPublishDialog';
import DocumentsPreviewPanel from './components/DocumentsPreviewPanel';
import DocumentsPublishStatusDialog from './components/DocumentsPublishStatusDialog';
import DocumentsQuickAccessFolders from './components/DocumentsQuickAccessFolders';
import DocumentsResultsPanel from './components/DocumentsResultsPanel';
import type {
  FileRow,
  FolderRow,
  ListResponse,
  PublicationStatusResponse,
  PublicationSummary,
  PublishMeta,
  PublishStatusUiState,
  PublishUiState,
  SearchFileRow,
} from './types';

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
  const [createFolderUi, setCreateFolderUi] = useState<{ parentId: string | null; name: string; color: string | null } | null>(null);
  const [fileSearch, setFileSearch] = useState('');
  const [fileSearchMode, setFileSearchMode] = useState<'folder' | 'all'>('folder');
  const [globalSearchLoading, setGlobalSearchLoading] = useState(false);
  const [globalSearchError, setGlobalSearchError] = useState<string | null>(null);
  const [globalSearchResults, setGlobalSearchResults] = useState<SearchFileRow[] | null>(null);
  const [publishUi, setPublishUi] = useState<PublishUiState | null>(null);
  const [publishMeta, setPublishMeta] = useState<PublishMeta | null>(null);
  const [publishMetaLoading, setPublishMetaLoading] = useState(false);
  const [publishMetaError, setPublishMetaError] = useState<string | null>(null);
  const [publishStatusUi, setPublishStatusUi] = useState<PublishStatusUiState | null>(null);
  const [isCompactViewport, setIsCompactViewport] = useState(false);
  const [showExplorerOnMobile, setShowExplorerOnMobile] = useState(true);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const createFolderNameRef = useRef<HTMLInputElement | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ type: 'file' | 'folder'; id: string; parentId: string | null; name: string } | null>(null);
  const [renameUi, setRenameUi] = useState<{ id: string; parentId: string | null; name: string } | null>(null);

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

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const media = window.matchMedia('(max-width: 980px)');
    const update = () => setIsCompactViewport(media.matches);
    update();
    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', update);
      return () => media.removeEventListener('change', update);
    }
    media.addListener(update);
    return () => media.removeListener(update);
  }, []);

  useEffect(() => {
    if (!isCompactViewport) setShowExplorerOnMobile(true);
  }, [isCompactViewport]);

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

  const goRoot = () => router.push('/crm/dokument', { scroll: false });
  const openFolder = (id: string) => router.push(`/crm/dokument?folderId=${encodeURIComponent(id)}`, { scroll: false });

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
    const queue = Array.from(files);
    const total = queue.length;
    let completed = 0;
    const failures: string[] = [];
    setUploadProgress({ current: 0, total });
    setBusy('upload');

    // Upload one file; failures are collected (not thrown) so one bad file
    // doesn't abort the rest of the batch.
    const uploadOne = async (f: File) => {
      const fd = new FormData();
      if (folderId) fd.set('folderId', folderId);
      fd.set('file', f);
      try {
        const res = await fetch('/api/documents/files', { method: 'POST', body: fd });
        const j = await res.json();
        if (!res.ok || !j?.ok) throw new Error(j?.error || f.name);
      } catch {
        failures.push(f.name);
      } finally {
        completed += 1;
        setUploadProgress({ current: completed, total });
      }
    };

    try {
      // Drain a shared queue with a small concurrency pool so large batches
      // upload in parallel instead of one-at-a-time.
      const CONCURRENCY = 3;
      const workers = Array.from({ length: Math.min(CONCURRENCY, total) }, async () => {
        for (let next = queue.shift(); next; next = queue.shift()) {
          await uploadOne(next);
        }
      });
      await Promise.all(workers);

      if (fileInputRef.current) fileInputRef.current.value = '';
      await load();

      if (failures.length === 0) {
        toast.success('Uppladdning klar');
      } else if (failures.length < total) {
        toast.error(`${total - failures.length} av ${total} laddades upp. Misslyckades: ${failures.join(', ')}`);
      } else {
        toast.error('Kunde inte ladda upp filerna');
      }
    } finally {
      setBusy(null);
      setUploadProgress(null);
    }
  };

  const downloadFile = async (id: string) => {
    try {
      const url = `/api/documents/files/download?id=${encodeURIComponent(id)}&download=1&redirect=1`;
      const popup = window.open(url, '_blank');
      if (!popup) {
        window.location.href = url;
      }
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

  const deleteFile = (id: string) => {
    if (!effectiveCanEdit) return;
    const name = data?.files.find((f) => f.id === id)?.file_name
      || globalSearchResults?.find((f) => f.id === id)?.file_name
      || 'filen';
    setDeleteConfirm({ type: 'file', id, parentId: null, name });
  };

  const loadPublishMeta = useCallback(async () => {
    if (publishMeta || publishMetaLoading) return;
    setPublishMetaLoading(true);
    setPublishMetaError(null);
    try {
      const res = await fetch('/api/documents/publications/meta', { cache: 'no-store' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Kunde inte ladda mottagare');
      setPublishMeta({
        users: Array.isArray(json.users) ? json.users : [],
        tags: Array.isArray(json.tags) ? json.tags : [],
      });
    } catch (e: any) {
      setPublishMetaError(e?.message || 'Kunde inte ladda mottagare');
    } finally {
      setPublishMetaLoading(false);
    }
  }, [publishMeta, publishMetaLoading]);

  const openPublish = useCallback((file: FileRow) => {
    setPublishUi({
      file,
      title: file.file_name,
      description: '',
      versionLabel: '',
      dueAt: '',
      requiresApproval: true,
      selectedUserIds: [],
      selectedTags: [],
    });
    loadPublishMeta();
  }, [loadPublishMeta]);

  const closePublish = useCallback(() => {
    setPublishUi(null);
    setPublishMetaError(null);
  }, []);

  const togglePublishUser = useCallback((userId: string) => {
    setPublishUi(prev => {
      if (!prev) return prev;
      const exists = prev.selectedUserIds.includes(userId);
      return { ...prev, selectedUserIds: exists ? prev.selectedUserIds.filter(id => id !== userId) : [...prev.selectedUserIds, userId] };
    });
  }, []);

  const togglePublishTag = useCallback((tag: string) => {
    setPublishUi(prev => {
      if (!prev) return prev;
      const exists = prev.selectedTags.includes(tag);
      return { ...prev, selectedTags: exists ? prev.selectedTags.filter(item => item !== tag) : [...prev.selectedTags, tag] };
    });
  }, []);

  const submitPublish = useCallback(async () => {
    if (!publishUi) return;
    if (!publishUi.title.trim()) {
      toast.error('Titel krävs');
      return;
    }
    if (publishUi.selectedUserIds.length === 0 && publishUi.selectedTags.length === 0) {
      toast.error('Välj minst en mottagare eller grupp');
      return;
    }
    setBusy('publish');
    try {
      const res = await fetch('/api/documents/publications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileId: publishUi.file.id,
          title: publishUi.title.trim(),
          description: publishUi.description.trim(),
          versionLabel: publishUi.versionLabel.trim(),
          dueAt: publishUi.dueAt ? new Date(publishUi.dueAt).toISOString() : null,
          requiresApproval: publishUi.requiresApproval,
          userIds: publishUi.selectedUserIds,
          tags: publishUi.selectedTags,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Kunde inte publicera dokument');
      toast.success('Dokumentet har publicerats för kvittens');
      closePublish();
    } catch (e: any) {
      toast.error(e?.message || 'Kunde inte publicera dokument');
    } finally {
      setBusy(null);
    }
  }, [closePublish, publishUi, toast]);

  const loadPublicationStatus = useCallback(async (publicationId: string) => {
    setPublishStatusUi(prev => prev ? { ...prev, selectedPublicationId: publicationId, loadingStatus: true, error: null } : prev);
    try {
      const res = await fetch(`/api/documents/publications/${encodeURIComponent(publicationId)}/status`, { cache: 'no-store' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Kunde inte ladda status');
      setPublishStatusUi(prev => prev ? { ...prev, selectedPublicationId: publicationId, status: json as PublicationStatusResponse, loadingStatus: false } : prev);
    } catch (e: any) {
      setPublishStatusUi(prev => prev ? { ...prev, loadingStatus: false, error: e?.message || 'Kunde inte ladda status' } : prev);
    }
  }, []);

  const openPublishStatus = useCallback(async (file: FileRow) => {
    setPublishStatusUi({
      file,
      publications: [],
      selectedPublicationId: null,
      status: null,
      loadingPublications: true,
      loadingStatus: false,
      error: null,
    });
    try {
      const res = await fetch(`/api/documents/publications?fileId=${encodeURIComponent(file.id)}`, { cache: 'no-store' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Kunde inte ladda publiceringar');
      const items = Array.isArray(json.items) ? json.items as PublicationSummary[] : [];
      setPublishStatusUi(prev => prev ? { ...prev, publications: items, loadingPublications: false, selectedPublicationId: items[0]?.id || null } : prev);
      if (items[0]?.id) {
        await loadPublicationStatus(items[0].id);
      }
    } catch (e: any) {
      setPublishStatusUi(prev => prev ? { ...prev, loadingPublications: false, error: e?.message || 'Kunde inte ladda publiceringar' } : prev);
    }
  }, [loadPublicationStatus]);

  const closePublishStatus = useCallback(() => {
    setPublishStatusUi(null);
  }, []);

  const deleteFolder = (id: string, parentId: string | null) => {
    if (!effectiveCanEdit) return;
    const name = Object.values(folderLists).flat().find((f) => f.id === id)?.name
      || data?.folders.find((f) => f.id === id)?.name
      || 'mappen';
    setDeleteConfirm({ type: 'folder', id, parentId, name });
  };

  // Runs the delete chosen in the confirm modal (file or folder).
  const performDelete = async () => {
    if (!deleteConfirm) return;
    const { type, id, parentId } = deleteConfirm;
    setBusy(type === 'folder' ? 'delete-folder' : 'delete-file');
    try {
      if (type === 'folder') {
        const res = await fetch(`/api/documents/folders?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
        const j = await res.json();
        if (!res.ok || !j?.ok) {
          const msg = j?.error === 'folder_not_empty' ? 'Mappen är inte tom.' : (j?.error || 'Kunde inte ta bort mapp');
          throw new Error(msg);
        }
        toast.success('Mapp borttagen');
        setDeleteConfirm(null);
        await load();
        await loadFolderChildren(parentId);
        if (folderId === id || breadcrumbs.some((b) => b.id === id)) {
          router.push(parentId ? `/crm/dokument?folderId=${encodeURIComponent(parentId)}` : '/crm/dokument');
        }
      } else {
        const res = await fetch(`/api/documents/files?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
        const j = await res.json();
        if (!res.ok || !j?.ok) throw new Error(j?.error || 'Kunde inte ta bort fil');
        toast.success('Filen är borttagen');
        setDeleteConfirm(null);
        await load();
      }
    } catch (e: any) {
      toast.error(e?.message || 'Kunde inte ta bort');
    } finally {
      setBusy(null);
    }
  };

  const renameFolder = (id: string, parentId: string | null, currentName: string) => {
    if (!effectiveCanEdit) return;
    setRenameUi({ id, parentId, name: currentName });
  };

  const performRename = async () => {
    if (!renameUi) return;
    const name = renameUi.name.trim();
    if (!name) return;
    const { id, parentId } = renameUi;
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
      setRenameUi(null);
      await load();
      await loadFolderChildren(parentId);
    } catch (e: any) {
      toast.error(e?.message || 'Kunde inte byta namn');
    } finally {
      setBusy(null);
    }
  };

  const currentFolderName = data?.folder?.name || null;
  const mainPanelStatusText = loading
    ? 'Uppdaterar…'
    : fileSearchMode === 'all'
      ? `${globalSearchResults?.length ?? 0} träffar i alla mappar`
      : (fileSearch.trim()
        ? `${filteredFiles.length} av ${data?.files.length ?? 0} filer`
        : `${data?.files.length ?? 0} filer`);

  return (
    <section className="grid grid-cols-1 gap-4">
      <DocumentsHeader
        breadcrumbs={breadcrumbs}
        currentFolderName={currentFolderName}
        isCompactViewport={isCompactViewport}
        showExplorerOnMobile={showExplorerOnMobile}
        effectiveCanEdit={effectiveCanEdit}
        loading={loading}
        busy={busy}
        uploadProgress={uploadProgress}
        fileSearchMode={fileSearchMode}
        folderCount={data?.folders.length || 0}
        fileCount={data?.files.length || 0}
        fileInputRef={fileInputRef}
        onUploadFiles={onUploadFiles}
        onToggleExplorer={() => setShowExplorerOnMobile(v => !v)}
        onGoRoot={goRoot}
        onOpenFolder={openFolder}
      />

      {showInitialLoading && (
        <div className="text-sm text-slate-400">Laddar…</div>
      )}
      {!showInitialLoading && error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      )}

      {data && (
        <div
          className={isCompactViewport
            ? 'grid grid-cols-1 items-start gap-4'
            : 'grid items-start gap-4 [grid-template-columns:minmax(300px,360px)_minmax(0,1fr)]'}
        >
          {/* Left explorer */}
          {(!isCompactViewport || showExplorerOnMobile) && (
            <DocumentsExplorer
              folderId={folderId}
              breadcrumbs={breadcrumbs}
              folderLists={folderLists}
              createFolderUi={createFolderUi}
              effectiveCanEdit={effectiveCanEdit}
              busy={busy}
              isCompactViewport={isCompactViewport}
              createFolderNameRef={createFolderNameRef}
              folderColorHex={folderColorHex}
              onOpenFolder={openFolder}
              onOpenCreateFolder={openCreateFolder}
              onCloseCreateFolder={closeCreateFolder}
              onSetCreateFolderName={(name) => setCreateFolderUi((prev) => (prev ? { ...prev, name } : prev))}
              onToggleCreateFolderColor={(color) => setCreateFolderUi((prev) => (prev ? { ...prev, color: prev.color === color ? null : color } : prev))}
              onSubmitCreateFolder={submitCreateFolder}
              onRenameFolder={renameFolder}
              onDeleteFolder={deleteFolder}
            />
          )}

          {/* Main documents pane */}
          <div className="min-w-0 overflow-hidden rounded-2xl border border-[#e0e8dc] bg-white shadow-[0_1px_3px_rgba(20,44,27,0.06),0_18px_36px_-18px_rgba(20,44,27,0.24)]">
            <DocumentsMainPanelHeader
              currentFolderName={currentFolderName}
              statusText={mainPanelStatusText}
              fileSearchMode={fileSearchMode}
              fileSearch={fileSearch}
              isCompactViewport={isCompactViewport}
              onToggleSearchMode={() => setFileSearchMode((mode) => (mode === 'folder' ? 'all' : 'folder'))}
              onFileSearchChange={setFileSearch}
              onClearSearch={() => setFileSearch('')}
            />

            <DocumentsQuickAccessFolders
              folders={data.folders}
              currentFolderName={currentFolderName}
              effectiveCanEdit={effectiveCanEdit}
              isCompactViewport={isCompactViewport}
              disableCreate={!!busy}
              onCreateFolder={() => openCreateFolder(folderId || null)}
              onOpenFolder={openFolder}
              resolveFolderColor={folderColorHex}
            />

            <DocumentsPreviewPanel
              previewLoading={previewLoading}
              previewError={previewError}
              preview={preview}
              onDownloadFile={downloadFile}
              onClose={() => {
                setPreview(null);
                setPreviewError(null);
              }}
            />

            <DocumentsResultsPanel
              fileSearchMode={fileSearchMode}
              fileSearch={fileSearch}
              globalSearchLoading={globalSearchLoading}
              globalSearchError={globalSearchError}
              globalSearchResults={globalSearchResults}
              folderFiles={data.files}
              filteredFiles={filteredFiles}
              isCompactViewport={isCompactViewport}
              effectiveCanEdit={effectiveCanEdit}
              previewLoading={previewLoading}
              busy={busy}
              formatBytes={formatBytes}
              onPreviewFile={previewFile}
              onDownloadFile={downloadFile}
              onOpenPublishStatus={openPublishStatus}
              onOpenPublish={openPublish}
              onDeleteFile={deleteFile}
            />
          </div>
        </div>
      )}

      <DocumentsPublishDialog
        publishUi={publishUi}
        publishMeta={publishMeta}
        publishMetaLoading={publishMetaLoading}
        publishMetaError={publishMetaError}
        isPublishing={busy === 'publish'}
        onClose={closePublish}
        onSubmit={submitPublish}
        onTitleChange={(value) => setPublishUi((prev) => (prev ? { ...prev, title: value } : prev))}
        onVersionLabelChange={(value) => setPublishUi((prev) => (prev ? { ...prev, versionLabel: value } : prev))}
        onDueAtChange={(value) => setPublishUi((prev) => (prev ? { ...prev, dueAt: value } : prev))}
        onDescriptionChange={(value) => setPublishUi((prev) => (prev ? { ...prev, description: value } : prev))}
        onRequiresApprovalChange={(checked) => setPublishUi((prev) => (prev ? { ...prev, requiresApproval: checked } : prev))}
        onToggleUser={togglePublishUser}
        onToggleTag={togglePublishTag}
      />

      <DocumentsPublishStatusDialog
        publishStatusUi={publishStatusUi}
        onClose={closePublishStatus}
        onSelectPublication={loadPublicationStatus}
      />

      {deleteConfirm ? (
        <CrmModal
          onClose={() => { if (!busy) setDeleteConfirm(null); }}
          ariaLabel="Bekräfta borttagning"
          maxWidth="sm:max-w-[440px]"
          header={
            <div className="grid gap-1">
              <span className={crm.sectionTitle}>Ta bort</span>
              <strong className="text-lg font-bold tracking-tight text-slate-900">
                {deleteConfirm.type === 'folder' ? 'Ta bort mapp' : 'Ta bort fil'}
              </strong>
            </div>
          }
          footer={
            <>
              <button type="button" onClick={() => setDeleteConfirm(null)} disabled={!!busy} className={cn(crm.ghostButton, 'flex-1 sm:flex-none')}>
                Avbryt
              </button>
              <button
                type="button"
                onClick={performDelete}
                disabled={!!busy}
                className="inline-flex h-9 flex-1 items-center justify-center rounded-lg bg-rose-600 px-4 text-[13px] font-semibold text-white transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50 sm:ml-auto sm:flex-none"
              >
                {busy ? 'Tar bort…' : 'Ta bort'}
              </button>
            </>
          }
        >
          <p className="m-0 text-sm leading-6 text-slate-600">
            Är du säker på att du vill ta bort {deleteConfirm.type === 'folder' ? 'mappen' : 'filen'}{' '}
            <strong className="font-semibold text-slate-900">”{deleteConfirm.name}”</strong>?
            {deleteConfirm.type === 'folder' ? ' Mappen måste vara tom.' : ' Det går inte att ångra.'}
          </p>
        </CrmModal>
      ) : null}

      {renameUi ? (
        <CrmModal
          onClose={() => { if (!busy) setRenameUi(null); }}
          ariaLabel="Byt namn på mapp"
          maxWidth="sm:max-w-[440px]"
          header={
            <div className="grid gap-1">
              <span className={crm.sectionTitle}>Mapp</span>
              <strong className="text-lg font-bold tracking-tight text-slate-900">Byt namn</strong>
            </div>
          }
          footer={
            <>
              <button type="button" onClick={() => setRenameUi(null)} disabled={!!busy} className={cn(crm.ghostButton, 'flex-1 sm:flex-none')}>
                Avbryt
              </button>
              <button
                type="submit"
                form="rename-folder-form"
                disabled={!!busy || !renameUi.name.trim()}
                className={cn(crm.formButton, 'flex-1 sm:ml-auto sm:flex-none')}
                style={{ backgroundColor: 'var(--crm-primary)' }}
              >
                {busy ? 'Sparar…' : 'Spara'}
              </button>
            </>
          }
        >
          <form id="rename-folder-form" onSubmit={(e) => { e.preventDefault(); performRename(); }} className="grid gap-1.5">
            <label className={crm.label} htmlFor="rename-folder-input">Mappnamn</label>
            <Input
              id="rename-folder-input"
              autoFocus
              value={renameUi.name}
              onChange={(e) => setRenameUi((prev) => (prev ? { ...prev, name: e.target.value } : prev))}
              placeholder="Mappnamn"
            />
          </form>
        </CrmModal>
      ) : null}
    </section>
  );
}


