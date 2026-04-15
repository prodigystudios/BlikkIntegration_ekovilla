"use client";
import { useEffect, useMemo, useState } from 'react';

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
function formatMonthLabel(ym: string) {
  const [yearRaw, monthRaw] = ym.split('-');
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return ym;
  return new Date(year, month - 1, 1).toLocaleDateString('sv-SE', { month: 'long', year: 'numeric' });
}
function formatTripDate(dateString: string) {
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return dateString;
  return date.toLocaleDateString('sv-SE', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}
function uuid() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }

const STORAGE_KEY = 'korjournal.trips.v1'; // kept for fallback cache

export default function KorjournalPage() {
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

  const overview = useMemo(() => {
    const totalTrips = trips.length;
    const totalKm = trips.reduce((sum, trip) => sum + diffKm(trip), 0);
    const incompleteTrips = trips.filter((trip) => !isComplete(trip)).length;
    const noteTrips = trips.filter((trip) => String(trip.note || '').trim()).length;
    const favoriteCount = Object.keys(usageStats.startCounts).length + Object.keys(usageStats.endCounts).length;
    return { totalTrips, totalKm, incompleteTrips, noteTrips, favoriteCount };
  }, [trips, usageStats]);

  const latestTrip = trips[0] || null;

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
    <div style={{ padding: 16, maxWidth: 1240, margin: '0 auto', display: 'grid', gap: 18 }}>
      <section style={{ border: '1px solid #dbe4ef', borderRadius: 28, padding: '20px 20px 18px', background: 'linear-gradient(180deg, #ffffff 0%, #f6fbff 100%)', boxShadow: '0 18px 48px rgba(15,23,42,0.06)', display: 'grid', gap: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div style={{ display: 'grid', gap: 8, maxWidth: 760 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={korEyebrowStyle}>Körjournal</span>
              <span style={korChipStyle}>{overview.totalTrips} resor sparade</span>
              {overview.incompleteTrips > 0 ? <span style={{ ...korChipStyle, background: '#fff7ed', border: '1px solid #fed7aa', color: '#9a3412' }}>{overview.incompleteTrips} kräver komplettering</span> : null}
            </div>
            <div style={{ display: 'grid', gap: 6 }}>
              <h1 style={{ margin: 0, fontSize: 38, lineHeight: 1.02, letterSpacing: -1.2, color: '#0f172a' }}>Översikt</h1>
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginTop: 8 }}>
              <button className="btn--primary btn--sm" onClick={openNew} style={{ minWidth: 176, paddingInline: 20, boxShadow: '0 14px 28px rgba(37,99,235,0.22)' }}>
                Lägg till resa
              </button>
            </div>
          </div>
          <div style={{ display: 'grid', gap: 8, justifyItems: 'end', minWidth: 220 }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              {topStarts.length > 0 && (
                <button className="btn--plain btn--sm" onClick={clearUsage} title="Rensa lokala favoritadresser">Rensa favoriter</button>
              )}
            </div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
          <div style={korStatCardStyle}>
            <span style={korStatLabelStyle}>Totala kilometer</span>
            <strong style={korStatValueStyle}>{overview.totalKm.toLocaleString('sv-SE')} km</strong>
          </div>
          <div style={korStatCardStyle}>
            <span style={korStatLabelStyle}>Resor</span>
            <strong style={korStatValueStyle}>{overview.totalTrips}</strong>
          </div>
          <div style={korStatCardStyle}>
            <span style={korStatLabelStyle}>Anteckningar</span>
            <strong style={korStatValueStyle}>{overview.noteTrips}</strong>
          </div>
          <div style={{ ...korStatCardStyle, background: overview.incompleteTrips > 0 ? 'linear-gradient(180deg, #fff7ed 0%, #ffedd5 100%)' : '#ffffff', border: overview.incompleteTrips > 0 ? '1px solid #fed7aa' : '1px solid #dbe4ef' }}>
            <span style={{ ...korStatLabelStyle, color: overview.incompleteTrips > 0 ? '#9a3412' : '#64748b' }}>Komplettera</span>
            <strong style={{ ...korStatValueStyle, color: overview.incompleteTrips > 0 ? '#9a3412' : '#0f172a' }}>{overview.incompleteTrips}</strong>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 10 }}>
          <div style={korInfoPanelStyle}>
            <strong style={korInfoTitleStyle}>Senaste registrerade resa</strong>
            {latestTrip ? (
              <>
                <span style={korInfoMainStyle}>{formatTripDate(latestTrip.date)}</span>
                <span style={korInfoSubStyle}>{latestTrip.startAddress} till {latestTrip.endAddress}</span>
              </>
            ) : (
              <span style={korInfoSubStyle}>Ingen resa registrerad ännu.</span>
            )}
          </div>
          <div style={korInfoPanelStyle}>
            <strong style={korInfoTitleStyle}>Lokala favoriter</strong>
            <span style={korInfoMainStyle}>{overview.favoriteCount}</span>
            <span style={korInfoSubStyle}>Baserat på ofta använda start- och slutadresser för snabbare ifyllnad.</span>
          </div>
        </div>
      </section>

      {monthlyGroups.length === 0 && (
        <div style={{ border: '1px dashed #cbd5e1', borderRadius: 22, padding: '24px 20px', background: '#f8fafc', color: '#64748b', fontSize: 14 }}>
          Inga resor ännu. Lägg till första resan för att börja bygga upp körjournalen.
        </div>
      )}

      {monthlyGroups.map(([ym, arr]) => (
        <section key={ym} style={{ border: '1px solid #dbe4ef', borderRadius: 24, overflow: 'hidden', background: '#ffffff', boxShadow: '0 14px 36px rgba(15,23,42,0.04)' }}>
          <div style={{ display: 'grid', gap: 14, padding: '16px 16px 14px', background: 'linear-gradient(180deg, #ffffff 0%, #f8fbff 100%)', borderBottom: '1px solid #e2e8f0' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ display: 'grid', gap: 6 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <strong style={{ fontSize: 22, lineHeight: 1.1, color: '#0f172a', textTransform: 'capitalize' }}>{formatMonthLabel(ym)}</strong>
                  <span style={korChipStyle}>{arr.length} resor</span>
                  <span style={korChipStyle}>{monthKm(arr).toLocaleString('sv-SE')} km</span>
                  {arr.some(t => !isComplete(t)) ? (
                    <span className="journal-badge journal-badge--warn" title="Ofullständig information: fyll i start/slut km">
                      Behöver kompletteras
                    </span>
                  ) : null}
                </div>
                <span style={{ fontSize: 13, color: '#64748b' }}>Månadsvy med både fullständig desktoptabell och kompakt mobilöversikt.</span>
              </div>
              <button className="btn--success btn--sm" disabled={isExporting} onClick={() => exportMonth(ym, arr)}>Exportera månad (CSV)</button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
              <div style={korMiniStatStyle}>
                <span style={korMiniStatLabelStyle}>Körda kilometer</span>
                <strong style={korMiniStatValueStyle}>{monthKm(arr).toLocaleString('sv-SE')} km</strong>
              </div>
              <div style={korMiniStatStyle}>
                <span style={korMiniStatLabelStyle}>Kompletta rader</span>
                <strong style={korMiniStatValueStyle}>{arr.filter(isComplete).length}</strong>
              </div>
              <div style={korMiniStatStyle}>
                <span style={korMiniStatLabelStyle}>Anteckningar</span>
                <strong style={korMiniStatValueStyle}>{arr.filter((trip) => String(trip.note || '').trim()).length}</strong>
              </div>
            </div>
          </div>

          {/* Desktop grid */}
          <div className="journal-desktop" style={{ padding: 14 }}>
            <div style={{ border: '1px solid #e2e8f0', borderRadius: 20, overflow: 'hidden', background: '#fbfdff' }}>
            <div className="contacts-header" style={{ gridTemplateColumns: '158px minmax(0,1fr) minmax(0,1fr) 88px 88px 86px 122px', background: '#f8fafc' }}>
              <div className="contacts-cell" style={{ padding: 6 }}>Datum</div>
              <div className="contacts-cell" style={{ padding: 6 }}>Startadress</div>
              <div className="contacts-cell" style={{ padding: 6 }}>Slutadress</div>
              <div className="contacts-cell" style={{ padding: 6 }}>Start km</div>
              <div className="contacts-cell" style={{ padding: 6 }}>Slut km</div>
              <div className="contacts-cell" style={{ padding: 6 }}>Distans</div>
              <div className="contacts-cell" style={{ padding: 6 }}>Åtgärder</div>
            </div>
            {arr.map(t => (
              <div key={t.id} className="contacts-row" style={{ display: 'grid', gridTemplateColumns: '158px minmax(0,1fr) minmax(0,1fr) 88px 88px 86px 122px', borderTop: '1px solid #e5e7eb', background: isComplete(t) ? '#ffffff' : '#fffaf5' }}>
                <div className="contacts-cell" style={{ padding: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                  {!isComplete(t) && <span className="warn" title="Fyll i km-start och km-slut">▲</span>}
                  <span>{formatTripDate(t.date)}</span>
                </div>
                <div className="contacts-cell" style={{ padding: 6, wordBreak: 'break-word' }}>{t.startAddress}</div>
                <div className="contacts-cell" style={{ padding: 6, wordBreak: 'break-word' }}>{t.endAddress}</div>
                <div className="contacts-cell" style={{ padding: 6, fontWeight: 700, color: '#334155' }}>{t.startKm ?? '—'}</div>
                <div className="contacts-cell" style={{ padding: 6, fontWeight: 700, color: '#334155' }}>{t.endKm ?? '—'}</div>
                <div className="contacts-cell" style={{ padding: 6, fontWeight: 700, color: '#0f172a' }}>{diffKm(t)} km</div>
                <div className="contacts-cell" style={{ padding: 6, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  <button className="btn--primary btn--sm" onClick={() => openEdit(t)}>Redigera</button>
                  <button className="btn--danger btn--sm" onClick={() => onDelete(t.id)}>Ta bort</button>
                </div>
              </div>
            ))}
            </div>
          </div>

          {/* Mobile cards */}
          <div className="journal-mobile">
            {arr.map(t => (
              <div key={t.id} className="journal-card" style={{ borderRadius: 20, border: '1px solid #dbe4ef', padding: 14, gap: 10, boxShadow: '0 10px 24px rgba(15,23,42,0.04)', background: isComplete(t) ? '#ffffff' : 'linear-gradient(180deg, #fffaf5 0%, #ffffff 100%)' }}>
                <div className="journal-card-header">
                  <div className="journal-card-title" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 15 }}>
                    {!isComplete(t) && <span className="warn" title="Fyll i km-start och km-slut">▲</span>}
                    <span>{formatTripDate(t.date)}</span>
                  </div>
                  <div className="journal-badge">{diffKm(t)} km</div>
                </div>
                <div style={{ display: 'grid', gap: 6, padding: '10px 12px', borderRadius: 16, background: '#f8fafc', border: '1px solid #eef2f7' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.35, textTransform: 'uppercase', color: '#64748b' }}>Rutt</div>
                  <div style={{ display: 'grid', gap: 4 }}>
                    <div className="journal-address" style={{ fontWeight: 700, color: '#0f172a' }}>{t.startAddress}</div>
                    <div style={{ fontSize: 12, color: '#94a3b8' }}>till</div>
                    <div className="journal-address" style={{ fontWeight: 700, color: '#0f172a' }}>{t.endAddress}</div>
                  </div>
                </div>
                <div className="journal-line">
                  <div className="journal-meta" style={{ justifyContent: 'space-between' }}>
                    <div style={korMetaPillStyle}><strong>Start:</strong> {t.startKm ?? '—'}</div>
                    <div style={korMetaPillStyle}><strong>Slut:</strong> {t.endKm ?? '—'}</div>
                  </div>
                </div>
                {t.note && (
                  <div className="journal-note" style={{ padding: '10px 12px', borderRadius: 14, background: '#f8fafc', border: '1px solid #eef2f7' }}><strong>Anteckning:</strong> {t.note}</div>
                )}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button className="btn--primary btn--sm" onClick={() => openEdit(t)}>Redigera</button>
                  <button className="btn--danger btn--sm" onClick={() => onDelete(t.id)}>Ta bort</button>
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}

      {/* Modal for new trip */}
      {open && (
        <div role="dialog" aria-modal="true" style={korModalOverlayStyle}>
          <div onClick={closeModal} style={{ position: 'absolute', inset: 0, background: 'rgba(15,23,42,0.45)' }} />
          <div style={korModalCardStyle}>
            <div style={{ display: 'grid', gap: 14, padding: '18px 18px 16px', borderBottom: '1px solid #e5e7eb', background: 'linear-gradient(180deg, #ffffff 0%, #f8fbff 100%)' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
                <div style={{ display: 'grid', gap: 6, minWidth: 0 }}>
                  <span style={korEyebrowStyle}>{editing ? 'Redigera resa' : 'Ny resa'}</span>
                  <strong style={{ fontSize: 26, lineHeight: 1.05, color: '#0f172a' }}>{editing ? 'Uppdatera körningen' : 'Registrera ny körning'}</strong>
                  <span style={{ fontSize: 14, color: '#64748b' }}>Fyll i resa, kilometer och anteckning i ett tydligare arbetsflöde.</span>
                </div>
                <div style={{ marginLeft: 'auto' }} />
                <button className="btn--plain btn--sm" onClick={closeModal}>Stäng</button>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8 }}>
                <div style={korMiniStatStyle}>
                  <span style={korMiniStatLabelStyle}>Läge</span>
                  <strong style={korMiniStatValueStyle}>{editing ? 'Redigering' : 'Ny registrering'}</strong>
                </div>
                <div style={korMiniStatStyle}>
                  <span style={korMiniStatLabelStyle}>Favoriter</span>
                  <strong style={korMiniStatValueStyle}>{topStarts.length + topEnds.length}</strong>
                </div>
              </div>
            </div>
            <div style={{ padding: 18, display: 'grid', gap: 14 }}>
              {error && <div style={{ color: '#b91c1c', fontSize: 13, padding: '12px 14px', borderRadius: 14, border: '1px solid #fecaca', background: '#fef2f2' }}>{error}</div>}
              <label style={{ display: 'grid', gap: 6 }}>
                <span style={korFieldLabelStyle}>Datum</span>
                <input className="text-field" type="date" value={form.date} onChange={e => setForm((f:any) => ({ ...f, date: e.target.value }))} />
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
              <label style={{ display: 'grid', gap: 6 }}>
                <span style={korFieldLabelStyle}>Startadress</span>
                <div style={{ position: 'relative' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 6 }}>
                    <input
                      className="text-field"
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
                    <button type="button" className="btn--plain btn--sm" onClick={() => fillAddress('start')} disabled={!!locating.start} title="Hämta nuvarande plats">
                      {locating.start ? 'Hämtar…' : 'Hämta plats'}
                    </button>
                  </div>

                  {topStarts.length > 0 && (
                    <div style={{ marginTop: 6, display: 'flex', justifyContent: 'flex-end' }}>
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
                    </div>
                  )}

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
              <label style={{ display: 'grid', gap: 6 }}>
                <span style={korFieldLabelStyle}>Slutadress</span>
                <div style={{ position: 'relative' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 6 }}>
                    <input
                      className="text-field"
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
                    <button type="button" className="btn--plain btn--sm" onClick={() => fillAddress('end')} disabled={!!locating.end} title="Hämta nuvarande plats">
                      {locating.end ? 'Hämtar…' : 'Hämta plats'}
                    </button>
                  </div>

                  {topEnds.length > 0 && (
                    <div style={{ marginTop: 6, display: 'flex', justifyContent: 'flex-end' }}>
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
                    </div>
                  )}

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
              </div>
              <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
                <label style={{ display: 'grid', gap: 6 }}>
                  <span style={korFieldLabelStyle}>Start km</span>
                  <input className="text-field" inputMode="numeric" value={form.startKm} onChange={e => setForm((f:any) => ({ ...f, startKm: e.target.value }))} placeholder="0" />
                </label>
                <label style={{ display: 'grid', gap: 6 }}>
                  <span style={korFieldLabelStyle}>Slut km</span>
                  <input className="text-field" inputMode="numeric" value={form.endKm} onChange={e => setForm((f:any) => ({ ...f, endKm: e.target.value }))} placeholder="0" />
                </label>
              </div>
              <label style={{ display: 'grid', gap: 6 }}>
                <span style={korFieldLabelStyle}>Anteckning</span>
                <textarea className="text-area" value={form.note} onChange={e => setForm((f:any) => ({ ...f, note: e.target.value }))} placeholder="Syfte med resan eller extra kontext" rows={4} />
              </label>
              <div style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
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

const korEyebrowStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '4px 10px',
  borderRadius: 999,
  background: '#d9f99d',
  border: '1px solid #bef264',
  color: '#3f6212',
  fontSize: 11,
  fontWeight: 800,
  letterSpacing: 0.35,
  textTransform: 'uppercase',
};

const korChipStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '4px 8px',
  borderRadius: 999,
  background: '#f8fafc',
  border: '1px solid #e2e8f0',
  color: '#475569',
  fontSize: 12,
  fontWeight: 700,
};

const korStatCardStyle: React.CSSProperties = {
  display: 'grid',
  gap: 6,
  padding: '14px 14px 12px',
  borderRadius: 18,
  border: '1px solid #dbe4ef',
  background: '#ffffff',
};

const korStatLabelStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 800,
  letterSpacing: 0.3,
  textTransform: 'uppercase',
  color: '#64748b',
};

const korStatValueStyle: React.CSSProperties = {
  fontSize: 28,
  lineHeight: 1.05,
  color: '#0f172a',
  fontWeight: 800,
};

const korInfoPanelStyle: React.CSSProperties = {
  display: 'grid',
  gap: 6,
  padding: '14px 14px 12px',
  borderRadius: 18,
  border: '1px solid #dbe4ef',
  background: 'linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)',
};

const korInfoTitleStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 800,
  letterSpacing: 0.32,
  textTransform: 'uppercase',
  color: '#64748b',
};

const korInfoMainStyle: React.CSSProperties = {
  fontSize: 18,
  fontWeight: 800,
  color: '#0f172a',
};

const korInfoSubStyle: React.CSSProperties = {
  fontSize: 13,
  color: '#64748b',
  lineHeight: 1.45,
};

const korMiniStatStyle: React.CSSProperties = {
  display: 'grid',
  gap: 5,
  padding: '12px 12px 10px',
  borderRadius: 16,
  border: '1px solid #e2e8f0',
  background: '#ffffff',
};

const korMiniStatLabelStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 800,
  letterSpacing: 0.3,
  textTransform: 'uppercase',
  color: '#64748b',
};

const korMiniStatValueStyle: React.CSSProperties = {
  fontSize: 18,
  fontWeight: 800,
  color: '#0f172a',
};

const korMetaPillStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '6px 10px',
  borderRadius: 999,
  background: '#f8fafc',
  border: '1px solid #e2e8f0',
  fontSize: 12,
  color: '#334155',
};

const korModalOverlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 2100,
  display: 'grid',
  placeItems: 'center',
  padding: 'max(16px, calc(env(safe-area-inset-top) + 12px)) max(12px, calc(env(safe-area-inset-right) + 12px)) max(16px, calc(env(safe-area-inset-bottom) + 12px)) max(12px, calc(env(safe-area-inset-left) + 12px))',
};

const korModalCardStyle: React.CSSProperties = {
  position: 'relative',
  width: 'min(96vw, 760px)',
  maxHeight: 'calc(100vh - env(safe-area-inset-top) - env(safe-area-inset-bottom) - 24px)',
  overflowY: 'auto',
  background: '#fff',
  borderRadius: 24,
  boxShadow: '0 28px 70px rgba(15,23,42,0.24)',
  border: '1px solid rgba(219,228,239,0.9)',
};

const korFieldLabelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 800,
  letterSpacing: 0.28,
  textTransform: 'uppercase',
  color: '#475569',
};
