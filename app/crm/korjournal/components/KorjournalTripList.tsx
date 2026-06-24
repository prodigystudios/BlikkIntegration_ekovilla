"use client";

import { cn } from '@/lib/shared/cn';
import { diffKm, isComplete } from '@/lib/domains/korjournal/calculations';
import { formatTripDate } from '@/lib/domains/korjournal/format';
import type { Trip } from '@/lib/domains/korjournal/types';

type Props = {
  trips: Trip[];
  onEdit: (trip: Trip) => void;
  onDelete: (id: string) => void;
};

const COLS = '150px minmax(0,1fr) minmax(0,1fr) 84px 84px 80px 132px';
const editBtn =
  'inline-flex items-center justify-center rounded-lg px-2.5 py-1 text-xs font-semibold text-white transition hover:opacity-90';
const deleteBtn =
  'inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-600 transition hover:border-rose-300 hover:text-rose-600';

export default function KorjournalTripList({ trips, onEdit, onDelete }: Props) {
  return (
    <>
      {/* Desktop table */}
      <div className="hidden p-3.5 md:block">
        <div className="overflow-hidden rounded-xl border border-[#e3e9df]">
          <div
            className="grid bg-[#f6f9f3] px-3 py-2 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400"
            style={{ gridTemplateColumns: COLS }}
          >
            <div>Datum</div>
            <div>Startadress</div>
            <div>Slutadress</div>
            <div>Start km</div>
            <div>Slut km</div>
            <div>Distans</div>
            <div>Åtgärder</div>
          </div>
          {trips.map((t) => {
            const complete = isComplete(t);
            return (
              <div
                key={t.id}
                className={cn(
                  'grid items-center gap-1 border-t border-[#eef2ec] px-3 py-2 text-[13px] transition-colors',
                  complete ? 'bg-white hover:bg-[#f9fbf7]' : 'bg-amber-50/50',
                )}
                style={{ gridTemplateColumns: COLS }}
              >
                <div className="flex items-center gap-1.5 text-slate-700">
                  {!complete ? <span className="text-amber-500" title="Fyll i km-start och km-slut">▲</span> : null}
                  <span>{formatTripDate(t.date)}</span>
                </div>
                <div className="break-words pr-2 text-slate-700">{t.startAddress}</div>
                <div className="break-words pr-2 text-slate-700">{t.endAddress}</div>
                <div className="font-semibold text-slate-600 tabular-nums">{t.startKm ?? '—'}</div>
                <div className="font-semibold text-slate-600 tabular-nums">{t.endKm ?? '—'}</div>
                <div className="font-bold text-slate-900 tabular-nums">{diffKm(t)} km</div>
                <div className="flex flex-wrap gap-1.5">
                  <button type="button" className={editBtn} style={{ backgroundColor: 'var(--crm-primary)' }} onClick={() => onEdit(t)}>
                    Redigera
                  </button>
                  <button type="button" className={deleteBtn} onClick={() => onDelete(t.id)}>
                    Ta bort
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Mobile cards */}
      <div className="grid gap-2 p-3 md:hidden">
        {trips.map((t) => {
          const complete = isComplete(t);
          return (
            <div
              key={t.id}
              className={cn(
                'grid gap-2.5 rounded-xl border px-3 py-2.5 shadow-[0_1px_2px_rgba(15,23,42,0.05)]',
                complete ? 'border-[#e3e9df] bg-white' : 'border-amber-200 bg-amber-50/50',
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-sm font-bold text-slate-900">
                  {!complete ? <span className="text-amber-500" title="Fyll i km-start och km-slut">▲</span> : null}
                  {formatTripDate(t.date)}
                </span>
                <span className="inline-flex items-center rounded-full border border-[#e0e8dc] bg-[#f9fbf7] px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                  {diffKm(t)} km
                </span>
              </div>

              <div className="grid gap-1 rounded-lg border border-[#eef2ec] bg-[#f9fbf7] px-3 py-2">
                <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Rutt</div>
                <div className="text-[13px] font-semibold text-slate-900">{t.startAddress}</div>
                <div className="text-[11px] text-slate-400">till</div>
                <div className="text-[13px] font-semibold text-slate-900">{t.endAddress}</div>
              </div>

              <div className="flex flex-wrap gap-1.5 text-[11px]">
                <span className="inline-flex items-center rounded-full border border-[#e0e8dc] bg-white px-2 py-0.5 font-semibold text-slate-600">
                  Start: {t.startKm ?? '—'}
                </span>
                <span className="inline-flex items-center rounded-full border border-[#e0e8dc] bg-white px-2 py-0.5 font-semibold text-slate-600">
                  Slut: {t.endKm ?? '—'}
                </span>
              </div>

              {t.note ? (
                <div className="rounded-lg border border-[#eef2ec] bg-[#f9fbf7] px-3 py-2 text-[13px] text-slate-700">
                  <strong className="font-semibold">Anteckning:</strong> {t.note}
                </div>
              ) : null}

              <div className="flex flex-wrap gap-2">
                <button type="button" className={editBtn} style={{ backgroundColor: 'var(--crm-primary)' }} onClick={() => onEdit(t)}>
                  Redigera
                </button>
                <button type="button" className={deleteBtn} onClick={() => onDelete(t.id)}>
                  Ta bort
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
