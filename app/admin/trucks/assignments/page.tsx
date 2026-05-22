"use client";
import React, { useEffect, useMemo, useState } from 'react';
import Badge from '../../../../components/ui/Badge';
import Button from '../../../../components/ui/Button';
import EmptyState from '../../../../components/ui/EmptyState';
import ErrorState from '../../../../components/ui/ErrorState';
import Input from '../../../../components/ui/Input';
import PageShell from '../../../../components/ui/PageShell';
import Select from '../../../../components/ui/Select';
import SectionCard from '../../../../components/ui/SectionCard';
import { useTruckAssignments } from '@/lib/TruckAssignmentsContext';

type NewAssignment = {
  truck_id: string;
  start_day: string;
  end_day: string;
  team_member1_name?: string | null;
  team_member2_name?: string | null;
};

export default function TruckAssignmentsAdminPage() {
  const { assignments, reload } = useTruckAssignments();
  const [filterTruck, setFilterTruck] = useState<string>('');
  const [form, setForm] = useState<NewAssignment>({ truck_id: '', start_day: '', end_day: '', team_member1_name: '', team_member2_name: '' });
  const [saving, setSaving] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { reload(); }, [reload]);

  const trucks = useMemo(() => {
    const set = new Set<string>();
    assignments.forEach(a => set.add(a.truck_id));
    return Array.from(set).sort();
  }, [assignments]);

  async function createAssignment() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/planning/truck-assignments/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
      setForm({ truck_id: '', start_day: '', end_day: '', team_member1_name: '', team_member2_name: '' });
      await reload();
    } catch (e: any) {
      setError(e?.message ?? 'Unknown error');
    } finally {
      setSaving(false);
    }
  }

  async function deleteAssignment(id: string) {
    if (!confirm('Ta bort tilldelningen?')) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/planning/truck-assignments/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
      await reload();
    } catch (e: any) {
      setError(e?.message ?? 'Unknown error');
    } finally {
      setSaving(false);
    }
  }

  async function updateAssignment(id: string, patch: Partial<NewAssignment>) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/planning/truck-assignments/update', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, ...patch }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
      await reload();
    } catch (e: any) {
      setError(e?.message ?? 'Unknown error');
    } finally {
      setSaving(false);
    }
  }
  const list = assignments.filter(a => !filterTruck || a.truck_id === filterTruck);

  return (
    <PageShell className="max-w-[1120px] gap-5 px-3 py-3 sm:px-4 lg:px-5">
      <SectionCard className="grid gap-4 rounded-[24px] bg-[linear-gradient(180deg,#ffffff_0%,#f8fbff_100%)] p-5 shadow-[0_14px_36px_rgba(15,23,42,0.04)]">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="grid max-w-[720px] gap-1.5">
            <div className="flex flex-wrap gap-2">
              <Badge variant="accent" className="px-2.5 py-1 text-[11px] uppercase tracking-[0.35px]">Truck-tilldelningar</Badge>
              <Badge>{assignments.length} totalt</Badge>
              <Badge>{list.length} visade</Badge>
            </div>
            <h1 className="m-0 text-[30px] leading-[1.08] text-slate-900">Hantera trucktilldelningar i ett tydligare flöde</h1>
            <p className="m-0 text-sm leading-[1.55] text-slate-600">Filtrera per truck, skapa nya tilldelningar och justera befintliga poster direkt i en mer sammanhållen adminyta.</p>
          </div>

          <div className="grid min-w-[220px] gap-1 rounded-2xl border border-ui-border bg-white px-3 py-2.5">
            <span className="text-[11px] font-extrabold uppercase tracking-[0.3px] text-slate-500">Filter</span>
            <Select value={filterTruck} onChange={e => setFilterTruck(e.target.value)}>
              <option value="">Alla trucks</option>
              {trucks.map(t => <option key={t} value={t}>{t}</option>)}
            </Select>
          </div>
        </div>
      </SectionCard>

      {error && <ErrorState title="Kunde inte uppdatera trucktilldelning" message={error} />}

      <SectionCard className="grid gap-4 p-5">
        <div className="grid gap-1">
          <h2 className="m-0 text-xl text-slate-900">Ny tilldelning</h2>
          <p className="m-0 text-sm text-slate-500">Skapa en ny period för trucken och koppla montörer direkt.</p>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Truck">
            <Input value={form.truck_id} onChange={e => setForm(f => ({ ...f, truck_id: e.target.value }))} placeholder="Ex: Truck-1" />
          </Field>
          <Field label="Startdag">
            <Input type="date" value={form.start_day} onChange={e => setForm(f => ({ ...f, start_day: e.target.value }))} />
          </Field>
          <Field label="Slutdag">
            <Input type="date" value={form.end_day} onChange={e => setForm(f => ({ ...f, end_day: e.target.value }))} />
          </Field>
          <Field label="Montör 1">
            <Input value={form.team_member1_name ?? ''} onChange={e => setForm(f => ({ ...f, team_member1_name: e.target.value }))} />
          </Field>
          <Field label="Montör 2">
            <Input value={form.team_member2_name ?? ''} onChange={e => setForm(f => ({ ...f, team_member2_name: e.target.value }))} />
          </Field>
        </div>

        <div>
          <Button type="button" variant="primary" onClick={createAssignment} disabled={saving || !form.truck_id || !form.start_day || !form.end_day}>Spara</Button>
        </div>
      </SectionCard>

      <SectionCard className="grid gap-4 p-5">
        <div className="grid gap-1">
          <h2 className="m-0 text-xl text-slate-900">Befintliga tilldelningar{filterTruck ? `: ${filterTruck}` : ''}</h2>
          <p className="m-0 text-sm text-slate-500">Ändringar sparas när du lämnar ett fält. Radera posten om tilldelningen inte längre gäller.</p>
        </div>

        <div className="grid gap-2">
          {list.length === 0 && <EmptyState title="Inga tilldelningar" description={filterTruck ? 'Det finns inga perioder för vald truck ännu.' : 'Skapa första tilldelningen för att börja planera.'} />}
          {list.map(a => (
            <div key={a.id} className="grid gap-3 rounded-xl border border-slate-200 bg-white p-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                <Field label="Truck">
                  <Input defaultValue={a.truck_id} onBlur={e => updateAssignment(a.id, { truck_id: e.target.value })} />
                </Field>
                <Field label="Startdag">
                  <Input type="date" defaultValue={a.start_day} onBlur={e => updateAssignment(a.id, { start_day: e.target.value })} />
                </Field>
                <Field label="Slutdag">
                  <Input type="date" defaultValue={a.end_day} onBlur={e => updateAssignment(a.id, { end_day: e.target.value })} />
                </Field>
                <Field label="Montör 1">
                  <Input defaultValue={a.team_member1_name ?? ''} onBlur={e => updateAssignment(a.id, { team_member1_name: e.target.value })} />
                </Field>
                <Field label="Montör 2">
                  <Input defaultValue={a.team_member2_name ?? ''} onBlur={e => updateAssignment(a.id, { team_member2_name: e.target.value })} />
                </Field>
              </div>
              <div>
                <Button variant="secondary" size="sm" className="text-red-700 hover:bg-red-50" onClick={() => deleteAssignment(a.id)} disabled={saving}>Ta bort</Button>
              </div>
            </div>
          ))}
        </div>
      </SectionCard>
    </PageShell>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1.5">
      <span className="text-xs font-medium text-slate-600">{label}</span>
      {children}
    </label>
  );
}
