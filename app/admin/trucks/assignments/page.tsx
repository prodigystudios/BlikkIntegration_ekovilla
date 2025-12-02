"use client";
import React, { useEffect, useMemo, useState } from 'react';
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
    <div style={{ padding: 16 }}>
      <h1>Truck-tilldelningar</h1>
      {error && <div style={{ color: '#b91c1c', marginBottom: 12 }}>Fel: {error}</div>}

      <div style={{ display: 'grid', gap: 12, marginBottom: 24 }}>
        <label style={{ display: 'grid', gap: 6 }}>
          <span>Filtrera truck</span>
          <select value={filterTruck} onChange={e => setFilterTruck(e.target.value)}>
            <option value="">Alla</option>
            {trucks.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
      </div>

      <section style={{ marginBottom: 24 }}>
        <h2>Ny tilldelning</h2>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <label style={{ display: 'grid', gap: 6 }}>
            <span>Truck</span>
            <input value={form.truck_id} onChange={e => setForm(f => ({ ...f, truck_id: e.target.value }))} placeholder="Ex: Truck-1" />
          </label>
          <label style={{ display: 'grid', gap: 6 }}>
            <span>Startdag</span>
            <input type="date" value={form.start_day} onChange={e => setForm(f => ({ ...f, start_day: e.target.value }))} />
          </label>
          <label style={{ display: 'grid', gap: 6 }}>
            <span>Slutdag</span>
            <input type="date" value={form.end_day} onChange={e => setForm(f => ({ ...f, end_day: e.target.value }))} />
          </label>
          <label style={{ display: 'grid', gap: 6 }}>
            <span>Montör 1</span>
            <input value={form.team_member1_name ?? ''} onChange={e => setForm(f => ({ ...f, team_member1_name: e.target.value }))} />
          </label>
          <label style={{ display: 'grid', gap: 6 }}>
            <span>Montör 2</span>
            <input value={form.team_member2_name ?? ''} onChange={e => setForm(f => ({ ...f, team_member2_name: e.target.value }))} />
          </label>
        </div>
        <div style={{ marginTop: 12 }}>
          <button type="button" className="btn" onClick={createAssignment} disabled={saving || !form.truck_id || !form.start_day || !form.end_day}>Spara</button>
        </div>
      </section>

      <section>
        <h2>Befintliga tilldelningar{filterTruck ? `: ${filterTruck}` : ''}</h2>
        <div style={{ display: 'grid', gap: 8 }}>
          {list.length === 0 && <div>Inga tilldelningar</div>}
          {list.map(a => (
            <div key={a.id} style={{ border: '1px solid #e5e7eb', padding: 12, borderRadius: 8, display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'center' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <label style={{ display: 'grid', gap: 4 }}>
                  <span style={{ fontSize: 12, color: '#64748b' }}>Truck</span>
                  <input defaultValue={a.truck_id} onBlur={e => updateAssignment(a.id, { truck_id: e.target.value })} />
                </label>
                <label style={{ display: 'grid', gap: 4 }}>
                  <span style={{ fontSize: 12, color: '#64748b' }}>Startdag</span>
                  <input type="date" defaultValue={a.start_day} onBlur={e => updateAssignment(a.id, { start_day: e.target.value })} />
                </label>
                <label style={{ display: 'grid', gap: 4 }}>
                  <span style={{ fontSize: 12, color: '#64748b' }}>Slutdag</span>
                  <input type="date" defaultValue={a.end_day} onBlur={e => updateAssignment(a.id, { end_day: e.target.value })} />
                </label>
                <label style={{ display: 'grid', gap: 4 }}>
                  <span style={{ fontSize: 12, color: '#64748b' }}>Montör 1</span>
                  <input defaultValue={a.team_member1_name ?? ''} onBlur={e => updateAssignment(a.id, { team_member1_name: e.target.value })} />
                </label>
                <label style={{ display: 'grid', gap: 4 }}>
                  <span style={{ fontSize: 12, color: '#64748b' }}>Montör 2</span>
                  <input defaultValue={a.team_member2_name ?? ''} onBlur={e => updateAssignment(a.id, { team_member2_name: e.target.value })} />
                </label>
              </div>
              <div>
                <button className="btn--plain" onClick={() => deleteAssignment(a.id)} disabled={saving}>Ta bort</button>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
