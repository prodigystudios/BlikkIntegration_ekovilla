"use client";

import React from 'react';

type FileRow = {
  id: string;
  folder_id: string | null;
  file_name: string;
  content_type: string | null;
  size_bytes: number | null;
  created_at: string;
};

type SearchFileRow = FileRow & {
  folder_name: string | null;
};

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

const softMetaChip: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '4px 8px',
  borderRadius: 999,
  background: '#f8fafc',
  color: '#475569',
  fontSize: 12,
  fontWeight: 700,
  border: '1px solid #e2e8f0',
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
  const actionButtonStyle: React.CSSProperties = {
    padding: isCompactViewport ? '8px 10px' : '10px 12px',
    borderRadius: 10,
    fontSize: isCompactViewport ? 13 : 14,
    border: '1px solid #e5e7eb',
    background: '#fff',
    color: '#111827',
    fontWeight: 600,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
  };

  const renderFileActions = (file: FileRow | SearchFileRow) => (
    <div style={{ display: 'flex', gap: 8, justifyContent: isCompactViewport ? 'stretch' : 'flex-end', flexWrap: 'wrap' }}>
      <button type="button" onClick={() => onPreviewFile(file)} disabled={previewLoading} style={actionButtonStyle}>
        Förhandsgranska
      </button>
      <button type="button" onClick={() => onDownloadFile(file.id)} style={actionButtonStyle}>
        Ladda ner
      </button>
      {effectiveCanEdit && (
        <button type="button" onClick={() => onOpenPublishStatus(file)} disabled={!!busy} style={actionButtonStyle}>
          Status
        </button>
      )}
      {effectiveCanEdit && (
        <button type="button" onClick={() => onOpenPublish(file)} disabled={!!busy} style={actionButtonStyle}>
          Publicera
        </button>
      )}
      {effectiveCanEdit && (
        <button type="button" onClick={() => onDeleteFile(file.id)} disabled={!!busy} style={{ ...actionButtonStyle, color: '#991b1b' }}>
          Ta bort
        </button>
      )}
    </div>
  );

  if (isCompactViewport) {
    return (
      <div style={{ display: 'grid', gap: 10, padding: 12 }}>
        {files.map((file) => {
          const folderName = includeFolderName && 'folder_name' in file ? file.folder_name : null;
          return (
            <div key={file.id} style={{ border: '1px solid #e2e8f0', borderRadius: 14, padding: '12px 12px 10px', background: '#fff', boxShadow: '0 6px 18px rgba(15,23,42,0.04)', display: 'grid', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, minWidth: 0 }}>
                <span aria-hidden style={{ fontSize: 18, lineHeight: 1 }}>📄</span>
                <div style={{ minWidth: 0, display: 'grid', gap: 5, flex: 1 }}>
                  <button type="button" onClick={() => onPreviewFile(file)} style={{ border: 'none', background: 'transparent', padding: 0, cursor: 'pointer', textAlign: 'left', fontWeight: 800, fontSize: 14, color: '#111827', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {file.file_name}
                  </button>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                    {folderName ? <span style={softMetaChip}>Mapp: {folderName || 'Rot'}</span> : null}
                    <span style={softMetaChip}>{formatBytes(file.size_bytes) || 'Okänd storlek'}</span>
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', color: '#64748b', fontSize: 12 }}>
                <span>Skapad {new Date(file.created_at).toLocaleString('sv-SE')}</span>
              </div>
              <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(132px, 1fr))' }}>
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
      <div style={{ display: 'grid', gridTemplateColumns: columns, padding: '10px 12px', background: 'linear-gradient(180deg,#ffffff,#f8fafc)', fontSize: 11, color: '#64748b', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.3 }}>
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
          <div key={file.id} style={{ display: 'grid', gridTemplateColumns: columns, padding: '12px 12px', borderTop: '1px solid #eef2f7', alignItems: 'center', gap: 10, background: '#fff' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
              <div style={{ width: 34, height: 34, borderRadius: 10, border: '1px solid #dbe4ef', background: 'linear-gradient(180deg,#ffffff,#f8fafc)', display: 'grid', placeItems: 'center', color: '#334155', fontSize: 10, fontWeight: 800, flex: '0 0 auto' }}>
                {extension}
              </div>
              <div style={{ minWidth: 0, display: 'grid', gap: 4 }}>
                <button type="button" onClick={() => onPreviewFile(file)} style={{ border: 'none', background: 'transparent', padding: 0, cursor: 'pointer', textAlign: 'left', fontWeight: 800, color: '#111827', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontSize: 13 }}>
                  {file.file_name}
                </button>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                  <span style={softMetaChip}>{extension}</span>
                  {!includeFolderName ? <span style={softMetaChip}>{formatBytes(file.size_bytes) || 'Okänd storlek'}</span> : null}
                </div>
              </div>
            </div>
            {includeFolderName ? <div style={{ color: '#6b7280', fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{folderName || 'Rot'}</div> : null}
            <div style={{ color: '#475569', fontSize: 13, fontWeight: 600 }}>{formatBytes(file.size_bytes)}</div>
            <div style={{ color: '#64748b', fontSize: 13 }}>{new Date(file.created_at).toLocaleString('sv-SE')}</div>
            {renderFileActions(file)}
          </div>
        );
      })}
    </div>
  );
}