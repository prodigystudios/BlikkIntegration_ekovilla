"use client";
import React from 'react';
import BagUsageText from './BagUsageText';
import { isoWeekNumber, isoWeekKey } from '../_lib/date';

type TruckDisplay = { bg: string; border: string; text: string };

export interface CalendarDayListProps {
  weeks: Array<Array<{ date: string | null; inMonth: boolean }>>;
  dayNames: string[];
  hideWeekends: boolean;
  itemsByDay: Map<string, any[]>;
  trucks: string[];
  truckColors: Record<string, TruckDisplay>;
  calendarSearch: string;
  truckFilters: string[];
  salesFilter: string;
  todayISO: string;
  selectedWeekKey: string;
  scheduledSegments: Array<{ id: string; sortIndex?: number | null }>;
  onDragStart: (e: React.DragEvent, segmentId: string) => void;
  onDragEnd: () => void;
  onDropDay: (e: React.DragEvent, day: string, laneTruck?: string | null) => void;
  allowDrop: (e: React.DragEvent) => void;
  scheduleSelectedOnDay: (day: string, laneTruck?: string | null) => void;
  openSegmentEditorForExisting: (segmentId: string) => void;
  setHoveredSegmentId: (id: string | null) => void;
  hoveredSegmentId: string | null;
  setSelectedProjectId: (projectId: string) => void;
  selectedProjectId: string | null;
  hasEgenkontroll: (orderNumber?: string | null) => boolean;
  rowCreatorLabel: (segmentId: string) => string | null;
  renderCreatorAvatar: (segmentId: string) => React.ReactNode;
  jumpTargetDay: string | null;
  scheduleMeta: Record<string, any>;
  truckTeamNames: (truck: string | null) => string[];
  jobTypeColors: Record<string, string>;
  projectAddresses: Record<string, string>;
  segmentCrew: Record<string, Array<{ id: string | null; name: string }>>;
  remainingBagsByProject?: Map<string, number>;
  bagUsageStatusByProject?: Map<string, { plan: number; used: number; remaining: number; overrun: number }>;
}

export default function CalendarDayList(props: CalendarDayListProps) {
  const {
    weeks,
    dayNames,
    hideWeekends,
    itemsByDay,
    trucks,
    truckColors,
    calendarSearch,
  truckFilters,
    salesFilter,
    todayISO,
    selectedWeekKey,
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
  selectedProjectId,
    hasEgenkontroll,
    rowCreatorLabel,
    renderCreatorAvatar,
    jumpTargetDay,
    scheduleMeta,
    truckTeamNames,
  jobTypeColors,
  projectAddresses,
  segmentCrew,
  remainingBagsByProject,
  bagUsageStatusByProject,
  } = props;

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {weeks.map((week, wi) => {
        const weekDays = week.map(c => c.date).filter(Boolean) as string[];
        const searchVal = calendarSearch.trim().toLowerCase();
        const dayHeaderBg = wi % 2 === 0 ? '#f1f5f9' : '#e5e7eb';
        const firstDay = week.find(c => c.date)?.date as string | undefined;
        if (selectedWeekKey) {
          if (!firstDay || isoWeekKey(firstDay) !== selectedWeekKey) return null;
        }
        const dayHasAny = (weekdayIdx: number) => {
          const cell = week[weekdayIdx];
          const day = cell?.date;
          if (!day) return false;
          const raw = itemsByDay.get(day) || [];
          const filtered = raw.filter((it: any) => {
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
          });
          return filtered.length > 0;
        };
        const includeSat = !hideWeekends && dayHasAny(5);
        const includeSun = !hideWeekends && dayHasAny(6);
        const visibleIndices = hideWeekends ? [0, 1, 2, 3, 4] : [0, 1, 2, 3, 4].concat(includeSat ? [5] : []).concat(includeSun ? [6] : []);

        let hasUnassigned = false;
        for (const day of weekDays) {
          const raw = itemsByDay.get(day) || [];
          const filtered = raw.filter((it: any) => {
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
          });
          if (filtered.some((it: any) => !it.truck)) { hasUnassigned = true; break; }
        }
        // Build visible rows (trucks + optional unassigned) applying multi-select filters when present
        let rows = [...trucks, ...(hasUnassigned ? ['__UNASSIGNED__'] : [])];
        if (Array.isArray(truckFilters) && truckFilters.length > 0) {
          const filterSet = new Set(truckFilters);
            rows = [
              ...trucks.filter(t => filterSet.has(t)),
              ...(filterSet.has('UNASSIGNED') && hasUnassigned ? ['__UNASSIGNED__'] : [])
            ];
        }
        const weekNum = firstDay ? isoWeekNumber(firstDay) : '';
        const weekContainsToday = week.some(c => c.date === todayISO);
        return (
          <div key={wi} style={{ display: 'grid', gap: 8, border: '1px solid #e5e7eb', borderRadius: 10, background: '#fff', padding: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: '#0f172a', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 999, padding: '2px 8px' }}>{weekNum && `v${weekNum}`}</span>
                {weekContainsToday && (
                  <span aria-label="Denna vecka innehåller idag" title="Denna vecka innehåller idag" style={{ fontSize: 10, color: '#1d4ed8', background: '#dbeafe', border: '1px solid #93c5fd', borderRadius: 999, padding: '1px 6px' }}>Idag</span>
                )}
              </span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: `140px repeat(${visibleIndices.length}, 1fr)`, alignItems: 'center', gap: 6, position: 'sticky', top: 0, zIndex: 5, background: '#ffffff', boxShadow: '0 2px 4px rgba(0,0,0,0.06)', paddingTop: 6, paddingBottom: 6 }}>
              <div style={{ gridColumn: '1 / 2', fontSize: 12, fontWeight: 600, color: '#374151', textAlign: 'left' }}>Lastbil</div>
              {visibleIndices.map((idx, vi) => {
                const cellDate = week[idx]?.date;
                const isTodayHeader = cellDate === todayISO;
                return (
                  <div key={`hdr-${idx}`} style={{ gridColumn: `${2 + vi} / ${3 + vi}`, background: dayHeaderBg, border: isTodayHeader ? '2px solid #60a5fa' : '1px solid #e5e7eb', boxShadow: isTodayHeader ? '0 0 0 3px rgba(59,130,246,0.25)' : undefined, borderRadius: 8, textAlign: 'center', padding: '4px 0', fontSize: 12, fontWeight: 600, color: '#374151' }}>{dayNames[idx]}</div>
                );
              })}
              {rows.map((rowKey, ri) => (
                <React.Fragment key={`row-${rowKey}`}>
                  {(() => { const disp = rowKey !== '__UNASSIGNED__' ? truckColors[rowKey] : null; const laneColor = disp?.border || '#cbd5e1'; const zebra = ri % 2 === 0 ? '#ffffff' : '#f9fafb'; const endCol = 2 + visibleIndices.length; const style: React.CSSProperties = { gridColumn: `1 / ${endCol}`, gridRow: `${ri + 2} / ${ri + 3}`, background: zebra, borderLeft: `4px solid ${rowKey === '__UNASSIGNED__' ? '#cbd5e1' : laneColor}`, borderRadius: 8, opacity: 0.9 }; return <div key={`bg-${rowKey}`} style={style} />; })()}
                  <div key={`lbl-${rowKey}`} style={{ gridColumn: '1 / 2', gridRow: `${ri + 2} / ${ri + 3}`, fontSize: 12, fontWeight: 600, color: '#111827', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', paddingLeft: 8 }}>
                    {(() => { const disp = rowKey !== '__UNASSIGNED__' ? truckColors[rowKey] : null; const sw = { width: 12, height: 12, borderRadius: 4, border: `2px solid ${disp?.border || '#94a3b8'}`, background: '#fff' } as React.CSSProperties; return <span key={`sw-${rowKey}`} style={sw} />; })()}
                    <span>{rowKey === '__UNASSIGNED__' ? 'Ingen lastbil' : rowKey}</span>
                    {rowKey !== '__UNASSIGNED__' && (() => {
                      const team = truckTeamNames(rowKey); return team.length ? (
                        <span style={{ fontSize: 10, fontWeight: 500, color: '#475569', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 999, padding: '1px 8px' }} title={`Team: ${team.join(', ')}`}>
                          Team: {team.join(', ')}
                        </span>
                      ) : null;
                    })()}
                    {(() => {
                      let sum = 0;
                      for (const day of weekDays) {
                        const raw = itemsByDay.get(day) || [];
                        const list = raw.filter((it: any) => {
                          const matchTruck = rowKey === '__UNASSIGNED__' ? !it.truck : it.truck === rowKey;
                          if (!matchTruck) return false;
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
                        });
                        for (const it of list) {
                          const isStart = (it as any).spanStart;
                          if (!isStart) continue;
                          if (typeof it.bagCount === 'number' && it.bagCount > 0) sum += it.bagCount;
                        }
                      }
                      return sum > 0 ? (
                        <span style={{ fontSize: 10, fontWeight: 600, color: '#334155', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 999, padding: '1px 8px' }} title={`Totalt säckar denna vecka: ${sum}`}>
                          {sum} säckar
                        </span>
                      ) : null;
                    })()}
                  </div>
                  {visibleIndices.map((weekdayIdx, vi) => {
                    const day = week[weekdayIdx]?.date || null;
                    const raw = day ? (itemsByDay.get(day) || []) : [];
                        const list = raw
                      .filter((it: any) => {
                        const matchTruck = rowKey === '__UNASSIGNED__' ? !it.truck : it.truck === rowKey;
                        if (!matchTruck) return false;
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
                        const sa = scheduledSegments.find(s => s.id === a.segmentId)?.sortIndex ?? null;
                        const sb = scheduledSegments.find(s => s.id === b.segmentId)?.sortIndex ?? null;
                        if (sa != null && sb != null && sa !== sb) return sa - sb;
                        if (sa != null && sb == null) return -1;
                        if (sb != null && sa == null) return 1;
                        const ao = a.project.orderNumber || '';
                        const bo = b.project.orderNumber || '';
                        if (ao && bo && ao !== bo) return ao.localeCompare(bo, 'sv');
                        return a.project.name.localeCompare(b.project.name, 'sv');
                      });
                    const isJumpHighlight = !!day && day === jumpTargetDay;
                    const disp = rowKey !== '__UNASSIGNED__' ? truckColors[rowKey] : null;
                    const laneColor = disp?.border || '#cbd5e1';
                    const gridCol = 2 + vi;
                    const isTodayCell = !!day && day === todayISO;
                    return (
                      <div key={`cell-${rowKey}-${weekdayIdx}-${day || 'x'}`} id={day ? `calday-${day}` : undefined}
                        onClick={day ? () => scheduleSelectedOnDay(day, rowKey === '__UNASSIGNED__' ? null : rowKey) : undefined}
                        onDragOver={allowDrop}
                        onDrop={day ? (e => onDropDay(e, day, rowKey === '__UNASSIGNED__' ? null : rowKey)) : undefined}
                        style={{
                          gridColumn: `${gridCol} / ${gridCol + 1}`,
                          gridRow: `${ri + 2} / ${ri + 3}`,
                          minHeight: 48,
                          border: isJumpHighlight ? '2px solid #f59e0b' : (selectedProjectId ? '2px dashed #fbbf24' : (isTodayCell ? '2px solid #60a5fa' : '1px solid rgba(148,163,184,0.35)')),
                          boxShadow: isTodayCell ? '0 0 0 2px rgba(59,130,246,0.18)' : undefined,
                          borderRadius: 8,
                          padding: 6,
                          background: '#ffffff',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 4,
                          borderLeft: `4px solid ${rowKey === '__UNASSIGNED__' ? '#cbd5e1' : laneColor}`,
                          cursor: selectedProjectId ? 'copy' : 'default'
                        }}>
                        {list.length === 0 && <span style={{ fontSize: 11, color: '#94a3b8' }}>—</span>}
                        {list.map((it: any) => {
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
                          const isDeliveryOutbound = !!it.isDeliveryOutbound;
                          const cardBorder = isDelivery ? (isDeliveryOutbound ? '#92400e' : '#1d201eff') : (display ? display.border : '#c7d2fe');
                          const cardBg = isDelivery ? (isDeliveryOutbound ? '#f59e0b' : '#00b386ff') : (display ? display.bg : '#eef2ff');
                          const highlight = calendarSearch && (it.project.name.toLowerCase().includes(searchVal) || (it.project.orderNumber || '').toLowerCase().includes(searchVal));
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
                                fontSize: 10,
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
                              {/* Show project address for normal segments and outgoing deliveries */}
                              {(!isDelivery || isDeliveryOutbound) && isStart && projectAddresses[it.project.id] && (
                                <span style={{ fontSize: 9, color: '#64748b' }}>
                                  {projectAddresses[it.project.id]}
                                </span>
                              )}
                              {isDelivery && !isDeliveryOutbound && (
                                <span style={{ fontSize: 9, color: '#ffffffff' }}>
                                  {(it.deliveryDepotName || '').trim()}
                                  {it.deliveryDepotName && (it.deliveryAmount != null) ? ' • ' : ''}
                                  {(it.deliveryAmount != null) ? `${it.deliveryAmount} st` : ''}
                                </span>
                              )}
                              {/* Show customer for normal segments and outgoing deliveries */}
                              {(!isDelivery || isDeliveryOutbound) && isStart && (
                                <span style={{ color: display ? display.text : '#6366f1' }}>{it.project.customer}</span>
                              )}
                                  {!isDelivery && isStart && segmentCrew[it.segmentId] && segmentCrew[it.segmentId].length > 0 && (
                                    <span style={{ fontSize: 9, color: display ? display.text : '#334155', background: '#ffffff50', padding: '1px 5px', borderRadius: 10, border: `1px solid ${cardBorder}55` }} title={`Team: ${segmentCrew[it.segmentId].map(m => m.name).join(', ')}`}>
                                      Team: {segmentCrew[it.segmentId].map(m => m.name).join(', ')}
                                    </span>
                                  )}
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
                                <span style={{ fontSize: 9, color: display ? display.text : '#1e293b', background: '#ffffff50', padding: '2px 5px', borderRadius: 10, border: `1px solid ${cardBorder}55` }} title={`Rapporterat: ${scheduleMeta[it.project.id]?.actual_bags_used} säckar`}>
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
                                    style={{ fontSize: 9, background: '#ecfdf5', border: '1px solid #6ee7b7', color: '#047857', borderRadius: 4, padding: '1px 4px', textTransform: 'none' }}
                                  >
                                    Lägg till dag
                                  </button>
                                </div>
                              )}
                              {!isDelivery && isStart && rowCreatorLabel(it.segmentId) && (
                                <span style={{ position: 'absolute', top: -6, left: -6, zIndex: 3 }}>
                                  {renderCreatorAvatar(it.segmentId)}
                                </span>
                              )}
                              {!isDelivery && isStart && hasEgenkontroll(it.project.orderNumber) && (
                                <span
                                  aria-label="Egenkontroll rapporterad"
                                  title="Egenkontroll rapporterad"
                                  style={{ position: 'absolute', top: -6, right: -6, width: 12, height: 12, borderRadius: 999, background: '#059669', color: '#fff', border: '1px solid #047857', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, fontWeight: 800, boxShadow: '0 0 0 2px #fff, 0 1px 3px rgba(0,0,0,0.2)', zIndex: 3, pointerEvents: 'none' }}
                                >
                                  ✓
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </React.Fragment>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
