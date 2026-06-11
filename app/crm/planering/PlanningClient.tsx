'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useToast } from '@/lib/Toast';
import { crm } from '@/app/crm/lib/crmTokens';
import type { SchedulableWorkOrder, OpsTruck, OpsSegment } from '@/lib/domains/planning/types';

// ── small date helpers (UI-local; a richer planning date util comes with the redesign slice) ──
function startOfWeek(d: Date): Date {
  const x = new Date(d);
  const dow = (x.getDay() + 6) % 7; // 0 = Monday
  x.setDate(x.getDate() - dow);
  x.setHours(0, 0, 0, 0);
  return x;
}
function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function fmtISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function isoWeek(d: Date): number {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  return 1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * 24 * 3600 * 1000));
}

type WeekDay = { date: Date; iso: string; weekday: string; dayLabel: string; isWeekend: boolean; isToday: boolean };

export default function PlanningClient({ canWrite }: { canWrite: boolean }) {
  const toast = useToast();

  const [weekOffset, setWeekOffset] = useState(0);
  const [backlog, setBacklog] = useState<SchedulableWorkOrder[]>([]);
  const [trucks, setTrucks] = useState<OpsTruck[]>([]);
  const [segments, setSegments] = useState<OpsSegment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const todayISO = useMemo(() => fmtISO(new Date()), []);

  const weekDays = useMemo<WeekDay[]>(() => {
    const monday = addDays(startOfWeek(new Date()), weekOffset * 7);
    return Array.from({ length: 7 }, (_, i) => {
      const date = addDays(monday, i);
      const iso = fmtISO(date);
      return {
        date,
        iso,
        weekday: date.toLocaleDateString('sv-SE', { weekday: 'short' }),
        dayLabel: date.toLocaleDateString('sv-SE', { day: 'numeric', month: 'numeric' }),
        isWeekend: i >= 5,
        isToday: iso === todayISO,
      };
    });
  }, [weekOffset, todayISO]);

  const weekNo = useMemo(() => isoWeek(weekDays[0].date), [weekDays]);
  const fromISO = weekDays[0].iso;
  const toISO = weekDays[6].iso;

  const loadBacklog = useCallback(async () => {
    const r = await fetch('/api/crm/planering/backlog', { cache: 'no-store' });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'Kunde inte hämta arbetsordrar');
    setBacklog(j.data.items as SchedulableWorkOrder[]);
  }, []);

  const loadSchedule = useCallback(async (from: string, to: string) => {
    const r = await fetch(`/api/crm/planering/segments?from=${from}&to=${to}`, { cache: 'no-store' });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'Kunde inte hämta schemat');
    setSegments(j.data.segments as OpsSegment[]);
    setTrucks(j.data.trucks as OpsTruck[]);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([loadBacklog(), loadSchedule(fromISO, toISO)])
      .catch((e) => {
        if (!cancelled) setError(e?.message || 'Något gick fel');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fromISO, toISO, loadBacklog, loadSchedule]);

  const segmentsByTruckDay = useMemo(() => {
    const map = new Map<string, OpsSegment[]>();
    for (const seg of segments) {
      for (const wd of weekDays) {
        if (seg.start_day <= wd.iso && seg.end_day >= wd.iso) {
          const key = `${seg.truck_id}|${wd.iso}`;
          const list = map.get(key) ?? [];
          list.push(seg);
          map.set(key, list);
        }
      }
    }
    return map;
  }, [segments, weekDays]);

  const selected = useMemo(() => backlog.find((b) => b.id === selectedId) ?? null, [backlog, selectedId]);

  const place = useCallback(
    async (truckId: string, dayISO: string) => {
      if (!canWrite || !selectedId) return;
      const r = await fetch('/api/crm/planering/segments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ work_order_id: selectedId, truck_id: truckId, start_day: dayISO, end_day: dayISO }),
      });
      const j = await r.json();
      if (!j.ok) {
        toast.error(j.error || 'Kunde inte placera ordern');
        return;
      }
      toast.success('Order placerad i schemat');
      setSelectedId(null);
      try {
        await Promise.all([loadBacklog(), loadSchedule(fromISO, toISO)]);
      } catch {
        /* a transient refresh error shouldn't undo the toast; next nav reloads */
      }
    },
    [canWrite, selectedId, fromISO, toISO, loadBacklog, loadSchedule, toast],
  );

  return (
    <div>
      {/* Header */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className={crm.pageTitle}>Planering</h1>
          <p className={crm.pageSubtitle}>Schemalägg arbetsordrar på bilar.</p>
        </div>
        <div className="flex items-center gap-1.5">
          <button className={crm.ghostButton} onClick={() => setWeekOffset((o) => o - 1)} aria-label="Föregående vecka">
            ‹
          </button>
          <button className={crm.ghostButton} onClick={() => setWeekOffset(0)}>
            Idag
          </button>
          <button className={crm.ghostButton} onClick={() => setWeekOffset((o) => o + 1)} aria-label="Nästa vecka">
            ›
          </button>
          <span className="ml-1 rounded-lg border border-[#e0e8dc] bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600">
            v.{weekNo}
          </span>
        </div>
      </div>

      {/* Skeleton-stage banner */}
      <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
        Tidig version (Wave 7, skiva 1). Gamla planeringen ligger kvar orörd tills den nya är klar.
      </div>

      {error && (
        <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>
      )}

      <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        {/* Backlog */}
        <section className={`${crm.card} p-3`}>
          <div className="mb-2 flex items-center justify-between">
            <h2 className={crm.sectionTitle}>Att planera</h2>
            <span className="text-[11px] text-slate-400">{backlog.length} st</span>
          </div>

          {loading ? (
            <p className="py-6 text-center text-sm text-slate-400">Laddar…</p>
          ) : backlog.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-400">
              Inga arbetsordrar att planera. Skapa en order i CRM:et så dyker den upp här.
            </p>
          ) : (
            <ul className="grid gap-1.5">
              {backlog.map((item) => {
                const isSelected = item.id === selectedId;
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      disabled={!canWrite}
                      onClick={() => setSelectedId(isSelected ? null : item.id)}
                      className={`w-full rounded-xl border p-2.5 text-left transition ${
                        isSelected
                          ? 'border-emerald-400 bg-emerald-50 ring-2 ring-emerald-500/20'
                          : 'border-[#e0e8dc] bg-white hover:border-[#c8d4c3]'
                      } ${canWrite ? 'cursor-pointer' : 'cursor-default'}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[13px] font-bold text-slate-900">{item.project_name}</span>
                        <span className="shrink-0 text-[10px] font-semibold text-slate-400">{item.order_number}</span>
                      </div>
                      <div className="mt-0.5 text-[11px] text-slate-500">{item.client_name}</div>
                      {item.address && <div className="text-[11px] text-slate-400">{item.address}</div>}
                      <div className="mt-1 flex flex-wrap items-center gap-1">
                        {item.total_sacks > 0 && (
                          <span className={`${crm.badge} border-emerald-200 bg-emerald-50 text-emerald-700`}>
                            {item.total_sacks} säck
                          </span>
                        )}
                        {item.desired_installation_date && (
                          <span className={`${crm.badge} border-sky-200 bg-sky-50 text-sky-700`}>
                            Önskat {item.desired_installation_date}
                          </span>
                        )}
                        {item.segment_count > 0 && (
                          <span className={`${crm.badge} border-violet-200 bg-violet-50 text-violet-700`}>
                            {item.segment_count} placerad{item.segment_count === 1 ? '' : 'e'}
                          </span>
                        )}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {canWrite && selected && (
            <p className="mt-2 rounded-lg bg-emerald-50 px-2 py-1.5 text-[11px] text-emerald-700">
              <strong>{selected.project_name}</strong> vald — klicka en cell i schemat för att placera.
            </p>
          )}
        </section>

        {/* Schedule grid */}
        <section className={`${crm.card} overflow-x-auto p-3`}>
          <div className="min-w-[760px]">
            {/* Day header row */}
            <div className="grid grid-cols-[120px_repeat(7,minmax(96px,1fr))] gap-1">
              <div />
              {weekDays.map((wd) => (
                <div
                  key={wd.iso}
                  className={`rounded-lg px-1.5 py-1 text-center text-[11px] font-semibold ${
                    wd.isToday ? 'bg-emerald-100 text-emerald-800' : wd.isWeekend ? 'text-slate-400' : 'text-slate-600'
                  }`}
                >
                  <div className="capitalize">{wd.weekday}</div>
                  <div className="text-[10px] font-normal text-slate-400">{wd.dayLabel}</div>
                </div>
              ))}
            </div>

            {/* Truck rows */}
            {trucks.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-400">Inga bilar upplagda än.</p>
            ) : (
              <div className="mt-1 grid gap-1">
                {trucks.map((truck) => (
                  <div key={truck.id} className="grid grid-cols-[120px_repeat(7,minmax(96px,1fr))] gap-1">
                    <div className="flex items-center gap-1.5 rounded-lg bg-white px-2 py-1.5">
                      <span
                        className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: truck.color || '#94a3b8' }}
                      />
                      <span className="truncate text-[12px] font-semibold text-slate-700">{truck.name}</span>
                    </div>
                    {weekDays.map((wd) => {
                      const cell = segmentsByTruckDay.get(`${truck.id}|${wd.iso}`) ?? [];
                      const placeable = canWrite && !!selectedId;
                      return (
                        <button
                          key={wd.iso}
                          type="button"
                          disabled={!placeable}
                          onClick={() => place(truck.id, wd.iso)}
                          className={`min-h-[52px] rounded-lg border p-1 text-left align-top transition ${
                            wd.isWeekend ? 'border-slate-100 bg-slate-50/60' : 'border-[#e8efe5] bg-white'
                          } ${placeable ? 'cursor-pointer hover:border-emerald-400 hover:bg-emerald-50/40' : 'cursor-default'}`}
                        >
                          <div className="grid gap-0.5">
                            {cell.map((seg) => (
                              <span
                                key={seg.id}
                                className="block truncate rounded-md border border-[#dbe7d6] bg-[#f1f7ef] px-1.5 py-0.5 text-[10px] font-semibold text-slate-700"
                                title={`${seg.work_order?.order_number ?? ''} ${seg.work_order?.project_name ?? ''}`}
                              >
                                {seg.work_order?.project_name ?? seg.work_order?.order_number ?? 'Order'}
                              </span>
                            ))}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
