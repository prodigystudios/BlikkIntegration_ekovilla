"use client";
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';

// Minimal types
type Trip = {
  id: string;
  date: string; // YYYY-MM-DD
  startAddress: string;
  endAddress: string;
  startKm: number | null;
  endKm: number | null;
  note?: string;
};

function pad(n: number) { return n < 10 ? `0${n}` : String(n); }
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}
function uuid() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }

const STORAGE_KEY = 'korjournal.trips.v1'; // kept for fallback cache

export default function KorjournalPage() {
  const router = useRouter();
  const supabase = createClientComponentClient();
  const [trips, setTrips] = useState<Trip[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    date: todayISO(), startAddress: '', endAddress: '', startKm: '', endKm: '', note: ''
  } as any);
  const [error, setError] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [editing, setEditing] = useState<Trip | null>(null);
  const [locating, setLocating] = useState<{start?: boolean; end?: boolean}>({});
  const [isSaving, setIsSaving] = useState(false); // prevent double submit
  // Usage stats (local only)
  interface UsageStats { startCounts: Record<string, number>; endCounts: Record<string, number>; pairCounts: Record<string, number>; }
  const USAGE_KEY = 'korjournal.usage.v1';
  const [usageStats, setUsageStats] = useState<UsageStats>({ startCounts: {}, endCounts: {}, pairCounts: {} });
  const [usageReady, setUsageReady] = useState(false);
  const [topStarts, setTopStarts] = useState<string[]>([]);
  const [topEnds, setTopEnds] = useState<string[]>([]);
  const MAX_SUGGEST = 6;
  const [suggestMenu, setSuggestMenu] = useState<null | 'start' | 'end'>(null);

  // Load from API; cache to localStorage as fallback
  useEffect(() => {
    (async () => {
      // Load usage stats first so we don't accidentally overwrite persisted favorites with empty defaults.
      try {
        const uRaw = localStorage.getItem(USAGE_KEY);
        if (uRaw) setUsageStats(JSON.parse(uRaw));
      } catch {}
      setUsageReady(true);

      try {
        const res = await fetch('/api/korjournal/trips', { cache: 'no-store' });
        if (res.ok) {
          const j = await res.json();
          const list: Trip[] = (j.trips || []).map((r: any) => ({
            id: r.id || uuid(),
            date: r.date,
            startAddress: r.start_address,
            endAddress: r.end_address,
            startKm: r.start_km,
            endKm: r.end_km,
            note: r.note || undefined,
          }));
          setTrips(list);
          try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list)); } catch {}
          return;
        }
      } catch {}
      // Fallback to local cache
      try { const raw = localStorage.getItem(STORAGE_KEY); if (raw) setTrips(JSON.parse(raw)); } catch {}
    })();
  }, []);

  // Cache trips locally for offline fallback
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(trips)); } catch {}
  }, [trips]);

  // Recompute top suggestions whenever usage stats change
  useEffect(() => {
    function sortEntries(rec: Record<string, number>) {
      return Object.entries(rec)
        .filter(([k]) => k.trim().length > 0)
        .sort((a,b) => b[1] - a[1])
        .slice(0, MAX_SUGGEST)
        .map(([k]) => k);
    }
    setTopStarts(sortEntries(usageStats.startCounts));
    setTopEnds(sortEntries(usageStats.endCounts));
    if (!usageReady) return;
    try { localStorage.setItem(USAGE_KEY, JSON.stringify(usageStats)); } catch {}
  }, [usageStats, usageReady]);

  const bumpUsage = (trip: Trip) => {
    setUsageStats(prev => {
      const copy: UsageStats = {
        startCounts: { ...prev.startCounts },
        endCounts: { ...prev.endCounts },
        pairCounts: { ...prev.pairCounts }
      };
      const s = (trip.startAddress || '').trim();
      const e = (trip.endAddress || '').trim();
      if (s) copy.startCounts[s] = (copy.startCounts[s] || 0) + 1;
      if (e) copy.endCounts[e] = (copy.endCounts[e] || 0) + 1;
      if (s && e) { const key = `${s}||${e}`; copy.pairCounts[key] = (copy.pairCounts[key] || 0) + 1; }
      return copy;
    });
  };

  const clearUsage = () => {
    if (!confirm('Rensa lokala favoritadresser?')) return;
    setUsageStats({ startCounts: {}, endCounts: {}, pairCounts: {} });
    try { localStorage.removeItem(USAGE_KEY); } catch {}
  };

  const normalizeAddr = (s: string) => s.trim().toLowerCase();
  const bestFavoriteForPrefix = (prefixRaw: string, counts: Record<string, number>) => {
    const prefix = normalizeAddr(prefixRaw);
    if (prefix.length < 2) return null;

    let bestAddr: string | null = null;
    let bestCount = -1;
    const consider = (addr: string, count: number) => {
      if (count > bestCount) {
        bestAddr = addr;
        bestCount = count;
      }
    };

    // Prefer prefix-matches (autocomplete-like)
    for (const [addr, count] of Object.entries(counts)) {
      const n = normalizeAddr(addr);
      if (!n || n === prefix) continue;
      if (n.startsWith(prefix)) consider(addr, count);
    }

    // Fallback: substring matches
    if (!bestAddr) {
      for (const [addr, count] of Object.entries(counts)) {
        const n = normalizeAddr(addr);
        if (!n || n === prefix) continue;
        if (n.includes(prefix)) consider(addr, count);
      }
    }

    return bestAddr;
  };

  const startAuto = useMemo(
    () => bestFavoriteForPrefix(String(form.startAddress || ''), usageStats.startCounts),
    [form.startAddress, usageStats.startCounts]
  );
  const endAuto = useMemo(
    () => bestFavoriteForPrefix(String(form.endAddress || ''), usageStats.endCounts),
    [form.endAddress, usageStats.endCounts]
  );

  const monthlyGroups = useMemo(() => {
    const map = new Map<string, Trip[]>();
    for (const t of trips) {
      const key = t.date.slice(0,7); // YYYY-MM
      const arr = map.get(key) || [];
      arr.push(t);
      map.set(key, arr);
    }
    // sort keys desc
    return Array.from(map.entries()).sort((a,b) => b[0].localeCompare(a[0]));
  }, [trips]);

  const diffKm = (t: Trip) => Math.max(0, (t.endKm || 0) - (t.startKm || 0));
  // Complete only when both km exist and end >= start
  const isComplete = (t: Trip) => (
    t.startKm !== null && t.startKm !== undefined && Number.isFinite(t.startKm) &&
    t.endKm !== null && t.endKm !== undefined && Number.isFinite(t.endKm) &&
    (t.endKm as number) >= (t.startKm as number)
  );
  const monthKm = (arr: Trip[]) => arr.reduce((sum, t) => sum + diffKm(t), 0);

  const resetForm = () => setForm({ date: todayISO(), startAddress: '', endAddress: '', startKm: '', endKm: '', note: '' });
  const closeModal = () => {
    setOpen(false);
    setSuggestMenu(null);
    setEditing(null);
    setIsSaving(false);
  };

  const openNew = () => { resetForm(); setError(null); setSuggestMenu(null); setEditing(null); setOpen(true); };
  const openEdit = (t: Trip) => {
    setForm({
      date: t.date,
      startAddress: t.startAddress,
      endAddress: t.endAddress,
  startKm: t.startKm ?? '',
  endKm: t.endKm ?? '',
      note: t.note || ''
    });
    setEditing(t);
    setError(null);
    setSuggestMenu(null);
    setOpen(true);
  };

  const submit = async () => {
    if (isSaving) return; // guard double click
    setError(null);
    const startKm = form.startKm === '' || form.startKm === null || form.startKm === undefined ? null : Number(form.startKm);
    const endKm = form.endKm === '' || form.endKm === null || form.endKm === undefined ? null : Number(form.endKm);
    // Validera endast om fält är ifyllda
    if (form.startKm !== '' && form.startKm !== null && form.startKm !== undefined && !Number.isFinite(startKm as any)) {
      setError('Ogiltig start-kilometer.');
      return;
    }
    if (form.endKm !== '' && form.endKm !== null && form.endKm !== undefined && !Number.isFinite(endKm as any)) {
      setError('Ogiltig slut-kilometer.');
      return;
    }
    // Tillåt utkast: slut km kan vara tom eller 0. Kontrollera endast när båda är ifyllda och slut != 0
    if (startKm !== null && endKm !== null && endKm !== 0 && (endKm as number) < (startKm as number)) {
      setError('Slut-kilometer kan inte vara mindre än start-kilometer.');
      return;
    }

    setIsSaving(true);
    const trip: Trip = {
      id: editing?.id || uuid(),
      date: form.date || todayISO(),
      startAddress: form.startAddress.trim(),
      endAddress: form.endAddress.trim(),
      startKm: (startKm as number | null),
      endKm: (endKm as number | null),
      note: String(form.note || '').trim() || undefined,
    };
    try {
      if (editing) {
        const res = await fetch(`/api/korjournal/trips/${editing.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            date: trip.date,
            startAddress: trip.startAddress,
            endAddress: trip.endAddress,
            startKm: trip.startKm,
            endKm: trip.endKm,
            note: trip.note,
          }),
        });
        const j = await res.json();
        if (!res.ok) throw new Error(j?.error || 'Misslyckades att spara');
        const saved: Trip = {
          id: j.trip?.id || trip.id,
          date: j.trip?.date || trip.date,
          startAddress: j.trip?.start_address || trip.startAddress,
          endAddress: j.trip?.end_address || trip.endAddress,
          startKm: j.trip?.start_km ?? trip.startKm,
          endKm: j.trip?.end_km ?? trip.endKm,
          note: j.trip?.note || trip.note,
        };
        setTrips(prev => prev.map(p => p.id === saved.id ? saved : p).sort((a,b) => b.date.localeCompare(a.date)));
        bumpUsage(saved);
      } else {
        const res = await fetch('/api/korjournal/trips', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            date: trip.date,
            startAddress: trip.startAddress,
            endAddress: trip.endAddress,
            startKm: trip.startKm,
            endKm: trip.endKm,
            note: trip.note,
          }),
        });
        const j = await res.json();
        if (!res.ok) throw new Error(j?.error || 'Misslyckades att spara');
        const saved: Trip = {
          id: j.trip?.id || trip.id,
          date: j.trip?.date || trip.date,
          startAddress: j.trip?.start_address || trip.startAddress,
          endAddress: j.trip?.end_address || trip.endAddress,
          startKm: j.trip?.start_km ?? trip.startKm,
          endKm: j.trip?.end_km ?? trip.endKm,
          note: j.trip?.note || trip.note,
        };
        setTrips(prev => [saved, ...prev].sort((a,b) => b.date.localeCompare(a.date)));
        bumpUsage(saved);
      }
      closeModal();
    } catch (e: any) {
      setError(e?.message || 'Kunde inte spara resan');
    } finally {
      setIsSaving(false);
    }
  };

  async function fillAddress(which: 'start' | 'end') {
    if (!('geolocation' in navigator)) {
      alert('Platstjänster stöds inte på den här enheten.');
      return;
    }
    setLocating((s) => ({ ...s, [which]: true }));
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 60000,
        });
      });
      const lat = pos.coords.latitude;
      const lon = pos.coords.longitude;
      const res = await fetch(`/api/geocode/reverse?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`, { cache: 'no-store' });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error || 'Kunde inte hämta adress');
      setForm((f: any) => which === 'start' ? { ...f, startAddress: j.address } : { ...f, endAddress: j.address });
    } catch (e: any) {
      alert(e?.message || 'Kunde inte hämta din plats');
    } finally {
      setLocating((s) => ({ ...s, [which]: false }));
    }
  }

  const onDelete = async (id: string) => {
    if (!confirm('Ta bort resan?')) return;
    try {
      const res = await fetch(`/api/korjournal/trips/${id}`, { method: 'DELETE' });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error || 'Misslyckades att ta bort');
      setTrips(prev => prev.filter(t => t.id !== id));
    } catch (e: any) {
      alert(e?.message || 'Kunde inte ta bort resan');
    }
  };

  // Simple PDF export: generate plain table as text via server endpoint later if needed
  const exportMonth = async (ym: string, arr: Trip[]) => {
    const incomplete = arr.filter(t => !isComplete(t));
    if (incomplete.length > 0) {
      alert(`Det finns ${incomplete.length} rader med saknad information (km). Komplettera innan export.`);
      return;
    }
    try {
      setIsExporting(true);
      // CSV formatting improvements:
      // 1. Add UTF-8 BOM so Excel (especially on Windows) correctly detects encoding (å, ä, ö etc.).
      // 2. Quote and escape fields containing special chars (semicolon, quotes, newlines, leading/trailing spaces).
      // 3. Keep semicolon delimiter (common in Swedish locale) so Excel auto-splits without changing delimiter settings.
      const esc = (val: any): string => {
        if (val === null || val === undefined) return '';
        let s = String(val);
        // Normalize CRLF -> LF for consistency
        s = s.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        const needsQuote = /[;"\n]|(^\s)|($\s)/.test(s);
        if (s.includes('"')) s = s.replace(/"/g, '""');
        return needsQuote ? `"${s}"` : s;
      };
      const header = ['Datum','Startadress','Slutadress','Start km','Slut km','Distans','Anteckning'];
      const dataLines = arr.map(t => [
        t.date, // YYYY-MM-DD (Excel will usually parse automatically). User can widen column manually.
        t.startAddress,
        t.endAddress,
        t.startKm ?? '',
        t.endKm ?? '',
        diffKm(t),
        t.note || ''
      ].map(esc).join(';'));
      const lines = [
        esc(`Körjournal ${ym}`),
        header.map(esc).join(';'),
        ...dataLines,
        ['Total km', monthKm(arr)].map(esc).join(';')
      ];
      // Prepend BOM for Excel UTF-8 recognition
      const content = '\uFEFF' + lines.join('\n');
      const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `korjournal_${ym}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div style={{ padding: 16 }}>
      <h1 style={{ margin: '0 0 12px' }}>Körjournal</h1>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12, alignItems: 'center' }}>
        <button className="btn--plain btn--sm" onClick={async () => { await supabase.auth.signOut(); router.replace('/auth/sign-in'); }}>
          Logga ut
        </button>
        <div style={{ marginLeft: 'auto' }} />
  <button className="btn--primary btn--sm" onClick={openNew}>Lägg till resa</button>
        {topStarts.length > 0 && (
          <button className="btn--plain btn--sm" onClick={clearUsage} title="Rensa lokala favoritadresser">Rensa favoriter</button>
        )}
      </div>

      {monthlyGroups.length === 0 && (
        <div style={{ color: '#6b7280' }}>Inga resor ännu.</div>
      )}

      {monthlyGroups.map(([ym, arr]) => (
        <div key={ym} style={{ border: '1px solid #e5e7eb', borderRadius: 8, marginBottom: 16, overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 10, background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
            <strong>{ym}</strong>
            <span style={{ color: '#6b7280' }}>Total: {monthKm(arr)} km</span>
            {arr.some(t => !isComplete(t)) && (
              <span className="journal-badge journal-badge--warn" title="Ofullständig information: fyll i start/slut km">
                ⚠️
              </span>
            )}
            <div style={{ marginLeft: 'auto' }} />
            <button className="btn--success btn--sm" disabled={isExporting} onClick={() => exportMonth(ym, arr)}>Exportera månad (CSV)</button>
          </div>
          {/* Desktop grid */}
          <div className="journal-desktop">
            <div className="contacts-header" style={{ gridTemplateColumns: '150px 0.45fr 0.45fr 80px 80px 70px 100px' }}>
              <div className="contacts-cell" style={{ padding: 6 }}>Datum</div>
              <div className="contacts-cell" style={{ padding: 6 }}>Startadress</div>
              <div className="contacts-cell" style={{ padding: 6 }}>Slutadress</div>
              <div className="contacts-cell" style={{ padding: 6 }}>Start km</div>
              <div className="contacts-cell" style={{ padding: 6 }}>Slut km</div>
              <div className="contacts-cell" style={{ padding: 6 }}>Distans</div>
              <div className="contacts-cell" style={{ padding: 6 }}>Åtgärder</div>
            </div>
            {arr.map(t => (
              <div key={t.id} className="contacts-row" style={{ display: 'grid', gridTemplateColumns: '150px 0.45fr 0.45fr 80px 80px 70px 100px', borderTop: '1px solid #e5e7eb' }}>
                <div className="contacts-cell" style={{ padding: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                  {!isComplete(t) && <span className="warn" title="Fyll i km-start och km-slut">▲</span>}
                  <span>{t.date}</span>
                </div>
                <div className="contacts-cell" style={{ padding: 6, wordBreak: 'break-word' }}>{t.startAddress}</div>
                <div className="contacts-cell" style={{ padding: 6, wordBreak: 'break-word' }}>{t.endAddress}</div>
                <div className="contacts-cell" style={{ padding: 6 }}>{t.startKm}</div>
                <div className="contacts-cell" style={{ padding: 6 }}>{t.endKm}</div>
                <div className="contacts-cell" style={{ padding: 6, fontWeight: 600 }}>{diffKm(t)}</div>
                <div className="contacts-cell" style={{ padding: 6, display: 'flex', gap: 4 }}>
                  <button className="btn--primary btn--sm" onClick={() => openEdit(t)}>Redigera</button>
                  <button className="btn--danger btn--sm" onClick={() => onDelete(t.id)}>Ta bort</button>
                </div>
              </div>
            ))}
          </div>

          {/* Mobile cards */}
          <div className="journal-mobile">
            {arr.map(t => (
              <div key={t.id} className="journal-card">
                <div className="journal-card-header">
                  <div className="journal-card-title" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    {!isComplete(t) && <span className="warn" title="Fyll i km-start och km-slut">▲</span>}
                    <span>{t.date}</span>
                  </div>
                  <div className="journal-badge">{diffKm(t)} km</div>
                </div>
                <div className="journal-line">
                  <div className="journal-label">Startadress</div>
                  <div className="journal-address">{t.startAddress}</div>
                </div>
                <div className="journal-line">
                  <div className="journal-label">Slutadress</div>
                  <div className="journal-address">{t.endAddress}</div>
                </div>
                <div className="journal-meta">
                  <div><strong>Start:</strong> {t.startKm}</div>
                  <div><strong>Slut:</strong> {t.endKm}</div>
                </div>
                {t.note && (
                  <div className="journal-note"><strong>Anteckning:</strong> {t.note}</div>
                )}
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn--primary btn--sm" onClick={() => openEdit(t)}>Redigera</button>
                  <button className="btn--danger btn--sm" onClick={() => onDelete(t.id)}>Ta bort</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* Modal for new trip */}
      {open && (
        <div role="dialog" aria-modal="true" style={{ position: 'fixed', inset: 0, zIndex: 2100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div onClick={closeModal} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.35)' }} />
          <div style={{ position: 'relative', width: 'min(96vw, 720px)', background: '#fff', borderRadius: 10, boxShadow: '0 10px 30px rgba(0,0,0,0.2)', overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 12, borderBottom: '1px solid #e5e7eb' }}>
              <strong>{editing ? 'Redigera resa' : 'Ny resa'}</strong>
              <div style={{ marginLeft: 'auto' }} />
              <button className="btn--plain btn--sm" onClick={closeModal}>Stäng</button>
            </div>
            <div style={{ padding: 12, display: 'grid', gap: 10 }}>
              {error && <div style={{ color: '#b91c1c', fontSize: 13 }}>{error}</div>}
              <label style={{ display: 'grid', gap: 4 }}>
                <span>Datum</span>
                <input type="date" value={form.date} onChange={e => setForm((f:any) => ({ ...f, date: e.target.value }))} />
              </label>
              <label style={{ display: 'grid', gap: 4 }}>
                <span>Startadress</span>
                <div style={{ position: 'relative' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 6 }}>
                    <input
                      list="kor-start-suggestions"
                      value={form.startAddress}
                      onChange={e => setForm((f:any) => ({ ...f, startAddress: e.target.value }))}
                      onKeyDown={e => {
                        if (!startAuto) return;
                        const el = e.currentTarget;
                        const caretAtEnd = (el.selectionStart ?? el.value.length) === el.value.length;
                        const accept = (e.key === 'ArrowRight' && caretAtEnd) || (e.key === ' ' && e.ctrlKey);
                        if (!accept) return;
                        e.preventDefault();
                        setForm((f: any) => ({ ...f, startAddress: startAuto }));
                      }}
                      placeholder="Ex: Företagsgatan 1, Stockholm"
                    />
                    {topStarts.length > 0 && (
                      <button
                        type="button"
                        className="btn--plain btn--sm"
                        aria-haspopup="listbox"
                        aria-expanded={suggestMenu === 'start'}
                        onClick={() => setSuggestMenu(m => m === 'start' ? null : 'start')}
                        title="Välj från favoriter"
                      >
                        Favoriter ▾
                      </button>
                    )}
                    <button type="button" className="btn--plain btn--sm" onClick={() => fillAddress('start')} disabled={!!locating.start} title="Hämta nuvarande plats">
                      {locating.start ? 'Hämtar…' : 'Hämta plats'}
                    </button>
                  </div>

                  {startAuto && (
                    <div style={{ marginTop: 6, fontSize: 12, color: '#6b7280', display: 'flex', gap: 8, alignItems: 'center' }}>
                      <span>Förslag:</span>
                      <button
                        type="button"
                        className="btn--plain btn--xs"
                        onClick={() => setForm((f: any) => ({ ...f, startAddress: startAuto }))}
                        title="Klicka för att fylla i (eller tryck → vid slutet av texten / Ctrl+Mellanslag)"
                        style={{ maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                      >
                        {startAuto}
                      </button>
                      <span style={{ marginLeft: 'auto', fontSize: 11 }}>→ / Ctrl+Mellanslag</span>
                    </div>
                  )}

                  {suggestMenu === 'start' && topStarts.length > 0 && (
                    <>
                      <div
                        onClick={() => setSuggestMenu(null)}
                        style={{ position: 'fixed', inset: 0, zIndex: 2105 }}
                      />
                      <div
                        role="listbox"
                        style={{ position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 2106, width: 'min(520px, 92vw)', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, boxShadow: '0 10px 30px rgba(0,0,0,0.15)', overflow: 'hidden' }}
                      >
                        <div style={{ padding: '8px 10px', fontSize: 12, fontWeight: 700, color: '#374151', background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                          Vanliga startadresser
                        </div>
                        <div style={{ maxHeight: 240, overflow: 'auto' }}>
                          {topStarts.map(addr => (
                            <button
                              key={'fav-start-' + addr}
                              type="button"
                              className="btn--plain"
                              onClick={() => {
                                setForm((f: any) => ({ ...f, startAddress: addr }));
                                setSuggestMenu(null);
                              }}
                              style={{ width: '100%', textAlign: 'left', padding: '10px 12px', borderBottom: '1px solid #f1f5f9' }}
                              title={addr}
                            >
                              <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                                <span style={{ flex: 1, wordBreak: 'break-word' }}>{addr}</span>
                                <span style={{ fontSize: 12, color: '#6b7280' }}>({usageStats.startCounts[addr] || 0})</span>
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    </>
                  )}
                </div>
                {topStarts.length > 0 && (
                  <datalist id="kor-start-suggestions">
                    {topStarts.map(addr => (
                      <option key={'opt-start-' + addr} value={addr}>{addr} ({usageStats.startCounts[addr] || 0})</option>
                    ))}
                  </datalist>
                )}
              </label>
              <label style={{ display: 'grid', gap: 4 }}>
                <span>Slutadress</span>
                <div style={{ position: 'relative' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 6 }}>
                    <input
                      list="kor-end-suggestions"
                      value={form.endAddress}
                      onChange={e => setForm((f:any) => ({ ...f, endAddress: e.target.value }))}
                      onKeyDown={e => {
                        if (!endAuto) return;
                        const el = e.currentTarget;
                        const caretAtEnd = (el.selectionStart ?? el.value.length) === el.value.length;
                        const accept = (e.key === 'ArrowRight' && caretAtEnd) || (e.key === ' ' && e.ctrlKey);
                        if (!accept) return;
                        e.preventDefault();
                        setForm((f: any) => ({ ...f, endAddress: endAuto }));
                      }}
                      placeholder="Ex: Kundvägen 5, Uppsala"
                    />
                    {topEnds.length > 0 && (
                      <button
                        type="button"
                        className="btn--plain btn--sm"
                        aria-haspopup="listbox"
                        aria-expanded={suggestMenu === 'end'}
                        onClick={() => setSuggestMenu(m => m === 'end' ? null : 'end')}
                        title="Välj från favoriter"
                      >
                        Favoriter ▾
                      </button>
                    )}
                    <button type="button" className="btn--plain btn--sm" onClick={() => fillAddress('end')} disabled={!!locating.end} title="Hämta nuvarande plats">
                      {locating.end ? 'Hämtar…' : 'Hämta plats'}
                    </button>
                  </div>

                  {endAuto && (
                    <div style={{ marginTop: 6, fontSize: 12, color: '#6b7280', display: 'flex', gap: 8, alignItems: 'center' }}>
                      <span>Förslag:</span>
                      <button
                        type="button"
                        className="btn--plain btn--xs"
                        onClick={() => setForm((f: any) => ({ ...f, endAddress: endAuto }))}
                        title="Klicka för att fylla i (eller tryck → vid slutet av texten / Ctrl+Mellanslag)"
                        style={{ maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                      >
                        {endAuto}
                      </button>
                      <span style={{ marginLeft: 'auto', fontSize: 11 }}>→ / Ctrl+Mellanslag</span>
                    </div>
                  )}

                  {suggestMenu === 'end' && topEnds.length > 0 && (
                    <>
                      <div
                        onClick={() => setSuggestMenu(null)}
                        style={{ position: 'fixed', inset: 0, zIndex: 2105 }}
                      />
                      <div
                        role="listbox"
                        style={{ position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 2106, width: 'min(520px, 92vw)', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, boxShadow: '0 10px 30px rgba(0,0,0,0.15)', overflow: 'hidden' }}
                      >
                        <div style={{ padding: '8px 10px', fontSize: 12, fontWeight: 700, color: '#374151', background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                          Vanliga slutadresser
                        </div>
                        <div style={{ maxHeight: 240, overflow: 'auto' }}>
                          {topEnds.map(addr => (
                            <button
                              key={'fav-end-' + addr}
                              type="button"
                              className="btn--plain"
                              onClick={() => {
                                setForm((f: any) => ({ ...f, endAddress: addr }));
                                setSuggestMenu(null);
                              }}
                              style={{ width: '100%', textAlign: 'left', padding: '10px 12px', borderBottom: '1px solid #f1f5f9' }}
                              title={addr}
                            >
                              <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                                <span style={{ flex: 1, wordBreak: 'break-word' }}>{addr}</span>
                                <span style={{ fontSize: 12, color: '#6b7280' }}>({usageStats.endCounts[addr] || 0})</span>
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    </>
                  )}
                </div>
                {topEnds.length > 0 && (
                  <datalist id="kor-end-suggestions">
                    {topEnds.map(addr => (
                      <option key={'opt-end-' + addr} value={addr}>{addr} ({usageStats.endCounts[addr] || 0})</option>
                    ))}
                  </datalist>
                )}
              </label>
              <div style={{ display: 'grid', gap: 10, gridTemplateColumns: '1fr 1fr' }}>
                <label style={{ display: 'grid', gap: 4 }}>
                  <span>Start km</span>
                  <input inputMode="numeric" value={form.startKm} onChange={e => setForm((f:any) => ({ ...f, startKm: e.target.value }))} placeholder="0" />
                </label>
                <label style={{ display: 'grid', gap: 4 }}>
                  <span>Slut km</span>
                  <input inputMode="numeric" value={form.endKm} onChange={e => setForm((f:any) => ({ ...f, endKm: e.target.value }))} placeholder="0" />
                </label>
              </div>
              <label style={{ display: 'grid', gap: 4 }}>
                <span>Anteckning (valfritt)</span>
                <input value={form.note} onChange={e => setForm((f:any) => ({ ...f, note: e.target.value }))} placeholder="Syfte med resan" />
              </label>
              <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                <button className="btn--success btn--sm" onClick={submit} disabled={isSaving}>
                  {isSaving ? 'Sparar…' : 'Spara resa'}
                </button>
                <button className="btn--plain btn--sm" onClick={() => { resetForm(); setError(null); }}>Rensa</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
