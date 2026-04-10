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
  const highlightTone = pendingCount > 0
    ? { border: '1px solid #bfdbfe', background: 'linear-gradient(180deg, #eff6ff 0%, #ffffff 100%)' }
    : { border: '1px solid #e5e7eb', background: '#ffffff' };

  return (
    <div style={{ display: 'grid', gap: compact ? 10 : 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ display:'grid', gap:4 }}>
          <div style={{ display:'inline-flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
            <h2 style={{ margin: 0, fontSize: compact ? 16 : 20 }}>Dokument att kvittera</h2>
            <span style={{ display:'inline-flex', alignItems:'center', gap:6, padding:'4px 8px', borderRadius:999, background: pendingCount > 0 ? '#dbeafe' : '#f1f5f9', color: pendingCount > 0 ? '#1d4ed8' : '#64748b', fontSize:11, fontWeight:700 }}>
              {pendingCount > 0 ? `${pendingCount} väntar` : 'Allt klart'}
            </span>
          </div>
          {(!compact || pendingCount > 0) && <p style={{ margin:0, fontSize: compact ? 12 : 13, color:'#64748b' }}>Dokument som kräver läsning eller godkännande ska fångas direkt.</p>}
        </div>
        <Link href="/mina-dokument" style={{ color: '#2563eb', fontSize: 13, fontWeight: 700, textDecoration: 'none' }}>
          Öppna alla
        </Link>
      </div>

      {loading && <p style={{ margin: 0, fontSize: 12, color: '#6b7280' }}>Laddar…</p>}
      {error && <p style={{ margin: 0, fontSize: 12, color: '#b91c1c' }}>{error}</p>}
      {!loading && !error && pendingCount === 0 && (
        <div style={{ display:'inline-flex', alignItems:'center', gap:8, width:'fit-content', padding: compact ? '8px 10px' : '10px 12px', borderRadius:999, background:'#f0fdf4', border:'1px solid #bbf7d0', color:'#166534', fontSize: compact ? 12 : 13, fontWeight:600 }}>
          <span style={{ width:8, height:8, borderRadius:'50%', background:'#22c55e' }} />
          Inga dokument väntar på kvittens.
        </div>
      )}
      {!loading && !error && pendingCount > 0 && (
        <>
          <div style={{ ...highlightTone, borderRadius: 16, padding: compact ? '10px 12px' : '12px 14px', display:'grid', gap:4 }}>
            <p style={{ margin: 0, color: '#0f172a', fontSize: compact ? 13 : 14, fontWeight:700 }}>
              {pendingCount} dokument väntar på att du läser eller godkänner dem.
            </p>
            <p style={{ margin: 0, color: '#64748b', fontSize: compact ? 11.5 : 12.5 }}>
              Börja med det som har deadline eller kräver aktiv kvittens.
            </p>
          </div>
          <div style={{ display: 'grid', gap: 8 }}>
            {pendingItems.map(item => (
              <div key={item.publicationId} style={{ border: '1px solid #dbe4ef', background: '#f8fbff', borderRadius: 14, padding: compact ? '10px 12px' : '12px 14px', display: 'grid', gap: 8, boxShadow:'0 6px 16px rgba(15,23,42,0.04)' }}>
                <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:8 }}>
                  <strong style={{ fontSize: compact ? 13.5 : 15, color:'#0f172a' }}>{item.title}</strong>
                  <span style={{ flex:'0 0 auto', display:'inline-flex', alignItems:'center', gap:4, padding:'4px 7px', borderRadius:999, background: item.requiresApproval ? '#dbeafe' : '#ecfeff', color: item.requiresApproval ? '#1d4ed8' : '#0f766e', fontSize:10.5, fontWeight:700 }}>
                    {item.requiresApproval ? 'Godkänn' : 'Läs'}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                  <span style={{ fontSize: compact ? 11 : 12, color: '#6b7280' }}>
                    {item.dueAt ? `Senast ${new Date(item.dueAt).toLocaleDateString('sv-SE')}` : 'Ingen deadline'}
                  </span>
                  <Link href="/mina-dokument" style={{ color: '#111827', fontSize: compact ? 12 : 13, fontWeight: 700, textDecoration: 'none', padding:'6px 10px', border:'1px solid #cbd5e1', borderRadius:10, background:'#fff' }}>
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
