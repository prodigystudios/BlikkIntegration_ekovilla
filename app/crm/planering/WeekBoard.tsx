import type React from 'react';
import { cn } from '@/lib/shared/cn';
import { crm } from '@/app/crm/lib/crmTokens';
import type { OpsSegment, OpsTruck } from '@/lib/domains/planning/types';
import { parseISO, type WeekDay } from './planningDates';
import { JOB_TYPES } from '@/lib/domains/planning/jobTypes';
import type { AssignablePerson } from '@/lib/domains/planning/crew';
import { groupNotesByDay, type DayNote } from '@/lib/domains/planning/dayNotes';
import { statusMeta, StatusPill, SackProgress, JobTypeOrMaterial, JobRef, CrewEditor, CrewAvatars, ConfirmationBadge, HoldBadge } from './jobCard';
import DayNotesCell from './DayNotesCell';

type WeekBoardProps = {
  weekDays: WeekDay[];
  trucks: OpsTruck[];
  segments: OpsSegment[];
  todayISO: string;
  canWrite: boolean;
  placing: boolean; // a backlog item is selected → cells are placement targets
  people: AssignablePerson[];
  onCellClick: (truckId: string, dayISO: string) => void;
  onCellDrop: (e: React.DragEvent, truckId: string, dayISO: string) => void;
  onSegDragStart: (e: React.DragEvent, seg: OpsSegment) => void;
  onSegClick: (seg: OpsSegment) => void;
  onSetJobType: (seg: OpsSegment, jobType: string | null) => void;
  onAddCrew: (seg: OpsSegment, person: AssignablePerson) => void;
  onRemoveCrew: (seg: OpsSegment, memberId: string) => void;
  onOpenConfirm: (seg: OpsSegment) => void;
  onToggleHold: (seg: OpsSegment, value: boolean) => void;
  dayNotes: DayNote[];
  onAddNote: (dayISO: string, body: string) => void;
  onRemoveNote: (id: string) => void;
};

// Which day column (0–6) a pointer x lands in, within a 7-column lane.
function dayIndexFromX(e: React.MouseEvent | React.DragEvent): number {
  const rect = e.currentTarget.getBoundingClientRect();
  const idx = Math.floor(((e.clientX - rect.left) / rect.width) * 7);
  return Math.max(0, Math.min(6, idx));
}

export default function WeekBoard({
  weekDays, trucks, segments, todayISO, canWrite, placing, people,
  onCellClick, onCellDrop, onSegDragStart, onSegClick, onSetJobType, onAddCrew, onRemoveCrew, onOpenConfirm, onToggleHold,
  dayNotes, onAddNote, onRemoveNote,
}: WeekBoardProps) {
  const weekStart = weekDays[0].iso;
  const weekEnd = weekDays[6].iso;
  const startMs = parseISO(weekStart).getTime();
  const dayIndexOf = (iso: string) => Math.round((parseISO(iso).getTime() - startMs) / 86_400_000);
  const notesByDay = groupNotesByDay(dayNotes);

  return (
    <section className={cn(crm.card, 'overflow-x-auto p-3')}>
      <div className="min-w-[1040px]">
        {/* Day header */}
        <div className="grid grid-cols-[112px_repeat(7,minmax(132px,1fr))]">
          <div />
          {weekDays.map((wd) => {
            const isToday = wd.iso === todayISO;
            return (
              <div
                key={wd.iso}
                className={cn('rounded-lg px-1.5 py-1.5 text-center', isToday && 'bg-emerald-50')}
              >
                <div className={cn('text-[11.5px] font-bold capitalize', isToday ? 'text-emerald-700' : wd.isWeekend ? 'text-slate-400' : 'text-slate-600')}>
                  {wd.weekday}
                </div>
                <div className={cn('text-[10px] tabular-nums', isToday ? 'text-emerald-600' : 'text-slate-400')}>{wd.dayLabel}</div>
              </div>
            );
          })}
        </div>

        {/* Day notes strip (dagsanteckningar) */}
        <div className="grid grid-cols-[112px_repeat(7,minmax(132px,1fr))] border-t border-[#eef3eb]">
          <div className="flex items-center justify-end pr-2 text-[9.5px] font-semibold uppercase tracking-wide text-slate-300">Noteringar</div>
          {weekDays.map((wd) => (
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
          trucks.map((truck) => {
            const laneSegs = segments.filter(
              (s) => s.truck_id === truck.id && s.end_day >= weekStart && s.start_day <= weekEnd,
            );
            return (
              <div key={truck.id} className="grid grid-cols-[112px_repeat(7,minmax(132px,1fr))] border-t border-[#e8efe5]">
                <div className="flex items-start gap-2 py-3 pl-1 pr-2">
                  <span className="mt-[3px] h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-black/[0.03]" style={{ backgroundColor: truck.color || '#94a3b8' }} />
                  <span className="truncate text-[12.5px] font-bold text-slate-700">{truck.name}</span>
                </div>

                {/* Day-area: one drop zone; the target day is derived from the pointer x. */}
                <div
                  className="relative"
                  style={{ gridColumn: '2 / -1' }}
                  onDragOver={(e) => {
                    if (canWrite) e.preventDefault();
                  }}
                  onDrop={(e) => {
                    if (!canWrite) return;
                    e.preventDefault();
                    onCellDrop(e, truck.id, weekDays[dayIndexFromX(e)].iso);
                  }}
                  onClick={(e) => {
                    if (placing) onCellClick(truck.id, weekDays[dayIndexFromX(e)].iso);
                  }}
                >
                  {/* gridline / weekend / today background */}
                  <div className="pointer-events-none absolute inset-0 grid grid-cols-7">
                    {weekDays.map((wd) => (
                      <div
                        key={wd.iso}
                        className={cn(
                          'border-l border-[#e8efe5] last:border-r',
                          wd.iso === todayISO ? 'bg-emerald-500/5' : wd.isWeekend ? 'bg-slate-400/[0.06]' : '',
                        )}
                      />
                    ))}
                  </div>

                  {/* segments */}
                  <div className={cn('relative grid grid-cols-7 content-start gap-1.5 p-1.5', placing && 'cursor-copy')} style={{ minHeight: 118 }}>
                    {laneSegs.map((seg) => {
                      const s = Math.max(0, dayIndexOf(seg.start_day));
                      const e = Math.min(6, dayIndexOf(seg.end_day));
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
                          style={{ gridColumn: `${s + 1} / ${e + 2}` }}
                          className={cn(
                            'relative overflow-hidden rounded-xl border border-[#e0e8dc] bg-white p-2.5 pl-3.5 shadow-[0_1px_2px_rgba(20,44,27,0.06)] transition hover:-translate-y-px hover:shadow-[0_3px_10px_rgba(20,44,27,0.12)]',
                            canWrite ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer',
                            seg.on_hold && 'opacity-60 ring-1 ring-amber-200',
                          )}
                        >
                          <span className={cn('absolute inset-y-0 left-0 w-1', statusMeta(seg.job?.status ?? '').rail)} />
                          {job ? (
                            <>
                              <div className="flex items-center gap-2">
                                <JobRef job={job} />
                                <StatusPill status={job.status} className="ml-auto" />
                              </div>
                              <div className="mt-1.5 text-[13px] font-bold leading-tight text-slate-900">{job.project_name}</div>
                              <div className="text-[11px] text-slate-500">{job.client_name}</div>
                              {job.address && <div className="mt-0.5 text-[10.5px] text-slate-400">{job.address}</div>}
                              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                                {seg.on_hold && <HoldBadge />}
                                <JobTypeOrMaterial jobType={seg.job_type} material={job.material} />
                                <SackProgress planned={job.total_sacks} reported={seg.sacks_reported} />
                                <ConfirmationBadge confirmation={seg.confirmation} />
                              </div>
                              <div className="mt-2">
                                {canWrite ? (
                                  <CrewEditor
                                    crew={seg.crew}
                                    people={people}
                                    onAdd={(p) => onAddCrew(seg, p)}
                                    onRemove={(mid) => onRemoveCrew(seg, mid)}
                                  />
                                ) : (
                                  <CrewAvatars crew={seg.crew} />
                                )}
                              </div>
                              {canWrite && (
                                <select
                                  value={seg.job_type ?? ''}
                                  onClick={(ev) => ev.stopPropagation()}
                                  onMouseDown={(ev) => ev.stopPropagation()}
                                  onChange={(ev) => {
                                    ev.stopPropagation();
                                    onSetJobType(seg, ev.target.value || null);
                                  }}
                                  className="mt-2 h-6 w-full rounded-lg border border-[#e0e8dc] bg-white px-1.5 text-[10px] font-semibold text-slate-500 outline-none focus:border-emerald-400"
                                >
                                  <option value="">Jobbtyp…</option>
                                  {JOB_TYPES.map((t) => (
                                    <option key={t.key} value={t.key}>{t.label}</option>
                                  ))}
                                </select>
                              )}
                              {canWrite && (
                                <div className="mt-1.5 flex gap-1.5">
                                  <button
                                    type="button"
                                    onMouseDown={(ev) => ev.stopPropagation()}
                                    onClick={(ev) => {
                                      ev.stopPropagation();
                                      onToggleHold(seg, !seg.on_hold);
                                    }}
                                    className={cn(
                                      'inline-flex h-6 flex-1 items-center justify-center gap-1 rounded-lg border text-[10px] font-semibold transition',
                                      seg.on_hold
                                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:border-emerald-400'
                                        : 'border-[#e0e8dc] bg-white text-slate-500 hover:border-amber-400 hover:text-amber-600',
                                    )}
                                  >
                                    {seg.on_hold ? 'Återuppta' : 'Pausa'}
                                  </button>
                                  <button
                                    type="button"
                                    onMouseDown={(ev) => ev.stopPropagation()}
                                    onClick={(ev) => {
                                      ev.stopPropagation();
                                      onOpenConfirm(seg);
                                    }}
                                    className="inline-flex h-6 flex-1 items-center justify-center gap-1 rounded-lg border border-[#e0e8dc] bg-white text-[10px] font-semibold text-slate-500 transition hover:border-emerald-400 hover:text-emerald-600"
                                  >
                                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                      <rect x="2" y="4" width="20" height="16" rx="2" />
                                      <path d="M22 7l-10 6L2 7" />
                                    </svg>
                                    Bekräftelse
                                  </button>
                                </div>
                              )}
                            </>
                          ) : (
                            <div className="text-[11px] text-slate-400">Order saknas</div>
                          )}
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
