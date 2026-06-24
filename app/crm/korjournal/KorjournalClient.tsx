"use client";

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useToast } from '@/lib/Toast';
import { cn } from '@/lib/shared/cn';
import { groupTripsByMonth, tripOverview } from '@/lib/domains/korjournal/calculations';
import { todayISO } from '@/lib/domains/korjournal/format';
import { bestFavoriteForPrefix, bumpUsage as applyBumpUsage, EMPTY_USAGE, topAddresses } from '@/lib/domains/korjournal/favorites';
import { csvFileName, incompleteTripsForExport, serializeTripsCsv } from '@/lib/domains/korjournal/csv';
import { mapTripRow } from '@/lib/domains/korjournal/types';
import type { Trip, TripRow, UsageStats } from '@/lib/domains/korjournal/types';
import CrmModal from '../components/CrmModal';
import { crm } from '../lib/crmTokens';
import KorjournalOverview from './components/KorjournalOverview';
import KorjournalMonthGroup from './components/KorjournalMonthGroup';
import KorjournalTripModal, { type TripForm } from './components/KorjournalTripModal';

// localStorage keys are intentionally unchanged so existing users keep their
// offline cache and address favourites.
const STORAGE_KEY = 'korjournal.trips.v1';
const USAGE_KEY = 'korjournal.usage.v1';

const emptyForm = (): TripForm => ({ date: todayISO(), startAddress: '', endAddress: '', startKm: '', endKm: '', note: '' });

type ConfirmState = { kind: 'delete'; trip: Trip } | { kind: 'clear-favorites' } | null;

export default function KorjournalClient() {
  const toast = useToast();

  const [trips, setTrips] = useState<Trip[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<TripForm>(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [editing, setEditing] = useState<Trip | null>(null);
  const [locating, setLocating] = useState<{ start?: boolean; end?: boolean }>({});
  const [isSaving, setIsSaving] = useState(false);
  const [usageStats, setUsageStats] = useState<UsageStats>(EMPTY_USAGE);
  const [usageReady, setUsageReady] = useState(false);
  const [suggestMenu, setSuggestMenu] = useState<null | 'start' | 'end'>(null);
  const [confirm, setConfirm] = useState<ConfirmState>(null);

  // Load usage stats first (so we don't overwrite favourites with defaults),
  // then trips from the API with a localStorage fallback.
  useEffect(() => {
    (async () => {
      try {
        const uRaw = localStorage.getItem(USAGE_KEY);
        if (uRaw) setUsageStats(JSON.parse(uRaw));
      } catch { /* ignore */ }
      setUsageReady(true);

      try {
        const res = await fetch('/api/korjournal/trips', { cache: 'no-store' });
        if (res.ok) {
          const j = await res.json();
          const list = ((j.trips || []) as TripRow[]).map(mapTripRow);
          setTrips(list);
          try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list)); } catch { /* ignore */ }
          return;
        }
      } catch { /* ignore */ }

      try { const raw = localStorage.getItem(STORAGE_KEY); if (raw) setTrips(JSON.parse(raw)); } catch { /* ignore */ }
    })();
  }, []);

  // Cache trips for offline fallback.
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(trips)); } catch { /* ignore */ }
  }, [trips]);

  // Persist usage stats once loaded.
  useEffect(() => {
    if (!usageReady) return;
    try { localStorage.setItem(USAGE_KEY, JSON.stringify(usageStats)); } catch { /* ignore */ }
  }, [usageStats, usageReady]);

  const topStarts = useMemo(() => topAddresses(usageStats.startCounts), [usageStats.startCounts]);
  const topEnds = useMemo(() => topAddresses(usageStats.endCounts), [usageStats.endCounts]);

  const bumpUsage = useCallback((trip: Pick<Trip, 'startAddress' | 'endAddress'>) => {
    setUsageStats((prev) => applyBumpUsage(prev, trip));
  }, []);

  const startAuto = useMemo(() => bestFavoriteForPrefix(form.startAddress, usageStats.startCounts), [form.startAddress, usageStats.startCounts]);
  const endAuto = useMemo(() => bestFavoriteForPrefix(form.endAddress, usageStats.endCounts), [form.endAddress, usageStats.endCounts]);

  const monthlyGroups = useMemo(() => groupTripsByMonth(trips), [trips]);
  const overview = useMemo(() => tripOverview(trips, usageStats), [trips, usageStats]);
  const latestTrip = trips[0] || null;

  const onField = useCallback((patch: Partial<TripForm>) => setForm((f) => ({ ...f, ...patch })), []);
  const resetForm = () => { setForm(emptyForm()); setError(null); };
  const closeModal = () => { setOpen(false); setSuggestMenu(null); setEditing(null); setIsSaving(false); };

  const openNew = () => { setForm(emptyForm()); setError(null); setSuggestMenu(null); setEditing(null); setOpen(true); };
  const openEdit = (t: Trip) => {
    setForm({
      date: t.date,
      startAddress: t.startAddress,
      endAddress: t.endAddress,
      startKm: t.startKm == null ? '' : String(t.startKm),
      endKm: t.endKm == null ? '' : String(t.endKm),
      note: t.note || '',
    });
    setEditing(t);
    setError(null);
    setSuggestMenu(null);
    setOpen(true);
  };

  const submit = async () => {
    if (isSaving) return;
    setError(null);

    const startKm = form.startKm === '' ? null : Number(form.startKm);
    const endKm = form.endKm === '' ? null : Number(form.endKm);
    if (form.startKm !== '' && !Number.isFinite(startKm as number)) { setError('Ogiltig start-kilometer.'); return; }
    if (form.endKm !== '' && !Number.isFinite(endKm as number)) { setError('Ogiltig slut-kilometer.'); return; }
    // Allow drafts: end km may be empty or 0. Only check when both are filled and end != 0.
    if (startKm !== null && endKm !== null && endKm !== 0 && endKm < startKm) {
      setError('Slut-kilometer kan inte vara mindre än start-kilometer.');
      return;
    }

    setIsSaving(true);
    const payload = {
      date: form.date || todayISO(),
      startAddress: form.startAddress.trim(),
      endAddress: form.endAddress.trim(),
      startKm,
      endKm,
      note: String(form.note || '').trim() || undefined,
    };
    try {
      const url = editing ? `/api/korjournal/trips/${editing.id}` : '/api/korjournal/trips';
      const res = await fetch(url, {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error || 'Misslyckades att spara');
      const row = j.trip as TripRow | undefined;
      if (!row) throw new Error('Misslyckades att spara');
      const saved = mapTripRow(row);
      setTrips((prev) => {
        const next = editing ? prev.map((p) => (p.id === saved.id ? saved : p)) : [saved, ...prev];
        return next.sort((a, b) => b.date.localeCompare(a.date));
      });
      bumpUsage(saved);
      closeModal();
    } catch (e: any) {
      setError(e?.message || 'Kunde inte spara resan');
    } finally {
      setIsSaving(false);
    }
  };

  const fillAddress = async (which: 'start' | 'end') => {
    if (!('geolocation' in navigator)) {
      toast.error('Platstjänster stöds inte på den här enheten.');
      return;
    }
    setLocating((s) => ({ ...s, [which]: true }));
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
      });
      const res = await fetch(
        `/api/geocode/reverse?lat=${encodeURIComponent(pos.coords.latitude)}&lon=${encodeURIComponent(pos.coords.longitude)}`,
        { cache: 'no-store' },
      );
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error || 'Kunde inte hämta adress');
      onField(which === 'start' ? { startAddress: j.address } : { endAddress: j.address });
    } catch (e: any) {
      toast.error(e?.message || 'Kunde inte hämta din plats');
    } finally {
      setLocating((s) => ({ ...s, [which]: false }));
    }
  };

  const requestDelete = (id: string) => {
    const trip = trips.find((t) => t.id === id);
    if (trip) setConfirm({ kind: 'delete', trip });
  };

  const performDelete = async () => {
    if (confirm?.kind !== 'delete') return;
    const id = confirm.trip.id;
    try {
      const res = await fetch(`/api/korjournal/trips/${id}`, { method: 'DELETE' });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error || 'Misslyckades att ta bort');
      setTrips((prev) => prev.filter((t) => t.id !== id));
      setConfirm(null);
      toast.success('Resan togs bort');
    } catch (e: any) {
      toast.error(e?.message || 'Kunde inte ta bort resan');
    }
  };

  const performClearFavorites = () => {
    setUsageStats(EMPTY_USAGE);
    try { localStorage.removeItem(USAGE_KEY); } catch { /* ignore */ }
    setConfirm(null);
    toast.success('Favoriter rensade');
  };

  const exportMonth = (ym: string, arr: Trip[]) => {
    const incomplete = incompleteTripsForExport(arr);
    if (incomplete.length > 0) {
      toast.error(`Det finns ${incomplete.length} rader med saknad information (km). Komplettera innan export.`);
      return;
    }
    try {
      setIsExporting(true);
      const blob = new Blob([serializeTripsCsv(ym, arr)], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = csvFileName(ym);
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <section className="grid grid-cols-1 gap-4">
      <KorjournalOverview
        overview={overview}
        latestTrip={latestTrip}
        hasFavorites={topStarts.length > 0 || topEnds.length > 0}
        onAdd={openNew}
        onClearFavorites={() => setConfirm({ kind: 'clear-favorites' })}
      />

      {monthlyGroups.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 px-6 py-10 text-center text-sm text-slate-400">
          Inga resor ännu. Lägg till första resan för att börja bygga upp körjournalen.
        </div>
      ) : null}

      {monthlyGroups.map(([ym, arr]) => (
        <KorjournalMonthGroup
          key={ym}
          ym={ym}
          trips={arr}
          isExporting={isExporting}
          onExport={exportMonth}
          onEdit={openEdit}
          onDelete={requestDelete}
        />
      ))}

      {open ? (
        <KorjournalTripModal
          editing={!!editing}
          error={error}
          isSaving={isSaving}
          form={form}
          onField={onField}
          onClose={closeModal}
          onSubmit={submit}
          onReset={resetForm}
          startAuto={startAuto}
          endAuto={endAuto}
          topStarts={topStarts}
          topEnds={topEnds}
          usageStats={usageStats}
          suggestMenu={suggestMenu}
          setSuggestMenu={setSuggestMenu}
          locating={locating}
          onFillLocation={fillAddress}
        />
      ) : null}

      {confirm ? (
        <CrmModal
          onClose={() => setConfirm(null)}
          ariaLabel={confirm.kind === 'delete' ? 'Ta bort resa' : 'Rensa favoriter'}
          maxWidth="sm:max-w-[440px]"
          header={
            <div className="grid gap-1">
              <span className={crm.sectionTitle}>{confirm.kind === 'delete' ? 'Ta bort' : 'Favoriter'}</span>
              <strong className="text-lg font-bold tracking-tight text-slate-900">
                {confirm.kind === 'delete' ? 'Ta bort resa' : 'Rensa favoriter'}
              </strong>
            </div>
          }
          footer={
            <>
              <button type="button" onClick={() => setConfirm(null)} className={cn(crm.ghostButton, 'flex-1 sm:flex-none')}>
                Avbryt
              </button>
              {confirm.kind === 'delete' ? (
                <button
                  type="button"
                  onClick={performDelete}
                  className="inline-flex h-9 flex-1 items-center justify-center rounded-lg bg-rose-600 px-4 text-[13px] font-semibold text-white transition hover:bg-rose-700 sm:ml-auto sm:flex-none"
                >
                  Ta bort
                </button>
              ) : (
                <button
                  type="button"
                  onClick={performClearFavorites}
                  className={cn(crm.formButton, 'flex-1 sm:ml-auto sm:flex-none')}
                  style={{ backgroundColor: 'var(--crm-primary)' }}
                >
                  Rensa
                </button>
              )}
            </>
          }
        >
          {confirm.kind === 'delete' ? (
            <p className="m-0 text-sm leading-6 text-slate-600">
              Ta bort resan{' '}
              <strong className="font-semibold text-slate-900">
                {confirm.trip.startAddress} → {confirm.trip.endAddress}
              </strong>
              ? Det går inte att ångra.
            </p>
          ) : (
            <p className="m-0 text-sm leading-6 text-slate-600">
              Rensa lokala favoritadresser? Detta påverkar bara den här webbläsaren.
            </p>
          )}
        </CrmModal>
      ) : null}
    </section>
  );
}
