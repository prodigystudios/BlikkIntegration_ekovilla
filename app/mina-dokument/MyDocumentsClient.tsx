"use client";

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useToast } from '@/lib/Toast';

type MyDocumentItem = {
  publicationId: string;
  assignedAt: string;
  title: string;
  description: string | null;
  versionLabel: string | null;
  dueAt: string | null;
  requiresApproval: boolean;
  file: { id: string; file_name: string; content_type: string | null } | null;
  receipt: {
    firstOpenedAt: string | null;
    lastOpenedAt: string | null;
    approvedAt: string | null;
    approvalNote: string | null;
  } | null;
};

type MyDocumentsResponse = { ok: true; items: MyDocumentItem[] } | { ok: false; error: string };

function isCompleted(item: MyDocumentItem) {
  return !!item.receipt?.approvedAt || (!item.requiresApproval && !!item.receipt?.firstOpenedAt);
}

function statusLabel(item: MyDocumentItem) {
  if (item.receipt?.approvedAt) return 'Godkänt';
  if (item.receipt?.firstOpenedAt) return item.requiresApproval ? 'Läst, väntar på godkännande' : 'Klart';
  return 'Ej öppnat';
}

function sortItems(items: MyDocumentItem[]) {
  return [...items].sort((a, b) => {
    const aDone = isCompleted(a);
    const bDone = isCompleted(b);
    if (aDone !== bDone) return aDone ? 1 : -1;
    const aDue = a.dueAt || '9999-12-31T00:00:00.000Z';
    const bDue = b.dueAt || '9999-12-31T00:00:00.000Z';
    return aDue.localeCompare(bDue) || b.assignedAt.localeCompare(a.assignedAt);
  });
}

export default function MyDocumentsClient() {
  const toast = useToast();
  const [items, setItems] = useState<MyDocumentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/documents/publications/mine', { cache: 'no-store' });
      const json = await res.json() as MyDocumentsResponse;
      if (!res.ok || !json || json.ok === false) throw new Error((json as any).error || 'Kunde inte ladda dokument');
      setItems(sortItems(json.items || []));
    } catch (e: any) {
      setError(e?.message || 'Kunde inte ladda dokument');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openItem = useCallback(async (item: MyDocumentItem) => {
    if (!item.file?.id) return;
    setBusyId(item.publicationId);
    try {
      const [openRes, fileRes] = await Promise.all([
        fetch(`/api/documents/publications/${encodeURIComponent(item.publicationId)}/open`, { method: 'POST' }),
        fetch(`/api/documents/files/download?id=${encodeURIComponent(item.file.id)}`, { cache: 'no-store' }),
      ]);
      const openJson = await openRes.json().catch(() => ({}));
      const fileJson = await fileRes.json().catch(() => ({}));
      if (!openRes.ok || !openJson?.ok) throw new Error(openJson?.error || 'Kunde inte registrera öppning');
      if (!fileRes.ok || !fileJson?.ok || !fileJson?.url) throw new Error(fileJson?.error || 'Kunde inte öppna dokument');
      window.open(fileJson.url, '_blank', 'noopener,noreferrer');
      await load();
    } catch (e: any) {
      toast.error(e?.message || 'Kunde inte öppna dokument');
    } finally {
      setBusyId(null);
    }
  }, [load, toast]);

  const approveItem = useCallback(async (item: MyDocumentItem) => {
    setBusyId(item.publicationId);
    try {
      const res = await fetch(`/api/documents/publications/${encodeURIComponent(item.publicationId)}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Kunde inte godkänna dokument');
      toast.success('Dokument godkänt');
      await load();
    } catch (e: any) {
      toast.error(e?.message || 'Kunde inte godkänna dokument');
    } finally {
      setBusyId(null);
    }
  }, [load, toast]);

  const pendingItems = useMemo(() => items.filter(item => !isCompleted(item)), [items]);
  const completedItems = useMemo(() => items.filter(item => isCompleted(item)), [items]);

  return (
    <section style={{ display: 'grid', gap: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <div>
          <h1 style={{ margin: 0 }}>Mina dokument</h1>
          <p style={{ margin: '6px 0 0', color: '#6b7280' }}>Dokument som du har blivit tilldelad att läsa och godkänna.</p>
        </div>
        <button type="button" onClick={load} style={secondaryBtn}>Uppdatera</button>
      </div>

      {loading && <div style={emptyBox}>Laddar dokument…</div>}
      {error && !loading && <div style={{ ...emptyBox, color: '#991b1b' }}>{error}</div>}

      {!loading && !error && pendingItems.length === 0 && completedItems.length === 0 && (
        <div style={emptyBox}>Du har inga tilldelade dokument just nu.</div>
      )}

      {!loading && !error && pendingItems.length > 0 && (
        <div style={{ display: 'grid', gap: 12 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>Väntar på dig ({pendingItems.length})</h2>
          {pendingItems.map(item => (
            <article key={item.publicationId} style={cardStyle}>
              <div style={{ display: 'grid', gap: 8 }}>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                  <strong style={{ fontSize: 17 }}>{item.title}</strong>
                  <span style={statusChip(item)}>{statusLabel(item)}</span>
                  {item.versionLabel && <span style={minorChip}>Version {item.versionLabel}</span>}
                </div>
                {item.description && <p style={{ margin: 0, color: '#374151', whiteSpace: 'pre-wrap' }}>{item.description}</p>}
                <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', color: '#6b7280', fontSize: 13 }}>
                  <span>Fil: {item.file?.file_name || 'Saknas'}</span>
                  {item.dueAt && <span>Senast: {new Date(item.dueAt).toLocaleString('sv-SE')}</span>}
                  {item.receipt?.firstOpenedAt && <span>Först öppnat: {new Date(item.receipt.firstOpenedAt).toLocaleString('sv-SE')}</span>}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                <button type="button" onClick={() => openItem(item)} disabled={busyId === item.publicationId || !item.file?.id} style={secondaryBtn}>
                  Öppna dokument
                </button>
                {item.requiresApproval && (
                  <button type="button" onClick={() => approveItem(item)} disabled={busyId === item.publicationId} style={primaryBtn}>
                    Jag godkänner
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}

      {!loading && !error && completedItems.length > 0 && (
        <details>
          <summary style={{ cursor: 'pointer', color: '#374151', fontWeight: 600 }}>Tidigare klara ({completedItems.length})</summary>
          <div style={{ display: 'grid', gap: 12, marginTop: 12 }}>
            {completedItems.map(item => (
              <article key={item.publicationId} style={{ ...cardStyle, background: '#f8fafc' }}>
                <div style={{ display: 'grid', gap: 8 }}>
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                    <strong style={{ fontSize: 16 }}>{item.title}</strong>
                    <span style={statusChip(item)}>{statusLabel(item)}</span>
                    {item.versionLabel && <span style={minorChip}>Version {item.versionLabel}</span>}
                  </div>
                  <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', color: '#6b7280', fontSize: 13 }}>
                    <span>
                      {item.requiresApproval ? 'Godkänt' : 'Klart'}: {
                        item.receipt?.approvedAt
                          ? new Date(item.receipt.approvedAt).toLocaleString('sv-SE')
                          : item.receipt?.firstOpenedAt
                            ? new Date(item.receipt.firstOpenedAt).toLocaleString('sv-SE')
                            : '-'
                      }
                    </span>
                    <span>Fil: {item.file?.file_name || 'Saknas'}</span>
                  </div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button type="button" onClick={() => openItem(item)} disabled={busyId === item.publicationId || !item.file?.id} style={secondaryBtn}>
                    Öppna igen
                  </button>
                </div>
              </article>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}

const cardStyle: React.CSSProperties = {
  border: '1px solid #e5e7eb',
  borderRadius: 16,
  background: '#fff',
  padding: '18px 20px',
  display: 'grid',
  gap: 14,
};

const emptyBox: React.CSSProperties = {
  border: '1px solid #e5e7eb',
  borderRadius: 16,
  background: '#fff',
  padding: '20px 22px',
  color: '#6b7280',
};

const primaryBtn: React.CSSProperties = {
  padding: '10px 14px',
  borderRadius: 10,
  border: '1px solid #111827',
  background: '#111827',
  color: '#fff',
  fontWeight: 600,
  cursor: 'pointer',
};

const secondaryBtn: React.CSSProperties = {
  padding: '10px 14px',
  borderRadius: 10,
  border: '1px solid #d1d5db',
  background: '#fff',
  color: '#111827',
  fontWeight: 600,
  cursor: 'pointer',
};

const minorChip: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '4px 8px',
  borderRadius: 999,
  background: '#eef2ff',
  color: '#4338ca',
  fontSize: 12,
  fontWeight: 700,
};

function statusChip(item: MyDocumentItem): React.CSSProperties {
  if (isCompleted(item)) {
    return {
      display: 'inline-flex',
      alignItems: 'center',
      padding: '4px 8px',
      borderRadius: 999,
      background: '#dcfce7',
      color: '#166534',
      fontSize: 12,
      fontWeight: 700,
    };
  }
  if (item.receipt?.firstOpenedAt) {
    return {
      display: 'inline-flex',
      alignItems: 'center',
      padding: '4px 8px',
      borderRadius: 999,
      background: '#fef3c7',
      color: '#92400e',
      fontSize: 12,
      fontWeight: 700,
    };
  }
  return {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '4px 8px',
    borderRadius: 999,
    background: '#fee2e2',
    color: '#991b1b',
    fontSize: 12,
    fontWeight: 700,
  };
}
