import type React from 'react';
import { useRef, useState } from 'react';
import { cn } from '@/lib/shared/cn';
import { crm } from '@/app/crm/lib/crmTokens';
import type { OpsSegment, OpsTruck } from '@/lib/domains/planning/types';
import { type WeekDay, addDaysISO, daysBetweenInclusive } from './planningDates';
import type { JobType } from '@/lib/domains/planning/jobTypes';
import type { AssignablePerson } from '@/lib/domains/planning/crew';
import { crewForTruckInRange, type TruckCrewMember } from '@/lib/domains/planning/truckCrew';
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
  onAddTruckCrew: (truckId: string, person: AssignablePerson, startDay: string, endDay: string) => void;
  onRemoveTruckCrew: (truckId: string, memberId: string) => void;
  onCopyTruckCrew: (truckId: string, sourceFrom: string, sourceTo: string) => void;
};

// Which visible-day column (0…count-1) a pointer x lands in, within a `count`-column lane.
function dayIndexFromX(e: React.MouseEvent | React.DragEvent, count: number): number {
  const rect = e.currentTarget.getBoundingClientRect();
  const idx = Math.floor(((e.clientX - rect.left) / rect.width) * count);
  return Math.max(0, Math.min(count - 1, idx));
}

export default function WeekBoard({
  weekDays, showWeekend, trucks, segments, todayISO, canWrite, placing, people, jobTypes,
  onCellClick, onCellDrop, onSegDragStart, onSegClick, actions,
  dayNotes, onAddNote, onRemoveNote, truckCrew, onAddTruckCrew, onRemoveTruckCrew, onCopyTruckCrew,
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

  // Pointer-drag a card's right edge to change how many days it spans (live preview via `resize`).
  const startResize = (e: React.MouseEvent, seg: OpsSegment) => {
    e.stopPropagation();
    e.preventDefault();
    const dayArea = (e.currentTarget as HTMLElement).closest('[data-dayarea]') as HTMLElement | null;
    if (!dayArea) return;
    const rect = dayArea.getBoundingClientRect();
    resizeEndRef.current = seg.end_day;
    const onMove = (me: MouseEvent) => {
      const idx = Math.max(0, Math.min(n - 1, Math.floor(((me.clientX - rect.left) / rect.width) * n)));
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
            const laneCrew = crewForTruckInRange(truckCrew, truck.id, weekStart, weekEnd);
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
                    {canWrite ? (
                      <CrewEditor
                        crew={laneCrew}
                        people={people}
                        onAdd={(p) => onAddTruckCrew(truck.id, p, weekStart, weekEnd)}
                        onRemove={(mid) => onRemoveTruckCrew(truck.id, mid)}
                      />
                    ) : (
                      <CrewAvatars crew={laneCrew} />
                    )}
                    {canWrite && laneCrew.length > 0 && (
                      <button
                        type="button"
                        onClick={() => onCopyTruckCrew(truck.id, weekStart, weekEnd)}
                        title="Kopiera besättningen till nästa vecka"
                        className="inline-flex items-center gap-0.5 text-[9px] font-semibold text-slate-400 transition hover:text-emerald-600"
                      >
                        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M5 12h14M13 6l6 6-6 6" />
                        </svg>
                        nästa v.
                      </button>
                    )}
                  </div>
                </div>

                {/* Day-area: one drop zone; the target day is derived from the pointer x. */}
                <div
                  data-dayarea
                  className="relative"
                  style={{ gridColumn: '2 / -1' }}
                  onDragOver={(e) => {
                    if (canWrite) e.preventDefault();
                  }}
                  onDrop={(e) => {
                    if (!canWrite) return;
                    e.preventDefault();
                    onCellDrop(e, truck.id, days[dayIndexFromX(e, n)].iso);
                  }}
                  onClick={(e) => {
                    if (placing) onCellClick(truck.id, days[dayIndexFromX(e, n)].iso);
                  }}
                >
                  {/* gridline / weekend / today background */}
                  <div className="pointer-events-none absolute inset-0 grid" style={{ gridTemplateColumns: dayCols }}>
                    {days.map((wd) => (
                      <div
                        key={wd.iso}
                        className={cn(
                          'border-solid border-[#e8efe5] border-l',
                          wd.iso === todayISO
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
                          style={{ gridColumn: `${col.s + 1} / ${endIdx + 2}` }}
                          className={cn(
                            'relative overflow-hidden rounded-xl border border-[#e0e8dc] bg-white p-2.5 pl-3.5 shadow-[0_1px_2px_rgba(20,44,27,0.06)] transition hover:shadow-[0_3px_10px_rgba(20,44,27,0.12)]',
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
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
