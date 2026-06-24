"use client";

import { cn } from '@/lib/shared/cn';
import { isComplete, monthKm } from '@/lib/domains/korjournal/calculations';
import { formatMonthLabel } from '@/lib/domains/korjournal/format';
import { crm } from '../../lib/crmTokens';
import type { Trip } from '@/lib/domains/korjournal/types';
import KorjournalTripList from './KorjournalTripList';

type Props = {
  ym: string;
  trips: Trip[];
  isExporting: boolean;
  onExport: (ym: string, trips: Trip[]) => void;
  onEdit: (trip: Trip) => void;
  onDelete: (id: string) => void;
};

const chip = 'inline-flex items-center rounded-full border border-[#e0e8dc] bg-white px-2.5 py-0.5 text-[11px] font-semibold text-slate-600';
const miniStat = 'grid gap-0.5 rounded-xl border border-[#e3e9df] bg-white px-3 py-2.5';
const miniLabel = 'text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400';
const miniValue = 'text-sm font-bold text-slate-900 tabular-nums';

export default function KorjournalMonthGroup({ ym, trips, isExporting, onExport, onEdit, onDelete }: Props) {
  const km = monthKm(trips);
  const completeCount = trips.filter(isComplete).length;
  const noteCount = trips.filter((t) => String(t.note || '').trim()).length;
  const hasIncomplete = trips.some((t) => !isComplete(t));

  return (
    <section className={cn(crm.card, 'overflow-hidden')}>
      <div className="grid gap-3 border-b border-[#e0e8dc] bg-[#f6f9f3] px-3.5 py-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="grid gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <strong className="text-base font-bold capitalize tracking-tight text-slate-900">{formatMonthLabel(ym)}</strong>
              <span className={chip}>{trips.length} resor</span>
              <span className={chip}>{km.toLocaleString('sv-SE')} km</span>
              {hasIncomplete ? (
                <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-[11px] font-semibold text-amber-700" title="Ofullständig information: fyll i start/slut km">
                  Behöver kompletteras
                </span>
              ) : null}
            </div>
          </div>
          <button
            type="button"
            className={crm.ghostButton}
            disabled={isExporting}
            onClick={() => onExport(ym, trips)}
          >
            Exportera månad (CSV)
          </button>
        </div>

        <div className="grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(140px,1fr))]">
          <div className={miniStat}>
            <span className={miniLabel}>Körda kilometer</span>
            <strong className={miniValue}>{km.toLocaleString('sv-SE')} km</strong>
          </div>
          <div className={miniStat}>
            <span className={miniLabel}>Kompletta rader</span>
            <strong className={miniValue}>{completeCount}</strong>
          </div>
          <div className={miniStat}>
            <span className={miniLabel}>Anteckningar</span>
            <strong className={miniValue}>{noteCount}</strong>
          </div>
        </div>
      </div>

      <KorjournalTripList trips={trips} onEdit={onEdit} onDelete={onDelete} />
    </section>
  );
}
