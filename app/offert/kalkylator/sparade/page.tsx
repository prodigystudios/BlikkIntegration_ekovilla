'use client';

export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/lib/Toast';

type SavedItem = {
  id: string;
  name: string;
  address: string;
  city: string;
  phone: string;
  quote_date: string;
  next_meeting_date?: string | null;
  salesperson: string;
  salesperson_phone?: string | null;
  status?: string | null;
  created_at: string;
  subtotal: number;
  total_before_rot: number;
  rot_amount: number;
  total_after_rot: number;
  customer_submitted_at?: string | null;
};

function formatKr(value: number) {
  const v = Number.isFinite(value) ? value : 0;
  return `${Math.round(v).toLocaleString('sv-SE')} kr`;
}

type SortMode =
  | 'created_desc'
  | 'created_asc'
  | 'quote_date_desc'
  | 'quote_date_asc'
  | 'name_asc'
  | 'name_desc'
  | 'status_asc'
  | 'status_desc'
  | 'total_after_rot_desc'
  | 'total_after_rot_asc';

export default function SparadeOfferterPage() {
  const toast = useToast();
  const router = useRouter();
  const [items, setItems] = useState<SavedItem[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [sharingId, setSharingId] = useState<string | null>(null);
  const [customerLinkingId, setCustomerLinkingId] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>('created_desc');

  const statusOptions = useMemo(() => ['Återkoppling', 'Bekräftad', 'Förlorad'] as const, []);

  const statusSelectClass = (status: string) => {
    if (status === 'Bekräftad') return 'status-select--confirmed';
    if (status === 'Förlorad') return 'status-select--lost';
    return '';
  };

  const safeFilename = (name: string) => {
    return (name || 'offert')
      .replace(/[^a-z0-9\-_ ]/gi, '')
      .trim()
      .replace(/\s+/g, '_')
      .slice(0, 60) || 'offert';
  };

  const sharePdf = async (id: string, name: string) => {
    setSharingId(id);
    try {
      const res = await fetch(`/api/pdf/offert-kalkylator/${encodeURIComponent(id)}`, { method: 'GET' });
      if (!res.ok) {
        const ct = res.headers.get('content-type') || '';
        if (ct.includes('application/json')) {
          const json = await res.json();
          throw new Error(json?.error || 'Kunde inte skapa PDF.');
        }
        throw new Error('Kunde inte skapa PDF.');
      }

      const blob = await res.blob();
      const filename = `${safeFilename(name)}.pdf`;

      const file = new File([blob], filename, { type: 'application/pdf' });
      const nav: any = navigator;

      if (nav?.share && (!nav?.canShare || nav.canShare({ files: [file] }))) {
        await nav.share({ files: [file], title: 'Offert PDF' });
        return;
      }

      // Fallback: download
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success('PDF nedladdad.');
    } catch (e: any) {
      toast.error(e?.message || String(e));
    } finally {
      setSharingId(null);
    }
  };

  const createCustomerLink = async (id: string) => {
    setCustomerLinkingId(id);
    try {
      const res = await fetch(`/api/offert-kalkylator/${encodeURIComponent(id)}/customer-link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error || 'Kunde inte skapa kundlänk.');
      const url = String(json?.url || '').trim();
      if (!url) throw new Error('Kunde inte skapa kundlänk.');

      try {
        await navigator.clipboard.writeText(url);
        toast.success('Kundlänk skapad och kopierad.', { ttl: 4500 });
      } catch {
        toast.success('Kundlänk skapad.', { ttl: 4500 });
        // Fallback: show a prompt so it can be copied manually.
        window.prompt('Kundlänk (kopiera):', url);
      }
    } catch (e: any) {
      toast.error(e?.message || String(e));
    } finally {
      setCustomerLinkingId(null);
    }
  };

  const refreshList = async () => {
    setLoadingList(true);
    try {
      const res = await fetch('/api/offert-kalkylator', { method: 'GET' });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Kunde inte hämta sparade offerter.');
      setItems(Array.isArray(json?.items) ? json.items : []);
    } catch (e: any) {
      toast.error(e?.message || String(e));
    } finally {
      setLoadingList(false);
    }
  };

  useEffect(() => {
    refreshList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sortedItems = useMemo(() => {
    const arr = [...items];
    const byCreatedDesc = (a: SavedItem, b: SavedItem) => String(b.created_at).localeCompare(String(a.created_at));

    const statusOrder: Record<string, number> = {
      'Återkoppling': 0,
      'Bekräftad': 1,
      'Förlorad': 2,
    };

    const statusRank = (s: SavedItem) => {
      const key = String(s.status || 'Återkoppling');
      return statusOrder[key] ?? 99;
    };

    arr.sort((a, b) => {
      switch (sortMode) {
        case 'created_desc':
          return byCreatedDesc(a, b);
        case 'created_asc':
          return String(a.created_at).localeCompare(String(b.created_at));
        case 'quote_date_desc':
          return String(b.quote_date).localeCompare(String(a.quote_date)) || byCreatedDesc(a, b);
        case 'quote_date_asc':
          return String(a.quote_date).localeCompare(String(b.quote_date)) || byCreatedDesc(a, b);
        case 'name_asc':
          return String(a.name).localeCompare(String(b.name), 'sv', { sensitivity: 'base' }) || byCreatedDesc(a, b);
        case 'name_desc':
          return String(b.name).localeCompare(String(a.name), 'sv', { sensitivity: 'base' }) || byCreatedDesc(a, b);
        case 'status_asc':
          return statusRank(a) - statusRank(b) || byCreatedDesc(a, b);
        case 'status_desc':
          return statusRank(b) - statusRank(a) || byCreatedDesc(a, b);
        case 'total_after_rot_desc':
          return Number(b.total_after_rot) - Number(a.total_after_rot) || byCreatedDesc(a, b);
        case 'total_after_rot_asc':
          return Number(a.total_after_rot) - Number(b.total_after_rot) || byCreatedDesc(a, b);
        default:
          return byCreatedDesc(a, b);
      }
    });

    return arr;
  }, [items, sortMode]);

  const openInCalculator = (id: string) => {
    setLoadingId(id);
    router.push(`/offert/kalkylator?load=${encodeURIComponent(id)}`);
  };

  const del = async (id: string) => {
    setDeletingId(id);
    try {
      const res = await fetch(`/api/offert-kalkylator/${encodeURIComponent(id)}`, { method: 'DELETE' });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Kunde inte ta bort offert.');
      toast.success('Offert borttagen.');
      await refreshList();
    } catch (e: any) {
      toast.error(e?.message || String(e));
    } finally {
      setDeletingId(null);
    }
  };

  const updateStatus = async (id: string, status: string) => {
    setUpdatingId(id);
    try {
      // optimistic UI
      setItems((prev) => prev.map((x) => (x.id === id ? { ...x, status } : x)));
      const res = await fetch(`/api/offert-kalkylator/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Kunde inte uppdatera status.');
      toast.success('Status uppdaterad.', { ttl: 3000 });
    } catch (e: any) {
      toast.error(e?.message || String(e));
      await refreshList();
    } finally {
      setUpdatingId(null);
    }
  };

  return (
    <div style={{ padding: 16, maxWidth: 980, margin: '0 auto', display: 'grid', gap: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'grid', gap: 4 }}>
          <h1 style={{ margin: 0, fontSize: 18 }}>Sparade offerter</h1>
          <p style={{ margin: 0, fontSize: 12, color: '#64748b' }}>Här kan du sortera, ladda och ta bort offerter.</p>
        </div>
        <Link className="btn--plain btn--sm" href="/offert/kalkylator">
          Till kalkylatorn
        </Link>
      </div>

      <section style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 12, background: '#ffffff', display: 'grid', gap: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <strong style={{ fontSize: 13 }}>LISTA</strong>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#334155' }}>
              <span>Sortera</span>
              <select className="select-field" value={sortMode} onChange={(e) => setSortMode(e.target.value as SortMode)}>
                <option value="created_desc">Senast Sparad</option>
                <option value="created_asc">Äldst sparad</option>
                <option value="quote_date_desc">Offertdatum (nyast)</option>
                <option value="quote_date_asc">Offertdatum (äldst)</option>
                <option value="name_asc">Namn (A–Ö)</option>
                <option value="name_desc">Namn (Ö–A)</option>
                <option value="status_asc">Status (Återkoppling → Förlorad)</option>
                <option value="status_desc">Status (Förlorad → Återkoppling)</option>
                <option value="total_after_rot_desc">Efter ROT (högst)</option>
                <option value="total_after_rot_asc">Efter ROT (lägst)</option>
              </select>
            </label>
            <button className="btn--plain btn--sm" onClick={refreshList} disabled={loadingList}>
              {loadingList ? 'Uppdaterar…' : 'Uppdatera'}
            </button>
          </div>
        </div>

        {items.length === 0 ? (
          <div style={{ fontSize: 12, color: '#64748b' }}>Inga sparade offerter ännu.</div>
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            {sortedItems.map((it) => (
              <div
                key={it.id}
                style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 10, display: 'grid', gap: 8, background: '#fff' }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                  <div style={{ display: 'grid', gap: 2 }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <div style={{ fontWeight: 700, fontSize: 13 }}>{it.name}</div>
                      {String(it.customer_submitted_at || '').trim() && (
                        <span
                          style={{
                            fontSize: 11,
                            padding: '2px 8px',
                            borderRadius: 999,
                            border: '1px solid #16a34a',
                            background: '#dcfce7',
                            color: '#14532d',
                            whiteSpace: 'nowrap',
                          }}
                          title={`Inskickat: ${new Date(String(it.customer_submitted_at)).toLocaleString('sv-SE')}`}
                        >
                          Kund lämnat uppgifter {new Date(String(it.customer_submitted_at)).toLocaleDateString('sv-SE')}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: '#64748b' }}>
                      {it.address} • {it.city} • {it.quote_date} • {it.salesperson}{String(it.salesperson_phone || '').trim() ? ` (${String(it.salesperson_phone).trim()})` : ''}
                    </div>
                    {it.next_meeting_date && (
                      <div style={{ fontSize: 12, color: '#64748b' }}>Nästa möte: {String(it.next_meeting_date)}</div>
                    )}
                    <div style={{ fontSize: 12, color: '#94a3b8' }}>{new Date(it.created_at).toLocaleString('sv-SE')}</div>
                  </div>
                  <div style={{ display: 'grid', gap: 2, textAlign: 'right' }}>
                    <div style={{ fontSize: 12, color: '#334155' }}>Efter ROT</div>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>{formatKr(it.total_after_rot)}</div>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#334155' }}>
                    <span>Status</span>
                    <select
                      className={`select-field ${statusSelectClass(String(it.status || 'Återkoppling'))}`}
                      value={String(it.status || 'Återkoppling')}
                      disabled={updatingId === it.id || deletingId === it.id || loadingId === it.id}
                      onChange={(e) => updateStatus(it.id, e.target.value)}
                      style={{ minWidth: 180 }}
                    >
                      {statusOptions.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <button
                    className="btn--primary btn--sm"
                    onClick={() => openInCalculator(it.id)}
                    disabled={loadingId === it.id || deletingId === it.id || updatingId === it.id || sharingId === it.id}
                  >
                    {loadingId === it.id ? 'Öppnar…' : 'Öppna i kalkylatorn'}
                  </button>
                  <button
                    className="btn--success btn--sm"
                    onClick={() => sharePdf(it.id, it.name)}
                    disabled={loadingId === it.id || deletingId === it.id || updatingId === it.id || sharingId === it.id || customerLinkingId === it.id}
                  >
                    {sharingId === it.id ? 'Skapar…' : 'Skapa PDF'}
                  </button>

                  <button
                    className="btn--plain btn--sm"
                    onClick={() => createCustomerLink(it.id)}
                    disabled={loadingId === it.id || deletingId === it.id || updatingId === it.id || sharingId === it.id || customerLinkingId === it.id}
                  >
                    {customerLinkingId === it.id ? 'Skapar…' : 'Skapa kundlänk'}
                  </button>

                  <span style={{ flex: 1 }} />

                  <button
                    className="btn--danger btn--sm"
                    onClick={() => del(it.id)}
                    disabled={deletingId === it.id || loadingId === it.id || updatingId === it.id || sharingId === it.id || customerLinkingId === it.id}
                  >
                    {deletingId === it.id ? 'Tar bort…' : 'Ta bort'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
