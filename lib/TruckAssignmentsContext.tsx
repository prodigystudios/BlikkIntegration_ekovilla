"use client";
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { TruckAssignment, normalizeAssignments, resolveCrewForDay, ResolvedCrew, getAssignmentsWindowStart, getAssignmentsWindowEnd } from './truckAssignments';

export type TruckAssignmentsState = {
  assignments: TruckAssignment[];
  loading: boolean;
  error?: string | null;
  resolveCrew: (truckId: string, dayISO: string) => ResolvedCrew;
  reload: (opts?: { from?: string; to?: string }) => Promise<void>;
};

const Ctx = createContext<TruckAssignmentsState | undefined>(undefined);

export function TruckAssignmentsProvider({ children, from, to }: { children: React.ReactNode; from?: string; to?: string }) {
  const [assignments, setAssignments] = useState<TruckAssignment[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const todayISO = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const defaultFrom = useMemo(() => from ?? getAssignmentsWindowStart(todayISO, 60), [from, todayISO]);
  const defaultTo = useMemo(() => to ?? getAssignmentsWindowEnd(todayISO, 180), [to, todayISO]);

  async function reload(opts?: { from?: string; to?: string }) {
    setLoading(true);
    setError(null);
    try {
      const url = new URL('/api/planning/truck-assignments', window.location.origin);
      url.searchParams.set('from', opts?.from ?? defaultFrom);
      url.searchParams.set('to', opts?.to ?? defaultTo);
      const res = await fetch(url.toString());
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
      setAssignments(normalizeAssignments((json?.assignments ?? []) as TruckAssignment[]));
    } catch (e: any) {
      setError(e?.message ?? 'Unknown error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultFrom, defaultTo]);

  const resolveCrew = (truckId: string, dayISO: string): ResolvedCrew => {
    return resolveCrewForDay(truckId, dayISO, assignments);
  };

  const value: TruckAssignmentsState = {
    assignments,
    loading,
    error,
    resolveCrew,
    reload,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTruckAssignments() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useTruckAssignments must be used within TruckAssignmentsProvider');
  return ctx;
}
