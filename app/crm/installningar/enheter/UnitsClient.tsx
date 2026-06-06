"use client";

import { useState } from 'react';
import Link from 'next/link';
import { useToast } from '@/lib/Toast';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import DialogShell from '@/components/ui/DialogShell';
import EmptyState from '@/components/ui/EmptyState';
import type { FortnoxUnit } from '@/lib/domains/fortnox/units';

type UnitsClientProps = {
  initialUnits: FortnoxUnit[];
  fortnoxConnected: boolean;
};

async function apiRequest<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.ok) throw new Error(json?.error || `Begäran misslyckades (${res.status})`);
  return json.data as T;
}

export default function UnitsClient({ initialUnits, fortnoxConnected }: UnitsClientProps) {
  const toast = useToast();
  const [units, setUnits] = useState<FortnoxUnit[]>(initialUnits);
  const [busy, setBusy] = useState<null | 'save' | 'delete'>(null);

  // null = closed; { code: null } = create; { code: string } = edit.
  const [editing, setEditing] = useState<null | { code: string | null }>(null);
  const [form, setForm] = useState({ code: '', description: '' });
  const [confirmDelete, setConfirmDelete] = useState<FortnoxUnit | null>(null);

  async function refresh() {
    const data = await apiRequest<{ items: FortnoxUnit[] }>('/api/fortnox/units');
    setUnits(data.items);
  }

  function openCreate() {
    setForm({ code: '', description: '' });
    setEditing({ code: null });
  }

  function openEdit(unit: FortnoxUnit) {
    setForm({ code: unit.code, description: unit.description });
    setEditing({ code: unit.code });
  }

  async function handleSave() {
    if (!editing) return;
    const isCreate = editing.code === null;
    if (isCreate && !form.code.trim()) {
      toast.error('Kod krävs');
      return;
    }
    setBusy('save');

    try {
      if (isCreate) {
        await apiRequest('/api/fortnox/units', {
          method: 'POST',
          body: JSON.stringify({ code: form.code.trim(), description: form.description.trim() || undefined }),
        });
      } else {
        await apiRequest(`/api/fortnox/units/${encodeURIComponent(editing.code!)}`, {
          method: 'PUT',
          body: JSON.stringify({ description: form.description.trim() || undefined }),
        });
      }
      await refresh();
      setEditing(null);
      toast.success(isCreate ? 'Enhet skapad' : 'Enhet uppdaterad');
    } catch (e: any) {
      toast.error(e?.message || 'Kunde inte spara enhet');
    } finally {
      setBusy(null);
    }
  }

  async function handleDelete() {
    if (!confirmDelete) return;
    const code = confirmDelete.code;
    setBusy('delete');
    try {
      await apiRequest(`/api/fortnox/units/${encodeURIComponent(code)}`, { method: 'DELETE' });
      await refresh();
      setConfirmDelete(null);
      toast.success(`Enhet ${code} raderad`);
    } catch (e: any) {
      toast.error(e?.message || 'Kunde inte ta bort enhet');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="m-0 text-2xl font-bold tracking-tight text-slate-900">Enheter</h1>
          <p className="m-0 mt-1 text-sm text-slate-500">Hantera enheter (t.ex. st, m², tim) i Fortnox.</p>
        </div>
        <Button variant="primary" onClick={openCreate} disabled={!fortnoxConnected || busy !== null}>
          Ny enhet
        </Button>
      </div>

      {!fortnoxConnected && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Fortnox är inte kopplat. Anslut under{' '}
          <Link href="/crm/installningar" className="font-semibold underline">Inställningar</Link>{' '}
          för att kunna hantera enheter.
        </div>
      )}

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_2px_12px_rgba(0,0,0,0.04)]">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="m-0 text-base font-bold text-slate-900">Enhetsregister</h2>
          <span className="text-xs font-semibold text-slate-500">{units.length} enheter</span>
        </div>

        {units.length === 0 ? (
          <EmptyState
            title="Inga enheter"
            description={fortnoxConnected ? 'Skapa en ny enhet för att komma igång.' : 'Anslut Fortnox för att se enheter.'}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">
                  <th className="py-2 pr-3">Kod</th>
                  <th className="py-2 pr-3">Beskrivning</th>
                  <th className="py-2 pr-3 text-right">Åtgärder</th>
                </tr>
              </thead>
              <tbody>
                {units.map((u) => (
                  <tr key={u.code} className="border-b border-slate-100 last:border-0">
                    <td className="py-2.5 pr-3 font-semibold text-slate-900">{u.code}</td>
                    <td className="py-2.5 pr-3 text-slate-700">{u.description || '–'}</td>
                    <td className="py-2.5 pr-3">
                      <div className="flex items-center justify-end gap-2">
                        <Button size="sm" variant="secondary" onClick={() => openEdit(u)} disabled={busy !== null}>
                          Redigera
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          className="border-red-200 text-red-700 hover:bg-red-50"
                          onClick={() => setConfirmDelete(u)}
                          disabled={busy !== null}
                        >
                          Radera
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create / edit dialog */}
      {editing && (
        <DialogShell
          eyebrow={editing.code === null ? 'Ny enhet' : 'Redigera enhet'}
          title={editing.code === null ? 'Skapa enhet' : `Enhet ${editing.code}`}
          onClose={() => (busy === null ? setEditing(null) : undefined)}
          panelClassName="max-w-md"
        >
          <div className="grid gap-4">
            <label className="grid gap-1.5">
              <span className="text-sm font-semibold text-slate-700">Kod *</span>
              <Input
                value={editing.code ?? form.code}
                onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
                placeholder="t.ex. st, m2, tim"
                disabled={editing.code !== null}
              />
              {editing.code !== null && <span className="text-xs text-slate-400">Koden kan inte ändras.</span>}
            </label>

            <label className="grid gap-1.5">
              <span className="text-sm font-semibold text-slate-700">Beskrivning</span>
              <Input
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="t.ex. Stycke, Kvadratmeter, Timme"
              />
            </label>

            <div className="flex items-center justify-end gap-2 pt-1">
              <Button variant="secondary" onClick={() => setEditing(null)} disabled={busy !== null}>
                Avbryt
              </Button>
              <Button variant="primary" onClick={handleSave} disabled={busy !== null}>
                {busy === 'save' ? 'Sparar…' : 'Spara'}
              </Button>
            </div>
          </div>
        </DialogShell>
      )}

      {/* Delete confirmation */}
      {confirmDelete && (
        <DialogShell
          eyebrow="Radera enhet"
          title={`Radera ${confirmDelete.code}?`}
          description="Enheten tas bort i Fortnox. Detta går inte att ångra."
          onClose={() => (busy === null ? setConfirmDelete(null) : undefined)}
          panelClassName="max-w-md"
        >
          <div className="grid gap-4">
            <p className="m-0 text-xs text-slate-400">
              Fortnox kan neka borttagning om enheten används på artiklar eller dokument.
            </p>
            <div className="flex items-center justify-end gap-2">
              <Button variant="secondary" onClick={() => setConfirmDelete(null)} disabled={busy !== null}>
                Avbryt
              </Button>
              <Button
                variant="primary"
                className="border-red-600 bg-red-600 hover:bg-red-700"
                onClick={handleDelete}
                disabled={busy !== null}
              >
                {busy === 'delete' ? 'Raderar…' : 'Radera'}
              </Button>
            </div>
          </div>
        </DialogShell>
      )}
    </div>
  );
}
