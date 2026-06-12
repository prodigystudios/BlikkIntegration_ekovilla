import type React from 'react';
import { cn } from '@/lib/shared/cn';
import { crm } from '@/app/crm/lib/crmTokens';
import type { OpsSegment, OpsTruck } from '@/lib/domains/planning/types';
import type { MonthWeek } from './planningDates';
import { statusMeta, JobRef, CrewAvatars } from './jobCard';
import { sacksRemaining } from '@/lib/domains/planning/reports';
import { describeSmsStatus } from '@/lib/domains/planning/confirmations';
import { groupNotesByDay, type DayNote } from '@/lib/domains/planning/dayNotes';
import { swedishHoliday } from '@/lib/domains/planning/holidays';

type MonthGridProps = {
  weeks: MonthWeek[];
  trucks: OpsTruck[];
  segments: OpsSegment[];
  todayISO: string;
  canWrite: boolean;
  placing: boolean;
  onDayClick: (dayISO: string) => void;
  onDayDrop: (e: React.DragEvent, dayISO: string) => void;
  onSegDragStart: (e: React.DragEvent, seg: OpsSegment) => void;
  onSegClick: (seg: OpsSegment) => void;
  dayNotes: DayNote[];
};

const WEEKDAYS = ['mån', 'tis', 'ons', 'tor', 'fre', 'lör', 'sön'];

export default function MonthGrid({
  weeks, trucks, segments, todayISO, canWrite, placing, onDayClick, onDayDrop, onSegDragStart, onSegClick, dayNotes,
}: MonthGridProps) {
  const truckColor = new Map(trucks.map((t) => [t.id, t.color || '#94a3b8']));
  const notesByDay = groupNotesByDay(dayNotes);

  return (
    <section className={cn(crm.card, 'overflow-x-auto p-3')}>
      <div className="min-w-[960px]">
        {/* weekday header */}
        <div className="grid grid-cols-[34px_repeat(7,1fr)]">
          <div />
          {WEEKDAYS.map((wd, i) => (
            <div key={wd} className={cn('py-1 text-center text-[11px] font-bold capitalize', i >= 5 ? 'text-slate-400' : 'text-slate-500')}>
              {wd}
            </div>
          ))}
        </div>

        <div className="border-b border-r border-[#e8efe5] rounded-b-lg">
          {weeks.map((week) => (
            <div key={`${week.weekNo}-${week.days[0].iso}`} className="grid grid-cols-[34px_repeat(7,1fr)]">
              <div className="flex justify-center pt-2 text-[10px] font-bold tabular-nums text-slate-300">{week.weekNo}</div>
              {week.days.map((cell) => {
                const isToday = cell.iso === todayISO;
                const dayActive = placing && canWrite;
                const daySegs = segments.filter((s) => s.start_day <= cell.iso && s.end_day >= cell.iso);
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
                      'flex min-h-[130px] flex-col gap-1 border-l border-t border-[#e8efe5] p-1.5',
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
                            'relative flex items-start gap-1.5 overflow-hidden rounded-lg border border-[#e0e8dc] bg-white px-2 py-1 pl-2.5 shadow-[0_1px_2px_rgba(20,44,27,0.06)] transition hover:-translate-y-px',
                            canWrite ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer',
                            seg.on_hold && 'opacity-55 ring-1 ring-amber-200',
                          )}
                        >
                          <span className={cn('absolute inset-y-0 left-0 w-[3px]', statusMeta(job?.status ?? '').rail)} />
                          <span className="mt-1 h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: truckColor.get(seg.truck_id) || '#94a3b8' }} />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-baseline justify-between gap-1.5">
                              <span className="flex min-w-0 items-center gap-1">
                                {seg.on_hold && (
                                  <span title="Pausad" className="inline-flex shrink-0 text-amber-500">
                                    <svg width="8" height="8" viewBox="0 0 24 24" fill="currentColor">
                                      <rect x="6" y="5" width="4" height="14" rx="1" />
                                      <rect x="14" y="5" width="4" height="14" rx="1" />
                                    </svg>
                                  </span>
                                )}
                                {job ? <JobRef job={job} className="text-[10px]" /> : <span className="text-[10px] text-slate-400">—</span>}
                                {(() => {
                                  const c = seg.confirmation;
                                  if (!c.email_sent_at && !c.sms_sent_at) return null;
                                  const smsFailed = describeSmsStatus(c.sms_status)?.tone === 'fail' && !c.email_sent_at;
                                  return (
                                    <span
                                      title={smsFailed ? 'SMS ej levererat' : 'Bekräftad'}
                                      className={cn(
                                        'inline-flex h-2.5 w-2.5 shrink-0 items-center justify-center rounded-full text-[6px] font-bold leading-none text-white',
                                        smsFailed ? 'bg-rose-500' : 'bg-emerald-500',
                                      )}
                                    >
                                      {smsFailed ? '!' : '✓'}
                                    </span>
                                  );
                                })()}
                              </span>
                              {job && job.total_sacks > 0 && (
                                <span
                                  className={cn(
                                    'shrink-0 text-[9px] font-bold tabular-nums',
                                    seg.sacks_reported > 0 ? 'text-amber-700' : 'text-emerald-700',
                                  )}
                                  title={seg.sacks_reported > 0 ? `kvar ${sacksRemaining(job.total_sacks, seg.sacks_reported)} / ${job.total_sacks} säck` : `${job.total_sacks} säck`}
                                >
                                  {seg.sacks_reported > 0 ? sacksRemaining(job.total_sacks, seg.sacks_reported) : job.total_sacks}
                                </span>
                              )}
                            </div>
                            <div className="truncate text-[10px] text-slate-600">{job?.client_name ?? job?.project_name ?? 'Order'}</div>
                            {seg.crew.length > 0 && (
                              <div className="mt-0.5">
                                <CrewAvatars crew={seg.crew} size={14} />
                              </div>
                            )}
                          </div>
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
