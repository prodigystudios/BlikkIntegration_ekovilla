import type React from 'react';
import { cn } from '@/lib/shared/cn';
import { crm } from '@/app/crm/lib/crmTokens';
import type { OpsSegment, OpsTruck } from '@/lib/domains/planning/types';
import { addDaysISO, daysBetweenInclusive, type MonthWeek } from './planningDates';
import {
  statusMeta,
  StatusPill,
  JobRef,
  CrewAvatars,
  SegmentMenu,
  JobTypeOrMaterial,
  HoldBadge,
  SackProgress,
  ConfirmationBadge,
  MapLink,
} from './jobCard';
import { resolveJobTypeFrom, type JobType } from '@/lib/domains/planning/jobTypes';
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
  onSetStatus: (seg: OpsSegment, status: string) => void;
  onSetJobType: (seg: OpsSegment, jobType: string | null) => void;
  onToggleHold: (seg: OpsSegment, value: boolean) => void;
  onOpenConfirm: (seg: OpsSegment) => void;
  onResize: (seg: OpsSegment, startDay: string, endDay: string) => void;
  onAddCrew: (seg: OpsSegment, person: AssignablePerson) => void;
  onRemoveCrew: (seg: OpsSegment, memberId: string) => void;
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
  onSetStatus,
  onSetJobType,
  onToggleHold,
  onOpenConfirm,
  onResize,
  onAddCrew,
  onRemoveCrew,
  dayNotes,
}: MonthGridProps) {
  const truckColor = new Map(trucks.map((t) => [t.id, t.color || '#94a3b8']));
  const truckName = new Map(trucks.map((t) => [t.id, t.name]));
  const truckOrder = new Map(trucks.map((t, i) => [t.id, i]));
  const notesByDay = groupNotesByDay(dayNotes);

  return (
    <section className={cn(crm.card, 'overflow-x-auto p-3')}>
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
                      if (canWrite) e.preventDefault();
                    }}
                    onDrop={(e) => {
                      if (!canWrite) return;
                      e.preventDefault();
                      onDayDrop(e, cell.iso);
                    }}
                    className={cn(
                      'flex min-h-[140px] flex-col gap-1 border-l border-t border-solid border-[#e8efe5] p-1.5',
                      cell.inMonth ? 'bg-[#f9fbf7]' : 'bg-[#eef2ec]',
                      cell.isWeekend && cell.inMonth && 'bg-slate-400/[0.05]',
                      hol && cell.inMonth && 'bg-rose-400/[0.06]',
                      isToday && 'bg-emerald-50',
                      dayActive && 'cursor-copy',
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

                    {daySegs.map((seg) => {
                      const job = seg.job;
                      return (
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
                          <span className={cn('absolute inset-y-0 left-0 w-1', statusMeta(job?.status ?? '').rail)} />
                          {job ? (
                            <>
                              <div className="flex items-center gap-1.5">
                                <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: truckColor.get(seg.truck_id) || '#94a3b8' }} />
                                <JobRef job={job} className="text-[10.5px]" />
                                <StatusPill status={job.status} className="ml-auto" />
                                {canWrite && (
                                  <SegmentMenu
                                    status={job.status}
                                    jobType={seg.job_type}
                                    jobTypes={jobTypes}
                                    onHold={seg.on_hold}
                                    lengthDays={daysBetweenInclusive(seg.start_day, seg.end_day)}
                                    crew={seg.crew}
                                    people={people}
                                    onSetStatus={(st) => onSetStatus(seg, st)}
                                    onSetJobType={(key) => onSetJobType(seg, key)}
                                    onToggleHold={() => onToggleHold(seg, !seg.on_hold)}
                                    onOpenConfirm={() => onOpenConfirm(seg)}
                                    onSetLength={(d) => onResize(seg, seg.start_day, addDaysISO(seg.start_day, d - 1))}
                                    onAddCrew={(p) => onAddCrew(seg, p)}
                                    onRemoveCrew={(mid) => onRemoveCrew(seg, mid)}
                                  />
                                )}
                              </div>
                              <div className="mt-1 truncate text-[11.5px] font-bold leading-tight text-slate-900">{job.project_name}</div>
                              <div className="truncate text-[10px] text-slate-500">{job.client_name}</div>
                              {job.address && (
                                <div className="mt-0.5 flex items-center gap-1 text-[9.5px] text-slate-400">
                                  <span className="truncate">{job.address}</span>
                                  <MapLink address={job.address} />
                                </div>
                              )}
                              <div className="mt-1 flex flex-wrap items-center gap-1">
                                {seg.on_hold && <HoldBadge />}
                                <JobTypeOrMaterial jobType={resolveJobTypeFrom(jobTypes, seg.job_type)} material={job.material} />
                              </div>
                              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                                <SackProgress planned={job.total_sacks} reported={seg.sacks_reported} />
                                <ConfirmationBadge confirmation={seg.confirmation} />
                                <div className="ml-auto flex items-center gap-1">
                                  <span className="truncate text-[9px] font-semibold text-slate-400">{truckName.get(seg.truck_id) ?? ''}</span>
                                  {seg.crew.length > 0 && <CrewAvatars crew={seg.crew} size={14} />}
                                </div>
                              </div>
                            </>
                          ) : (
                            <div className="flex items-center gap-1.5">
                              <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: truckColor.get(seg.truck_id) || '#94a3b8' }} />
                              <span className="text-[10px] text-slate-400">Order saknas</span>
                            </div>
                          )}
                        </div>
                      );
                    })}
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
