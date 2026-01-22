"use client";
import React from 'react';
import { useTruckAssignments } from '@/lib/TruckAssignmentsContext';
import BagUsageText from './BagUsageText';
import { isoWeekKey, isWeekend, getSwedishPublicHolidays, isSwedishHoliday } from '../_lib/date';
import type { DayNote } from '@/lib/dayNotes';
import DayNoteEditor from './DayNoteEditor';

type TruckDisplay = { bg: string; border: string; text: string };

export interface CalendarWeekdayLanesProps {
  readOnly?: boolean;
  visibleDayNames: string[];
  visibleDayIndices: number[];
  weekdayLanes: Array<Array<{ date: string; inMonth: boolean }>>;
  itemsByDay: Map<string, any[]>;
  notesByDay?: Map<string, DayNote | undefined>;
  onNoteChange?: (day: string, note: DayNote | null) => void;
  currentUserId?: string | null;
  currentUserName?: string | null;
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
  selectedWeekKey: string;
  scheduleMeta: Record<string, any>;
  jobTypeColors: Record<string, string>;
  projectAddresses: Record<string, string>;
  projectStatuses?: Record<string, string>;
  projectStatusColors?: Record<string, string>;
  segmentCrew: Record<string, Array<{ id: string | null; name: string }>>;
  remainingBagsByProject?: Map<string, number>;
  bagUsageStatusByProject?: Map<string, { plan: number; used: number; remaining: number; overrun: number }>;
}

export default function CalendarWeekdayLanes(props: CalendarWeekdayLanesProps) {
  const { resolveCrew } = useTruckAssignments();
  const {
    readOnly,
    visibleDayNames,
    visibleDayIndices,
    weekdayLanes,
    itemsByDay,
    notesByDay,
    onNoteChange,
    currentUserId,
    currentUserName,
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
    selectedWeekKey,
    scheduleMeta,
    jobTypeColors,
    projectAddresses,
    projectStatuses,
    projectStatusColors,
    segmentCrew,
    remainingBagsByProject,
    bagUsageStatusByProject,
  } = props;

  // Build holiday sets for the years spanned by visible lanes
  const yearsInView = Array.from(new Set(weekdayLanes.flat().map(d => new Date(d.date + 'T00:00:00').getFullYear())));
  const holidaySets = yearsInView.map(y => getSwedishPublicHolidays(y));
  const isHoliday = (iso?: string) => !!iso && holidaySets.some(set => isSwedishHoliday(iso, set));

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {visibleDayNames.map((name, localIdx) => {
        const lane = weekdayLanes[localIdx] || [];
        const laneDays = selectedWeekKey ? lane.filter(dObj => isoWeekKey(dObj.date) === selectedWeekKey) : lane;
        if (selectedWeekKey && laneDays.length === 0) return null;
        return (
          <div key={name} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            <div style={{ width: 60, fontSize: 12, fontWeight: 700, textAlign: 'center', padding: '6px 4px', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 8 }}>{name}</div>
            <div style={{ flex: 1, overflowX: 'auto', display: 'flex', gap: 8 }}>
              {(selectedWeekKey ? laneDays : lane).map(dObj => {
                const day = dObj.date;
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
                    if (aUn && !bUn) return 1;
                    if (bUn && !aUn) return -1;
                    if (!aUn && !bUn && ia !== ib) return ia - ib;
                    return (a.truck || '').localeCompare(b.truck || '', 'sv');
                  });
                const isJumpHighlight = day === jumpTargetDay;
                const isToday = day === todayISO;
                const weekendCell = isWeekend(day);
                const holidayCell = isHoliday(day);
                return (
                  <div key={day}
                    id={`calday-${day}`}
                    onClick={() => { if (!readOnly) scheduleSelectedOnDay(day); }}
                    onDragOver={readOnly ? undefined : allowDrop}
                    onDrop={readOnly ? undefined : (e => onDropDay(e, day))}
                    style={{ minWidth: 160, border: isJumpHighlight ? '2px solid #f59e0b' : (selectedProjectId ? '2px dashed #fbbf24' : (isToday ? '2px solid #60a5fa' : '1px solid rgba(148,163,184,0.4)')), boxShadow: isJumpHighlight ? '0 0 0 4px rgba(245,158,11,0.35)' : (isToday ? '0 0 0 3px rgba(59,130,246,0.25)' : '0 1px 2px rgba(0,0,0,0.05)'), borderRadius: 10, padding: 8, background: holidayCell ? '#fffbeb' : (weekendCell ? '#fff1f2' : '#ffffff'), display: 'flex', flexDirection: 'column', gap: 6, position: 'relative', cursor: selectedProjectId ? 'copy' : 'default' }}>
                    <DayNoteEditor
                      day={day}
                      note={notesByDay?.get(day)}
                      currentUserId={currentUserId}
                      currentUserName={currentUserName}
                      onSaved={(n) => onNoteChange?.(day, n)}
                      readOnly={readOnly}
                    />
                    <div style={{ fontSize: 11, fontWeight: 600, display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: '#111827' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <span>{day.slice(8, 10)}/{day.slice(5, 7)}</span>
                        {isToday && (
                          <span aria-label="Idag" title="Idag" style={{ fontSize: 9, color: '#1d4ed8', background: '#dbeafe', border: '1px solid #93c5fd', padding: '0px 6px', borderRadius: 999 }}>Idag</span>
                        )}
                        {holidayCell && (
                          <span aria-label="Helgdag" title="Helgdag" style={{ fontSize: 9, color: '#92400e', background: '#fde68a', border: '1px solid #f59e0b', padding: '0px 6px', borderRadius: 999 }}>Helgdag</span>
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
                          display = { bg: '#8dd688ff', border: '#fca5a5', text: '#7f1d1d' };
                        }
                        const isDelivery = !!it.isDelivery;
                        const isDeliveryOutbound = !!it.isDeliveryOutbound;
                        const cardBorder = isDelivery ? (isDeliveryOutbound ? '#92400e' : '#1d201eff') : (display ? display.border : '#c7d2fe');
                        const cardBg = isDelivery ? (isDeliveryOutbound ? '#f59e0b' : '#00b386ff') : (display ? display.bg : '#2f57deff');
                        const searchVal = calendarSearch.trim().toLowerCase();
                        const highlight = calendarSearch && (it.project.name.toLowerCase().includes(searchVal) || (it.project.orderNumber || '').toLowerCase().includes(searchVal));
                        const isMid = (it as any).spanMiddle;
                        const isStart = (it as any).spanStart;
                        const groupSameTruck = items.filter((x: any) => x.truck === it.truck);
                        // Resolve truck crew for this day (assignment-aware), fallback is segmentCrew display below
                        let resolvedCrewNames: string[] = [];
                        if (it.truck) {
                          const rc = resolveCrew(it.truck, day);
                          resolvedCrewNames = [rc.member1, rc.member2].filter(Boolean) as string[];
                        }
                        const groupSorted = [...groupSameTruck].sort((a2: any, b2: any) => {
                          const sa2 = scheduledSegments.find(s => s.id === a2.segmentId)?.sortIndex ?? null;
                          const sb2 = scheduledSegments.find(s => s.id === b2.segmentId)?.sortIndex ?? null;
                          if (sa2 != null && sb2 != null && sa2 !== sb2) return sa2 - sb2;
                          if (sa2 != null && sb2 == null) return -1;
                          if (sb2 != null && sa2 == null) return 1;
                          const ao2 = a2.project.orderNumber || '';
                          const bo2 = b2.project.orderNumber || '';
                          if (ao2 && bo2 && ao2 !== bo2) return ao2.localeCompare(bo2, 'sv');
                          return a2.project.name.localeCompare(b2.project.name, 'sv');
                        });
                        const pos = groupSorted.findIndex(x => x.segmentId === it.segmentId);
                        const totalStart = groupSorted.filter((x: any) => (x as any).spanStart).length;
                        return (
                          <div
                            key={`${(it.segmentId || it.id || (it.project && it.project.id) || 'x')}:${it.day}`}
                            draggable={!readOnly && !isDelivery}
                            onDragStart={readOnly ? undefined : (e => onDragStart(e, it.segmentId))}
                            onDragEnd={readOnly ? undefined : onDragEnd}
                            onDoubleClick={() => openSegmentEditorForExisting(it.segmentId)}
                            onMouseEnter={() => setHoveredSegmentId(it.segmentId)}
                            onMouseLeave={() => setHoveredSegmentId(hoveredSegmentId === it.segmentId ? null : hoveredSegmentId)}
                            title={readOnly ? 'Dubbelklicka för att visa' : 'Dubbelklicka för att redigera'}
                            style={{
                              position: 'relative',
                              border: `1px solid ${highlight ? '#f59e0b' : (hoveredSegmentId === it.segmentId ? '#6366f1' : cardBorder)}`,
                              background: cardBg,
                              borderRadius: 6,
                              padding: 5,
                              fontSize: 10,
                              lineHeight: 1.15,
                              cursor: (readOnly || isDelivery) ? 'default' : 'grab',
                              display: 'grid',
                              gap: 4,
                              opacity: isMid ? 0.95 : 1,
                              boxShadow: highlight
                                ? '0 0 0 3px rgba(245,158,11,0.35)'
                                : (hoveredSegmentId === it.segmentId ? '0 0 0 3px rgba(99,102,241,0.35)' : 'none'),
                              transition: 'border-color .15s, box-shadow .15s'
                            }}
                          >
                            {!isDelivery && isStart && pos >= 0 && (
                              <span style={{ position: 'absolute', top: 4, right: 4, background: '#111827', color: '#fff', fontSize: 9, padding: '2px 6px', borderRadius: 8, border: '1px solid #334155' }} title="Placering i dag/lastbil">
                                {`${pos + 1}/${totalStart || groupSorted.length}`}
                              </span>
                            )}
                            {hoveredSegmentId === it.segmentId && !readOnly && !highlight && !isDelivery && (
                              <span style={{ position: 'absolute', top: -8, right: 4, background: '#6366f1', color: '#fff', fontSize: 9, padding: '2px 6px', borderRadius: 8, boxShadow: '0 2px 4px rgba(0,0,0,0.15)' }}>Redigera</span>
                            )}
                            {/* Inline Egenkontroll indicator moved to title row below */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                              <span style={{ fontWeight: 600, color: isDelivery ? (isDeliveryOutbound ? '#3a2200' : '#18065fff') : (display ? display.text : '#312e81'), display: 'flex', alignItems: 'center', columnGap: 6, rowGap: 2, flexWrap: 'wrap' }}>
                                {it.project.orderNumber ? (
                                  <span style={{ fontFamily: 'ui-monospace, monospace', background: '#ffffff', color: display ? display.text : '#312e81', border: `1px solid ${cardBorder}`, padding: '1px 4px', borderRadius: 4, whiteSpace: 'nowrap' }} title="Ordernummer">#{it.project.orderNumber}</span>
                                ) : null}
                                <span title={it.project.name} style={{ color: isDelivery ? '#ffffffff' : (display ? display.text : '#e7e7eeff'), fontWeight: 600, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>{it.project.name}</span>
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
                              {!isDelivery && isStart && (
                                (() => {
                                  const segNames = segmentCrew[it.segmentId]?.map(m => m.name) || [];
                                  const names = resolvedCrewNames.length ? resolvedCrewNames : segNames;
                                  return names.length > 0 ? (
                                    <span style={{ fontSize: 9, color: display ? display.text : '#e1e3e5ff', background: '#ffffff40', padding: '1px 5px', borderRadius: 10, border: `1px solid ${cardBorder}55` }} title={`Team: ${names.join(', ')}`}>
                                      Team: {names.join(', ')}
                                    </span>
                                  ) : null;
                                })()
                              )}
                              {/* Show customer for normal segments and outgoing deliveries */}
                              {(!isDelivery || isDeliveryOutbound) && isStart && <span style={{ color: display ? display.text : '#6366f1' }}>{it.project.customer}</span>}
                              {/* Show project status if available, with color */}
                              {(!isDelivery || isDeliveryOutbound) && isStart && projectStatuses && projectStatuses[it.project.id] && (() => {
                                const col = projectStatusColors?.[it.project.id];
                                const bg = col ? col : '#ffffff40';
                                const border = col ? col : `${cardBorder}55`;
                                const hex = (col || '').startsWith('#') ? (col || '').slice(1) : '';
                                let textColor = display ? display.text : '#334155';
                                if (/^[0-9a-fA-F]{6}$/.test(hex)) {
                                  const r = parseInt(hex.slice(0,2),16), g = parseInt(hex.slice(2,4),16), b = parseInt(hex.slice(4,6),16);
                                  const brightness = (r * 299 + g * 587 + b * 114) / 1000;
                                  textColor = brightness < 135 ? '#ffffff' : '#111827';
                                }
                                return (
                                  <span>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 2px'}}>
                                      <span style={{ fontSize: 9, color: textColor, background: bg, padding: '4px 6px', borderRadius: 6, border: `1px solid ${border}` }}> {projectStatuses[it.project.id]}</span>
                                      {!isDelivery && isStart && hasEgenkontroll(it.project.orderNumber) && (
                                        <span title="Egenkontroll rapporterad" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 9, background: '#ecfdf5', color: '#047857', padding: '4px 6px', borderRadius: 6, border: '1px solid #6ee7b7' }}>
                                          <span style={{ display: 'inline-grid', placeItems: 'center', width: 10, height: 10, borderRadius: 999, background: '#059669', color: '#fff', fontSize: 8, fontWeight: 800 }}>✓</span>
                                          Egenkontroll
                                        </span>
                                      )}
                                    </div>
                                  </span>
                                );
                              })()}
                              {!isDelivery && isStart && it.project.salesResponsible && <span style={{ fontSize: 9, color: display ? display.text : '#334155', background: '#ffffff40', padding: '1px 5px', borderRadius: 10, border: `1px solid ${cardBorder}55` }}>Sälj: {it.project.salesResponsible}</span>}
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
                                <span style={{ fontSize: 9, color: display ? display.text : '#1e293b', background: '#ffffff40', padding: '1px 5px', borderRadius: 10, border: `1px solid ${cardBorder}55` }} title={`Rapporterat: ${scheduleMeta[it.project.id]?.actual_bags_used} säckar`}>
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
                                    style={{ fontSize: 9, background: '#ecfdf5', border: '1px solid #6ee7b7', color: '#047857', borderRadius: 4, padding: '1px 4px' }}
                                  >
                                    Lägg till dag
                                  </button>
                                </div>
                              )}
                            </div>
                            {!isDelivery && isStart && rowCreatorLabel(it.segmentId) && (
                              <span style={{ position: 'absolute', top: -6, left: -6, zIndex: 3 }}>
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
          </div>
        );
      })}
    </div>
  );
}
