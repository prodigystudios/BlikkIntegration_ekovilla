import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/shared/cn';
import { crm } from '@/app/crm/lib/crmTokens';
import type { OpsSegment, OpsTruck } from '@/lib/domains/planning/types';
import { type WeekDay, addDaysISO, daysBetweenInclusive } from './planningDates';
import type { JobType } from '@/lib/domains/planning/jobTypes';
import { crewInitials, crewColor, type AssignablePerson } from '@/lib/domains/planning/crew';
import { crewForTruckInRange, type TruckCrewMember } from '@/lib/domains/planning/truckCrew';
import type { DefaultCrewMember } from '@/lib/domains/planning/defaultCrew';
import { groupNotesByDay, type DayNote } from '@/lib/domains/planning/dayNotes';
import { swedishHoliday } from '@/lib/domains/planning/holidays';
import { CrewEditor, CrewAvatars, SegmentCardBody, type SegmentActions } from './jobCard';
import { orderInfo } from '@/lib/domains/planning/order';
import DayNotesCell from './DayNotesCell';

type WeekBoardProps = {
  weekDays: WeekDay[];
  showWeekend: boolean;
  trucks: OpsTruck[];
  segments: OpsSegment[];
  todayISO: string;
  canWrite: boolean;
  placing: boolean; // a backlog item is selected → cells are placement targets
  people: AssignablePerson[];
  jobTypes: JobType[];
  onCellClick: (truckId: string, dayISO: string) => void;
  onCellDrop: (e: React.DragEvent, truckId: string, dayISO: string) => void;
  onSegDragStart: (e: React.DragEvent, seg: OpsSegment) => void;
  onSegClick: (seg: OpsSegment) => void;
  actions: SegmentActions;
  dayNotes: DayNote[];
  onAddNote: (dayISO: string, body: string) => void;
  onRemoveNote: (id: string) => void;
  truckCrew: TruckCrewMember[];
  defaultCrew: DefaultCrewMember[];
  onAddTruckCrew: (truckId: string, person: AssignablePerson, startDay: string, endDay: string) => void;
  onRemoveTruckCrew: (truckId: string, memberId: string) => void;
  onCopyTruckCrew: (truckId: string, sourceFrom: string, sourceTo: string) => void;
  onForkWeek: (truckId: string, startDay: string, endDay: string) => void;
  onRestoreWeek: (truckId: string, startDay: string, endDay: string) => void;
};

// A read-only avatar row marking the leader with a star — used for the inherited default team.
function DefaultCrewAvatars({ team }: { team: DefaultCrewMember[] }) {
  if (team.length === 0) return null;
  return (
    <div className="flex items-center -space-x-1.5">
      {team.map((m) => (
        <span key={m.id} className="relative inline-grid h-5 w-5 place-items-center rounded-full text-[7px] font-bold text-white ring-1 ring-white" style={{ backgroundColor: crewColor(m.member_id ?? m.member_name) }} title={`${m.member_name}${m.role === 'leader' ? ' (teamledare)' : ''}`}>
          {crewInitials(m.member_name)}
          {m.role === 'leader' && (
            <svg className="absolute -right-1 -top-1 text-amber-500" width="8" height="8" viewBox="0 0 24 24" fill="currentColor" stroke="white" strokeWidth="1.5"><path d="M12 2l3 7h7l-5.5 4.5L18 21l-6-4-6 4 1.5-7.5L2 9h7z" /></svg>
          )}
        </span>
      ))}
    </div>
  );
}

// Which visible-day column (0…count-1) a pointer x lands in, within a `count`-column lane.
function dayIndexFromX(e: React.MouseEvent | React.DragEvent, count: number): number {
  const rect = e.currentTarget.getBoundingClientRect();
  const idx = Math.floor(((e.clientX - rect.left) / rect.width) * count);
  return Math.max(0, Math.min(count - 1, idx));
}

export default function WeekBoard({
  weekDays, showWeekend, trucks, segments, todayISO, canWrite, placing, people, jobTypes,
  onCellClick, onCellDrop, onSegDragStart, onSegClick, actions,
  dayNotes, onAddNote, onRemoveNote, truckCrew, defaultCrew, onAddTruckCrew, onRemoveTruckCrew, onCopyTruckCrew, onForkWeek, onRestoreWeek,
}: WeekBoardProps) {
  // The visible day columns: all seven, or weekdays only when weekends are hidden.
  const days = showWeekend ? weekDays : weekDays.filter((d) => !d.isWeekend);
  const n = days.length;
  const weekStart = weekDays[0].iso;
  const weekEnd = weekDays[6].iso;
  const laneCols = `112px repeat(${n}, minmax(132px,1fr))`;
  const dayCols = `repeat(${n}, minmax(0,1fr))`;
  const notesByDay = groupNotesByDay(dayNotes);

  // First/last visible-day column a segment occupies (null when it falls entirely on hidden days).
  const segColumns = (seg: OpsSegment): { s: number; e: number } | null => {
    let s = -1;
    let e = -1;
    for (let i = 0; i < n; i++) {
      if (days[i].iso >= seg.start_day && days[i].iso <= seg.end_day) {
        if (s === -1) s = i;
        e = i;
      }
    }
    return s === -1 ? null : { s, e };
  };

  const [resize, setResize] = useState<{ segId: string; endIso: string } | null>(null);
  const resizeEndRef = useRef<string | null>(null);
  const suppressClickRef = useRef(false);
  const [dragCell, setDragCell] = useState<{ truckId: string; idx: number } | null>(null);
  const [hoverCell, setHoverCell] = useState<{ truckId: string; idx: number } | null>(null);
  // Clear the drag-target highlight whenever a drag ends (drop, Esc, or leaving the window).
  useEffect(() => {
    const clear = () => setDragCell(null);
    window.addEventListener('dragend', clear);
    return () => window.removeEventListener('dragend', clear);
  }, []);

  // Pointer-drag a card's right edge to change how many days it spans (live preview via `resize`).
  // The target day is read with elementFromPoint against a per-day overlay (rendered while resizing),
  // not pointer-x ÷ rect math — the latter breaks under CSS `zoom` because WebKit's
  // getBoundingClientRect ignores zoom while MouseEvent.clientX is visual, so the last day became
  // unreachable. elementFromPoint uses the browser's own visual hit-testing, correct at any zoom.
  const startResize = (e: React.MouseEvent, seg: OpsSegment) => {
    e.stopPropagation();
    e.preventDefault();
    resizeEndRef.current = seg.end_day;
    setResize({ segId: seg.id, endIso: seg.end_day }); // show the day overlay from the first move
    const onMove = (me: MouseEvent) => {
      const cell = (document.elementFromPoint(me.clientX, me.clientY) as HTMLElement | null)?.closest('[data-dayidx]') as HTMLElement | null;
      if (!cell) return;
      const idx = Math.max(0, Math.min(n - 1, Number(cell.dataset.dayidx)));
      const endIso = days[idx].iso < seg.start_day ? seg.start_day : days[idx].iso;
      resizeEndRef.current = endIso;
      setResize({ segId: seg.id, endIso });
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      const endIso = resizeEndRef.current;
      setResize(null);
      suppressClickRef.current = true;
      setTimeout(() => { suppressClickRef.current = false; }, 0);
      if (endIso && endIso !== seg.end_day) actions.onResize(seg, seg.start_day, endIso);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  return (
    <section className={cn(crm.card, 'planning-board overflow-x-auto p-3')}>
      <div style={{ minWidth: 112 + n * 132 }}>
        {/* Day header */}
        <div className="mb-1.5 grid" style={{ gridTemplateColumns: laneCols }}>
          <div />
          {days.map((wd) => {
            const isToday = wd.iso === todayISO;
            const hol = swedishHoliday(wd.iso);
            return (
              <div key={wd.iso} className={cn('px-1.5 py-1.5 text-center', isToday ? 'bg-emerald-50' : hol && 'bg-rose-50')}>
                <div className={cn('text-[11.5px] font-bold capitalize', isToday ? 'text-emerald-700' : hol ? 'text-rose-600' : wd.isWeekend ? 'text-slate-400' : 'text-slate-600')}>
                  {wd.weekday}
                </div>
                <div className={cn('text-[10px] tabular-nums', isToday ? 'text-emerald-600' : hol ? 'text-rose-400' : 'text-slate-400')}>{wd.dayLabel}</div>
                {hol && <div className="truncate text-[8px] font-semibold leading-tight text-rose-500" title={hol}>{hol}</div>}
              </div>
            );
          })}
        </div>

        {/* Day notes strip (dagsanteckningar) */}
        <div className="grid" style={{ gridTemplateColumns: laneCols }}>
          <div className="flex items-center justify-end pr-2 text-[9.5px] font-semibold uppercase tracking-wide text-slate-300">Noteringar</div>
          {days.map((wd) => (
            <DayNotesCell
              key={wd.iso}
              dayISO={wd.iso}
              notes={notesByDay.get(wd.iso) ?? []}
              canWrite={canWrite}
              isWeekend={wd.isWeekend}
              isToday={wd.iso === todayISO}
              onAdd={onAddNote}
              onRemove={onRemoveNote}
            />
          ))}
        </div>

        {/* Truck lanes */}
        {trucks.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-400">Inga bilar upplagda än.</p>
        ) : (
          trucks.map((truck, ti) => {
            const laneSegs = segments.filter(
              (s) => s.truck_id === truck.id && s.end_day >= weekStart && s.start_day <= weekEnd,
            );
            const laneWeekly = crewForTruckInRange(truckCrew, truck.id, weekStart, weekEnd);
            const overridden = laneWeekly.length > 0;
            const defaultTeam = defaultCrew.filter((m) => m.truck_id === truck.id);
            const laneColor = truck.color || '#94a3b8';
            return (
              <div
                key={truck.id}
                className={cn('grid border-t border-solid border-[#e8efe5]', ti === trucks.length - 1 && 'border-b')}
                style={{ gridTemplateColumns: laneCols }}
              >
                <div className="flex flex-col gap-1 py-2 pl-1 pr-2">
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-black/[0.03]" style={{ backgroundColor: truck.color || '#94a3b8' }} />
                    <span className="truncate text-[12.5px] font-bold text-slate-700">{truck.name}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 pl-[18px]">
                    {overridden ? (
                      // This week deviates from the default — edit it directly.
                      <>
                        {canWrite ? (
                          <CrewEditor
                            crew={laneWeekly}
                            people={people}
                            onAdd={(p) => onAddTruckCrew(truck.id, p, weekStart, weekEnd)}
                            onRemove={(mid) => onRemoveTruckCrew(truck.id, mid)}
                          />
                        ) : (
                          <CrewAvatars crew={laneWeekly} />
                        )}
                        {canWrite && (
                          <>
                            <button
                              type="button"
                              onClick={() => onRestoreWeek(truck.id, weekStart, weekEnd)}
                              title="Återgå till standardbemanningen för den här veckan"
                              className="inline-flex items-center gap-0.5 text-[9px] font-semibold text-slate-400 transition hover:text-emerald-600"
                            >
                              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5" /></svg>
                              standard
                            </button>
                            <button
                              type="button"
                              onClick={() => onCopyTruckCrew(truck.id, weekStart, weekEnd)}
                              title="Kopiera besättningen till nästa vecka"
                              className="inline-flex items-center gap-0.5 text-[9px] font-semibold text-slate-400 transition hover:text-emerald-600"
                            >
                              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
                              nästa v.
                            </button>
                          </>
                        )}
                      </>
                    ) : defaultTeam.length > 0 ? (
                      // No override → show the truck's standing team (inherited), with a fork button.
                      <>
                        <DefaultCrewAvatars team={defaultTeam} />
                        <span className="rounded-full border border-[#e0e8dc] bg-[#f3f6f1] px-1.5 py-px text-[8.5px] font-semibold text-slate-400">standard</span>
                        {canWrite && (
                          <button
                            type="button"
                            onClick={() => onForkWeek(truck.id, weekStart, weekEnd)}
                            title="Avvik från standardbemanningen för den här veckan"
                            className="inline-flex items-center gap-0.5 text-[9px] font-semibold text-slate-400 transition hover:text-emerald-600"
                          >
                            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
                            ändra
                          </button>
                        )}
                      </>
                    ) : (
                      // No default + no override → assign directly (creates this week's crew).
                      canWrite ? (
                        <CrewEditor
                          crew={laneWeekly}
                          people={people}
                          onAdd={(p) => onAddTruckCrew(truck.id, p, weekStart, weekEnd)}
                          onRemove={(mid) => onRemoveTruckCrew(truck.id, mid)}
                        />
                      ) : null
                    )}
                  </div>
                </div>

                {/* Day-area: one drop zone; the target day is derived from the pointer x. */}
                <div
                  data-dayarea
                  className="relative"
                  style={{ gridColumn: '2 / -1' }}
                  onDragOver={(e) => {
                    if (!canWrite) return;
                    e.preventDefault();
                    const idx = dayIndexFromX(e, n);
                    setDragCell((cur) => (cur && cur.truckId === truck.id && cur.idx === idx ? cur : { truckId: truck.id, idx }));
                  }}
                  onDrop={(e) => {
                    if (!canWrite) return;
                    e.preventDefault();
                    setDragCell(null);
                    onCellDrop(e, truck.id, days[dayIndexFromX(e, n)].iso);
                  }}
                  onMouseMove={(e) => {
                    if (!placing) return;
                    const idx = dayIndexFromX(e, n);
                    setHoverCell((cur) => (cur && cur.truckId === truck.id && cur.idx === idx ? cur : { truckId: truck.id, idx }));
                  }}
                  onMouseLeave={() => placing && setHoverCell(null)}
                  onClick={(e) => {
                    if (placing) onCellClick(truck.id, days[dayIndexFromX(e, n)].iso);
                  }}
                >
                  {/* gridline / weekend / today background */}
                  <div className="pointer-events-none absolute inset-0 grid" style={{ gridTemplateColumns: dayCols }}>
                    {days.map((wd, di) => (
                      <div
                        key={wd.iso}
                        className={cn(
                          'border-solid border-[#e8efe5] border-l',
                          dragCell?.truckId === truck.id && dragCell.idx === di
                            ? 'bg-emerald-400/20 ring-2 ring-inset ring-emerald-400'
                            : placing && hoverCell?.truckId === truck.id && hoverCell.idx === di
                              ? 'bg-emerald-400/10 outline-dashed outline-2 -outline-offset-2 outline-emerald-400/70'
                              : placing
                                ? 'bg-emerald-400/[0.05]'
                                : wd.iso === todayISO
                                  ? 'bg-emerald-500/5'
                                  : swedishHoliday(wd.iso)
                                    ? 'bg-rose-400/[0.07]'
                                    : wd.isWeekend
                                      ? 'bg-slate-400/[0.06]'
                                      : '',
                        )}
                      />
                    ))}
                  </div>

                  {/* segments */}
                  <div className={cn('relative grid h-full content-start gap-1.5 px-1.5 py-1.5', placing && 'cursor-copy')} style={{ gridTemplateColumns: dayCols, minHeight: 72 }}>
                    {laneSegs.map((seg) => {
                      const col = segColumns(seg);
                      if (!col) return null;
                      const previewEnd = resize?.segId === seg.id ? days.findIndex((d) => d.iso === resize.endIso) : -1;
                      const endIdx = previewEnd >= col.s ? previewEnd : col.e;
                      return (
                        <div
                          key={seg.id}
                          draggable={canWrite}
                          onDragStart={(ev) => onSegDragStart(ev, seg)}
                          onClick={(ev) => {
                            ev.stopPropagation();
                            if (suppressClickRef.current) return;
                            onSegClick(seg);
                          }}
                          // Tint the card by its truck's colour (same as the month view) so jobs read
                          // by truck at a glance everywhere — consistent across week + month.
                          style={{ gridColumn: `${col.s + 1} / ${endIdx + 2}`, backgroundColor: `${laneColor}1f`, borderColor: `${laneColor}66` }}
                          className={cn(
                            'relative overflow-hidden rounded-xl border border-solid p-2.5 pl-3.5 shadow-[0_1px_2px_rgba(20,44,27,0.06)] transition hover:shadow-[0_3px_10px_rgba(20,44,27,0.12)]',
                            canWrite ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer',
                            seg.on_hold && 'opacity-60 ring-1 ring-amber-200',
                          )}
                        >
                          {canWrite && (
                            <span
                              onMouseDown={(e) => startResize(e, seg)}
                              onClick={(e) => e.stopPropagation()}
                              title="Dra för att ändra antal dagar"
                              className="absolute inset-y-2 right-0 z-10 flex w-2 cursor-ew-resize items-center justify-center text-slate-300 transition hover:text-emerald-500"
                            >
                              <svg width="4" height="13" viewBox="0 0 4 14" fill="currentColor"><rect width="1.2" height="14" rx="0.6" /><rect x="2.8" width="1.2" height="14" rx="0.6" /></svg>
                            </span>
                          )}
                          <SegmentCardBody
                            seg={seg}
                            canWrite={canWrite}
                            jobTypes={jobTypes}
                            people={people}
                            actions={actions}
                            order={orderInfo(segments, seg)}
                          />
                        </div>
                      );
                    })}
                  </div>

                  {/* Day-index hit overlay — only while resizing a card in this lane. Sits above the
                      cards so elementFromPoint reliably reports the day under the pointer (zoom-safe). */}
                  {resize && laneSegs.some((s) => s.id === resize.segId) && (
                    <div className="absolute inset-0 z-40 grid" style={{ gridTemplateColumns: dayCols }}>
                      {days.map((wd, di) => (
                        <div key={wd.iso} data-dayidx={di} />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
