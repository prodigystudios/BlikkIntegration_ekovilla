'use client';

export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/lib/Toast';

type SavedItem = {
  id: string;
  offert_number_year?: number | null;
  offert_number_seq?: number | null;
  name: string;
  address: string;
  city: string;
  phone: string;
  quote_date: string;
  next_meeting_date?: string | null;
  salesperson: string;
  salesperson_phone?: string | null;
  status?: string | null;
  internal_note?: string | null;
  created_at: string;
  updated_at?: string | null;
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

function formatOffertNumber(year: any, seq: any) {
  const y = Number(year);
  const s = Number(seq);
  if (!Number.isFinite(y) || !Number.isFinite(s) || y <= 0 || s <= 0) return '';
  return `${y}-${String(Math.trunc(s)).padStart(5, '0')}`;
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
  const [isNarrow, setIsNarrow] = useState(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [savingNoteId, setSavingNoteId] = useState<string | null>(null);

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

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const media = window.matchMedia('(max-width: 940px)');
    const update = () => setIsNarrow(media.matches);
    update();
    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', update);
      return () => media.removeEventListener('change', update);
    }
    media.addListener(update);
    return () => media.removeListener(update);
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

  const selectedItem = useMemo(() => items.find((item) => item.id === selectedId) ?? null, [items, selectedId]);

  const activityItems = useMemo(() => {
    if (!selectedItem) return [] as Array<{ id: string; label: string; detail: string; tone: 'neutral' | 'success' | 'warning'; at?: string | null }>;

    const status = String(selectedItem.status || 'Återkoppling');
    const hasUpdatedAt = Boolean(selectedItem.updated_at && selectedItem.updated_at !== selectedItem.created_at);
    const items: Array<{ id: string; label: string; detail: string; tone: 'neutral' | 'success' | 'warning'; at?: string | null }> = [
      {
        id: 'created',
        label: 'Offert skapad',
        detail: `Offerten skapades för ${selectedItem.name || 'kund'} och lades till i arkivet.`,
        tone: 'neutral',
        at: selectedItem.created_at,
      },
      {
        id: 'status',
        label: 'Nuvarande status',
        detail: status === 'Bekräftad' ? 'Offerten är markerad som bekräftad.' : status === 'Förlorad' ? 'Offerten är markerad som förlorad.' : 'Offerten väntar på återkoppling.',
        tone: status === 'Bekräftad' ? 'success' : status === 'Förlorad' ? 'warning' : 'neutral',
        at: hasUpdatedAt ? selectedItem.updated_at : selectedItem.created_at,
      },
    ];

    if (selectedItem.customer_submitted_at) {
      items.push({
        id: 'customer-submitted',
        label: 'Kunduppgifter inkomna',
        detail: 'Kunden har öppnat kundflödet och skickat in sina uppgifter.',
        tone: 'success',
        at: selectedItem.customer_submitted_at,
      });
    }

    if (selectedItem.next_meeting_date) {
      items.push({
        id: 'next-meeting',
        label: 'Nästa uppföljning planerad',
        detail: `Nästa möte eller uppföljning är satt till ${selectedItem.next_meeting_date}.`,
        tone: 'neutral',
        at: selectedItem.next_meeting_date,
      });
    }

    if (String(selectedItem.internal_note || '').trim()) {
      items.push({
        id: 'note',
        label: 'Intern anteckning finns',
        detail: 'Det finns intern säljinformation sparad på offerten.',
        tone: 'warning',
        at: hasUpdatedAt ? selectedItem.updated_at : null,
      });
    }

    return items.sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
  }, [selectedItem]);

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
      setSelectedId((current) => (current === id ? null : current));
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
      const res = await fetch(`/api/offert-kalkylator/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Kunde inte uppdatera status.');
      if (json?.item?.id) {
        setItems((prev) => prev.map((x) => (x.id === id ? { ...x, ...json.item, customer_submitted_at: x.customer_submitted_at } : x)));
      } else {
        setItems((prev) => prev.map((x) => (x.id === id ? { ...x, status } : x)));
      }
      toast.success('Status uppdaterad.', { ttl: 3000 });
    } catch (e: any) {
      toast.error(e?.message || String(e));
      await refreshList();
    } finally {
      setUpdatingId(null);
    }
  };

  const saveInternalNote = async () => {
    if (!selectedItem) return;
    setSavingNoteId(selectedItem.id);
    try {
      const res = await fetch(`/api/offert-kalkylator/${encodeURIComponent(selectedItem.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ internalNote: noteDraft }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Kunde inte spara anteckning.');
      if (json?.item?.id) {
        setItems((prev) => prev.map((x) => (x.id === selectedItem.id ? { ...x, ...json.item, customer_submitted_at: x.customer_submitted_at } : x)));
        setNoteDraft(String(json.item.internal_note || ''));
      }
      toast.success('Anteckning sparad.', { ttl: 2800 });
    } catch (e: any) {
      toast.error(e?.message || String(e));
    } finally {
      setSavingNoteId(null);
    }
  };

  const statusTone = (status: string) => {
    if (status === 'Bekräftad') return { bg: '#dcfce7', border: '#86efac', text: '#166534' };
    if (status === 'Förlorad') return { bg: '#fee2e2', border: '#fecaca', text: '#991b1b' };
    return { bg: '#fef3c7', border: '#fde68a', text: '#92400e' };
  };

  useEffect(() => {
    if (!selectedId) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSelectedId(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedId]);

  useEffect(() => {
    setNoteDraft(String(selectedItem?.internal_note || ''));
  }, [selectedItem]);

  return (
    <div style={{ padding: isNarrow ? 14 : 18, maxWidth: 1180, margin: '0 auto', display: 'grid', gap: 16 }}>
      <div style={{ border: '1px solid #dbe4ef', borderRadius: 24, padding: isNarrow ? '16px 16px 14px' : '20px 22px 18px', background: 'linear-gradient(180deg, #ffffff 0%, #f7fbff 100%)', display: 'grid', gap: 14, boxShadow: '0 14px 36px rgba(15,23,42,0.05)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ display: 'grid', gap: 6, maxWidth: 760 }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={heroEyebrowStyle}>Offertarkiv</span>
              <span style={{ fontSize: 11, color: '#64748b' }}>{items.length} sparade offerter</span>
            </div>
            <h1 style={{ margin: 0, fontSize: isNarrow ? 28 : 34, lineHeight: 1.05, color: '#0f172a' }}>Sparade offerter</h1>
            <p style={{ margin: 0, fontSize: 14, color: '#475569', maxWidth: 760 }}>Här kan du sortera, öppna, dela och följa upp tidigare offerter i en tydligare översikt.</p>
          </div>
          <Link className="btn--plain btn--sm" href="/offert/kalkylator" style={ghostLinkStyle}>
            Till kalkylatorn
          </Link>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <span style={metaChipStyle}>{items.length} totalt</span>
          <span style={metaChipStyle}>{sortedItems.filter((item) => String(item.status || 'Återkoppling') === 'Bekräftad').length} bekräftade</span>
          <span style={metaChipStyle}>{sortedItems.filter((item) => String(item.status || 'Återkoppling') === 'Återkoppling').length} återkoppling</span>
        </div>
      </div>

      <section style={{ border: '1px solid #dbe4ef', borderRadius: 20, padding: 14, background: '#ffffff', display: 'grid', gap: 12, boxShadow: '0 12px 28px rgba(15,23,42,0.04)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ display: 'grid', gap: 3 }}>
            <strong style={{ fontSize: 12, letterSpacing: 0.35, textTransform: 'uppercase', color: '#0f172a' }}>Lista</strong>
            <span style={{ fontSize: 12, color: '#64748b' }}>Sortera offertlistan och öppna rätt ärende snabbare.</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#334155' }}>
              <span>Sortera</span>
              <select className="select-field" style={selectFieldStyle} value={sortMode} onChange={(e) => setSortMode(e.target.value as SortMode)}>
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
          <div style={{ fontSize: 12, color: '#64748b', border: '1px dashed #cbd5e1', borderRadius: 16, padding: '16px 14px', background: '#f8fafc' }}>Inga sparade offerter ännu.</div>
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            {sortedItems.map((it) => (
              <div
                key={it.id}
                role="button"
                tabIndex={0}
                aria-label={`Öppna offert för ${it.name}`}
                onMouseEnter={() => setHoveredId(it.id)}
                onMouseLeave={() => setHoveredId(prev => (prev === it.id ? null : prev))}
                onClick={() => setSelectedId(it.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    setSelectedId(it.id);
                  }
                }}
                style={{ border: '1px solid #e2e8f0', borderRadius: 18, padding: '14px 14px 12px', display: 'grid', gap: 12, background: 'linear-gradient(180deg, #ffffff 0%, #fbfdff 100%)', boxShadow: hoveredId === it.id || selectedId === it.id ? '0 16px 30px rgba(15,23,42,0.07)' : '0 10px 22px rgba(15,23,42,0.03)', transition: 'box-shadow 160ms ease, border-color 160ms ease', borderColor: hoveredId === it.id || selectedId === it.id ? '#cbd5e1' : '#e2e8f0', cursor: 'pointer', outline: 'none' }}
              >
                <div style={{ display: 'grid', gridTemplateColumns: isNarrow ? '1fr' : 'minmax(0, 1fr) auto', gap: 12, alignItems: 'start' }}>
                  <div style={{ display: 'grid', gap: 6 }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <div style={{ fontWeight: 800, fontSize: 14, color: '#0f172a' }}>{it.name}</div>
                      {formatOffertNumber(it.offert_number_year, it.offert_number_seq) && (
                        <span
                          style={{
                            fontSize: 11,
                            padding: '2px 8px',
                            borderRadius: 999,
                            border: '1px solid #e5e7eb',
                            background: '#f8fafc',
                            color: '#334155',
                            whiteSpace: 'nowrap',
                          }}
                          title="Offertnummer"
                        >
                          {formatOffertNumber(it.offert_number_year, it.offert_number_seq)}
                        </span>
                      )}
                      <span style={{ ...metaChipStyle, background: statusTone(String(it.status || 'Återkoppling')).bg, border: `1px solid ${statusTone(String(it.status || 'Återkoppling')).border}`, color: statusTone(String(it.status || 'Återkoppling')).text }}>
                        {String(it.status || 'Återkoppling')}
                      </span>
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
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <span style={metaChipStyle}>{it.address}</span>
                      <span style={metaChipStyle}>{it.city}</span>
                      <span style={metaChipStyle}>Offertdatum {it.quote_date}</span>
                      <span style={metaChipStyle}>{it.salesperson}</span>
                    </div>
                    {it.next_meeting_date && (
                      <div style={{ fontSize: 12, color: '#64748b' }}>Nästa möte: {String(it.next_meeting_date)}</div>
                    )}
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                      <span style={{ fontSize: 12, color: '#94a3b8' }}>{new Date(it.created_at).toLocaleString('sv-SE')}</span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: '#2563eb' }}>Klicka för detaljer</span>
                    </div>
                  </div>
                  <div style={{ display: 'grid', gap: 8, textAlign: isNarrow ? 'left' : 'right', justifyItems: isNarrow ? 'start' : 'end' }}>
                    <div style={{ padding: '10px 12px', borderRadius: 14, border: '1px solid #bfdbfe', background: 'linear-gradient(180deg, #eff6ff 0%, #dbeafe 100%)', minWidth: isNarrow ? 'auto' : 150 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.25, textTransform: 'uppercase', color: '#1d4ed8' }}>Efter ROT</div>
                      <div style={{ fontWeight: 800, fontSize: 18, color: '#1d4ed8', marginTop: 4 }}>{formatKr(it.total_after_rot)}</div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: isNarrow ? 'flex-start' : 'flex-end' }}>
                      <span style={metaChipStyle}>Före ROT {formatKr(it.total_before_rot)}</span>
                      <span style={metaChipStyle}>ROT {formatKr(it.rot_amount)}</span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {selectedItem ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Offertdetaljer för ${selectedItem.name}`}
          onClick={() => setSelectedId(null)}
          style={modalOverlayStyle}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            style={{
              ...modalCardStyle,
              width: isNarrow ? 'calc(100vw - 24px)' : 'min(980px, calc(100vw - 48px))',
              marginTop: isNarrow ? 88 : 24,
              marginBottom: isNarrow ? 96 : 24,
              padding: isNarrow ? '16px 14px 14px' : '20px 20px 18px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ display: 'grid', gap: 8, minWidth: 0 }}>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <span style={heroEyebrowStyle}>Offertdetaljer</span>
                  {formatOffertNumber(selectedItem.offert_number_year, selectedItem.offert_number_seq) ? (
                    <span style={metaChipStyle}>{formatOffertNumber(selectedItem.offert_number_year, selectedItem.offert_number_seq)}</span>
                  ) : null}
                  <span style={{ ...metaChipStyle, background: statusTone(String(selectedItem.status || 'Återkoppling')).bg, border: `1px solid ${statusTone(String(selectedItem.status || 'Återkoppling')).border}`, color: statusTone(String(selectedItem.status || 'Återkoppling')).text }}>
                    {String(selectedItem.status || 'Återkoppling')}
                  </span>
                </div>
                <div style={{ display: 'grid', gap: 4 }}>
                  <h2 style={{ margin: 0, fontSize: isNarrow ? 24 : 30, lineHeight: 1.05, color: '#0f172a' }}>{selectedItem.name || 'Offert'}</h2>
                  <p style={{ margin: 0, fontSize: 14, color: '#475569' }}>Hantera status, kundlänk, PDF och offertinformation utan att belasta listvyn.</p>
                </div>
              </div>
              <button className="btn--plain btn--sm" onClick={() => setSelectedId(null)}>
                Stäng
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: isNarrow ? '1fr' : 'repeat(4, minmax(0, 1fr))', gap: 10 }}>
              <div style={previewStatCardStyle}>
                <span style={previewStatLabelStyle}>Delsumma</span>
                <strong style={previewStatValueStyle}>{formatKr(selectedItem.subtotal)}</strong>
              </div>
              <div style={previewStatCardStyle}>
                <span style={previewStatLabelStyle}>Före ROT</span>
                <strong style={previewStatValueStyle}>{formatKr(selectedItem.total_before_rot)}</strong>
              </div>
              <div style={previewStatCardStyle}>
                <span style={previewStatLabelStyle}>ROT</span>
                <strong style={{ ...previewStatValueStyle, color: '#92400e' }}>− {formatKr(selectedItem.rot_amount)}</strong>
              </div>
              <div style={{ ...previewStatCardStyle, background: 'linear-gradient(180deg, #eff6ff 0%, #dbeafe 100%)', border: '1px solid #bfdbfe' }}>
                <span style={{ ...previewStatLabelStyle, color: '#1d4ed8' }}>Efter ROT</span>
                <strong style={{ ...previewStatValueStyle, color: '#1d4ed8' }}>{formatKr(selectedItem.total_after_rot)}</strong>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: isNarrow ? '1fr' : 'minmax(0, 1.3fr) minmax(0, 1fr)', gap: 12 }}>
              <div style={{ display: 'grid', gap: 10 }}>
                <div style={modalSectionStyle}>
                  <div style={{ display: 'grid', gap: 4 }}>
                    <strong style={modalSectionTitleStyle}>Kontakt och plats</strong>
                    <span style={modalSectionTextStyle}>All grundinformation för offerten samlad på ett ställe.</span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: isNarrow ? '1fr' : 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
                    <div style={previewInfoCardStyle}>
                      <span style={previewInfoLabelStyle}>Kund</span>
                      <strong style={previewInfoValueStyle}>{selectedItem.name || '—'}</strong>
                      <span style={previewInfoMetaStyle}>{selectedItem.phone || 'Ingen kundtelefon angiven'}</span>
                      <span style={previewInfoMetaStyle}>{selectedItem.address || '—'}</span>
                      <span style={previewInfoMetaStyle}>{selectedItem.city || '—'}</span>
                    </div>
                    <div style={previewInfoCardStyle}>
                      <span style={previewInfoLabelStyle}>Ansvarig säljare</span>
                      <strong style={previewInfoValueStyle}>{selectedItem.salesperson || '—'}</strong>
                      <span style={previewInfoMetaStyle}>{String(selectedItem.salesperson_phone || '').trim() || 'Ingen telefon angiven'}</span>
                      <span style={previewInfoMetaStyle}>Offertdatum {selectedItem.quote_date || '—'}</span>
                      <span style={previewInfoMetaStyle}>{selectedItem.next_meeting_date ? `Nästa möte ${selectedItem.next_meeting_date}` : 'Inget nästa möte planerat'}</span>
                    </div>
                  </div>
                </div>

                <div style={modalSectionStyle}>
                  <div style={{ display: 'grid', gap: 4 }}>
                    <strong style={modalSectionTitleStyle}>Senaste aktivitet</strong>
                    <span style={modalSectionTextStyle}>CRM-flöde för vad som har hänt på offerten och vad som väntar.</span>
                  </div>
                  <div style={{ display: 'grid', gap: 10 }}>
                    {activityItems.map((activity) => (
                      <div key={activity.id} style={activityCardStyle(activity.tone)}>
                        <div style={{ display: 'grid', gap: 4 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                            <strong style={activityTitleStyle}>{activity.label}</strong>
                            {activity.at ? <span style={activityTimeStyle}>{formatActivityDate(activity.at)}</span> : null}
                          </div>
                          <span style={activityDetailStyle}>{activity.detail}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div style={modalSectionStyle}>
                  <div style={{ display: 'grid', gap: 4 }}>
                    <strong style={modalSectionTitleStyle}>Interna anteckningar</strong>
                    <span style={modalSectionTextStyle}>Säljanteckningar, uppföljningspunkter eller sådant som inte ska ligga i själva offerten.</span>
                  </div>
                  <textarea
                    value={noteDraft}
                    onChange={(event) => setNoteDraft(event.target.value)}
                    placeholder="Skriv intern anteckning här..."
                    style={noteTextareaStyle}
                    rows={isNarrow ? 5 : 6}
                  />
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 12, color: '#64748b' }}>
                      {String(selectedItem.internal_note || '').trim() ? 'Senast sparad internt på denna offert.' : 'Ingen intern anteckning sparad ännu.'}
                    </span>
                    <button
                      className="btn--primary btn--sm"
                      onClick={saveInternalNote}
                      disabled={savingNoteId === selectedItem.id || noteDraft === String(selectedItem.internal_note || '')}
                    >
                      {savingNoteId === selectedItem.id ? 'Sparar…' : 'Spara anteckning'}
                    </button>
                  </div>
                </div>
              </div>

              <div style={{ display: 'grid', gap: 10, alignContent: 'start' }}>
                <div style={modalSectionStyle}>
                  <div style={{ display: 'grid', gap: 4 }}>
                    <strong style={modalSectionTitleStyle}>Åtgärder</strong>
                    <span style={modalSectionTextStyle}>Det som tidigare låg i listan ligger nu samlat här.</span>
                  </div>
                  <label style={{ display: 'grid', gap: 6, fontSize: 12, color: '#334155' }}>
                    <span>Status</span>
                    <select
                      className={`select-field ${statusSelectClass(String(selectedItem.status || 'Återkoppling'))}`}
                      style={selectFieldStyle}
                      value={String(selectedItem.status || 'Återkoppling')}
                      disabled={updatingId === selectedItem.id || deletingId === selectedItem.id || loadingId === selectedItem.id}
                      onChange={(e) => updateStatus(selectedItem.id, e.target.value)}
                    >
                      {statusOptions.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </label>

                  <div style={{ display: 'grid', gap: 8 }}>
                    <button
                      className="btn--primary btn--sm"
                      onClick={() => openInCalculator(selectedItem.id)}
                      disabled={loadingId === selectedItem.id || deletingId === selectedItem.id || updatingId === selectedItem.id || sharingId === selectedItem.id}
                    >
                      {loadingId === selectedItem.id ? 'Öppnar…' : 'Öppna i kalkylatorn'}
                    </button>
                    <button
                      className="btn--success btn--sm"
                      onClick={() => sharePdf(selectedItem.id, selectedItem.name)}
                      disabled={loadingId === selectedItem.id || deletingId === selectedItem.id || updatingId === selectedItem.id || sharingId === selectedItem.id || customerLinkingId === selectedItem.id}
                    >
                      {sharingId === selectedItem.id ? 'Skapar…' : 'Skapa PDF'}
                    </button>
                    <button
                      className="btn--plain btn--sm"
                      onClick={() => createCustomerLink(selectedItem.id)}
                      disabled={loadingId === selectedItem.id || deletingId === selectedItem.id || updatingId === selectedItem.id || sharingId === selectedItem.id || customerLinkingId === selectedItem.id}
                    >
                      {customerLinkingId === selectedItem.id ? 'Skapar…' : 'Skapa kundlänk'}
                    </button>
                    <button
                      className="btn--danger btn--sm"
                      onClick={() => {
                        const ok = window.confirm(`Ta bort offert ”${String(selectedItem.name || '').trim() || 'offert'}”?`);
                        if (!ok) return;
                        del(selectedItem.id);
                      }}
                      disabled={deletingId === selectedItem.id || loadingId === selectedItem.id || updatingId === selectedItem.id || sharingId === selectedItem.id || customerLinkingId === selectedItem.id}
                    >
                      {deletingId === selectedItem.id ? 'Tar bort…' : 'Ta bort offert'}
                    </button>
                  </div>
                </div>

                {selectedItem.customer_submitted_at ? (
                  <div style={{ ...modalSectionStyle, border: '1px solid #bbf7d0', background: 'linear-gradient(180deg, #f0fdf4 0%, #dcfce7 100%)' }}>
                    <strong style={{ ...modalSectionTitleStyle, color: '#166534' }}>Kunduppgifter inkomna</strong>
                    <span style={{ ...modalSectionTextStyle, color: '#166534' }}>
                      Kunden har skickat in sina uppgifter {new Date(String(selectedItem.customer_submitted_at)).toLocaleString('sv-SE')}.
                    </span>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

const heroEyebrowStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '4px 9px',
  borderRadius: 999,
  background: '#dbeafe',
  border: '1px solid #bfdbfe',
  color: '#2563eb',
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: 0.35,
  textTransform: 'uppercase',
};

const ghostLinkStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '10px 12px',
  borderRadius: 12,
  border: '1px solid #dbe4ef',
  background: '#fff',
  color: '#0f172a',
  fontWeight: 600,
  textDecoration: 'none',
};

const metaChipStyle: React.CSSProperties = {
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

const selectFieldStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  border: '1px solid #dbe4ef',
  borderRadius: 12,
  background: '#fff',
  color: '#0f172a',
  fontSize: 13,
  boxSizing: 'border-box',
};

const previewStatCardStyle: React.CSSProperties = {
  display: 'grid',
  gap: 6,
  padding: '12px 12px 10px',
  borderRadius: 14,
  border: '1px solid #dbe4ef',
  background: '#ffffff',
};

const previewStatLabelStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: 0.25,
  textTransform: 'uppercase',
  color: '#64748b',
};

const previewStatValueStyle: React.CSSProperties = {
  fontSize: 18,
  lineHeight: 1.1,
  color: '#0f172a',
  fontWeight: 800,
};

const previewInfoCardStyle: React.CSSProperties = {
  display: 'grid',
  gap: 5,
  padding: '12px 12px 10px',
  borderRadius: 14,
  border: '1px solid #e2e8f0',
  background: '#ffffff',
};

const previewInfoLabelStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: 0.25,
  textTransform: 'uppercase',
  color: '#64748b',
};

const previewInfoValueStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 800,
  color: '#0f172a',
};

const previewInfoMetaStyle: React.CSSProperties = {
  fontSize: 12,
  color: '#64748b',
};

function formatActivityDate(value?: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('sv-SE');
}

const modalOverlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 70,
  display: 'grid',
  alignItems: 'start',
  justifyItems: 'center',
  overflowY: 'auto',
  paddingTop: 'max(28px, calc(env(safe-area-inset-top) + 28px))',
  paddingRight: 'max(12px, calc(env(safe-area-inset-right) + 12px))',
  paddingBottom: 'max(32px, calc(env(safe-area-inset-bottom) + 32px))',
  paddingLeft: 'max(12px, calc(env(safe-area-inset-left) + 12px))',
  background: 'rgba(15, 23, 42, 0.42)',
  backdropFilter: 'blur(6px)',
};

const modalCardStyle: React.CSSProperties = {
  marginTop: 0,
  marginBottom: 0,
  maxHeight: 'calc(100vh - env(safe-area-inset-top) - env(safe-area-inset-bottom) - 72px)',
  overflowY: 'auto',
  borderRadius: 28,
  border: '1px solid rgba(219, 228, 239, 0.9)',
  background: 'linear-gradient(180deg, #ffffff 0%, #f8fbff 100%)',
  boxShadow: '0 30px 80px rgba(15,23,42,0.22)',
  display: 'grid',
  gap: 14,
};

const modalSectionStyle: React.CSSProperties = {
  display: 'grid',
  gap: 10,
  padding: '14px 14px 12px',
  borderRadius: 18,
  border: '1px solid #dbe4ef',
  background: '#ffffff',
};

const modalSectionTitleStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 800,
  color: '#0f172a',
};

const modalSectionTextStyle: React.CSSProperties = {
  fontSize: 12,
  color: '#64748b',
};

const timelineRowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 12,
  alignItems: 'center',
  padding: '10px 12px',
  borderRadius: 14,
  border: '1px solid #e2e8f0',
  background: '#f8fafc',
};

const timelineLabelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  color: '#64748b',
};

const timelineValueStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  color: '#0f172a',
  textAlign: 'right',
};

const noteTextareaStyle: React.CSSProperties = {
  width: '100%',
  resize: 'vertical',
  padding: '12px 13px',
  borderRadius: 14,
  border: '1px solid #dbe4ef',
  background: '#f8fafc',
  color: '#0f172a',
  fontSize: 13,
  lineHeight: 1.5,
  boxSizing: 'border-box',
};

const activityTitleStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 800,
  color: '#0f172a',
};

const activityDetailStyle: React.CSSProperties = {
  fontSize: 12,
  color: '#475569',
  lineHeight: 1.45,
};

const activityTimeStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: '#64748b',
};

function activityCardStyle(tone: 'neutral' | 'success' | 'warning'): React.CSSProperties {
  if (tone === 'success') {
    return {
      display: 'grid',
      gap: 8,
      padding: '12px 12px 10px',
      borderRadius: 16,
      border: '1px solid #bbf7d0',
      background: 'linear-gradient(180deg, #f0fdf4 0%, #dcfce7 100%)',
    };
  }
  if (tone === 'warning') {
    return {
      display: 'grid',
      gap: 8,
      padding: '12px 12px 10px',
      borderRadius: 16,
      border: '1px solid #fde68a',
      background: 'linear-gradient(180deg, #fffbeb 0%, #fef3c7 100%)',
    };
  }
  return {
    display: 'grid',
    gap: 8,
    padding: '12px 12px 10px',
    borderRadius: 16,
    border: '1px solid #dbe4ef',
    background: 'linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)',
  };
}
