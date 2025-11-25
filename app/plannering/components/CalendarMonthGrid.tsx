"use client";
import React from 'react';
import BagUsageText from './BagUsageText';
import { isoWeekNumber, isoWeekKey } from '../_lib/date';

type TruckDisplay = { bg: string; border: string; text: string };

export interface CalendarMonthGridProps {
  weeks: Array<Array<{ date: string | null; inMonth: boolean }>>;
  visibleDayNames: string[];
  hideWeekends: boolean;
  selectedWeekKey: string;
  itemsByDay: Map<string, any[]>;
  trucks: string[];
  truckColors: Record<string, TruckDisplay>;
  calendarSearch: string;
  truckFilters: string[];
  salesFilter: string;
  jumpTargetDay: string | null;
  todayISO: string;
  selectedProjectId: string | null;
  scheduledSegments: Array<{ id: string; sortIndex?: number | null }>;
  onDragStart: (e: React.DragEvent, segmentId: string) => void;
  onDragEnd: () => void;
  onDropDay: (e: React.DragEvent, day: string) => void;
  allowDrop: (e: React.DragEvent) => void;
  scheduleSelectedOnDay: (day: string) => void;
  openSegmentEditorForExisting: (segmentId: string) => void;
  setHoveredSegmentId: (id: string | null) => void;
  hoveredSegmentId: string | null;
  setSelectedProjectId: (projectId: string) => void;
  hasEgenkontroll: (orderNumber?: string | null) => boolean;
  rowCreatorLabel: (segmentId: string) => string | null;
  renderCreatorAvatar: (segmentId: string) => React.ReactNode;
  scheduleMeta: Record<string, any>;
  jobTypeColors: Record<string, string>;
  projectAddresses: Record<string, string>;
  segmentCrew: Record<string, Array<{ id: string | null; name: string }>>;
  remainingBagsByProject?: Map<string, number>;
  bagUsageStatusByProject?: Map<string, { plan: number; used: number; remaining: number; overrun: number }>;
}

export default function CalendarMonthGrid(props: CalendarMonthGridProps) {
  const {
    weeks,
    visibleDayNames,
    hideWeekends,
    selectedWeekKey,
    itemsByDay,
    trucks,
    truckColors,
    calendarSearch,
  truckFilters,
    salesFilter,
    jumpTargetDay,
    todayISO,
    selectedProjectId,
    scheduledSegments,
    onDragStart,
    onDragEnd,
    onDropDay,
    allowDrop,
    scheduleSelectedOnDay,
    openSegmentEditorForExisting,
    setHoveredSegmentId,
    hoveredSegmentId,
    setSelectedProjectId,
    hasEgenkontroll,
    rowCreatorLabel,
    renderCreatorAvatar,
    scheduleMeta,
    jobTypeColors,
    projectAddresses,
    segmentCrew,
    remainingBagsByProject,
    bagUsageStatusByProject,
  } = props;

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'grid', gridTemplateColumns: `60px repeat(${visibleDayNames.length}, 1fr)`, gap: 8, fontSize: 12, fontWeight: 600, color: '#374151', position: 'sticky', top: 0, zIndex: 20, background: '#ffffff', boxShadow: '0 2px 4px rgba(0,0,0,0.06)', padding: '6px 0' }}>
        <div style={{ textAlign: 'center' }}>Vecka</div>
        {visibleDayNames.map(n => <div key={n} style={{ textAlign: 'center' }}>{n}</div>)}
      </div>
      {weeks.map((week, wi) => {
        const firstDay = week.find(c => c.date)?.date as string | undefined;
        const weekNum = firstDay ? isoWeekNumber(firstDay) : '';
        const weekBg = wi % 2 === 0 ? '#e0f2fe' : '#e0e7ff';
        if (selectedWeekKey) {
          if (!firstDay || isoWeekKey(firstDay) !== selectedWeekKey) return null;
        }
        return (
          <div key={wi} style={{ display: 'grid', gridTemplateColumns: `60px repeat(${visibleDayNames.length}, 1fr)`, gap: 8, background: weekBg, padding: 6, borderRadius: 12, boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.05)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, background: 'rgba(255,255,255,0.65)', backdropFilter: 'blur(2px)', border: '1px solid rgba(0,0,0,0.07)', borderRadius: 8, color: '#1e293b', boxShadow: '0 1px 2px rgba(0,0,0,0.08)' }}>{weekNum && `v${weekNum}`}</div>
            {week.map((cell, ci) => {
              if (hideWeekends && (ci === 5 || ci === 6)) return <div key={ci} style={{ minHeight: 160, border: '1px solid transparent', borderRadius: 8 }} />;
              if (!cell.date) return <div key={ci} style={{ minHeight: 160, border: '1px solid transparent', borderRadius: 8 }} />;
              if (selectedWeekKey && isoWeekKey(cell.date) !== selectedWeekKey) {
                return <div key={ci} style={{ minHeight: 160, border: '1px solid transparent', borderRadius: 8 }} />;
              }
              const day = cell.date;
              const rawItems = itemsByDay.get(day) || [];
              const searchVal = calendarSearch.trim().toLowerCase();
              const items = rawItems
                .filter((it: any) => {
                  if (Array.isArray(truckFilters) && truckFilters.length > 0) {
                    const includeUnassigned = truckFilters.includes('UNASSIGNED');
                    const inSelected = it.truck ? truckFilters.includes(it.truck) : includeUnassigned;
                    if (!inSelected) return false;
                  }
                  if (salesFilter) {
                    if (salesFilter === '__NONE__') { if (it.project.salesResponsible) return false; }
                    else if ((it.project.salesResponsible || '').toLowerCase() !== salesFilter.toLowerCase()) return false;
                  }
                  if (searchVal) {
                    const hay = [it.project.name, it.project.orderNumber || '', it.project.customer, it.jobType || '', (it.bagCount != null ? String(it.bagCount) : '')].join(' ').toLowerCase();
                    if (!hay.includes(searchVal)) return false;
                  }
                  return true;
                })
                .sort((a: any, b: any) => {
                  if (!!a.isDelivery && !b.isDelivery) return -1;
                  if (!!b.isDelivery && !a.isDelivery) return 1;
                  if (a.truck === b.truck) {
                    const sa = scheduledSegments.find(s => s.id === a.segmentId)?.sortIndex ?? null;
                    const sb = scheduledSegments.find(s => s.id === b.segmentId)?.sortIndex ?? null;
                    if (sa != null && sb != null && sa !== sb) return sa - sb;
                    if (sa != null && sb == null) return -1;
                    if (sb != null && sa == null) return 1;
                    const ao = a.project.orderNumber || '';
                    const bo = b.project.orderNumber || '';
                    if (ao && bo && ao !== bo) return ao.localeCompare(bo, 'sv');
                    return a.project.name.localeCompare(b.project.name, 'sv');
                  }
                  const ia = a.truck ? trucks.indexOf(a.truck) : -1;
                  const ib = b.truck ? trucks.indexOf(b.truck) : -1;
                  const aUn = ia === -1 || !a.truck;
                  const bUn = ib === -1 || !b.truck;
                  if (aUn && !bUn) return 1; // unassigned/unknown last
                  if (bUn && !aUn) return -1;
                  if (!aUn && !bUn && ia !== ib) return ia - ib;
                  return (a.truck || '').localeCompare(b.truck || '', 'sv');
                });
              const isJumpHighlight = day === jumpTargetDay;
              const isToday = day === todayISO;
              return (
                <div key={day}
                  id={`calday-${day}`}
                  onClick={() => scheduleSelectedOnDay(day)}
                  onDragOver={allowDrop}
                  onDrop={e => onDropDay(e, day)}
                  style={{ border: isJumpHighlight ? '2px solid #f59e0b' : (selectedProjectId ? '2px dashed #fbbf24' : (isToday ? '2px solid #60a5fa' : '1px solid rgba(148,163,184,0.4)')), boxShadow: isJumpHighlight ? '0 0 0 4px rgba(245,158,11,0.35)' : (isToday ? '0 0 0 3px rgba(59,130,246,0.25)' : '0 1px 2px rgba(0,0,0,0.05)'), transition: 'box-shadow 0.3s,border 0.3s', borderRadius: 10, padding: 8, minHeight: 160, background: '#ffffff', display: 'flex', flexDirection: 'column', gap: 8, position: 'relative', cursor: selectedProjectId ? 'copy' : 'default' }}>
                  <div style={{ fontSize: 12, fontWeight: 600, display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: '#111827' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <span>{day.slice(8, 10)}/{day.slice(5, 7)}</span>
                      {isToday && (
                        <span aria-label="Idag" title="Idag" style={{ fontSize: 10, color: '#1d4ed8', background: '#dbeafe', border: '1px solid #93c5fd', padding: '0px 6px', borderRadius: 999 }}>Idag</span>
                      )}
                    </span>
                    {items.length > 0 && <span style={{ fontSize: 10, background: '#f3f4f6', padding: '2px 6px', borderRadius: 12 }}>{items.length}</span>}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {items.map((it: any) => {
                      let display: null | TruckDisplay = null;
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
                      } else {
                        display = { bg: '#fee2e2', border: '#fca5a5', text: '#7f1d1d' };
                      }
                      const isDelivery = !!it.isDelivery;
                      const isDeliveryOutbound = !!it.isDeliveryOutbound; // scheduled segment with jobType Leverans
                      // Distinct styling for outgoing deliveries (amber) vs incoming (green)
                      const cardBorder = isDelivery ? (isDeliveryOutbound ? '#92400e' : '#1d201eff') : (display ? display.border : '#c7d2fe');
                      const cardBg = isDelivery ? (isDeliveryOutbound ? '#f59e0b' : '#00b386ff') : (display ? display.bg : '#eef2ff');
                      const searchVal2 = calendarSearch.trim().toLowerCase();
                      const highlight = calendarSearch && (it.project.name.toLowerCase().includes(searchVal2) || (it.project.orderNumber || '').toLowerCase().includes(searchVal2));
                      const isMid = (it as any).spanMiddle;
                      const isStart = (it as any).spanStart;
                      return (
                        <div
                          key={`${(it.segmentId || it.id || (it.project && it.project.id) || 'x')}:${it.day}`}
                          draggable={!isDelivery}
                          onDragStart={e => onDragStart(e, it.segmentId)}
                          onDragEnd={onDragEnd}
                          onDoubleClick={() => openSegmentEditorForExisting(it.segmentId)}
                          onMouseEnter={() => setHoveredSegmentId(it.segmentId)}
                          onMouseLeave={() => setHoveredSegmentId(hoveredSegmentId === it.segmentId ? null : hoveredSegmentId)}
                          title="Dubbelklicka för att redigera"
                          style={{
                            position: 'relative',
                            border: `1px solid ${highlight ? '#f59e0b' : (hoveredSegmentId === it.segmentId ? '#6366f1' : cardBorder)}`,
                            background: cardBg,
                            borderRadius: 6,
                            padding: 5,
                            fontSize: 11,
                            lineHeight: 1.15,
                            cursor: isDelivery ? 'default' : 'grab',
                            display: 'grid',
                            gap: 4,
                            opacity: isMid ? 0.95 : 1,
                            boxShadow: highlight
                              ? '0 0 0 3px rgba(245,158,11,0.35)'
                              : (hoveredSegmentId === it.segmentId ? '0 0 0 3px rgba(99,102,241,0.35)' : 'none'),
                            transition: 'border-color .15s, box-shadow .15s'
                          }}
                        >
                          {hoveredSegmentId === it.segmentId && !highlight && !isDelivery && (
                            <span style={{ position: 'absolute', top: -8, right: 4, background: '#6366f1', color: '#fff', fontSize: 9, padding: '2px 6px', borderRadius: 8, boxShadow: '0 2px 4px rgba(0,0,0,0.15)' }}>Redigera</span>
                          )}
                          {!isDelivery && isStart && hasEgenkontroll(it.project.orderNumber) && (
                            <span
                              aria-label="Egenkontroll rapporterad"
                              title="Egenkontroll rapporterad"
                              style={{ position: 'absolute', top: -7, right: -7, width: 14, height: 14, borderRadius: 999, background: '#059669', color: '#fff', border: '1px solid #047857', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 800, boxShadow: '0 0 0 2px #fff, 0 1px 3px rgba(0,0,0,0.2)', zIndex: 3, pointerEvents: 'none' }}
                            >
                              ✓
                            </span>
                          )}
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                            <span style={{ fontWeight: 600, color: isDelivery ? (isDeliveryOutbound ? '#3a2200' : '#18065fff') : (display ? display.text : '#312e81'), display: 'flex', alignItems: 'center', columnGap: 6, rowGap: 2, flexWrap: 'wrap' }}>
                              {it.project.orderNumber ? (
                                <span style={{ fontFamily: 'ui-monospace, monospace', background: '#ffffff', color: display ? display.text : '#312e81', border: `1px solid ${cardBorder}`, padding: '1px 4px', borderRadius: 4, whiteSpace: 'nowrap' }} title="Ordernummer">#{it.project.orderNumber}</span>
                              ) : null}
                              <span title={it.project.name} style={{ color: isDelivery ? '#ffffffff' : (display ? display.text : '#312e81'), fontWeight: 600, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>{it.project.name}</span>
                              {isDelivery && (
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                  <span style={{ fontSize: 9, background: isDeliveryOutbound ? '#b45309' : '#15803d', color: '#fff', padding: '2px 6px', borderRadius: 6, fontWeight: 600 }}>
                                    {isDeliveryOutbound ? 'Utleverans' : 'Leverans'}
                                  </span>
                                  {isDeliveryOutbound && scheduleMeta[it.project.id]?.delivery_sent && (
                                    <span title="Leverans skickad" style={{ fontSize: 9, background: '#059669', color: '#fff', padding: '2px 6px', borderRadius: 6, fontWeight: 600 }}>Skickad ✓</span>
                                  )}
                                </span>
                              )}
                            </span>
                            {/* Show project address for normal segments and outgoing deliveries (Utleverans) */}
                            {(!isDelivery || isDeliveryOutbound) && isStart && projectAddresses[it.project.id] && (
                              <span style={{ fontSize: 10, color: '#64748b' }}>
                                {projectAddresses[it.project.id]}
                              </span>
                            )}
                            {isDelivery && !isDeliveryOutbound && (
                              <span style={{ fontSize: 10, color: '#ffffffff' }}>
                                {(it.deliveryDepotName || '').trim()}
                                {it.deliveryDepotName && (it.deliveryAmount != null) ? ' • ' : ''}
                                {(it.deliveryAmount != null) ? `${it.deliveryAmount} st` : ''}
                              </span>
                            )}
                            {!isDelivery && isStart && segmentCrew[it.segmentId] && segmentCrew[it.segmentId].length > 0 && (
                              <span style={{ fontSize: 10, color: display ? display.text : '#334155', background: '#ffffff50', padding: '2px 6px', borderRadius: 10, border: `1px solid ${cardBorder}55` }} title={`Team: ${segmentCrew[it.segmentId].map(m => m.name).join(', ')}`}>
                                Team: {segmentCrew[it.segmentId].map(m => m.name).join(', ')}
                              </span>
                            )}
                            {/* Show customer for normal segments and outgoing deliveries */}
                            {(!isDelivery || isDeliveryOutbound) && isStart && <span style={{ color: display ? display.text : '#6366f1' }}>{it.project.customer}</span>}
                            {!isDelivery && isStart && it.project.salesResponsible && <span style={{ fontSize: 10, color: display ? display.text : '#334155', background: '#ffffff30', padding: '2px 6px', borderRadius: 12, border: `1px solid ${cardBorder}55` }}>Sälj: {it.project.salesResponsible}</span>}
                            {!isDelivery && (it.bagCount != null || it.jobType) && (
                              <span style={{ fontSize: 11, color: display ? display.text : '#374151' }}>
                                <BagUsageText
                                  status={bagUsageStatusByProject?.get(it.project.id)}
                                  plan={it.bagCount}
                                  jobType={it.jobType}
                                  jobTypeColors={jobTypeColors}
                                  defaultColor={display ? display.text : '#374151'}
                                />
                              </span>
                            )}
                            {!isDelivery && isStart && scheduleMeta[it.project.id]?.actual_bags_used != null && (
                              <span style={{ fontSize: 10, color: display ? display.text : '#1e293b', background: '#ffffff50', padding: '4px 6px', borderRadius: 10, border: `1px solid ${cardBorder}55` }} title={`Rapporterat: ${scheduleMeta[it.project.id]?.actual_bags_used} säckar`}>
                                säckar blåsta {scheduleMeta[it.project.id]!.actual_bags_used} st
                              </span>
                            )}
                            {!isDelivery && (
                              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); setSelectedProjectId(it.project.id); }}
                                  className="btn--plain btn--xs"
                                  title="Lägg till ny separat dag"
                                  style={{ fontSize: 10, background: '#ecfdf5', border: '1px solid #6ee7b7', color: '#047857', borderRadius: 4, padding: '2px 4px' }}
                                >
                                  Lägg till dag
                                </button>
                              </div>
                            )}
                          </div>
                          {!isDelivery && isStart && rowCreatorLabel(it.segmentId) && (
                            <span style={{ position: 'absolute', top: -7, left: -7, zIndex: 3 }}>
                              {renderCreatorAvatar(it.segmentId)}
                            </span>
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
  );
}
