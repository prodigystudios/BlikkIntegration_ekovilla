"use client";
import React, { useMemo, useState, useEffect } from 'react';
import { useTruckAssignments } from '@/lib/TruckAssignmentsContext';
import { isoWeekKey } from '../_lib/date';

type TruckDisplay = { bg: string; border: string; text: string };

export default function TruckAssignmentsInline({ trucks, crewList, truckColors }: { trucks: string[]; crewList: Array<{ id: string; name: string }>; truckColors?: Record<string, TruckDisplay> }) {
  const { reload } = useTruckAssignments();
  const [weekKey, setWeekKey] = useState<string>('');

  const currentWeek = useMemo(() => {
    const today = new Date();
    const iso = today.toISOString().slice(0,10);
    return isoWeekKey(iso);
  }, []);

  const weekRange = useMemo(() => {
    const key = weekKey || currentWeek;
    const [yearStr, wStr] = key.split('-W');
    const year = parseInt(yearStr, 10);
    const w = parseInt(wStr, 10);
    // Get Monday of ISO week
    const simpleISOWeekToDate = (y: number, week: number) => {
      const simple = new Date(Date.UTC(y, 0, 1));
      const day = simple.getUTCDay();
      const diff = (day <= 4 ? day - 1 : day - 8);
      const monday = new Date(simple);
      monday.setUTCDate(simple.getUTCDate() - diff + (week - 1) * 7);
      return monday;
    };
    const start = simpleISOWeekToDate(year, w);
    const end = new Date(start);
    end.setUTCDate(start.getUTCDate() + 6);
    const startISO = start.toISOString().slice(0,10);
    const endISO = end.toISOString().slice(0,10);
    return { startISO, endISO };
  }, [weekKey, currentWeek]);

  // Week options around current week
  const weekOptions = useMemo(() => {
    // Use Monday of currentWeek as base
    const [yStr, wStr] = (currentWeek || '').split('-W');
    const y = parseInt(yStr, 10);
    const w = parseInt(wStr, 10);
    const simpleISOWeekToDate = (yy: number, ww: number) => {
      const simple = new Date(Date.UTC(yy, 0, 1));
      const day = simple.getUTCDay();
      const diff = (day <= 4 ? day - 1 : day - 8);
      const monday = new Date(simple);
      monday.setUTCDate(simple.getUTCDate() - diff + (ww - 1) * 7);
      return monday;
    };
    const baseMonday = simpleISOWeekToDate(y, w);
    const out: { key: string; label: string }[] = [];
    for (let i = -8; i <= 8; i++) {
      const d = new Date(baseMonday);
      d.setUTCDate(baseMonday.getUTCDate() + i * 7);
      const yy = d.getUTCFullYear();
      const onejan = new Date(Date.UTC(yy,0,1));
      const millis = d.getTime() - onejan.getTime();
      const day = Math.floor(millis / 86400000) + onejan.getUTCDay();
      const ww = Math.ceil(day / 7);
      const key = `${yy}-W${String(ww).padStart(2, '0')}`;
      const startISO = d.toISOString().slice(0,10);
      const endISO = new Date(d.getTime() + 6*86400000).toISOString().slice(0,10);
      out.push({ key, label: `${key} (${startISO} → ${endISO})` });
    }
    return out;
  }, [currentWeek]);

  // Top-level save/copy removed; per-truck cards handle assignments.

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ fontWeight: 700, color: '#0f172a' }}>Veckotilldelningar</div>
          <span style={{ fontSize: 12, color: '#64748b' }}>Välj lastbil, vecka och montörer</span>
        </div>
  <button type="button" onClick={() => reload()} className="btn--plain btn--xs" style={{ fontSize: 12, padding: '6px 10px', border: '1px solid #cbd5e1', background: '#fff', borderRadius: 8 }}>Uppdatera</button>
      </div>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
        gap: 14,
        alignItems: 'start'
      }}>
        <label style={{ display: 'grid', gap: 6 }}>
          <span style={{ fontSize: 12, color: '#374151' }}>Vecka</span>
          <select
            value={weekKey || currentWeek}
            onChange={e => setWeekKey(e.target.value)}
            style={{
              padding: '10px 12px',
              border: '1px solid #cbd5e1',
              borderRadius: 10,
              background: '#fff',
              fontSize: 13,
              lineHeight: 1.4,
              boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
            }}
          >
            {weekOptions.map(o => (
              <option key={o.key} value={o.key}>{o.label}</option>
            ))}
          </select>
        </label>
      </div>
      {weekRange && (
        <div style={{ display: 'grid', gap: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>Vecka {weekKey || currentWeek}</span>
            <span style={{ fontSize: 12, fontWeight: 500, color: '#334155' }}>{weekRange.startISO} → {weekRange.endISO}</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 12 }}>
            {trucks.map(t => (
              <WeekTruckCard key={t} truckName={t} crewList={crewList} weekRange={weekRange} onSaved={reload} truckColors={truckColors} />
            ))}
          </div>
        </div>
      )}
      {/* Overlap summary removed; each truck card shows overlap badges inline. */}
    </div>
  );
}

function WeekTruckCard({ truckName, crewList, weekRange, onSaved, truckColors }: {
  truckName: string;
  crewList: Array<{ id: string; name: string }>;
  weekRange: { startISO: string; endISO: string };
  onSaved: () => Promise<void> | void;
  truckColors?: Record<string, TruckDisplay>;
}) {
  const { assignments, resolveCrew } = useTruckAssignments();
  const resolved = resolveCrew(truckName, weekRange.startISO);
  const [local1Id, setLocal1Id] = useState<string | null>(null);
  const [local2Id, setLocal2Id] = useState<string | null>(null);
  const [local1Name, setLocal1Name] = useState<string>(resolved.member1 || '');
  const [local2Name, setLocal2Name] = useState<string>(resolved.member2 || '');
  // Derived UI status badges
  const overlappingCount = useMemo(() => {
    return assignments.filter(
      a => a.truck_id === truckName && a.start_day <= weekRange.endISO && a.end_day >= weekRange.startISO
    ).length;
  }, [assignments, truckName, weekRange.startISO, weekRange.endISO]);
  const idsSet = (local1Id ? 1 : 0) + (local2Id ? 1 : 0);
  const canSave = !!(local1Id || local2Id || local1Name.trim() || local2Name.trim());
  
  // Prefill from existing assignment if one overlaps this week (prefer exact match start/end)
  useEffect(() => {
    const overlapping = assignments.filter(a => a.truck_id === truckName && a.start_day <= weekRange.endISO && a.end_day >= weekRange.startISO);
    // Prefer exact match to the week range
    const exact = overlapping.find(a => a.start_day === weekRange.startISO && a.end_day === weekRange.endISO) || overlapping[0];
    if (exact) {
      setLocal1Id(exact.team1_id ?? null);
      setLocal2Id(exact.team2_id ?? null);
      setLocal1Name((exact.team_member1_name ?? '') || (resolved.member1 || ''));
      setLocal2Name((exact.team_member2_name ?? '') || (resolved.member2 || ''));
    } else {
      // Fallback to resolved names only
      setLocal1Id(null);
      setLocal2Id(null);
      setLocal1Name(resolved.member1 || '');
      setLocal2Name(resolved.member2 || '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignments, truckName, weekRange.startISO, weekRange.endISO]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    if (!canSave) {
      setErr('Välj minst en montör eller ange ett namn.');
      return;
    }
    setBusy(true); setErr(null);
    try {
      const res = await fetch('/api/planning/truck-assignments/create', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          truck_id: truckName,
          start_day: weekRange.startISO,
          end_day: weekRange.endISO,
          team1_id: local1Id,
          team2_id: local2Id,
          team_member1_name: local1Name || undefined,
          team_member2_name: local2Name || undefined
        })
      });
      const json = await res.json();
      if (res.status === 409 && json?.error === 'OVERLAP') {
        // Offer replace confirm
        const ok = typeof window !== 'undefined' ? window.confirm('Det finns redan en tilldelning för denna vecka. Vill du ersätta den?') : false;
        if (!ok) return;
        const res2 = await fetch('/api/planning/truck-assignments/create', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            truck_id: truckName,
            start_day: weekRange.startISO,
            end_day: weekRange.endISO,
            team1_id: local1Id,
            team2_id: local2Id,
            team_member1_name: local1Name || undefined,
            team_member2_name: local2Name || undefined,
            replace: true,
          })
        });
        const json2 = await res2.json();
        if (!res2.ok || json2.error) throw new Error(json2.error || `HTTP ${res2.status}`);
      } else if (!res.ok || json.error) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      await onSaved();
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const copyNextWeek = async () => {
    if (!canSave) {
      setErr('Välj minst en montör eller ange ett namn.');
      return;
    }
    setBusy(true); setErr(null);
    try {
      const s = new Date(weekRange.startISO);
      s.setDate(s.getDate() + 7);
      const e = new Date(weekRange.endISO);
      e.setDate(e.getDate() + 7);
      const startISO = s.toISOString().slice(0,10);
      const endISO = e.toISOString().slice(0,10);
      const res = await fetch('/api/planning/truck-assignments/create', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          truck_id: truckName,
          start_day: startISO,
          end_day: endISO,
          team1_id: local1Id,
          team2_id: local2Id,
          team_member1_name: local1Name || undefined,
          team_member2_name: local2Name || undefined
        })
      });
      const json = await res.json();
      if (res.status === 409 && json?.error === 'OVERLAP') {
        const ok = typeof window !== 'undefined' ? window.confirm('Nästa vecka har redan en tilldelning. Vill du ersätta den?') : false;
        if (!ok) return;
        const res2 = await fetch('/api/planning/truck-assignments/create', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            truck_id: truckName,
            start_day: startISO,
            end_day: endISO,
            team1_id: local1Id,
            team2_id: local2Id,
            team_member1_name: local1Name || undefined,
            team_member2_name: local2Name || undefined,
            replace: true,
          })
        });
        const json2 = await res2.json();
        if (!res2.ok || json2.error) throw new Error(json2.error || `HTTP ${res2.status}`);
      } else if (!res.ok || json.error) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      await onSaved();
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'grid', gap: 10, padding: '10px 12px', border: '1px solid #e5e7eb', borderRadius: 12, background: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {truckColors && truckColors[truckName] && (
          <span aria-hidden style={{ width: 12, height: 12, borderRadius: 4, border: `2px solid ${truckColors[truckName].border}`, background: '#fff' }} />
        )}
        <div style={{ fontSize: 12, fontWeight: 700, color: '#111827' }}>{truckName}</div>
        <div style={{ display: 'flex', gap: 6, marginLeft: 'auto', alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: '#64748b' }}>{weekRange.startISO} → {weekRange.endISO}</span>
          {overlappingCount > 0 && (
            <span title={`Överlapp: ${overlappingCount}`} style={{ fontSize: 11, padding: '2px 6px', borderRadius: 999, border: '1px solid #f59e0b', background: '#fffbeb', color: '#92400e' }}>Överlapp ×{overlappingCount}</span>
          )}
          <span style={{ fontSize: 11, padding: '2px 6px', borderRadius: 999, border: idsSet > 0 ? '1px solid #10b981' : '1px solid #94a3b8', background: idsSet > 0 ? '#ecfdf5' : '#f1f5f9', color: idsSet > 0 ? '#065f46' : '#334155' }}>
            {idsSet > 0 ? 'ID satt' : 'Endast namn'}
          </span>
        </div>
      </div>
      <label style={{ display: 'grid', gap: 6 }}>
        <span style={{ fontSize: 12, color: '#374151' }}>Montör 1</span>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <select value={local1Id || ''} onChange={e => { const v = e.target.value || null; setLocal1Id(v); const nm = crewList.find(c => c.id === v)?.name || ''; setLocal1Name(nm); }} style={{ flex: 1, padding: '10px 12px', border: '1px solid #cbd5e1', borderRadius: 10, background: '#fff', fontSize: 13, boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }}>
            <option value="">Ej tilldelad</option>
            {crewList.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <input value={local1Name} onChange={e => setLocal1Name(e.target.value)} placeholder="Namn (valfritt)" style={{ flex: 1, padding: '10px 12px', border: '1px solid #cbd5e1', borderRadius: 10, fontSize: 13, boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }} />
        </div>
      </label>
      <label style={{ display: 'grid', gap: 6 }}>
        <span style={{ fontSize: 12, color: '#374151' }}>Montör 2</span>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <select value={local2Id || ''} onChange={e => { const v = e.target.value || null; setLocal2Id(v); const nm = crewList.find(c => c.id === v)?.name || ''; setLocal2Name(nm); }} style={{ flex: 1, padding: '10px 12px', border: '1px solid #cbd5e1', borderRadius: 10, background: '#fff', fontSize: 13, boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }}>
            <option value="">Ej tilldelad</option>
            {crewList.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <input value={local2Name} onChange={e => setLocal2Name(e.target.value)} placeholder="Namn (valfritt)" style={{ flex: 1, padding: '10px 12px', border: '1px solid #cbd5e1', borderRadius: 10, fontSize: 13, boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }} />
        </div>
      </label>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button type="button" onClick={save} disabled={busy || !canSave} className="btn--plain btn--xs" style={{ fontSize: 12, padding: '8px 12px', border: '1px solid #16a34a', background: canSave ? '#dcfce7' : '#f1f5f9', color: canSave ? '#166534' : '#64748b', borderRadius: 10 }}>{busy ? 'Sparar…' : 'Spara för vecka'}</button>
        <button type="button" onClick={copyNextWeek} disabled={busy || !canSave} className="btn--plain btn--xs" style={{ fontSize: 12, padding: '8px 12px', border: '1px solid #7dd3fc', background: canSave ? '#e0f2fe' : '#f1f5f9', color: canSave ? '#0369a1' : '#64748b', borderRadius: 10 }}>Kopiera till nästa vecka</button>
        {err && <span style={{ fontSize: 12, color: '#b91c1c' }}>Fel: {err}</span>}
      </div>
    </div>
  );
}
