"use client";

import { cn } from '@/lib/shared/cn';
import CrmModal from '../../components/CrmModal';
import { crm } from '../../lib/crmTokens';
import type { UsageStats } from '@/lib/domains/korjournal/types';
import KorjournalAddressField from './KorjournalAddressField';

export type TripForm = {
  date: string;
  startAddress: string;
  endAddress: string;
  startKm: string;
  endKm: string;
  note: string;
};

type Props = {
  editing: boolean;
  error: string | null;
  isSaving: boolean;
  form: TripForm;
  onField: (patch: Partial<TripForm>) => void;
  onClose: () => void;
  onSubmit: () => void;
  onReset: () => void;
  // Address-field wiring
  startAuto: string | null;
  endAuto: string | null;
  topStarts: string[];
  topEnds: string[];
  usageStats: UsageStats;
  suggestMenu: null | 'start' | 'end';
  setSuggestMenu: (menu: null | 'start' | 'end') => void;
  locating: { start?: boolean; end?: boolean };
  onFillLocation: (which: 'start' | 'end') => void;
};

export default function KorjournalTripModal({
  editing,
  error,
  isSaving,
  form,
  onField,
  onClose,
  onSubmit,
  onReset,
  startAuto,
  endAuto,
  topStarts,
  topEnds,
  usageStats,
  suggestMenu,
  setSuggestMenu,
  locating,
  onFillLocation,
}: Props) {
  return (
    <CrmModal
      onClose={onClose}
      ariaLabel={editing ? 'Redigera resa' : 'Ny resa'}
      maxWidth="sm:max-w-[720px]"
      header={
        <div className="grid gap-1">
          <span className={crm.sectionTitle}>{editing ? 'Redigera resa' : 'Ny resa'}</span>
          <strong className="text-lg font-bold tracking-tight text-slate-900">
            {editing ? 'Uppdatera körningen' : 'Registrera ny körning'}
          </strong>
          <p className="m-0 text-sm text-slate-500">Fyll i resa, kilometer och anteckning.</p>
        </div>
      }
      footer={
        <>
          <button type="button" onClick={onReset} className={cn(crm.ghostButton, 'flex-1 sm:flex-none')}>
            Rensa
          </button>
          <button
            type="submit"
            form="korjournal-trip-form"
            disabled={isSaving}
            className={cn(crm.formButton, 'flex-1 sm:ml-auto sm:flex-none')}
            style={{ backgroundColor: 'var(--crm-primary)' }}
          >
            {isSaving ? 'Sparar…' : 'Spara resa'}
          </button>
        </>
      }
    >
      <form
        id="korjournal-trip-form"
        onSubmit={(e) => { e.preventDefault(); onSubmit(); }}
        className="grid gap-3.5"
      >
        {error ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-sm text-rose-700">{error}</div>
        ) : null}

        <label className="grid gap-1.5">
          <span className={crm.label}>Datum</span>
          <input
            type="date"
            className={crm.input}
            value={form.date}
            onChange={(e) => onField({ date: e.target.value })}
          />
        </label>

        <div className="grid gap-3.5 [grid-template-columns:repeat(auto-fit,minmax(260px,1fr))]">
          <KorjournalAddressField
            label="Startadress"
            value={form.startAddress}
            onChange={(value) => onField({ startAddress: value })}
            placeholder="Ex: Företagsgatan 1, Stockholm"
            auto={startAuto}
            onAcceptAuto={() => { if (startAuto) onField({ startAddress: startAuto }); }}
            favorites={topStarts}
            counts={usageStats.startCounts}
            menuTitle="Vanliga startadresser"
            onPickFavorite={(addr) => { onField({ startAddress: addr }); setSuggestMenu(null); }}
            menuOpen={suggestMenu === 'start'}
            onToggleMenu={() => setSuggestMenu(suggestMenu === 'start' ? null : 'start')}
            onCloseMenu={() => setSuggestMenu(null)}
            locating={!!locating.start}
            onFillLocation={() => onFillLocation('start')}
          />
          <KorjournalAddressField
            label="Slutadress"
            value={form.endAddress}
            onChange={(value) => onField({ endAddress: value })}
            placeholder="Ex: Kundvägen 5, Uppsala"
            auto={endAuto}
            onAcceptAuto={() => { if (endAuto) onField({ endAddress: endAuto }); }}
            favorites={topEnds}
            counts={usageStats.endCounts}
            menuTitle="Vanliga slutadresser"
            onPickFavorite={(addr) => { onField({ endAddress: addr }); setSuggestMenu(null); }}
            menuOpen={suggestMenu === 'end'}
            onToggleMenu={() => setSuggestMenu(suggestMenu === 'end' ? null : 'end')}
            onCloseMenu={() => setSuggestMenu(null)}
            locating={!!locating.end}
            onFillLocation={() => onFillLocation('end')}
          />
        </div>

        <div className="grid gap-3.5 [grid-template-columns:repeat(auto-fit,minmax(160px,1fr))]">
          <label className="grid gap-1.5">
            <span className={crm.label}>Start km</span>
            <input
              className={crm.input}
              inputMode="numeric"
              value={form.startKm}
              onChange={(e) => onField({ startKm: e.target.value })}
              placeholder="0"
            />
          </label>
          <label className="grid gap-1.5">
            <span className={crm.label}>Slut km</span>
            <input
              className={crm.input}
              inputMode="numeric"
              value={form.endKm}
              onChange={(e) => onField({ endKm: e.target.value })}
              placeholder="0"
            />
          </label>
        </div>

        <label className="grid gap-1.5">
          <span className={crm.label}>Anteckning</span>
          <textarea
            className="min-h-24 w-full resize-y rounded-lg border border-[#dce4d8] bg-white px-3 py-2 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15"
            value={form.note}
            onChange={(e) => onField({ note: e.target.value })}
            placeholder="Syfte med resan eller extra kontext"
            rows={4}
          />
        </label>
      </form>
    </CrmModal>
  );
}
