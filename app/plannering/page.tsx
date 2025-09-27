"use client";
import { useEffect, useMemo, useState } from 'react';

interface Project {
  id: string;
  name: string;
  orderNumber?: string | null;
  customer: string;
  createdAt: string;
  status: string;
}

interface ScheduledItem extends Project {
  startDay: string; // YYYY-MM-DD
  endDay: string;   // YYYY-MM-DD (inclusive)
  truck?: string | null;
  color?: string | null; // optional custom color override (hex)
  bagCount?: number | null; // antal säckar
  jobType?: string | null;  // typ av jobb
}

function startOfMonth(d: Date) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function endOfMonth(d: Date) { return new Date(d.getFullYear(), d.getMonth()+1, 0); }
function fmtDate(d: Date) { return d.toISOString().slice(0,10); }

export default function PlanneringPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [scheduled, setScheduled] = useState<ScheduledItem[]>([]); // local only for now
  const [monthOffset, setMonthOffset] = useState(0); // navigate months
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [searchOrder, setSearchOrder] = useState('');
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [recentSearchedIds, setRecentSearchedIds] = useState<string[]>([]);
  const trucks = ['mb blå', 'mb vit', 'volvo blå'];
  const jobTypes = ['Ekovilla', 'Vitull', 'Leverans', 'Utsugning', 'Snickerier', 'Övrigt'];
  const [editingTruckFor, setEditingTruckFor] = useState<string | null>(null);
  const [truckFilter, setTruckFilter] = useState<string>(''); // '' = all, 'UNASSIGNED' = utan lastbil
  // Per-truck color overrides (store base/border color). Initialize with defaults.
  const [truckColorOverrides, setTruckColorOverrides] = useState<Record<string,string>>({
    'mb blå': '#38bdf8',
    'mb vit': '#94a3b8',
    'volvo blå': '#6366f1'
  });

  function deriveColors(baseHex: string) {
    // Ensure #RRGGBB
    let hex = baseHex.startsWith('#') ? baseHex.slice(1) : baseHex;
    if (!/^[0-9a-fA-F]{6}$/.test(hex)) hex = '6366f1';
    const r = parseInt(hex.slice(0,2),16);
    const g = parseInt(hex.slice(2,4),16);
    const b = parseInt(hex.slice(4,6),16);
    const lighten = (ch: number) => Math.round(ch + (255 - ch) * 0.85); // strong lighten for subtle bg
    const lr = lighten(r), lg = lighten(g), lb = lighten(b);
    const bg = `#${lr.toString(16).padStart(2,'0')}${lg.toString(16).padStart(2,'0')}${lb.toString(16).padStart(2,'0')}`;
    const brightness = (r*299 + g*587 + b*114) / 1000;
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
        // Merge (replace existing same id or prepend new)
        setProjects(prev => {
          const ids = new Set(normalized.map(p => p.id));
          const rest = prev.filter(p => !ids.has(p.id));
          return [...normalized, ...rest];
        });
        setRecentSearchedIds(prev => {
          const merged = [...normalized.map(p => p.id), ...prev.filter(id => !normalized.some(n => n.id === id))];
          return merged.slice(0, 5); // keep small history
        });
        setSource(j.source || source);
      }
    } catch (err: any) {
      setSearchError(String(err.message || err));
    } finally {
      setSearchLoading(false);
    }
  }

  // Fetch newest projects
  useEffect(() => {
    (async () => {
      try {
        setError(null);
        const res = await fetch('/api/blikk/projects');
        const j = await res.json();
        if (!res.ok) {
          setError(j.error || 'Fel vid hämtning');
        }
  const normalized = (j.projects || []).map((p: any) => ({ ...p, id: String(p.id), orderNumber: p.orderNumber ?? null }));
  setProjects(normalized);
        setSource(j.source || null);
        if (j.error && !error) setError(j.error);
      } catch (e: any) {
        setError(String(e?.message || e));
      } finally { setLoading(false); }
    })();
  }, []);

  // Calendar weeks (7 days per row). Monday as first day of week.
  const weeks = useMemo(() => {
    const base = new Date();
    base.setDate(1);
    base.setMonth(base.getMonth() + monthOffset);
    const start = startOfMonth(base);
    const end = endOfMonth(base);
    const days: Array<{ date: string | null; inMonth: boolean }> = [];
    const weekdayIndex = (d: Date) => (d.getDay() + 6) % 7; // Mon=0 ... Sun=6
    // leading blanks
    for (let i = 0, lead = weekdayIndex(start); i < lead; i++) {
      days.push({ date: null, inMonth: false });
    }
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      days.push({ date: fmtDate(new Date(d)), inMonth: true });
    }
    // trailing blanks to complete final week
    while (days.length % 7 !== 0) days.push({ date: null, inMonth: false });
    // chunk into weeks
    const out: Array<Array<{ date: string | null; inMonth: boolean }>> = [];
    for (let i = 0; i < days.length; i += 7) out.push(days.slice(i, i + 7));
    return out;
  }, [monthOffset]);

  // Day names (Mon-first, Swedish abbreviations)
  const dayNames = ['Mån', 'Tis', 'Ons', 'Tor', 'Fre', 'Lör', 'Sön'];

  function isoWeekNumber(dateStr: string): number {
    const d = new Date(dateStr + 'T00:00:00');
    // ISO week: Thursday in current week decides the year
    const target = new Date(d.valueOf());
    const dayNr = (d.getDay() + 6) % 7; // Mon=0
    target.setDate(target.getDate() - dayNr + 3); // move to Thursday
    const firstThursday = new Date(target.getFullYear(), 0, 4);
    const firstThursdayDayNr = (firstThursday.getDay() + 6) % 7;
    firstThursday.setDate(firstThursday.getDate() - firstThursdayDayNr + 3);
    const diff = target.getTime() - firstThursday.getTime();
    return 1 + Math.round(diff / (7 * 24 * 3600 * 1000));
  }

  // Derived truck color palette each render
  const truckColors: Record<string, { bg: string; border: string; text: string }> = useMemo(() => {
    const map: Record<string, { bg: string; border: string; text: string }> = {};
    for (const t of trucks) {
      map[t] = deriveColors(truckColorOverrides[t]);
    }
    return map;
  }, [truckColorOverrides, trucks]);

  // Expand multi-day items into per-day instances for rendering
  interface DayInstance extends ScheduledItem { day: string; spanStart: boolean; spanEnd: boolean; spanMiddle: boolean; totalSpan: number; }
  const itemsByDay = useMemo(() => {
    const map = new Map<string, DayInstance[]>();
    for (const base of scheduled) {
      const start = new Date(base.startDay);
      const end = new Date(base.endDay);
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const dayStr = fmtDate(d);
        const spanStart = dayStr === base.startDay;
        const spanEnd = dayStr === base.endDay;
        const totalSpan = Math.round((new Date(base.endDay).getTime() - new Date(base.startDay).getTime()) / 86400000) + 1;
        const inst: DayInstance = { ...base, day: dayStr, spanStart, spanEnd, spanMiddle: !spanStart && !spanEnd, totalSpan };
        const list = map.get(dayStr) || []; list.push(inst); map.set(dayStr, list);
      }
    }
    return map;
  }, [scheduled]);

  // Remaining (unscheduled) backlog
  const backlog = useMemo(() => projects.filter(p => !scheduled.some(s => s.id === p.id) && !recentSearchedIds.includes(p.id)), [projects, scheduled, recentSearchedIds]);
  const searchedProjects = useMemo(() => recentSearchedIds.map(id => projects.find(p => p.id === id)).filter(Boolean) as Project[], [recentSearchedIds, projects]);

  function onDragStart(e: React.DragEvent, id: string) {
    e.dataTransfer.setData('text/plain', id);
    setDraggingId(id);
    e.dataTransfer.effectAllowed = 'move';
  }
  function onDragEnd() { setDraggingId(null); }

  function onDropDay(e: React.DragEvent, day: string) {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/plain');
    if (!id) return;
    // If already scheduled, move it
    setScheduled(prev => {
      const existing = prev.find(p => p.id === id);
      if (existing) {
        // Preserve duration
        const durationDays = Math.round((new Date(existing.endDay).getTime() - new Date(existing.startDay).getTime()) / 86400000);
        const newStart = day;
        const newStartDate = new Date(newStart);
        const newEndDate = new Date(newStartDate.getTime());
        newEndDate.setDate(newEndDate.getDate() + durationDays);
        const newEnd = fmtDate(newEndDate);
        return prev.map(p => p.id === id ? { ...p, startDay: newStart, endDay: newEnd } : p);
      }
  const proj = projects.find(p => p.id === id);
  if (!proj) return prev;
  const newItem: ScheduledItem = { ...proj, startDay: day, endDay: day, truck: null, color: null, bagCount: null, jobType: null };
      setTimeout(() => setEditingTruckFor(newItem.id), 0);
      return [...prev, newItem];
    });
  }

  function allowDrop(e: React.DragEvent) { e.preventDefault(); }

  function unschedule(id: string) {
    setScheduled(prev => prev.filter(p => p.id !== id));
  }

  function extendSpan(id: string, direction: 'forward' | 'back') {
    setScheduled(prev => prev.map(p => {
      if (p.id !== id) return p;
      if (direction === 'forward') {
        const d = new Date(p.endDay);
        d.setDate(d.getDate() + 1);
        return { ...p, endDay: fmtDate(d) };
      } else {
        const d = new Date(p.startDay);
        d.setDate(d.getDate() - 1);
        // Prevent spanning backwards beyond end by more than sanity (optional)
        return { ...p, startDay: fmtDate(d) };
      }
    }));
  }

  function shrinkSpan(id: string, edge: 'end' | 'start') {
    setScheduled(prev => prev.map(p => {
      if (p.id !== id) return p;
      const spanLen = Math.round((new Date(p.endDay).getTime() - new Date(p.startDay).getTime()) / 86400000) + 1;
      if (spanLen <= 1) return p; // cannot shrink further
      if (edge === 'end') {
        const d = new Date(p.endDay);
        d.setDate(d.getDate() - 1);
        return { ...p, endDay: fmtDate(d) };
      } else {
        const d = new Date(p.startDay);
        d.setDate(d.getDate() + 1);
        return { ...p, startDay: fmtDate(d) };
      }
    }));
  }
  return (
    <div style={{ padding: 16, display: 'grid', gap: 16 }}>
      <h1 style={{ margin: 0 }}>Plannering</h1>
      <p style={{ margin: 0, color: '#6b7280', fontSize: 14 }}>Dra projekt från listan till en dag i kalendern. Endast lokal state just nu.</p>
      {source && <div style={{ fontSize: 11, color: '#9ca3af' }}>Källa: {source}</div>}
      {error && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', padding: '6px 8px', borderRadius: 6, fontSize: 12 }}>Fel: {error}</div>}
      <form onSubmit={searchByOrderNumber} style={{ display:'flex', gap:8, marginTop:4, alignItems:'center' }}>
        <input value={searchOrder} onChange={e => setSearchOrder(e.target.value)} placeholder="Sök ordernummer..." style={{ flex:1, border:'1px solid #d1d5db', borderRadius:6, padding:'6px 8px', fontSize:14 }} />
        <button type="submit" disabled={!searchOrder.trim() || searchLoading} className="btn--plain btn--sm" style={{ border:'1px solid #d1d5db', borderRadius:6, padding:'6px 10px', background:'#fff' }}>{searchLoading ? 'Söker…' : 'Sök'}</button>
        {searchError && <span style={{ fontSize:11, color:'#b91c1c' }}>{searchError}</span>}
      </form>

      <div style={{ display: 'grid', gap: 16, gridTemplateColumns: '280px 1fr', alignItems: 'start' }}>
        {/* Backlog column */}
        <div style={{ display: 'grid', gap: 12 }}>
          {searchedProjects.length > 0 && (
            <div style={{ display:'grid', gap:8, marginBottom:12 }}>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                <h2 style={{ fontSize:14, margin:0, color:'#374151' }}>Sökresultat</h2>
                <button type="button" className="btn--plain btn--xs" onClick={() => setRecentSearchedIds([])} style={{ fontSize:11 }}>Rensa</button>
              </div>
              <div style={{ display:'grid', gap:8 }}>
                {searchedProjects.map(p => (
                  <div key={p.id}
                       draggable
                       onDragStart={e => onDragStart(e, p.id)}
                       onDragEnd={onDragEnd}
                       style={{ position:'relative', border: '1px solid #6366f1', boxShadow:'0 0 0 3px rgba(99,102,241,0.25)', background: draggingId === p.id ? '#eef2ff' : '#ffffff', borderRadius: 8, padding: 10, cursor: 'grab', display: 'grid', gap: 4 }}>
                    <div style={{ position:'absolute', top:-6, right:-6, background:'#6366f1', color:'#fff', fontSize:10, padding:'2px 6px', borderRadius:12 }}>Hittad</div>
                    <strong style={{ fontSize: 14 }}>
                      {p.orderNumber ? <span style={{ fontFamily: 'ui-monospace, monospace', background:'#eef2ff', color:'#312e81', padding:'2px 6px', borderRadius:4, marginRight:6, fontSize:12, border:'1px solid #c7d2fe' }}>#{p.orderNumber}</span> : null}
                      {p.name}
                    </strong>
                    <span style={{ fontSize: 12, color: '#6b7280' }}>{p.customer}</span>
                    <span style={{ fontSize: 11, color: '#9ca3af' }}>Skapad: {p.createdAt.slice(0,10)}</span>
                  </div>
                ))}
              </div>
              <hr style={{ border:'none', height:1, background:'#e5e7eb', margin:'4px 0 0' }} />
            </div>
          )}
          <h2 style={{ fontSize: 16, margin: '0 0 4px' }}>Nya projekt</h2>
          {loading && <div>Laddar projekt…</div>}
          {!loading && backlog.length === 0 && <div style={{ color: '#6b7280', fontSize: 13 }}>Inga fler oschemalagda projekt.</div>}
          <div style={{ display: 'grid', gap: 8 }}>
            {backlog.map(p => (
              <div key={p.id}
                   draggable
                   onDragStart={e => onDragStart(e, p.id)}
                   onDragEnd={onDragEnd}
                   style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 10, background: draggingId === p.id ? '#eef2ff' : '#fff', cursor: 'grab', display: 'grid', gap: 4 }}>
                <strong style={{ fontSize: 14 }}>
                  {p.orderNumber ? <span style={{ fontFamily: 'ui-monospace, monospace', background:'#f3f4f6', padding:'2px 6px', borderRadius:4, marginRight:6, fontSize:12 }}>#{p.orderNumber}</span> : null}
                  {p.name}
                </strong>
                <span style={{ fontSize: 12, color: '#6b7280' }}>{p.customer}</span>
                <span style={{ fontSize: 11, color: '#9ca3af' }}>Skapad: {p.createdAt.slice(0,10)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Calendar column */}
        <div style={{ display: 'grid', gap: 12 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap:'wrap' }}>
            <button className="btn--plain btn--sm" onClick={() => setMonthOffset(o => o - 1)}>◀</button>
            <strong style={{ fontSize: 16 }}>
              {(() => { const d = new Date(); d.setMonth(d.getMonth() + monthOffset); return d.toLocaleDateString('sv-SE', { month: 'long', year: 'numeric' }); })()}
            </strong>
            <button className="btn--plain btn--sm" onClick={() => setMonthOffset(o => o + 1)}>▶</button>
            {monthOffset !== 0 && <button className="btn--plain btn--sm" onClick={() => setMonthOffset(0)}>Idag</button>}
            <div style={{ marginLeft:'auto', display:'flex', gap:6, alignItems:'center' }}>
              <label style={{ fontSize:12, color:'#374151' }}>Filtrera lastbil:</label>
              <select value={truckFilter} onChange={e => setTruckFilter(e.target.value)} style={{ fontSize:12, padding:'4px 6px', border:'1px solid #d1d5db', borderRadius:6, background:'#fff' }}>
                <option value="">Alla</option>
                <option value="UNASSIGNED">(Ingen vald)</option>
                {trucks.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
              {truckFilter && <button type="button" className="btn--plain btn--xs" style={{ fontSize:11 }} onClick={() => setTruckFilter('')}>Rensa</button>}
            </div>
          </div>
          {/* Legend with color pickers */}
          <div style={{ display:'flex', gap:12, flexWrap:'wrap', fontSize:11, alignItems:'center' }}>
            {trucks.map(t => {
              const c = truckColors[t];
              const current = truckColorOverrides[t];
              return (
                <div key={t} style={{ display:'flex', alignItems:'center', gap:6, padding:'4px 6px', border:'1px solid #e5e7eb', borderRadius:8, background:'#fff' }}>
                  <span style={{ width:16, height:16, background:c.bg, border:`3px solid ${c.border}`, borderRadius:6, display:'inline-block' }} />
                  <span style={{ fontWeight:600, color:c.text }}>{t}</span>
                  <input type="color" value={current} aria-label={`Ändra färg för ${t}`} onChange={e => setTruckColorOverrides(o => ({ ...o, [t]: e.target.value }))} style={{ width:28, height:28, padding:0, border:'1px solid #cbd5e1', borderRadius:6, cursor:'pointer', background:'#fff' }} />
                  <button type="button" className="btn--plain btn--xs" style={{ fontSize:11 }} title="Återställ" onClick={() => setTruckColorOverrides(o => ({ ...o, [t]: ({'mb blå':'#38bdf8','mb vit':'#94a3b8','volvo blå':'#6366f1'} as any)[t] }))}>↺</button>
                </div>
              );
            })}
            <div style={{ display:'flex', alignItems:'center', gap:4 }}><span style={{ width:14, height:14, background:'#fff', border:'2px dashed #94a3b8', borderRadius:4 }} /> Ingen</div>
          </div>
          <div style={{ display:'grid', gap:12 }}>
            {/* Weekday header */}
            <div style={{ display:'grid', gridTemplateColumns:'60px repeat(7, 1fr)', gap:8, fontSize:12, fontWeight:600, color:'#374151' }}>
              <div style={{ textAlign:'center' }}>Vecka</div>
              {dayNames.map(n => <div key={n} style={{ textAlign:'center' }}>{n}</div>)}
            </div>
            {weeks.map((week, wi) => {
              const firstDay = week.find(c => c.date)?.date;
              const weekNum = firstDay ? isoWeekNumber(firstDay) : '';
              return (
                <div key={wi} style={{ display:'grid', gridTemplateColumns:'60px repeat(7, 1fr)', gap:8 }}>
                  <div style={{ display:'flex', alignItems:'center', justifyContent:'center', fontSize:12, fontWeight:600, background:'#f3f4f6', border:'1px solid #e5e7eb', borderRadius:8 }}>
                    {weekNum && `v${weekNum}`}
                  </div>
                  {week.map((cell, ci) => {
                    if (!cell.date) {
                      return <div key={ci} style={{ minHeight:160, border:'1px solid transparent', borderRadius:8 }} />;
                    }
                    const day = cell.date;
                    const rawItems = itemsByDay.get(day) || [];
                    const items = rawItems.filter(it => {
                      if (!truckFilter) return true;
                      if (truckFilter === 'UNASSIGNED') return !it.truck;
                      return it.truck === truckFilter;
                    });
                    return (
                      <div key={day}
                           onDragOver={allowDrop}
                           onDrop={e => onDropDay(e, day)}
                           style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 8, minHeight: 160, background: '#fff', display: 'flex', flexDirection: 'column', gap: 8, position:'relative' }}>
                        <div style={{ fontSize: 12, fontWeight: 600, display:'flex', justifyContent:'space-between', alignItems:'center', color:'#111827' }}>
                          <span>{day.slice(8,10)}/{day.slice(5,7)}</span>
                          {items.length > 0 && <span style={{ fontSize:10, background:'#f3f4f6', padding:'2px 6px', borderRadius:12 }}>{items.length}</span>}
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          {items.map(it => {
                            // Derive display colors: custom color overrides truck color
                            let display = null as null | { bg: string; border: string; text: string };
                            if (it.color) {
                              const hex = it.color.startsWith('#') ? it.color.slice(1) : it.color;
                              if (/^[0-9a-fA-F]{6}$/.test(hex)) {
                                const r = parseInt(hex.slice(0,2),16);
                                const g = parseInt(hex.slice(2,4),16);
                                const b = parseInt(hex.slice(4,6),16);
                                const lighten = (ch: number) => Math.round(ch + (255 - ch) * 0.85);
                                const lr = lighten(r), lg = lighten(g), lb = lighten(b);
                                const bg = `#${lr.toString(16).padStart(2,'0')}${lg.toString(16).padStart(2,'0')}${lb.toString(16).padStart(2,'0')}`;
                                const brightness = (r*299 + g*587 + b*114) / 1000;
                                const text = brightness < 110 ? '#ffffff' : '#111827';
                                display = { bg, border: '#' + hex, text };
                              }
                            } else if (it.truck) {
                              display = truckColors[it.truck];
                            }
                            const cardBorder = display ? display.border : '#c7d2fe';
                            const cardBg = display ? display.bg : '#eef2ff';
                            const isStart = (it as any).spanStart;
                            const isMid = (it as any).spanMiddle;
                            return (
                              <div key={`${it.id}:${it.day}`} draggable onDragStart={e => onDragStart(e, it.id)} onDragEnd={onDragEnd}
                                   style={{ position:'relative', border: `1px solid ${cardBorder}`, background: cardBg, borderRadius: 6, padding: 6, fontSize: 12, cursor: 'grab', display: 'grid', gap: 4, opacity: isMid ? 0.95 : 1 }}>
                                <div style={{ display:'flex', flexDirection:'column', gap:2 }}>
                                  <span style={{ fontWeight: 600, color: display ? display.text : '#312e81' }}>
                                    {it.orderNumber ? <span style={{ fontFamily: 'ui-monospace, monospace', background:'#ffffff', color: display ? display.text : '#312e81', border:`1px solid ${cardBorder}`, padding:'1px 4px', borderRadius:4, marginRight:4 }}>#{it.orderNumber}</span> : null}
                                    {it.name}
                                  </span>
                                  {isStart && <span style={{ color: display ? display.text : '#6366f1' }}>{it.customer}</span>}
                                  {(it.bagCount != null || it.jobType) && (
                                    <span style={{ fontSize:11, color: display ? display.text : '#374151' }}>
                                      {it.bagCount != null ? `${it.bagCount} säckar` : ''}
                                      {it.bagCount != null && it.jobType ? ' • ' : ''}
                                      {it.jobType || ''}
                                    </span>
                                  )}
                                </div>
                                {isStart && (
                                  <div style={{ display:'flex', gap:4, flexWrap:'wrap', alignItems:'center' }}>
                                    {editingTruckFor === it.id ? (
                                      <select autoFocus value={it.truck || ''} onChange={e => {
                                        const val = e.target.value || null;
                                        setScheduled(prev => prev.map(p => p.id === it.id ? { ...p, truck: val } : p));
                                        setEditingTruckFor(null);
                                      }} onBlur={() => setEditingTruckFor(null)} style={{ fontSize:11, padding:'2px 4px', border:`1px solid ${cardBorder}`, borderRadius:4 }}>
                                        <option value="">Välj lastbil…</option>
                                        {trucks.map(t => <option key={t} value={t}>{t}</option>)}
                                      </select>
                                    ) : (
                                      <button type="button" className="btn--plain btn--xs" onClick={() => setEditingTruckFor(it.id)} style={{ fontSize:11, border:`1px solid ${cardBorder}`, borderRadius:4, padding:'2px 6px', background:'#fff', color: display ? display.text : '#312e81' }}>
                                        {it.truck ? `Lastbil: ${it.truck}` : 'Välj lastbil'}
                                      </button>
                                    )}
                                    {/* Color picker removed from card; now global in legend */}
                                    <input type="number" min={0} placeholder="Säckar" value={it.bagCount ?? ''} onChange={e => {
                                      const v = e.target.value;
                                      setScheduled(prev => prev.map(p => p.id === it.id ? { ...p, bagCount: v === '' ? null : Math.max(0, parseInt(v,10) || 0) } : p));
                                    }} style={{ width:70, fontSize:11, padding:'2px 4px', border:`1px solid ${cardBorder}`, borderRadius:4 }} />
                                    <select value={it.jobType || ''} onChange={e => {
                                      const v = e.target.value || null;
                                      setScheduled(prev => prev.map(p => p.id === it.id ? { ...p, jobType: v } : p));
                                    }} style={{ fontSize:11, padding:'2px 4px', border:`1px solid ${cardBorder}`, borderRadius:4 }}>
                                      <option value="">Typ av jobb…</option>
                                      {jobTypes.map(j => <option key={j} value={j}>{j}</option>)}
                                    </select>
                                    <div style={{ display:'flex', gap:2 }}>
                                      <button type="button" title="Förläng bakåt" className="btn--plain btn--xs" onClick={() => extendSpan(it.id, 'back')} style={{ fontSize:11 }}>←+</button>
                                      <button type="button" title="Förläng framåt" className="btn--plain btn--xs" onClick={() => extendSpan(it.id, 'forward')} style={{ fontSize:11 }}>+→</button>
                                      {(it as any).totalSpan > 1 && <button type="button" title="Kortare (slut)" className="btn--plain btn--xs" onClick={() => shrinkSpan(it.id, 'end')} style={{ fontSize:11 }}>-→</button>}
                                      {(it as any).totalSpan > 1 && <button type="button" title="Kortare (start)" className="btn--plain btn--xs" onClick={() => shrinkSpan(it.id, 'start')} style={{ fontSize:11 }}>←-</button>}
                                    </div>
                                    <button type="button" className="btn--plain btn--xs" onClick={() => unschedule(it.id)} style={{ fontSize:11 }}>Ta bort</button>
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
