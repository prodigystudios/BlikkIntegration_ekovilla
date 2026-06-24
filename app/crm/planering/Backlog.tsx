import type React from 'react';
import { cn } from '@/lib/shared/cn';
import { crm } from '@/app/crm/lib/crmTokens';
import type { SchedulableWorkOrder } from '@/lib/domains/planning/types';
import { statusMeta, SackBadge, JobRef, MapLink } from './jobCard';
import { formatDate } from '@/app/crm/lib/format';

type BacklogFilter = 'unplanned' | 'planned' | 'all';

type BacklogProps = {
  items: SchedulableWorkOrder[];
  loading: boolean;
  canWrite: boolean;
  selectedId: string | null;
  filter: BacklogFilter;
  onFilterChange: (f: BacklogFilter) => void;
  counts: { unplanned: number; planned: number; all: number };
  onSelect: (id: string) => void;
  onDragStartItem: (e: React.DragEvent, item: SchedulableWorkOrder) => void;
  onDropUnschedule: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  dropActive: boolean;
};

const FILTER_TABS: ReadonlyArray<readonly [BacklogFilter, string]> = [
  ['unplanned', 'Oplanerade'],
  ['planned', 'Planerade'],
  ['all', 'Alla'],
];

function shortDate(value: string | null): string | null {
  if (!value) return null;
  const formatted = formatDate(value);
  return formatted || value;
}

export default function Backlog({
  items, loading, canWrite, selectedId, filter, onFilterChange, counts, onSelect, onDragStartItem, onDropUnschedule, onDragOver, dropActive,
}: BacklogProps) {
  const emptyText =
    filter === 'planned'
      ? 'Inga inplanerade jobb än.'
      : filter === 'unplanned'
        ? counts.planned > 0
          ? 'Alla jobb är inplanerade. 🎉'
          : 'Inga arbetsordrar att planera. Skapa en order i CRM:et så dyker den upp här.'
        : 'Inga arbetsordrar att planera. Skapa en order i CRM:et så dyker den upp här.';
  return (
    <section
      className={cn(
        crm.card,
        // Sticky on desktop so the backlog follows the board down — no scrolling back up to grab a
        // card when planning a job on a later week. Capped under viewport height with its own scroll.
        'flex max-h-[calc(100dvh-220px)] flex-col lg:sticky lg:top-3 lg:self-start',
        dropActive && 'ring-2 ring-rose-300',
      )}
      onDragOver={onDragOver}
      onDrop={onDropUnschedule}
    >
      <div className="flex items-center justify-between px-3.5 pb-2 pt-3.5">
        <h2 className={crm.sectionTitle}>Att planera</h2>
        <span className="text-[11px] tabular-nums text-slate-400">{items.length} st</span>
      </div>

      {/* Filter — defaults to "Oplanerade" so scheduled jobs don't clutter the backlog. */}
      <div className="flex gap-1 px-3.5 pb-2.5">
        {FILTER_TABS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => onFilterChange(key)}
            className={cn(
              'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] font-bold transition',
              filter === key ? 'border-[#1a3f26] bg-[#1a3f26] text-white' : 'border-[#e0e8dc] bg-white text-slate-500 hover:border-[#c8d4c3]',
            )}
          >
            {label}
            <span className={cn('tabular-nums', filter === key ? 'text-white/70' : 'text-slate-400')}>{counts[key]}</span>
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-3">
        {loading ? (
          <p className="py-6 text-center text-sm text-slate-400">Laddar…</p>
        ) : items.length === 0 ? (
          <p className="px-2 py-6 text-center text-sm text-slate-400">{emptyText}</p>
        ) : (
          <div className="grid gap-2">
            {items.map((item) => {
              const isSelected = item.id === selectedId;
              return (
                  <div
                    key={item.id}
                    role="button"
                    tabIndex={0}
                    draggable={canWrite}
                    onDragStart={(e) => onDragStartItem(e, item)}
                    onClick={() => canWrite && onSelect(item.id)}
                    onKeyDown={(e) => {
                      if ((e.key === 'Enter' || e.key === ' ') && canWrite) {
                        e.preventDefault();
                        onSelect(item.id);
                      }
                    }}
                    className={cn(
                      'relative rounded-xl border bg-white p-2.5 pl-3.5 text-left shadow-[0_1px_2px_rgba(20,44,27,0.06)] transition',
                      isSelected ? 'border-emerald-400 ring-2 ring-emerald-500/20' : 'border-[#e0e8dc] hover:border-[#c8d4c3]',
                      canWrite ? 'cursor-grab active:cursor-grabbing' : 'cursor-default',
                    )}
                  >
                    <span className={cn('absolute bottom-2.5 left-0 top-2.5 w-[3px] rounded-full', statusMeta(item.status).rail)} />
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-[11px] font-bold text-slate-900">{item.project_name}</span>
                      <JobRef job={item} />
                    </div>
                    <div className="mt-0.5 text-[10px] text-slate-500">{item.client_name}</div>
                    {item.address && (
                      <div className="flex items-center gap-1 text-[9.5px] text-slate-400">
                        <span className="truncate">{item.address}</span>
                        <MapLink address={item.address} />
                      </div>
                    )}
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <SackBadge sacks={item.total_sacks} />
                      {item.segment_count > 0 && (
                        <span className="whitespace-nowrap rounded-full border border-violet-200 bg-violet-50 px-2 py-px text-[10px] font-bold text-violet-700">
                          {item.segment_count} placering{item.segment_count > 1 ? 'ar' : ''}
                        </span>
                      )}
                      {item.desired_installation_date && (
                        <span className="whitespace-nowrap rounded-full border border-sky-200 bg-sky-50 px-2 py-px text-[10px] font-bold text-sky-700">
                          Önskat {shortDate(item.desired_installation_date)}
                        </span>
                      )}
                      <span className={cn('whitespace-nowrap rounded-full border px-2 py-px text-[10px] font-bold', statusMeta(item.status).pill)}>
                        {statusMeta(item.status).label}
                      </span>
                    </div>
                  </div>
              );
            })}
          </div>
        )}
      </div>

      {canWrite && (
        <p className="border-t border-[#e8efe5] px-3.5 py-2 text-[10px] text-slate-400">
          Dra ett kort till schemat för att planera — eller dra ett planerat jobb hit för att avplanera.
        </p>
      )}
    </section>
  );
}
