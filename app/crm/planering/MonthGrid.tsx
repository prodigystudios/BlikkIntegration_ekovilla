import type React from 'react';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/shared/cn';
import { crm } from '@/app/crm/lib/crmTokens';
import type { OpsSegment, OpsTruck } from '@/lib/domains/planning/types';
import type { MonthWeek } from './planningDates';
import { SegmentCardBody, type SegmentActions } from './jobCard';
import { orderInfo } from '@/lib/domains/planning/order';
import type { JobType } from '@/lib/domains/planning/jobTypes';
import type { AssignablePerson } from '@/lib/domains/planning/crew';
import { groupNotesByDay, type DayNote } from '@/lib/domains/planning/dayNotes';
import { swedishHoliday } from '@/lib/domains/planning/holidays';

type MonthGridProps = {
  weeks: MonthWeek[];
  trucks: OpsTruck[];
  segments: OpsSegment[];
  todayISO: string;
  canWrite: boolean;
  placing: boolean;
  people: AssignablePerson[];
  jobTypes: JobType[];
  onDayClick: (dayISO: string) => void;
  onDayDrop: (e: React.DragEvent, dayISO: string) => void;
  onSegDragStart: (e: React.DragEvent, seg: OpsSegment) => void;
  onSegClick: (seg: OpsSegment) => void;
  actions: SegmentActions;
  dayNotes: DayNote[];
};

const WEEKDAYS = ['mån', 'tis', 'ons', 'tor', 'fre', 'lör', 'sön'];

export default function MonthGrid({
  weeks,
  trucks,
  segments,
  todayISO,
  canWrite,
  placing,
  people,
  jobTypes,
  onDayClick,
  onDayDrop,
  onSegDragStart,
  onSegClick,
  actions,
  dayNotes,
}: MonthGridProps) {
  const truckColor = new Map(trucks.map((t) => [t.id, t.color || '#94a3b8']));
  const truckName = new Map(trucks.map((t) => [t.id, t.name]));
  const truckOrder = new Map(trucks.map((t, i) => [t.id, i]));
  const notesByDay = groupNotesByDay(dayNotes);
  const [dragDay, setDragDay] = useState<string | null>(null);
  useEffect(() => {
    const clear = () => setDragDay(null);
    window.addEventListener('dragend', clear);
    return () => window.removeEventListener('dragend', clear);
  }, []);

  return (
    <section className={cn(crm.card, 'planning-board overflow-x-auto p-3')}>
      <div className="min-w-[1240px]">
        {/* weekday header */}
        <div className="grid grid-cols-[34px_repeat(7,1fr)]">
          <div />
          {WEEKDAYS.map((wd, i) => (
            <div key={wd} className={cn('py-1 text-center text-[11px] font-bold capitalize', i >= 5 ? 'text-slate-400' : 'text-slate-500')}>
              {wd}
            </div>
          ))}
        </div>

        <div className="rounded-b-lg border-b border-r border-solid border-[#e8efe5]">
          {weeks.map((week) => (
            <div key={`${week.weekNo}-${week.days[0].iso}`} className="grid grid-cols-[34px_repeat(7,1fr)]">
              <div className="flex justify-center pt-2 text-[10px] font-bold tabular-nums text-slate-300">{week.weekNo}</div>
              {week.days.map((cell) => {
                const isToday = cell.iso === todayISO;
                const dayActive = placing && canWrite;
                const daySegs = segments
                  .filter((s) => s.start_day <= cell.iso && s.end_day >= cell.iso)
                  .sort(
                    (a, b) =>
                      (truckOrder.get(a.truck_id) ?? 999) - (truckOrder.get(b.truck_id) ?? 999) ||
                      a.start_day.localeCompare(b.start_day) ||
                      a.id.localeCompare(b.id),
                  );
                const cellNotes = notesByDay.get(cell.iso) ?? [];
                const hol = swedishHoliday(cell.iso);
                return (
                  <div
                    key={cell.iso}
                    title={hol ?? undefined}
                    onClick={() => {
                      if (placing) onDayClick(cell.iso);
                    }}
                    onDragOver={(e) => {
                      if (!canWrite) return;
                      e.preventDefault();
                      if (dragDay !== cell.iso) setDragDay(cell.iso);
                    }}
                    onDrop={(e) => {
                      if (!canWrite) return;
                      e.preventDefault();
                      setDragDay(null);
                      onDayDrop(e, cell.iso);
                    }}
                    className={cn(
                      'flex min-h-[140px] flex-col gap-1 border-l border-t border-solid border-[#e8efe5] p-1.5',
                      cell.inMonth ? 'bg-[#f9fbf7]' : 'bg-[#eef2ec]',
                      cell.isWeekend && cell.inMonth && 'bg-slate-400/[0.05]',
                      hol && cell.inMonth && 'bg-rose-400/[0.06]',
                      isToday && 'bg-emerald-50',
                      dayActive && 'cursor-copy',
                      dragDay === cell.iso && 'ring-2 ring-inset ring-emerald-400',
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-1">
                        <span className={cn('text-[11px] font-bold tabular-nums', !cell.inMonth ? 'text-slate-300' : isToday ? 'text-emerald-700' : hol ? 'text-rose-600' : 'text-slate-500')}>
                          {cell.day}
                        </span>
                        {hol && cell.inMonth && <span className="h-1.5 w-1.5 rounded-full bg-rose-400" />}
                      </span>
                      <span className="flex items-center gap-1">
                        {cellNotes.length > 0 && (
                          <span
                            title={cellNotes.map((n) => n.body).join(' · ')}
                            className="inline-flex h-3.5 min-w-[14px] items-center justify-center rounded-full bg-amber-100 px-1 text-[8px] font-bold tabular-nums text-amber-700"
                          >
                            {cellNotes.length}
                          </span>
                        )}
                        {isToday && <span className="rounded-full bg-emerald-600 px-1.5 py-px text-[8.5px] font-extrabold text-white">idag</span>}
                      </span>
                    </div>

                    {daySegs.map((seg) => (
                      <div
                        key={seg.id}
                        draggable={canWrite}
                        onDragStart={(ev) => onSegDragStart(ev, seg)}
                        onClick={(ev) => {
                          ev.stopPropagation();
                          onSegClick(seg);
                        }}
                        className={cn(
                          'relative overflow-hidden rounded-lg border border-[#e0e8dc] bg-white p-2 pl-2.5 shadow-[0_1px_2px_rgba(20,44,27,0.06)] transition hover:shadow-[0_3px_10px_rgba(20,44,27,0.12)]',
                          canWrite ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer',
                          seg.on_hold && 'opacity-60 ring-1 ring-amber-200',
                        )}
                      >
                        <SegmentCardBody
                          seg={seg}
                          canWrite={canWrite}
                          jobTypes={jobTypes}
                          people={people}
                          actions={actions}
                          truckColor={truckColor.get(seg.truck_id) || '#94a3b8'}
                          truckName={truckName.get(seg.truck_id) ?? ''}
                          order={orderInfo(segments, seg)}
                        />
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
