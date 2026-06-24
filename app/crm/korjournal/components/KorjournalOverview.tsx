"use client";

import { cn } from '@/lib/shared/cn';
import { formatTripDate } from '@/lib/domains/korjournal/format';
import type { TripOverview } from '@/lib/domains/korjournal/calculations';
import type { Trip } from '@/lib/domains/korjournal/types';

type Props = {
  overview: TripOverview;
  latestTrip: Trip | null;
  hasFavorites: boolean;
  onAdd: () => void;
  onClearFavorites: () => void;
};

const statCard = 'grid gap-1 rounded-2xl border border-[#e0e8dc] bg-[#f9fbf7] px-3.5 py-3';
const statLabel = 'text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400';
const statValue = 'text-xl font-bold text-slate-900 tabular-nums';
const infoCard = 'grid gap-1 rounded-2xl border border-[#e0e8dc] bg-[#f9fbf7] px-3.5 py-3';

export default function KorjournalOverview({ overview, latestTrip, hasFavorites, onAdd, onClearFavorites }: Props) {
  return (
    <div className="grid grid-cols-1 gap-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="m-0 text-lg font-bold tracking-tight text-slate-900">Körjournal</h1>
          <p className="m-0 mt-1 text-sm text-slate-500">
            Registrera och följ upp resor
            {overview.incompleteTrips > 0 ? (
              <span className="ml-2 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                {overview.incompleteTrips} kräver komplettering
              </span>
            ) : null}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {hasFavorites ? (
            <button
              type="button"
              onClick={onClearFavorites}
              className="inline-flex h-8 items-center justify-center rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-800"
              title="Rensa lokala favoritadresser"
            >
              Rensa favoriter
            </button>
          ) : null}
          <button
            type="button"
            onClick={onAdd}
            className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm font-semibold text-white transition hover:opacity-90"
            style={{ backgroundColor: 'var(--crm-primary)' }}
          >
            + Lägg till resa
          </button>
        </div>
      </div>

      <div className="grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(160px,1fr))]">
        <div className={statCard}>
          <span className={statLabel}>Totala kilometer</span>
          <strong className={statValue}>{overview.totalKm.toLocaleString('sv-SE')} km</strong>
        </div>
        <div className={statCard}>
          <span className={statLabel}>Resor</span>
          <strong className={statValue}>{overview.totalTrips}</strong>
        </div>
        <div className={statCard}>
          <span className={statLabel}>Anteckningar</span>
          <strong className={statValue}>{overview.noteTrips}</strong>
        </div>
        <div
          className={cn(
            statCard,
            overview.incompleteTrips > 0 && 'border-amber-200 bg-amber-50',
          )}
        >
          <span className={cn(statLabel, overview.incompleteTrips > 0 && 'text-amber-700')}>Komplettera</span>
          <strong className={cn(statValue, overview.incompleteTrips > 0 && 'text-amber-700')}>{overview.incompleteTrips}</strong>
        </div>
      </div>

      <div className="grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(260px,1fr))]">
        <div className={infoCard}>
          <strong className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Senaste registrerade resa</strong>
          {latestTrip ? (
            <>
              <span className="text-sm font-semibold text-slate-900">{formatTripDate(latestTrip.date)}</span>
              <span className="text-[13px] text-slate-500">{latestTrip.startAddress} till {latestTrip.endAddress}</span>
            </>
          ) : (
            <span className="text-[13px] text-slate-400">Ingen resa registrerad ännu.</span>
          )}
        </div>
        <div className={infoCard}>
          <strong className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Lokala favoriter</strong>
          <span className="text-sm font-semibold text-slate-900">{overview.favoriteCount}</span>
          <span className="text-[13px] text-slate-500">Baserat på ofta använda start- och slutadresser för snabbare ifyllnad.</span>
        </div>
      </div>
    </div>
  );
}
