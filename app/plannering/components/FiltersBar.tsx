"use client";
import React from 'react';

export type ViewMode = 'monthGrid' | 'weekdayLanes' | 'dayList';

export default function FiltersBar(props: {
  monthOffset: number;
  setMonthOffset: React.Dispatch<React.SetStateAction<number>>;
  viewMode: ViewMode;
  setViewMode: (v: ViewMode) => void;
  hideWeekends: boolean;
  setHideWeekends: (v: boolean) => void;
  refreshEgenkontroller: () => void;
  egenkontrollLoading: boolean;
  egenkontrollError: string | null;
  egenkontrollCount: number;
  sidebarCollapsed: boolean;
  setSidebarCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  isAdmin: boolean;
  setAdminModalOpen: (v: boolean) => void;
  realtimePaused?: boolean;
  realtimeStatus?: 'connecting' | 'live' | 'error' | string;
}) {
  const {
    monthOffset,
    setMonthOffset,
    viewMode,
    setViewMode,
    hideWeekends,
    setHideWeekends,
    refreshEgenkontroller,
    egenkontrollLoading,
    egenkontrollError,
    egenkontrollCount,
    sidebarCollapsed,
    setSidebarCollapsed,
    isAdmin,
    setAdminModalOpen,
    realtimePaused,
    realtimeStatus,
  } = props;

  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
      <button className="btn--plain btn--sm" onClick={() => setMonthOffset(o => o - 1)}>◀</button>
      <strong style={{ fontSize: 16 }}>{(() => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + monthOffset); return d.toLocaleDateString('sv-SE', { month: 'long', year: 'numeric' }); })()}</strong>
      <button className="btn--plain btn--sm" onClick={() => setMonthOffset(o => o + 1)}>▶</button>
      {monthOffset !== 0 && <button className="btn--plain btn--sm" onClick={() => setMonthOffset(0)}>Idag</button>}
      <div style={{ display: 'flex', gap: 4 }}>
        {(['monthGrid', 'weekdayLanes', 'dayList'] as const).map(modeKey => {
          const active = viewMode === modeKey;
          return (
            <button
              key={modeKey}
              type="button"
              aria-pressed={active}
              onClick={() => setViewMode(modeKey)}
              className="btn--plain btn--sm"
              style={{
                padding: '4px 10px',
                borderRadius: 6,
                border: active ? '2px solid #6366f1' : '1px solid #d1d5db',
                background: active ? '#eef2ff' : '#fff',
                fontWeight: active ? 600 : 500,
                fontSize: 12,
                color: active ? '#312e81' : '#374151'
              }}
            >{modeKey === 'monthGrid' ? 'Månad' : modeKey === 'weekdayLanes' ? 'Veckodagar' : 'Daglista'}</button>
          );
        })}
      </div>
      {/* Hide weekends toggle */}
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#374151', border: '1px solid #d1d5db', borderRadius: 6, padding: '4px 8px', background: '#fff' }}>
        <input type="checkbox" checked={hideWeekends} onChange={e => setHideWeekends(e.target.checked)} />
        Dölj helger
      </label>
      {/* EK controls */}
      <button type="button" className="btn--plain btn--sm" onClick={refreshEgenkontroller} style={{ border: '1px solid #d1d5db', borderRadius: 6, padding: '4px 10px', fontSize: 12 }}>
        {egenkontrollLoading ? 'Laddar EK…' : 'Uppdatera EK'}
      </button>
      {egenkontrollError && <span style={{ fontSize: 10, color: '#b91c1c' }} title={egenkontrollError}>Fel EK</span>}
      {!egenkontrollLoading && egenkontrollCount > 0 && <span style={{ fontSize: 10, background: '#ecfdf5', color: '#047857', padding: '2px 6px', borderRadius: 12, border: '1px solid #6ee7b7' }} title="Antal matchade egenkontroller">EK: {egenkontrollCount}</span>}
      <span style={{ flex: 1 }} />
      <button type="button" className="btn--plain btn--sm" onClick={() => setSidebarCollapsed(s => !s)}
        style={{ border: '1px solid #d1d5db', borderRadius: 6, padding: '4px 10px', fontSize: 12 }}>
        {sidebarCollapsed ? 'Visa projektpanel' : 'Dölj projektpanel'}
      </button>
      {isAdmin && (
        <button type="button" className="btn--plain btn--sm" onClick={() => setAdminModalOpen(true)}
          style={{ marginLeft: 'auto', border: '1px solid #d1d5db', borderRadius: 6, padding: '4px 10px', fontSize: 12, background: '#fff' }}>
          Admin‑inställningar
        </button>
      )}
      {/* Realtime status next to top icon/controls */}
      <span title={`Realtime: ${realtimePaused ? 'paused' : (realtimeStatus || 'unknown')}`}
        style={{ marginLeft: 6, fontSize: 11, color: realtimePaused ? '#92400e' : (realtimeStatus === 'live' ? '#065f46' : '#1d4ed8'), background: realtimePaused ? '#fde68a' : (realtimeStatus === 'live' ? '#d1fae5' : '#dbeafe'), border: '1px solid ' + (realtimePaused ? '#f59e0b' : (realtimeStatus === 'live' ? '#6ee7b7' : '#93c5fd')), borderRadius: 999, padding: '2px 8px' }}>
        {realtimePaused ? 'Realtime: paused' : `Realtime: ${realtimeStatus || '—'}`}
      </span>
    </div>
  );
}
