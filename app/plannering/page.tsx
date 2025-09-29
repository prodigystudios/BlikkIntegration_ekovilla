"use client";
import { useEffect, useMemo, useState } from 'react';

// Types
interface Project {
  id: string;
  name: string;
  orderNumber?: string | null;
  customer: string;
  createdAt: string;
  status: string;
  isManual?: boolean; // local only flag
}
interface ScheduledItem extends Project {
  startDay: string; // YYYY-MM-DD
  endDay: string;   // inclusive
  truck?: string | null;
  color?: string | null;
  bagCount?: number | null;
  jobType?: string | null;
}

function startOfMonth(d: Date) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function endOfMonth(d: Date) { return new Date(d.getFullYear(), d.getMonth() + 1, 0); }
function fmtDate(d: Date) { return d.toISOString().slice(0, 10); }

export default function PlanneringPage() {
  // Loading/data
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [scheduled, setScheduled] = useState<ScheduledItem[]>([]);

  // Calendar / UI state
  const [monthOffset, setMonthOffset] = useState(0);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [editingTruckFor, setEditingTruckFor] = useState<string | null>(null);
  const [truckFilter, setTruckFilter] = useState<string>('');
  const [calendarSearch, setCalendarSearch] = useState('');
  const [jumpTargetDay, setJumpTargetDay] = useState<string | null>(null);
  const [matchIndex, setMatchIndex] = useState(-1);

  // Project lookup / backlog
  const [searchOrder, setSearchOrder] = useState('');
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [recentSearchedIds, setRecentSearchedIds] = useState<string[]>([]);

  // Manual project form
  const [manualName, setManualName] = useState('');
  const [manualCustomer, setManualCustomer] = useState('');
  const [manualOrderNumber, setManualOrderNumber] = useState('');
  const [manualError, setManualError] = useState<string | null>(null);

  const trucks = ['mb blå', 'mb vit', 'volvo blå'];
  const jobTypes = ['Ekovilla', 'Vitull', 'Leverans', 'Utsugning', 'Snickerier', 'Övrigt'];

  // Fallback selection scheduling (if drag/drop misbehaves)
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);

  // Truck color overrides (base color for each truck -> derived palette)
  const [truckColorOverrides, setTruckColorOverrides] = useState<Record<string, string>>({
    'mb blå': '#38bdf8',
    'mb vit': '#94a3b8',
    'volvo blå': '#6366f1'
  });

  function deriveColors(baseHex: string) {
    let hex = baseHex.startsWith('#') ? baseHex.slice(1) : baseHex;
    if (!/^[0-9a-fA-F]{6}$/.test(hex)) hex = '6366f1';
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    const lighten = (ch: number) => Math.round(ch + (255 - ch) * 0.85);
    const lr = lighten(r), lg = lighten(g), lb = lighten(b);
    const bg = `#${lr.toString(16).padStart(2, '0')}${lg.toString(16).padStart(2, '0')}${lb.toString(16).padStart(2, '0')}`;
    const brightness = (r * 299 + g * 587 + b * 114) / 1000;
    const text = brightness < 110 ? '#ffffff' : '#111827';
    return { border: '#' + hex, bg, text };
  }

  async function searchByOrderNumber(e?: React.FormEvent) {
    if (e) e.preventDefault();
    const val = searchOrder.trim();
    if (!val) return;
    setSearchLoading(true);
    setSearchError(null);
    try {
      const res = await fetch(`/api/blikk/projects?orderNumber=${encodeURIComponent(val)}`);
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Fel vid sökning');
      const normalized: Project[] = (j.projects || []).map((p: any) => ({ ...p, id: String(p.id), orderNumber: p.orderNumber ?? null }));
      if (!normalized.length) {
        setSearchError('Inget projekt hittades');
      } else {
        setProjects(prev => {
          const ids = new Set(normalized.map(p => p.id));
          const rest = prev.filter(p => !ids.has(p.id));
          return [...normalized, ...rest];
        });
        setRecentSearchedIds(prev => {
          const merged = [...normalized.map(p => p.id), ...prev.filter(id => !normalized.some(n => n.id === id))];
          return merged.slice(0, 5);
        });
        setSource(j.source || source);
      }
    } catch (err: any) {
      setSearchError(String(err.message || err));
    } finally {
      setSearchLoading(false);
    }
  }

  function addManualProject(e: React.FormEvent) {
    e.preventDefault();
    setManualError(null);
    const name = manualName.trim();
    const customer = manualCustomer.trim();
    if (!name) return setManualError('Namn krävs');
    if (!customer) return setManualError('Kund krävs');
    const id = 'manual-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    const proj: Project = {
      id,
      name,
      customer,
      orderNumber: manualOrderNumber.trim() || null,
      createdAt: new Date().toISOString(),
      status: 'MANUELL',
      isManual: true
    };
    setProjects(prev => [proj, ...prev]);
    setManualName('');
    setManualCustomer('');
    setManualOrderNumber('');
  }

  // Initial fetch
  useEffect(() => {
    (async () => {
      try {
        setError(null);
        const res = await fetch('/api/blikk/projects');
        const j = await res.json();
        if (!res.ok) setError(j.error || 'Fel vid hämtning');
        const normalized: Project[] = (j.projects || []).map((p: any) => ({ ...p, id: String(p.id), orderNumber: p.orderNumber ?? null }));
        setProjects(normalized);
        setSource(j.source || null);
      } catch (e: any) {
        setError(String(e?.message || e));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Calendar grid weeks
  const weeks = useMemo(() => {
    const base = new Date();
    base.setDate(1);
    base.setMonth(base.getMonth() + monthOffset);
    const start = startOfMonth(base);
    const end = endOfMonth(base);
    const days: Array<{ date: string | null; inMonth: boolean }> = [];
    const weekdayIndex = (d: Date) => (d.getDay() + 6) % 7; // Mon=0
    for (let i = 0, lead = weekdayIndex(start); i < lead; i++) days.push({ date: null, inMonth: false });
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) days.push({ date: fmtDate(new Date(d)), inMonth: true });
    while (days.length % 7 !== 0) days.push({ date: null, inMonth: false });
    const out: Array<Array<{ date: string | null; inMonth: boolean }>> = [];
    for (let i = 0; i < days.length; i += 7) out.push(days.slice(i, i + 7));
    return out;
  }, [monthOffset]);

  const dayNames = ['Mån', 'Tis', 'Ons', 'Tor', 'Fre', 'Lör', 'Sön'];

  function isoWeekNumber(dateStr: string) {
    const d = new Date(dateStr + 'T00:00:00');
    const target = new Date(d.valueOf());
    const dayNr = (d.getDay() + 6) % 7;
    target.setDate(target.getDate() - dayNr + 3);
    const firstThursday = new Date(target.getFullYear(), 0, 4);
    const firstThursdayDayNr = (firstThursday.getDay() + 6) % 7;
    firstThursday.setDate(firstThursday.getDate() - firstThursdayDayNr + 3);
    const diff = target.getTime() - firstThursday.getTime();
    return 1 + Math.round(diff / (7 * 24 * 3600 * 1000));
  }

  // Truck colors
  const truckColors = useMemo(() => {
    const map: Record<string, { bg: string; border: string; text: string }> = {};
    for (const t of trucks) map[t] = deriveColors(truckColorOverrides[t]);
    return map;
  }, [truckColorOverrides, trucks]);

  // Expand scheduled items to per-day instances
  interface DayInstance extends ScheduledItem { day: string; spanStart: boolean; spanEnd: boolean; spanMiddle: boolean; totalSpan: number; }
  const itemsByDay = useMemo(() => {
    const map = new Map<string, DayInstance[]>();
    for (const base of scheduled) {
      const start = new Date(base.startDay);
      const end = new Date(base.endDay);
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const day = fmtDate(d);
        const spanStart = day === base.startDay;
        const spanEnd = day === base.endDay;
        const totalSpan = Math.round((new Date(base.endDay).getTime() - new Date(base.startDay).getTime()) / 86400000) + 1;
        const inst: DayInstance = { ...base, day, spanStart, spanEnd, spanMiddle: !spanStart && !spanEnd, totalSpan };
        const list = map.get(day) || [];
        list.push(inst);
        map.set(day, list);
      }
    }
    return map;
  }, [scheduled]);

  // Calendar search (only one implementation)
  const calendarMatchDays = useMemo(() => {
    const term = calendarSearch.trim().toLowerCase();
    if (!term) return [] as string[];
    const set = new Set<string>();
    for (const it of scheduled) {
      const hay = [it.name, it.orderNumber || '', it.customer, it.jobType || '', (it.bagCount != null ? String(it.bagCount) : '')].join(' ').toLowerCase();
      if (hay.includes(term)) set.add(it.startDay);
    }
    return Array.from(set).sort();
  }, [calendarSearch, scheduled]);
  const firstCalendarMatchDay = calendarMatchDays[0] || null;
  function navigateToMatch(idx: number) {
    const day = calendarMatchDays[idx];
    if (!day) return;
    const target = new Date(day + 'T00:00:00');
    const base = new Date(); base.setDate(1);
    const desiredOffset = (target.getFullYear() - base.getFullYear()) * 12 + (target.getMonth() - base.getMonth());
    setMonthOffset(desiredOffset);
    setJumpTargetDay(day);
    setMatchIndex(idx);
  }
  function jumpToFirstMatch() { if (firstCalendarMatchDay) navigateToMatch(0); }
  useEffect(() => { setMatchIndex(-1); }, [calendarSearch]);
  useEffect(() => {
    if (!jumpTargetDay) return;
    const el = document.getElementById('calday-' + jumpTargetDay);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const t = setTimeout(() => setJumpTargetDay(null), 2500);
      return () => clearTimeout(t);
    }
  }, [weeks, jumpTargetDay]);

  // Backlog lists
  const backlog = useMemo(() => projects.filter(p => !scheduled.some(s => s.id === p.id) && !recentSearchedIds.includes(p.id)), [projects, scheduled, recentSearchedIds]);
  const searchedProjects = useMemo(() => recentSearchedIds.map(id => projects.find(p => p.id === id)).filter(Boolean) as Project[], [recentSearchedIds, projects]);

  // DnD handlers
  function onDragStart(e: React.DragEvent, id: string) { e.dataTransfer.setData('text/plain', id); setDraggingId(id); e.dataTransfer.effectAllowed = 'move'; }
  function onDragEnd() { setDraggingId(null); }
  function allowDrop(e: React.DragEvent) { e.preventDefault(); }
  function onDropDay(e: React.DragEvent, day: string) {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/plain');
    if (!id) return;
    console.debug('[Plannering] Drop received', { id, day });
    setScheduled(prev => {
      const existing = prev.find(p => p.id === id);
      if (existing) {
        const duration = Math.round((new Date(existing.endDay).getTime() - new Date(existing.startDay).getTime()) / 86400000);
        const start = day;
        const end = new Date(day + 'T00:00:00');
        end.setDate(end.getDate() + duration);
        console.debug('[Plannering] Moving existing scheduled item', { id, start, end: fmtDate(end) });
        return prev.map(p => p.id === id ? { ...p, startDay: start, endDay: fmtDate(end) } : p);
      }
      const proj = projects.find(p => p.id === id);
      if (!proj) return prev;
      const newItem: ScheduledItem = { ...proj, startDay: day, endDay: day, truck: null, color: null, bagCount: null, jobType: null };
      console.debug('[Plannering] Scheduling new item from backlog/manual', { id, day });
      setTimeout(() => setEditingTruckFor(newItem.id), 0);
      return [...prev, newItem];
    });
  }

  // Click-based scheduling fallback: select a backlog project, then click a calendar day.
  function scheduleSelectedOnDay(day: string) {
    if (!selectedProjectId) return;
    const id = selectedProjectId;
    setSelectedProjectId(null);
    setScheduled(prev => {
      if (prev.some(p => p.id === id)) return prev; // already scheduled
      const proj = projects.find(p => p.id === id);
      if (!proj) return prev;
      console.debug('[Plannering] Click-schedule new item', { id, day });
      const newItem: ScheduledItem = { ...proj, startDay: day, endDay: day, truck: null, color: null, bagCount: null, jobType: null };
      setTimeout(() => setEditingTruckFor(newItem.id), 0);
      return [...prev, newItem];
    });
  }
  function unschedule(id: string) { setScheduled(prev => prev.filter(p => p.id !== id)); }
  function extendSpan(id: string, direction: 'forward' | 'back') {
    setScheduled(prev => prev.map(p => {
      if (p.id !== id) return p;
      if (direction === 'forward') { const d = new Date(p.endDay); d.setDate(d.getDate() + 1); return { ...p, endDay: fmtDate(d) }; }
      const d = new Date(p.startDay); d.setDate(d.getDate() - 1); return { ...p, startDay: fmtDate(d) };
    }));
  }
  function shrinkSpan(id: string, edge: 'end' | 'start') {
    setScheduled(prev => prev.map(p => {
      if (p.id !== id) return p;
      const span = Math.round((new Date(p.endDay).getTime() - new Date(p.startDay).getTime()) / 86400000) + 1;
      if (span <= 1) return p;
      if (edge === 'end') { const d = new Date(p.endDay); d.setDate(d.getDate() - 1); return { ...p, endDay: fmtDate(d) }; }
      const d = new Date(p.startDay); d.setDate(d.getDate() + 1); return { ...p, startDay: fmtDate(d) };
    }));
  }

  return (
    <div style={{ padding: 16, display: 'grid', gap: 16 }}>
      <h1 style={{ margin: 0 }}>Plannering</h1>
      <p style={{ margin: 0, color: '#6b7280', fontSize: 14 }}>Dra projekt från listan till en dag i kalendern (lokal state).</p>
      {source && <div style={{ fontSize: 11, color: '#9ca3af' }}>Källa: {source}</div>}
      {error && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', padding: '6px 8px', borderRadius: 6, fontSize: 12 }}>Fel: {error}</div>}

      <div style={{ display: 'grid', gap: 16, gridTemplateColumns: '290px 1fr', alignItems: 'start' }}>
        {/* Left: search / manual add / backlog */}
        <div style={{ display: 'grid', gap: 16 }}>
          {/* Search & manual add */}
            <div style={{ display: 'grid', gap: 10 }}>
              <form onSubmit={searchByOrderNumber} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input value={searchOrder} onChange={e => setSearchOrder(e.target.value)} placeholder="Sök ordernummer..." style={{ flex: 1, border: '1px solid #d1d5db', borderRadius: 6, padding: '6px 8px', fontSize: 13 }} />
                <button type="submit" disabled={!searchOrder.trim() || searchLoading} className="btn--plain btn--xs" style={{ border: '1px solid #d1d5db', borderRadius: 6, padding: '5px 10px', background: '#fff' }}>{searchLoading ? 'Söker…' : 'Sök'}</button>
                {searchOrder && !searchLoading && <button type="button" className="btn--plain btn--xs" style={{ fontSize: 11 }} onClick={() => { setSearchOrder(''); setSearchError(null); }}>Rensa</button>}
              </form>
              {searchError && <div style={{ fontSize: 11, color: '#b91c1c' }}>{searchError}</div>}
              <div style={{ padding: 10, border: '1px solid #e2e8f0', borderRadius: 8, background: '#f8fafc', display: 'grid', gap: 8 }}>
                <strong style={{ fontSize: 13, color: '#1e293b' }}>Lägg till manuellt</strong>
                <form onSubmit={addManualProject} style={{ display: 'grid', gap: 6 }}>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input value={manualName} onChange={e => setManualName(e.target.value)} placeholder="Projektnamn" style={{ flex: 1, border: '1px solid #cbd5e1', borderRadius: 6, padding: '6px 8px', fontSize: 12 }} />
                    <input value={manualCustomer} onChange={e => setManualCustomer(e.target.value)} placeholder="Kund" style={{ flex: 1, border: '1px solid #cbd5e1', borderRadius: 6, padding: '6px 8px', fontSize: 12 }} />
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <input value={manualOrderNumber} onChange={e => setManualOrderNumber(e.target.value)} placeholder="Ordernr (valfritt)" style={{ flex: 1, border: '1px solid #cbd5e1', borderRadius: 6, padding: '6px 8px', fontSize: 12 }} />
                    <button type="submit" className="btn--plain btn--xs" disabled={!manualName.trim() || !manualCustomer.trim()} style={{ fontSize: 12, border: '1px solid #2563eb', color: '#1d4ed8', background: '#fff', padding: '6px 10px', borderRadius: 6 }}>Lägg till</button>
                  </div>
                  {manualError && <div style={{ fontSize: 11, color: '#b91c1c' }}>{manualError}</div>}
                  <div style={{ fontSize: 10, color: '#64748b' }}>Endast lokalt tills sparfunktion finns.</div>
                </form>
              </div>
            </div>

          {searchedProjects.length > 0 && (
            <div style={{ display: 'grid', gap: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h2 style={{ fontSize: 14, margin: 0 }}>Sökresultat</h2>
                <button type="button" className="btn--plain btn--xs" style={{ fontSize: 11 }} onClick={() => setRecentSearchedIds([])}>Rensa</button>
              </div>
              {searchedProjects.map(p => (
                <div key={p.id} draggable onDragStart={e => onDragStart(e, p.id)} onDragEnd={onDragEnd} style={{ position: 'relative', border: '1px solid #6366f1', boxShadow: '0 0 0 3px rgba(99,102,241,0.25)', background: draggingId === p.id ? '#eef2ff' : '#ffffff', borderRadius: 8, padding: 10, cursor: 'grab', display: 'grid', gap: 4 }}>
                  <div style={{ position: 'absolute', top: -6, right: -6, background: '#6366f1', color: '#fff', fontSize: 10, padding: '2px 6px', borderRadius: 12 }}>Hittad</div>
                  <strong style={{ fontSize: 14 }}>
                    {p.orderNumber ? <span style={{ fontFamily: 'ui-monospace, monospace', background: '#eef2ff', color: '#312e81', padding: '2px 6px', borderRadius: 4, marginRight: 6, fontSize: 12, border: '1px solid #c7d2fe' }}>#{p.orderNumber}</span> : null}
                    {p.name}
                  </strong>
                  <span style={{ fontSize: 12, color: '#6b7280' }}>{p.customer}</span>
                  <span style={{ fontSize: 11, color: '#9ca3af' }}>Skapad: {p.createdAt.slice(0, 10)}</span>
                </div>
              ))}
              <hr style={{ border: 'none', height: 1, background: '#e5e7eb', margin: 0 }} />
            </div>
          )}

          <div style={{ display: 'grid', gap: 8 }}>
            <h2 style={{ fontSize: 15, margin: 0 }}>Backlog</h2>
            {loading && <div style={{ fontSize: 12 }}>Laddar projekt…</div>}
            {!loading && backlog.length === 0 && <div style={{ fontSize: 12, color: '#64748b' }}>Inga fler oschemalagda.</div>}
            {backlog.map(p => (
        <div key={p.id}
           draggable
           onDragStart={e => onDragStart(e, p.id)}
           onDragEnd={onDragEnd}
           onClick={() => setSelectedProjectId(prev => prev === p.id ? null : p.id)}
           style={{ position: 'relative', border: selectedProjectId === p.id ? '2px solid #f59e0b' : (p.isManual ? '2px dashed #94a3b8' : '1px solid #e5e7eb'), borderRadius: 8, padding: 10, background: draggingId === p.id ? '#eef2ff' : (p.isManual ? '#f1f5f9' : '#fff'), cursor: 'grab', display: 'grid', gap: 4 }}>
                {p.isManual && <span style={{ position: 'absolute', top: -7, left: 8, background: '#334155', color: '#fff', fontSize: 10, padding: '2px 6px', borderRadius: 12 }}>Manuell</span>}
        {selectedProjectId === p.id && <span style={{ position: 'absolute', top: -7, right: 8, background: '#f59e0b', color: '#fff', fontSize: 10, padding: '2px 6px', borderRadius: 12 }}>Vald</span>}
                <strong style={{ fontSize: 14 }}>
                  {p.orderNumber ? <span style={{ fontFamily: 'ui-monospace, monospace', background: '#f3f4f6', padding: '2px 6px', borderRadius: 4, marginRight: 6, fontSize: 12 }}>#{p.orderNumber}</span> : null}
                  {p.name}
                </strong>
                <span style={{ fontSize: 12, color: '#6b7280' }}>{p.customer}</span>
                <span style={{ fontSize: 11, color: '#9ca3af' }}>Skapad: {p.createdAt.slice(0, 10)}</span>
              </div>
            ))}
      {selectedProjectId && <div style={{ fontSize: 11, color: '#b45309', background: '#fef3c7', border: '1px solid #fcd34d', padding: '4px 6px', borderRadius: 6 }}>Klicka på en dag i kalendern för att schemalägga vald projekt (fallback).</div>}
          </div>
        </div>

        {/* Calendar */}
        <div style={{ display: 'grid', gap: 12 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button className="btn--plain btn--sm" onClick={() => setMonthOffset(o => o - 1)}>◀</button>
            <strong style={{ fontSize: 16 }}>{(() => { const d = new Date(); d.setMonth(d.getMonth() + monthOffset); return d.toLocaleDateString('sv-SE', { month: 'long', year: 'numeric' }); })()}</strong>
            <button className="btn--plain btn--sm" onClick={() => setMonthOffset(o => o + 1)}>▶</button>
            {monthOffset !== 0 && <button className="btn--plain btn--sm" onClick={() => setMonthOffset(0)}>Idag</button>}
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <label style={{ fontSize: 12, color: '#374151' }}>Sök i kalender:</label>
                <input value={calendarSearch} onChange={e => setCalendarSearch(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); if (calendarMatchDays.length > 0) navigateToMatch((matchIndex + 1) % calendarMatchDays.length); } }} style={{ border: '1px solid #d1d5db', borderRadius: 6, padding: '4px 6px', fontSize: 12 }} placeholder="#1234 eller namn" />
                {calendarSearch && <button type="button" className="btn--plain btn--xs" style={{ fontSize: 11 }} onClick={() => setCalendarSearch('')}>X</button>}
                <button type="button" className="btn--plain btn--xs" disabled={!firstCalendarMatchDay} onClick={jumpToFirstMatch} style={{ fontSize: 11, border: '1px solid #d1d5db', borderRadius: 6, padding: '2px 8px', background: firstCalendarMatchDay ? '#fff' : '#f3f4f6', opacity: firstCalendarMatchDay ? 1 : 0.5 }}>Hoppa</button>
              </div>
              <label style={{ fontSize: 12, color: '#374151' }}>Lastbil:</label>
              <select value={truckFilter} onChange={e => setTruckFilter(e.target.value)} style={{ fontSize: 12, padding: '4px 6px', border: '1px solid #d1d5db', borderRadius: 6, background: '#fff' }}>
                <option value="">Alla</option>
                <option value="UNASSIGNED">(Ingen vald)</option>
                {trucks.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
              {truckFilter && <button type="button" className="btn--plain btn--xs" style={{ fontSize: 11 }} onClick={() => setTruckFilter('')}>Rensa</button>}
            </div>
          </div>
          {/* Legend */}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 11, alignItems: 'center' }}>
            {trucks.map(t => {
              const c = truckColors[t];
              const current = truckColorOverrides[t];
              return (
                <div key={t} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px', border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff' }}>
                  <span style={{ width: 16, height: 16, background: c.bg, border: `3px solid ${c.border}`, borderRadius: 6, display: 'inline-block' }} />
                  <span style={{ fontWeight: 600, color: c.text }}>{t}</span>
                  <input type="color" value={current} aria-label={`Ändra färg för ${t}`} onChange={e => setTruckColorOverrides(o => ({ ...o, [t]: e.target.value }))} style={{ width: 28, height: 28, padding: 0, border: '1px solid #cbd5e1', borderRadius: 6, cursor: 'pointer', background: '#fff' }} />
                  <button type="button" className="btn--plain btn--xs" style={{ fontSize: 11 }} title="Återställ" onClick={() => setTruckColorOverrides(o => ({ ...o, [t]: ({ 'mb blå': '#38bdf8', 'mb vit': '#94a3b8', 'volvo blå': '#6366f1' } as any)[t] }))}>↺</button>
                </div>
              );
            })}
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ width: 14, height: 14, background: '#fff', border: '2px dashed #94a3b8', borderRadius: 4 }} /> Ingen</div>
          </div>
          <div style={{ display: 'grid', gap: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '60px repeat(7, 1fr)', gap: 8, fontSize: 12, fontWeight: 600, color: '#374151' }}>
              <div style={{ textAlign: 'center' }}>Vecka</div>
              {dayNames.map(n => <div key={n} style={{ textAlign: 'center' }}>{n}</div>)}
            </div>
            {weeks.map((week, wi) => {
              const firstDay = week.find(c => c.date)?.date;
              const weekNum = firstDay ? isoWeekNumber(firstDay) : '';
              const weekBg = wi % 2 === 0 ? '#e0f2fe' : '#e0e7ff';
              return (
                <div key={wi} style={{ display: 'grid', gridTemplateColumns: '60px repeat(7, 1fr)', gap: 8, background: weekBg, padding: 6, borderRadius: 12, boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.05)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, background: 'rgba(255,255,255,0.65)', backdropFilter: 'blur(2px)', border: '1px solid rgba(0,0,0,0.07)', borderRadius: 8, color: '#1e293b', boxShadow: '0 1px 2px rgba(0,0,0,0.08)' }}>{weekNum && `v${weekNum}`}</div>
                  {week.map((cell, ci) => {
                    if (!cell.date) return <div key={ci} style={{ minHeight: 160, border: '1px solid transparent', borderRadius: 8 }} />;
                    const day = cell.date;
                    const rawItems = itemsByDay.get(day) || [];
                    const searchVal = calendarSearch.trim().toLowerCase();
                    const items = rawItems.filter(it => {
                      if (truckFilter) {
                        if (truckFilter === 'UNASSIGNED') { if (it.truck) return false; }
                        else if (it.truck !== truckFilter) return false;
                      }
                      if (searchVal) {
                        const hay = [it.name, it.orderNumber || '', it.customer, it.jobType || '', (it.bagCount != null ? String(it.bagCount) : '')].join(' ').toLowerCase();
                        if (!hay.includes(searchVal)) return false;
                      }
                      return true;
                    });
                    const isJumpHighlight = day === jumpTargetDay;
                    return (
                      <div key={day}
                           id={`calday-${day}`}
                           onClick={() => scheduleSelectedOnDay(day)}
                           onDragOver={allowDrop}
                           onDrop={e => onDropDay(e, day)}
                           style={{ border: isJumpHighlight ? '2px solid #f59e0b' : (selectedProjectId ? '2px dashed #fbbf24' : '1px solid rgba(148,163,184,0.4)'), boxShadow: isJumpHighlight ? '0 0 0 4px rgba(245,158,11,0.35)' : '0 1px 2px rgba(0,0,0,0.05)', transition: 'box-shadow 0.3s,border 0.3s', borderRadius: 10, padding: 8, minHeight: 160, background: '#ffffff', display: 'flex', flexDirection: 'column', gap: 8, position: 'relative', cursor: selectedProjectId ? 'copy' : 'default' }}>
                        <div style={{ fontSize: 12, fontWeight: 600, display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: '#111827' }}>
                          <span>{day.slice(8, 10)}/{day.slice(5, 7)}</span>
                          {items.length > 0 && <span style={{ fontSize: 10, background: '#f3f4f6', padding: '2px 6px', borderRadius: 12 }}>{items.length}</span>}
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          {items.map(it => {
                            let display: null | { bg: string; border: string; text: string } = null;
                            if (it.color) {
                              const hex = it.color.startsWith('#') ? it.color.slice(1) : it.color;
                              if (/^[0-9a-fA-F]{6}$/.test(hex)) {
                                const r = parseInt(hex.slice(0, 2), 16);
                                const g = parseInt(hex.slice(2, 4), 16);
                                const b = parseInt(hex.slice(4, 6), 16);
                                const lighten = (ch: number) => Math.round(ch + (255 - ch) * 0.85);
                                const lr = lighten(r), lg = lighten(g), lb = lighten(b);
                                const bg = `#${lr.toString(16).padStart(2, '0')}${lg.toString(16).padStart(2, '0')}${lb.toString(16).padStart(2, '0')}`;
                                const brightness = (r * 299 + g * 587 + b * 114) / 1000;
                                const text = brightness < 110 ? '#ffffff' : '#111827';
                                display = { bg, border: '#' + hex, text };
                              }
                            } else if (it.truck) {
                              display = truckColors[it.truck];
                            }
                            const cardBorder = display ? display.border : '#c7d2fe';
                            const cardBg = display ? display.bg : '#eef2ff';
                            const highlight = calendarSearch && (it.name.toLowerCase().includes(searchVal) || (it.orderNumber || '').toLowerCase().includes(searchVal));
                            const isMid = (it as any).spanMiddle;
                            const isStart = (it as any).spanStart;
                            return (
                              <div key={`${it.id}:${it.day}`} draggable onDragStart={e => onDragStart(e, it.id)} onDragEnd={onDragEnd} style={{ position: 'relative', border: `2px solid ${highlight ? '#f59e0b' : cardBorder}`, background: cardBg, borderRadius: 6, padding: 6, fontSize: 12, cursor: 'grab', display: 'grid', gap: 4, opacity: isMid ? 0.95 : 1, boxShadow: highlight ? '0 0 0 3px rgba(245,158,11,0.35)' : 'none' }}>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                  <span style={{ fontWeight: 600, color: display ? display.text : '#312e81' }}>
                                    {it.orderNumber ? <span style={{ fontFamily: 'ui-monospace, monospace', background: '#ffffff', color: display ? display.text : '#312e81', border: `1px solid ${cardBorder}`, padding: '1px 4px', borderRadius: 4, marginRight: 4 }}>#{it.orderNumber}</span> : null}
                                    {it.name}
                                  </span>
                                  {isStart && <span style={{ color: display ? display.text : '#6366f1' }}>{it.customer}</span>}
                                  {(it.bagCount != null || it.jobType) && (
                                    <span style={{ fontSize: 11, color: display ? display.text : '#374151' }}>
                                      {it.bagCount != null ? `${it.bagCount} säckar` : ''}
                                      {it.bagCount != null && it.jobType ? ' • ' : ''}
                                      {it.jobType || ''}
                                    </span>
                                  )}
                                </div>
                                {isStart && (
                                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                                    {editingTruckFor === it.id ? (
                                      <select autoFocus value={it.truck || ''} onChange={e => { const val = e.target.value || null; setScheduled(prev => prev.map(p => p.id === it.id ? { ...p, truck: val } : p)); setEditingTruckFor(null); }} onBlur={() => setEditingTruckFor(null)} style={{ fontSize: 11, padding: '2px 4px', border: `1px solid ${cardBorder}`, borderRadius: 4 }}>
                                        <option value="">Välj lastbil…</option>
                                        {trucks.map(t => <option key={t} value={t}>{t}</option>)}
                                      </select>
                                    ) : (
                                      <button type="button" className="btn--plain btn--xs" onClick={() => setEditingTruckFor(it.id)} style={{ fontSize: 11, border: `1px solid ${cardBorder}`, borderRadius: 4, padding: '2px 6px', background: '#fff', color: display ? display.text : '#312e81' }}>{it.truck ? `Lastbil: ${it.truck}` : 'Välj lastbil'}</button>
                                    )}
                                    <input type="number" min={0} placeholder="Säckar" value={it.bagCount ?? ''} onChange={e => { const v = e.target.value; setScheduled(prev => prev.map(p => p.id === it.id ? { ...p, bagCount: v === '' ? null : Math.max(0, parseInt(v, 10) || 0) } : p)); }} style={{ width: 70, fontSize: 11, padding: '2px 4px', border: `1px solid ${cardBorder}`, borderRadius: 4 }} />
                                    <select value={it.jobType || ''} onChange={e => { const v = e.target.value || null; setScheduled(prev => prev.map(p => p.id === it.id ? { ...p, jobType: v } : p)); }} style={{ fontSize: 11, padding: '2px 4px', border: `1px solid ${cardBorder}`, borderRadius: 4 }}>
                                      <option value="">Typ av jobb…</option>
                                      {jobTypes.map(j => <option key={j} value={j}>{j}</option>)}
                                    </select>
                                    <div style={{ display: 'flex', gap: 2 }}>
                                      <button type="button" title="Förläng bakåt" className="btn--plain btn--xs" onClick={() => extendSpan(it.id, 'back')} style={{ fontSize: 11 }}>←+</button>
                                      <button type="button" title="Förläng framåt" className="btn--plain btn--xs" onClick={() => extendSpan(it.id, 'forward')} style={{ fontSize: 11 }}>+→</button>
                                      {(it as any).totalSpan > 1 && <button type="button" title="Kortare (slut)" className="btn--plain btn--xs" onClick={() => shrinkSpan(it.id, 'end')} style={{ fontSize: 11 }}>-→</button>}
                                      {(it as any).totalSpan > 1 && <button type="button" title="Kortare (start)" className="btn--plain btn--xs" onClick={() => shrinkSpan(it.id, 'start')} style={{ fontSize: 11 }}>←-</button>}
                                    </div>
                                    <button type="button" className="btn--plain btn--xs" onClick={() => unschedule(it.id)} style={{ fontSize: 11, background: '#fee2e2', border: '1px solid #fca5a5', color: '#b91c1c', borderRadius: 4, padding: '2px 6px' }}>Ta bort</button>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
