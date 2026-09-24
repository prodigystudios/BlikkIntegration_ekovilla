"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { useToast } from '@/lib/Toast';
import type { KmaDirectoryEntry } from '@/lib/domains/crm/kmaPlans/directory';
import type { WorkOrderCrewPerson } from '@/lib/domains/planning/workOrderCrew';
import type {
  SafetyRound,
  SafetyRoundAction,
  SafetyRoundBundle,
  SafetyRoundItem,
  SafetyRoundParticipant,
} from '@/lib/domains/safetyRounds/types';

// All datatrafik för EN skyddsrond. Samma arbetsfördelning som useKmaPlans: toasts bor HÄR, aldrig
// i komponenterna, och ett laddfel är ett eget läge — aldrig en tom rond.
//
// VARJE ÄNDRING SPARAS DIREKT (en PATCH per fält), så att en rond som avbryts mitt i — telefonen dör,
// någon ringer — inte förlorar något. Därför:
//   * Ändringen visas direkt (optimistiskt) och ersätts sedan av serverns rad.
//   * Två snabba ändringar på samma rad kan få sina svar i omvänd ordning. Varje rad har ett
//     löpnummer, och bara svaret på den SENASTE frågan får skriva tillbaka — annars hade ett äldre
//     svar rullat tillbaka det man just valde.
//   * Misslyckas en sparning läses hela ronden om. Att försöka backa en enskild ändring för hand
//     hade krockat med nästa ändring på samma rad; serverns läge är det enda säkra facit.

type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string; status: number; details?: unknown };

export type SafetyRoundSuggestions = {
  directory: KmaDirectoryEntry[];
  crew: WorkOrderCrewPerson[];
};

export type ChecklistCategory = { code: string; label: string };

type Loaded = SafetyRoundBundle & { canWrite: boolean; categories: ChecklistCategory[] };

async function call<T>(url: string, method: string, body?: unknown): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, {
      method,
      cache: 'no-store',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.ok) {
      return { ok: false, status: res.status, error: json?.error || 'Något gick fel.', details: json?.errorDetails?.details };
    }
    return { ok: true, data: json.data as T };
  } catch {
    return { ok: false, status: 0, error: 'Ingen kontakt med servern. Kontrollera uppkopplingen.' };
  }
}

function replaceById<T extends { id: string }>(list: T[], id: string, next: (row: T) => T): T[] {
  return list.map((row) => (row.id === id ? next(row) : row));
}

export function useSafetyRound(roundId: string) {
  const toast = useToast();
  const [data, setData] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pending, setPending] = useState(0);
  const [suggestions, setSuggestions] = useState<SafetyRoundSuggestions>({ directory: [], crew: [] });
  const base = `/api/safety-rounds/${roundId}`;

  const loadSeq = useRef(0);
  const rowSeq = useRef(new Map<string, number>());

  const refresh = useCallback(async () => {
    const seq = ++loadSeq.current;
    const result = await call<SafetyRoundBundle & { can_write: boolean; categories: ChecklistCategory[] }>(base, 'GET');
    if (seq !== loadSeq.current) return;
    if (!result.ok) {
      setLoadError(result.status === 404 ? 'Skyddsronden finns inte, eller så har du inte tillgång till den.' : result.error);
      setLoading(false);
      return;
    }
    const { round, participants, items, actions, can_write: canWrite, categories } = result.data;
    setData({ round, participants, items, actions, canWrite, categories: categories ?? [] });
    setLoadError(null);
    setLoading(false);
  }, [base]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Namnförslagen hämtas en gång, och bara när de kan användas (skrivnyckel + utkast).
  const wantsSuggestions = data?.canWrite === true && data.round.status === 'draft';
  useEffect(() => {
    if (!wantsSuggestions) return;
    let cancelled = false;
    void call<SafetyRoundSuggestions>(`${base}/suggestions`, 'GET').then((result) => {
      if (!cancelled && result.ok) setSuggestions(result.data);
    });
    return () => {
      cancelled = true;
    };
  }, [base, wantsSuggestions]);

  /**
   * Skickar en ändring på en rad. `key` identifierar raden för löpnumret. Svarar med serverns data,
   * eller null när frågan misslyckades eller blev omsprungen av en nyare fråga på samma rad.
   */
  const send = useCallback(
    async <T,>(key: string, url: string, method: string, body?: unknown): Promise<T | null> => {
      const seq = (rowSeq.current.get(key) ?? 0) + 1;
      rowSeq.current.set(key, seq);
      setPending((n) => n + 1);
      try {
        const result = await call<T>(url, method, body);
        if (!result.ok) {
          toast.error(result.error);
          await refresh();
          return null;
        }
        return rowSeq.current.get(key) === seq ? result.data : null;
      } finally {
        setPending((n) => n - 1);
      }
    },
    [refresh, toast],
  );

  // ── Rondinfo ──────────────────────────────────────────────────────────────

  const patchRound = useCallback(
    async (patch: Partial<SafetyRound>) => {
      setData((d) => (d ? { ...d, round: { ...d.round, ...patch } } : d));
      const res = await send<{ round: SafetyRound }>('round', base, 'PATCH', patch);
      if (res) setData((d) => (d ? { ...d, round: res.round } : d));
    },
    [base, send],
  );

  // ── Deltagare ─────────────────────────────────────────────────────────────

  const addParticipant = useCallback(
    async (input: Pick<SafetyRoundParticipant, 'name' | 'role'> & Partial<Pick<SafetyRoundParticipant, 'profile_id' | 'company'>>) => {
      const res = await send<{ participant: SafetyRoundParticipant }>(`participant:new:${Date.now()}`, `${base}/participants`, 'POST', input);
      if (res) setData((d) => (d ? { ...d, participants: [...d.participants, res.participant] } : d));
      return res !== null;
    },
    [base, send],
  );

  const patchParticipant = useCallback(
    async (id: string, patch: Partial<SafetyRoundParticipant>) => {
      setData((d) => (d ? { ...d, participants: replaceById(d.participants, id, (p) => ({ ...p, ...patch })) } : d));
      const res = await send<{ participant: SafetyRoundParticipant }>(`participant:${id}`, `${base}/participants/${id}`, 'PATCH', patch);
      if (res) setData((d) => (d ? { ...d, participants: replaceById(d.participants, id, () => res.participant) } : d));
    },
    [base, send],
  );

  const removeParticipant = useCallback(
    async (id: string) => {
      const res = await send<{ id: string }>(`participant:${id}`, `${base}/participants/${id}`, 'DELETE');
      if (res) setData((d) => (d ? { ...d, participants: d.participants.filter((p) => p.id !== id) } : d));
    },
    [base, send],
  );

  // ── Checklistan ───────────────────────────────────────────────────────────

  const patchItem = useCallback(
    async (id: string, patch: Partial<SafetyRoundItem>) => {
      setData((d) => (d ? { ...d, items: replaceById(d.items, id, (item) => ({ ...item, ...patch })) } : d));
      const res = await send<{ item: SafetyRoundItem }>(`item:${id}`, `${base}/items/${id}`, 'PATCH', patch);
      if (res) setData((d) => (d ? { ...d, items: replaceById(d.items, id, () => res.item) } : d));
    },
    [base, send],
  );

  const addCustomItem = useCallback(
    async (categoryCode: string, text: string) => {
      const res = await send<{ item: SafetyRoundItem }>(`item:new:${Date.now()}`, `${base}/items`, 'POST', { category_code: categoryCode, text });
      if (res) setData((d) => (d ? { ...d, items: [...d.items, res.item] } : d));
      return res !== null;
    },
    [base, send],
  );

  const removeCustomItem = useCallback(
    async (id: string) => {
      const res = await send<{ id: string }>(`item:${id}`, `${base}/items/${id}`, 'DELETE');
      // Åtgärder som pekade på punkten tappar kopplingen i databasen (on delete set null).
      if (res) {
        setData((d) =>
          d
            ? {
                ...d,
                items: d.items.filter((item) => item.id !== id),
                actions: d.actions.map((a) => (a.item_id === id ? { ...a, item_id: null } : a)),
              }
            : d,
        );
      }
    },
    [base, send],
  );

  // ── Handlingsplanen ───────────────────────────────────────────────────────

  const addAction = useCallback(
    async (input: Pick<SafetyRoundAction, 'finding'> & Partial<Pick<SafetyRoundAction, 'item_id' | 'risk'>>) => {
      const res = await send<{ action: SafetyRoundAction }>(`action:new:${Date.now()}`, `${base}/actions`, 'POST', input);
      if (res) setData((d) => (d ? { ...d, actions: [...d.actions, res.action] } : d));
      return res?.action ?? null;
    },
    [base, send],
  );

  const patchAction = useCallback(
    async (id: string, patch: Partial<SafetyRoundAction>) => {
      setData((d) => (d ? { ...d, actions: replaceById(d.actions, id, (a) => ({ ...a, ...patch })) } : d));
      const res = await send<{ action: SafetyRoundAction }>(`action:${id}`, `${base}/actions/${id}`, 'PATCH', patch);
      if (res) setData((d) => (d ? { ...d, actions: replaceById(d.actions, id, () => res.action) } : d));
    },
    [base, send],
  );

  const removeAction = useCallback(
    async (id: string) => {
      const res = await send<{ id: string }>(`action:${id}`, `${base}/actions/${id}`, 'DELETE');
      if (res) setData((d) => (d ? { ...d, actions: d.actions.filter((a) => a.id !== id) } : d));
    },
    [base, send],
  );

  // ── Ronden som helhet ─────────────────────────────────────────────────────

  const [completing, setCompleting] = useState(false);
  const complete = useCallback(async () => {
    setCompleting(true);
    try {
      const result = await call<{ round: SafetyRound }>(`${base}/complete`, 'POST');
      if (!result.ok) {
        toast.error(result.error);
        await refresh();
        return false;
      }
      toast.success('Ronden är slutförd');
      await refresh();
      return true;
    } finally {
      setCompleting(false);
    }
  }, [base, refresh, toast]);

  const [deleting, setDeleting] = useState(false);
  const deleteRound = useCallback(async () => {
    setDeleting(true);
    try {
      const result = await call<{ id: string }>(base, 'DELETE');
      if (!result.ok) {
        toast.error(result.error);
        await refresh();
        return false;
      }
      toast.success('Utkastet är borttaget');
      return true;
    } finally {
      setDeleting(false);
    }
  }, [base, refresh, toast]);

  return {
    data,
    loading,
    loadError,
    saving: pending > 0,
    suggestions,
    refresh,
    patchRound,
    addParticipant,
    patchParticipant,
    removeParticipant,
    patchItem,
    addCustomItem,
    removeCustomItem,
    addAction,
    patchAction,
    removeAction,
    completing,
    complete,
    deleting,
    deleteRound,
  };
}

export type SafetyRoundController = ReturnType<typeof useSafetyRound>;
