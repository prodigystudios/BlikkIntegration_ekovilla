"use client";

import Link from 'next/link';
import React, { useEffect, useMemo, useState } from 'react';

type DashboardDocumentItem = {
  publicationId: string;
  title: string;
  dueAt: string | null;
  requiresApproval: boolean;
  receipt: { approvedAt: string | null; firstOpenedAt?: string | null } | null;
};

function isCompleted(item: DashboardDocumentItem) {
  return !!item.receipt?.approvedAt || (!item.requiresApproval && !!item.receipt?.firstOpenedAt);
}

export default function DashboardDocumentApprovals({ compact }: { compact?: boolean }) {
  const [items, setItems] = useState<DashboardDocumentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const res = await fetch('/api/documents/publications/mine', { cache: 'no-store' });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json?.ok) throw new Error(json?.error || 'Kunde inte ladda dokument');
        if (!active) return;
        setItems(Array.isArray(json.items) ? json.items : []);
      } catch (e: any) {
        if (!active) return;
        setError(e?.message || 'Kunde inte ladda dokument');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  const pendingItems = useMemo(
    () => items.filter(item => !isCompleted(item)).slice(0, 3),
    [items]
  );
  const pendingCount = items.filter(item => !isCompleted(item)).length;

  return (
    <div style={{ display: 'grid', gap: compact ? 10 : 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <h2 style={{ margin: 0, fontSize: compact ? 16 : 20 }}>Dokument att kvittera</h2>
        <Link href="/mina-dokument" style={{ color: '#2563eb', fontSize: 13, fontWeight: 700, textDecoration: 'none' }}>
          Öppna alla
        </Link>
      </div>

      {loading && <p style={{ margin: 0, fontSize: 12, color: '#6b7280' }}>Laddar…</p>}
      {error && <p style={{ margin: 0, fontSize: 12, color: '#b91c1c' }}>{error}</p>}
      {!loading && !error && pendingCount === 0 && (
        <p style={{ margin: 0, fontSize: compact ? 12 : 14, color: '#6b7280' }}>Inga dokument väntar på kvittens.</p>
      )}
      {!loading && !error && pendingCount > 0 && (
        <>
          <p style={{ margin: 0, color: '#111827', fontSize: compact ? 13 : 14 }}>
            {pendingCount} dokument väntar på att du läser eller godkänner dem.
          </p>
          <div style={{ display: 'grid', gap: 8 }}>
            {pendingItems.map(item => (
              <div key={item.publicationId} style={{ border: '1px solid #e5e7eb', background: '#f8fafc', borderRadius: 10, padding: compact ? '8px 10px' : '10px 12px', display: 'grid', gap: 6 }}>
                <strong style={{ fontSize: compact ? 13.5 : 15 }}>{item.title}</strong>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                  <span style={{ fontSize: compact ? 11 : 12, color: '#6b7280' }}>
                    {item.dueAt ? `Senast ${new Date(item.dueAt).toLocaleDateString('sv-SE')}` : 'Ingen deadline'}
                  </span>
                  <Link href="/mina-dokument" style={{ color: '#111827', fontSize: compact ? 12 : 13, fontWeight: 700, textDecoration: 'none' }}>
                    Hantera
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
