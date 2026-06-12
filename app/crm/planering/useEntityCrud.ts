'use client';

import { useEffect, useState } from 'react';
import { useToast } from '@/lib/Toast';

type WithId = { id: string };

// Shared CRUD-over-a-REST-collection for the planning management modals (bilar/jobbtyper/depåer).
// Each modal owns its field-row JSX + "add new" form; this owns the duplicated machine:
// load(no-store) → list state, optimistic patchLocal, save (PATCH /{id}), remove (DELETE /{id}),
// add (POST), plus loading/busy and the {ok,data,error} envelope handling + toasts.
//
// save/remove/add resolve to a success signal so the caller can fire its own onChanged() refresh.
export function useEntityCrud<T extends WithId>(opts: {
  api: string; // collection endpoint, e.g. /api/crm/planering/trucks
  listKey: string; // key under {data} holding the array, e.g. 'trucks'
  itemKey?: string; // key under {data} for a created row (default 'item')
  toPayload: (item: T) => unknown; // PATCH body built from an edited row
  labels?: { saved?: string; saveFail?: string; removeFail?: string; addFail?: string };
}) {
  const toast = useToast();
  const itemKey = opts.itemKey ?? 'item';
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    fetch(opts.api, { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => {
        if (active && j.ok) setItems(j.data[opts.listKey] as T[]);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.api]);

  function patchLocal(id: string, patch: Partial<T>) {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }

  async function save(item: T): Promise<boolean> {
    setBusy(true);
    try {
      const r = await fetch(`${opts.api}/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(opts.toPayload(item)),
      });
      const j = await r.json();
      if (!j.ok) {
        toast.error(j.error || opts.labels?.saveFail || 'Kunde inte spara');
        return false;
      }
      toast.success(opts.labels?.saved || 'Sparad');
      return true;
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string): Promise<boolean> {
    setBusy(true);
    try {
      const r = await fetch(`${opts.api}/${id}`, { method: 'DELETE' });
      const j = await r.json();
      if (!j.ok) {
        toast.error(j.error || opts.labels?.removeFail || 'Kunde inte ta bort');
        return false;
      }
      setItems((prev) => prev.filter((it) => it.id !== id));
      return true;
    } finally {
      setBusy(false);
    }
  }

  async function add(payload: unknown): Promise<T | null> {
    setBusy(true);
    try {
      const r = await fetch(opts.api, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const j = await r.json();
      if (!j.ok) {
        toast.error(j.error || opts.labels?.addFail || 'Kunde inte lägga till');
        return null;
      }
      const created = j.data[itemKey] as T;
      setItems((prev) => [...prev, created]);
      return created;
    } finally {
      setBusy(false);
    }
  }

  return { items, setItems, loading, busy, patchLocal, save, remove, add };
}
