"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { useToast } from '@/lib/Toast';
import type { KmaDirectoryEntry } from '@/lib/domains/crm/kmaPlans/directory';
import type { WorkOrderCrewPerson } from '@/lib/domains/planning/workOrderCrew';
import type {
  SafetyRound,
  SafetyRoundAction,
  SafetyRoundBundle,
  SafetyRoundItem,
  SafetyRoundParticipant,
  SafetyRoundPhoto,
} from '@/lib/domains/safetyRounds/types';
import { preparePhotoVariants } from '../_components/photoUpload';

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

/** Hur långt en punkts uppladdning kommit ("Sparar foto 2 av 3"). */
export type PhotoUploadProgress = { done: number; total: number };

export function useSafetyRound(roundId: string) {
  const toast = useToast();
  const supabase = useMemo(() => createClientComponentClient(), []);
  const [data, setData] = useState<Loaded | null>(null);
  // Fotonas signerade läs-URL:er, per foto-id. De gäller i 30 minuter — ronden hämtas om före det.
  const [photoUrls, setPhotoUrls] = useState<Record<string, string | null>>({});
  const [photoUploads, setPhotoUploads] = useState<Record<string, PhotoUploadProgress>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pending, setPending] = useState(0);
  const [suggestions, setSuggestions] = useState<SafetyRoundSuggestions>({ directory: [], crew: [] });
  const base = `/api/safety-rounds/${roundId}`;

  const loadSeq = useRef(0);
  const rowSeq = useRef(new Map<string, number>());
  // När fotonas URL:er senast signerades — se refreshPhotoUrls.
  const urlsSignedAt = useRef(Date.now());

  const refresh = useCallback(async () => {
    const seq = ++loadSeq.current;
    const result = await call<
      SafetyRoundBundle & { can_write: boolean; categories: ChecklistCategory[]; photo_urls: Record<string, string | null> }
    >(base, 'GET');
    if (seq !== loadSeq.current) return;
    if (!result.ok) {
      setLoadError(result.status === 404 ? 'Skyddsronden finns inte, eller så har du inte tillgång till den.' : result.error);
      setLoading(false);
      return;
    }
    const { round, participants, items, actions, photos, can_write: canWrite, categories, photo_urls: urls } = result.data;
    setData({ round, participants, items, actions, photos: photos ?? [], canWrite, categories: categories ?? [] });
    setPhotoUrls(urls ?? {});
    urlsSignedAt.current = Date.now();
    setLoadError(null);
    setLoading(false);
  }, [base]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Fotonas URL:er är signerade i 30 minuter, och en rond ligger ofta uppe längre än så (man går
  // runt på bygget). De förnyas när de börjar bli gamla — var 25:e minut, och när fliken kommer
  // tillbaka efter mer än 20.
  //
  // 🧨 BARA URL:ERNA, ALDRIG RONDEN. På en telefon göms fliken varje gång "+ Foto" öppnar kameran,
  // och en omläsning av hela ronden i det ögonblicket hade kunnat landa efter att fotot sparats —
  // och skrivit över det, liksom varje ändring som ännu var på väg. URL:erna slås ihop med de man
  // har; inget tas bort.
  const refreshPhotoUrls = useCallback(async () => {
    urlsSignedAt.current = Date.now();
    const result = await call<{ photo_urls: Record<string, string | null> }>(`${base}/photos`, 'GET');
    if (result.ok) setPhotoUrls((u) => ({ ...u, ...result.data.photo_urls }));
  }, [base]);

  const hasPhotos = (data?.photos.length ?? 0) > 0;
  useEffect(() => {
    if (!hasPhotos) return;
    const interval = setInterval(() => void refreshPhotoUrls(), 25 * 60 * 1000);
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - urlsSignedAt.current > 20 * 60 * 1000) void refreshPhotoUrls();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [hasPhotos, refreshPhotoUrls]);

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
      // Åtgärder som pekade på punkten tappar kopplingen i databasen (on delete set null), och
      // punktens foton kaskaderar bort med den.
      if (res) {
        setData((d) =>
          d
            ? {
                ...d,
                items: d.items.filter((item) => item.id !== id),
                actions: d.actions.map((a) => (a.item_id === id ? { ...a, item_id: null } : a)),
                photos: d.photos.filter((p) => p.item_id !== id),
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

  // ── Foton ─────────────────────────────────────────────────────────────────

  /**
   * Laddar upp valda bilder till en punkt, EN åt gången: numren blir i den ordning man valde dem, och
   * en telefon på bygget har sällan bandbredd för fler samtidigt. Tre steg per bild — förbered två
   * uppladdnings-URL:er, ladda upp båda varianterna direkt till lagringen, bekräfta. Ett fel på en
   * bild stoppar inte de andra; utfallet sägs i en toast efteråt.
   */
  const uploadPhotos = useCallback(
    async (itemId: string, files: File[]) => {
      if (files.length === 0) return;
      const total = files.length;
      let done = 0;
      const failures: string[] = [];
      setPhotoUploads((u) => ({ ...u, [itemId]: { done: 0, total } }));
      setPending((n) => n + 1);
      try {
        for (const file of files) {
          try {
            const variants = await preparePhotoVariants(file);
            const prepared = await call<{ bucket: string; full: { path: string; token: string }; print: { path: string; token: string } }>(
              `${base}/photos/upload-url`,
              'POST',
              { item_id: itemId },
            );
            if (!prepared.ok) throw new Error(prepared.error);
            const bucket = supabase.storage.from(prepared.data.bucket);
            const [full, print] = await Promise.all([
              bucket.uploadToSignedUrl(prepared.data.full.path, prepared.data.full.token, variants.full),
              bucket.uploadToSignedUrl(prepared.data.print.path, prepared.data.print.token, variants.print),
            ]);
            if (full.error || print.error) throw new Error('Uppladdningen avbröts. Kontrollera uppkopplingen och försök igen.');
            const confirmed = await call<{ photo: SafetyRoundPhoto; url: string | null }>(`${base}/photos`, 'POST', {
              item_id: itemId,
              storage_path: prepared.data.full.path,
            });
            if (!confirmed.ok) throw new Error(confirmed.error);
            const { photo, url } = confirmed.data;
            setData((d) => (d ? { ...d, photos: [...d.photos, photo] } : d));
            setPhotoUrls((u) => ({ ...u, [photo.id]: url }));
          } catch (e) {
            failures.push(e instanceof Error ? e.message : 'Fotot kunde inte sparas.');
          }
          done += 1;
          setPhotoUploads((u) => ({ ...u, [itemId]: { done, total } }));
        }
      } finally {
        setPending((n) => n - 1);
        setPhotoUploads((u) => {
          const { [itemId]: _finished, ...rest } = u;
          return rest;
        });
      }
      if (failures.length === 0) toast.success(total === 1 ? 'Fotot är sparat' : `${total} foton är sparade`);
      else if (failures.length === total) toast.error(failures[0]);
      else toast.error(`${failures.length} av ${total} foton kunde inte sparas. ${failures[0]}`);
    },
    [base, supabase, toast],
  );

  const removePhoto = useCallback(
    async (photoId: string) => {
      const res = await send<{ id: string }>(`photo:${photoId}`, `${base}/photos/${photoId}`, 'DELETE');
      if (res) setData((d) => (d ? { ...d, photos: d.photos.filter((p) => p.id !== photoId) } : d));
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
    photoUrls,
    photoUploads,
    uploadPhotos,
    removePhoto,
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
