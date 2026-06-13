'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { cn } from '@/lib/shared/cn';
import { useToast } from '@/lib/Toast';
import { crm } from '@/app/crm/lib/crmTokens';
import { MATERIAL_SHORTS } from '@/lib/domains/crm/materials';
import { useEntityCrud } from './useEntityCrud';
import { TrashIcon } from './managerModalUi';
import type { OpsTruck, OpsDepot } from '@/lib/domains/planning/types';
import type { JobTypeRow } from '@/lib/domains/planning/jobTypes';
import type { DepotBalance } from '@/lib/domains/planning/depotStock';
import type { AssignablePerson } from '@/lib/domains/planning/crew';
import { crewInitials, crewColor } from '@/lib/domains/planning/crew';
import { defaultCrewByTruck, type DefaultCrewMember } from '@/lib/domains/planning/defaultCrew';

// One consolidated admin workspace for the planning board (replaces the separate Bilar/Depåer/
// Jobbtyper/Lager modals). Master-detail: left "Områden" nav → list → detail/editor. Areas are
// filtered by permission (Option A): admins see the management areas, everyone sees Lager.
// Reuses the existing domain/API + useEntityCrud — no behaviour change, just one surface.

type AreaKey = 'trucks' | 'depots' | 'jobtypes' | 'stock';

const PANEL = 'rounded-2xl border border-[#e0e8dc] bg-white p-4';
const LABEL = 'mb-1.5 block text-[10.5px] font-bold uppercase tracking-wide text-slate-400';

export default function PlanningAdminModal({
  canManageTrucks,
  canManageDepots,
  canWrite,
  onClose,
  onChanged,
}: {
  canManageTrucks: boolean;
  canManageDepots: boolean;
  canWrite: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const trucksCrud = useEntityCrud<OpsTruck>({
    api: '/api/crm/planering/trucks',
    listKey: 'trucks',
    toPayload: (t) => ({ name: t.name, color: t.color, active: t.active, depot_id: t.depot_id }),
    labels: { saveFail: 'Kunde inte spara bilen', removeFail: 'Kunde inte ta bort bilen', addFail: 'Kunde inte lägga till bilen' },
  });
  const depotsCrud = useEntityCrud<OpsDepot>({
    api: '/api/crm/planering/depots',
    listKey: 'depots',
    toPayload: (d) => ({ name: d.name, location: d.location, active: d.active }),
    labels: { saveFail: 'Kunde inte spara depån', removeFail: 'Kunde inte ta bort depån', addFail: 'Kunde inte lägga till depån' },
  });
  const jobTypesCrud = useEntityCrud<JobTypeRow>({
    api: '/api/crm/planering/job-types',
    listKey: 'jobTypes',
    toPayload: (t) => ({ label: t.label, color: t.color, active: t.active }),
    labels: { saveFail: 'Kunde inte spara jobbtypen', removeFail: 'Kunde inte ta bort jobbtypen', addFail: 'Kunde inte lägga till jobbtypen' },
  });

  // People + default crew (standardbemanning) for the Lastbilar area's crew editor.
  const [people, setPeople] = useState<AssignablePerson[]>([]);
  const [defaultCrew, setDefaultCrew] = useState<DefaultCrewMember[]>([]);
  const loadDefaultCrew = useCallback(async () => {
    const r = await fetch('/api/crm/planering/default-crew', { cache: 'no-store' });
    const j = await r.json();
    if (j.ok) setDefaultCrew(j.data.crew as DefaultCrewMember[]);
  }, []);
  useEffect(() => {
    if (!canManageTrucks) return;
    fetch('/api/crm/planering/crew', { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => { if (j.ok) setPeople(j.data.people as AssignablePerson[]); })
      .catch(() => {});
    loadDefaultCrew().catch(() => {});
  }, [canManageTrucks, loadDefaultCrew]);
  const defaultByTruck = useMemo(() => defaultCrewByTruck(defaultCrew), [defaultCrew]);

  const areas = useMemo(
    () =>
      [
        { key: 'trucks' as const, label: 'Lastbilar', sub: 'Namn, färg och depåkoppling', count: trucksCrud.items.length, show: canManageTrucks },
        { key: 'depots' as const, label: 'Depåer', sub: 'Lagerplatser', count: depotsCrud.items.length, show: canManageDepots },
        { key: 'jobtypes' as const, label: 'Jobbtyper', sub: 'Färger och materialkoppling', count: jobTypesCrud.items.length, show: canManageTrucks },
        { key: 'stock' as const, label: 'Lager', sub: 'Saldo och leveranser', count: null, show: true },
      ].filter((a) => a.show),
    [canManageTrucks, canManageDepots, trucksCrud.items.length, depotsCrud.items.length, jobTypesCrud.items.length],
  );

  const [active, setActive] = useState<AreaKey>(areas[0]?.key ?? 'stock');
  // If permissions resolve to fewer areas than the default, keep the active area valid.
  useEffect(() => {
    if (!areas.some((a) => a.key === active)) setActive(areas[0]?.key ?? 'stock');
  }, [areas, active]);

  return (
    <div className="fixed inset-0 z-[2800] flex items-center justify-center bg-slate-900/40 p-4 sm:p-6" onClick={onClose}>
      <div
        className="planning-modal flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-[#e0e8dc] bg-[#f9fbf7] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="border-b border-[#e0e8dc] bg-gradient-to-b from-white to-[#f9fbf7] px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-[#cfe3d6] bg-[#e7f0ea] px-2.5 py-0.5 text-[10.5px] font-extrabold uppercase tracking-wider text-[#1f4a2e]">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                Planering admin
              </span>
              <h2 className="mt-2 text-[20px] font-extrabold tracking-tight text-[#142c1b]">Administrera planeringen</h2>
              <p className="mt-0.5 max-w-xl text-[12px] text-slate-500">
                En samlad arbetsyta för bilar, depåer, jobbtyper och lager. Välj ett område — överblick först, redigering när du valt vad du jobbar med.
              </p>
            </div>
            <button
              onClick={onClose}
              className="inline-flex h-9 items-center gap-2 rounded-xl border border-[#e0e8dc] bg-white px-3 text-[12.5px] font-bold text-slate-600 transition hover:border-[#c8d4c3]"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
              Stäng
            </button>
          </div>
        </div>

        {/* Body: nav | content */}
        <div className="grid min-h-0 flex-1 grid-cols-[230px_1fr]">
          {/* Områden */}
          <nav className="overflow-y-auto border-r border-[#e0e8dc] bg-gradient-to-b from-[#fbfdfa] to-[#f9fbf7] p-3">
            <div className="mb-2 px-1 text-[10.5px] font-extrabold uppercase tracking-wider text-slate-400">Områden</div>
            {areas.map((a) => {
              const on = a.key === active;
              return (
                <button
                  key={a.key}
                  onClick={() => setActive(a.key)}
                  className={cn(
                    'mb-1.5 block w-full rounded-xl border px-3 py-2.5 text-left transition',
                    on ? 'border-[#1a3f26] bg-[#1a3f26] shadow-sm' : 'border-transparent hover:border-[#e0e8dc] hover:bg-white',
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className={cn('text-[13.5px] font-bold', on ? 'text-white' : 'text-slate-800')}>{a.label}</span>
                    {a.count != null && (
                      <span className={cn('rounded-full px-2 py-px text-[11px] font-extrabold', on ? 'bg-white/15 text-[#dff0e6]' : 'bg-[#eef3ea] text-slate-500')}>{a.count}</span>
                    )}
                  </div>
                  <div className={cn('mt-0.5 text-[11px]', on ? 'text-[#a9c6b3]' : 'text-slate-400')}>{a.sub}</div>
                </button>
              );
            })}
          </nav>

          {/* Content */}
          <div className="min-h-0 overflow-hidden">
            {active === 'trucks' && <TruckPanel crud={trucksCrud} depots={depotsCrud.items} people={people} defaultByTruck={defaultByTruck} onCrewSaved={loadDefaultCrew} onChanged={onChanged} />}
            {active === 'depots' && <DepotPanel crud={depotsCrud} onChanged={onChanged} />}
            {active === 'jobtypes' && <JobTypePanel crud={jobTypesCrud} onChanged={onChanged} />}
            {active === 'stock' && <StockPanel canWrite={canWrite} />}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── shared master-detail shell ──────────────────────────────────────────────
function MasterDetail({ list, detail }: { list: React.ReactNode; detail: React.ReactNode }) {
  return (
    <div className="grid h-full min-h-0 grid-cols-[300px_1fr]">
      <div className="overflow-y-auto border-r border-[#e0e8dc] p-4">{list}</div>
      <div className="overflow-y-auto bg-gradient-to-b from-[#fcfdfb] to-[#f9fbf7] p-5">{detail}</div>
    </div>
  );
}

function EmptyDetail({ text }: { text: string }) {
  return <div className="grid h-full place-items-center text-[12.5px] text-slate-400">{text}</div>;
}

function RiskZone({ title, body, label, onConfirm, busy }: { title: string; body: string; label: string; onConfirm: () => void; busy: boolean }) {
  return (
    <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4">
      <h3 className="text-[13px] font-extrabold text-rose-800">{title}</h3>
      <p className="mt-1 text-[11.5px] leading-relaxed text-rose-500">{body}</p>
      <button onClick={onConfirm} disabled={busy} className="mt-3 inline-flex h-9 items-center rounded-lg border border-rose-200 bg-white px-4 text-[12px] font-extrabold text-rose-600 transition hover:bg-rose-50 disabled:opacity-50">
        {label}
      </button>
    </div>
  );
}

// Standardbemanning: a truck's standing team (one leader + personal). Saved as a whole via PUT.
function PersonAvatar({ name, seed }: { name: string; seed: string }) {
  return (
    <span className="inline-grid h-5 w-5 place-items-center rounded-full text-[8px] font-bold text-white" style={{ backgroundColor: crewColor(seed) }}>
      {crewInitials(name)}
    </span>
  );
}

function StandardCrewEditor({ truckId, initial, people, onSaved }: { truckId: string; initial: DefaultCrewMember[]; people: AssignablePerson[]; onSaved: () => void }) {
  const toast = useToast();
  const [leaderId, setLeaderId] = useState('');
  const [members, setMembers] = useState<{ member_id: string; member_name: string }[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const leader = initial.find((m) => m.role === 'leader');
    setLeaderId(leader?.member_id ?? '');
    setMembers(initial.filter((m) => m.role === 'member' && m.member_id).map((m) => ({ member_id: m.member_id as string, member_name: m.member_name })));
  }, [initial]);

  const leaderPerson = people.find((p) => p.id === leaderId) ?? null;
  const available = people.filter((p) => p.id !== leaderId && !members.some((m) => m.member_id === p.id));

  async function save() {
    setSaving(true);
    try {
      const payload = {
        members: [
          ...(leaderId && leaderPerson ? [{ member_id: leaderId, member_name: leaderPerson.full_name, role: 'leader' as const }] : []),
          ...members.map((m) => ({ member_id: m.member_id, member_name: m.member_name, role: 'member' as const })),
        ],
      };
      const r = await fetch(`/api/crm/planering/trucks/${truckId}/default-crew`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const j = await r.json();
      if (!j.ok) return toast.error(j.error || 'Kunde inte spara bemanningen');
      toast.success('Standardbemanning sparad');
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={PANEL}>
      <h3 className="text-[13.5px] font-extrabold text-[#142c1b]">Standardbemanning</h3>
      <p className="mb-3 mt-0.5 text-[11.5px] text-slate-500">Bilens stående team. Tavlan visar det varje vecka tills veckan ändras.</p>

      <span className={LABEL}>Teamledare</span>
      <select value={leaderId} onChange={(e) => setLeaderId(e.target.value)} className={crm.select} aria-label="Teamledare">
        <option value="">Ingen teamledare</option>
        {people.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
      </select>

      <span className={cn(LABEL, 'mt-3.5')}>Personal</span>
      <div className="flex flex-wrap gap-1.5">
        {members.length === 0 && <span className="text-[11.5px] text-slate-400">Ingen personal tillagd.</span>}
        {members.map((m) => (
          <span key={m.member_id} className="inline-flex items-center gap-1.5 rounded-full border border-[#e0e8dc] bg-white py-0.5 pl-0.5 pr-1.5 text-[11.5px] font-semibold text-slate-700">
            <PersonAvatar name={m.member_name} seed={m.member_id} />
            {m.member_name}
            <button type="button" onClick={() => setMembers((prev) => prev.filter((x) => x.member_id !== m.member_id))} aria-label="Ta bort" className="text-slate-400 transition hover:text-rose-600">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
          </span>
        ))}
      </div>
      {available.length > 0 && (
        <select
          value=""
          onChange={(e) => {
            const p = people.find((x) => x.id === e.target.value);
            if (p) setMembers((prev) => [...prev, { member_id: p.id, member_name: p.full_name }]);
          }}
          className={cn(crm.select, 'mt-2')}
          aria-label="Lägg till personal"
        >
          <option value="">+ Lägg till personal…</option>
          {available.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
        </select>
      )}

      <button onClick={save} disabled={saving} className={cn(crm.formButton, 'mt-3.5')} style={{ backgroundColor: 'var(--crm-primary)' }}>
        {saving ? 'Sparar…' : 'Spara bemanning'}
      </button>
    </div>
  );
}

// ── Lastbilar ───────────────────────────────────────────────────────────────
function TruckPanel({
  crud,
  depots,
  people,
  defaultByTruck,
  onCrewSaved,
  onChanged,
}: {
  crud: ReturnType<typeof useEntityCrud<OpsTruck>>;
  depots: OpsDepot[];
  people: AssignablePerson[];
  defaultByTruck: Map<string, DefaultCrewMember[]>;
  onCrewSaved: () => void;
  onChanged: () => void;
}) {
  const { items, loading, busy, patchLocal, save, remove, add } = crud;
  const [sel, setSel] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState('#3f6f52');
  const activeDepots = depots.filter((d) => d.active);

  useEffect(() => {
    if (!items.some((t) => t.id === sel)) setSel(items[0]?.id ?? null);
  }, [items, sel]);

  const truck = items.find((t) => t.id === sel) ?? null;
  const depotName = (id: string | null) => activeDepots.find((d) => d.id === id)?.name ?? 'Ingen depå';

  async function onSave() {
    if (truck && (await save(truck))) onChanged();
  }
  async function onRemove() {
    if (truck && (await remove(truck.id))) onChanged();
  }
  async function onAdd(e: FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    const created = await add({ name: newName.trim(), color: newColor });
    if (created) {
      setNewName('');
      setSel(created.id);
      onChanged();
    }
  }

  if (loading) return <div className="grid h-full place-items-center text-[12.5px] text-slate-400">Laddar…</div>;

  return (
    <MasterDetail
      list={
        <>
          <div className="mb-2 px-1 text-[10.5px] font-extrabold uppercase tracking-wider text-slate-400">Bilar</div>
          {items.map((t) => (
            <button
              key={t.id}
              onClick={() => setSel(t.id)}
              className={cn('mb-2 block w-full rounded-xl border bg-white p-3 text-left transition', t.id === sel ? 'border-emerald-400 ring-2 ring-emerald-500/15' : 'border-[#e0e8dc] hover:border-[#c8d4c3]', !t.active && 'opacity-60')}
            >
              <div className="flex items-center gap-2.5">
                <span className="h-3.5 w-3.5 shrink-0 rounded-[5px]" style={{ backgroundColor: t.color || '#94a3b8', boxShadow: 'inset 0 0 0 1px rgba(0,0,0,.08)' }} />
                <span className="text-[13.5px] font-bold text-slate-800">{t.name}</span>
              </div>
              <div className="mt-1.5 text-[11.5px] text-slate-500"><span className="font-semibold text-slate-600">Depå:</span> {depotName(t.depot_id)}</div>
            </button>
          ))}
          <form onSubmit={onAdd} className="mt-1 rounded-xl border border-dashed border-[#c6d3c0] bg-[#fbfdfa] p-3">
            <p className="mb-1 text-[12px] font-extrabold text-slate-700">Lägg till bil</p>
            <p className="mb-2.5 text-[11px] text-slate-400">Skapa en ny lastbil och koppla depå senare.</p>
            <div className="grid grid-cols-[2.5rem_1fr] items-center gap-2.5">
              <input type="color" value={newColor} onChange={(e) => setNewColor(e.target.value)} className={crm.colorInput} aria-label="Färg" />
              <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Namn, t.ex. Bil 4" className={crm.input} aria-label="Namn på ny bil" />
            </div>
            <button type="submit" disabled={busy || !newName.trim()} className="mt-2.5 h-9 w-full rounded-lg border border-emerald-200 bg-emerald-50 text-[12.5px] font-bold text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-50">
              Lägg till bil
            </button>
          </form>
        </>
      }
      detail={
        !truck ? (
          <EmptyDetail text="Välj en bil för att redigera." />
        ) : (
          <div className="grid gap-3.5">
            <div className={PANEL}>
              <h3 className="text-[13.5px] font-extrabold text-[#142c1b]">Grundinställningar</h3>
              <p className="mb-3 mt-0.5 text-[11.5px] text-slate-500">Namn och färg som visas på tavlan.</p>
              <div className="grid grid-cols-2 gap-3">
                <div><span className={LABEL}>Namn</span><input value={truck.name} onChange={(e) => patchLocal(truck.id, { name: e.target.value })} className={crm.input} /></div>
                <div><span className={LABEL}>Färg</span><div className="grid grid-cols-[2.5rem_1fr] items-center gap-2"><input type="color" value={truck.color || '#94a3b8'} onChange={(e) => patchLocal(truck.id, { color: e.target.value })} className={crm.colorInput} aria-label="Färg" /><input value={truck.color || ''} onChange={(e) => patchLocal(truck.id, { color: e.target.value })} className={crm.input} /></div></div>
              </div>
              <label className="mt-3.5 flex cursor-pointer items-center justify-between gap-3">
                <span><span className="block text-[12.5px] font-bold text-slate-800">Aktiv</span><span className="block text-[11px] text-slate-400">Inaktiva bilar göms från tavlan</span></span>
                <input type="checkbox" checked={truck.active} onChange={(e) => patchLocal(truck.id, { active: e.target.checked })} className="h-4 w-4 accent-emerald-600" />
              </label>
              <button onClick={onSave} disabled={busy} className={cn(crm.formButton, 'mt-3.5')} style={{ backgroundColor: 'var(--crm-primary)' }}>Spara</button>
            </div>

            <div className={PANEL}>
              <h3 className="text-[13.5px] font-extrabold text-[#142c1b]">Depåkoppling</h3>
              <p className="mb-3 mt-0.5 text-[11.5px] text-slate-500">Vilken depå bilen drar säckar från (styr förbrukning).</p>
              <select value={truck.depot_id ?? ''} onChange={(e) => patchLocal(truck.id, { depot_id: e.target.value || null })} className={crm.select} aria-label="Depå">
                <option value="">Ingen depå</option>
                {activeDepots.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
              <button onClick={onSave} disabled={busy} className={cn(crm.formButton, 'mt-3')} style={{ backgroundColor: 'var(--crm-primary)' }}>Spara depå</button>
            </div>

            <StandardCrewEditor key={truck.id} truckId={truck.id} initial={defaultByTruck.get(truck.id) ?? []} people={people} onSaved={onCrewSaved} />

            <RiskZone title="Riskzon" body="Ta bort bil endast om den inte längre används i planeringen. En bil med schemalagda jobb kan inte tas bort — avaktivera istället." label="Ta bort bil" onConfirm={onRemove} busy={busy} />
          </div>
        )
      }
    />
  );
}

// ── Depåer ──────────────────────────────────────────────────────────────────
function DepotPanel({ crud, onChanged }: { crud: ReturnType<typeof useEntityCrud<OpsDepot>>; onChanged: () => void }) {
  const { items, loading, busy, patchLocal, save, remove, add } = crud;
  const [sel, setSel] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [newLoc, setNewLoc] = useState('');

  useEffect(() => {
    if (!items.some((d) => d.id === sel)) setSel(items[0]?.id ?? null);
  }, [items, sel]);

  const depot = items.find((d) => d.id === sel) ?? null;

  async function onSave() {
    if (depot && (await save(depot))) onChanged();
  }
  async function onRemove() {
    if (depot && (await remove(depot.id))) onChanged();
  }
  async function onAdd(e: FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    const created = await add({ name: newName.trim(), location: newLoc.trim() || null });
    if (created) {
      setNewName('');
      setNewLoc('');
      setSel(created.id);
      onChanged();
    }
  }

  if (loading) return <div className="grid h-full place-items-center text-[12.5px] text-slate-400">Laddar…</div>;

  return (
    <MasterDetail
      list={
        <>
          <div className="mb-2 px-1 text-[10.5px] font-extrabold uppercase tracking-wider text-slate-400">Depåer</div>
          {items.map((d) => (
            <button key={d.id} onClick={() => setSel(d.id)} className={cn('mb-2 block w-full rounded-xl border bg-white p-3 text-left transition', d.id === sel ? 'border-emerald-400 ring-2 ring-emerald-500/15' : 'border-[#e0e8dc] hover:border-[#c8d4c3]', !d.active && 'opacity-60')}>
              <div className="text-[13.5px] font-bold text-slate-800">{d.name}</div>
              {d.location && <div className="mt-1 text-[11.5px] text-slate-500">{d.location}</div>}
            </button>
          ))}
          <form onSubmit={onAdd} className="mt-1 rounded-xl border border-dashed border-[#c6d3c0] bg-[#fbfdfa] p-3">
            <p className="mb-1 text-[12px] font-extrabold text-slate-700">Lägg till depå</p>
            <p className="mb-2.5 text-[11px] text-slate-400">En lagerplats som bilar drar säckar från.</p>
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Namn, t.ex. Gävle" className={cn(crm.input, 'mb-2')} aria-label="Namn på ny depå" />
            <input value={newLoc} onChange={(e) => setNewLoc(e.target.value)} placeholder="Plats (valfritt)" className={crm.input} aria-label="Plats" />
            <button type="submit" disabled={busy || !newName.trim()} className="mt-2.5 h-9 w-full rounded-lg border border-emerald-200 bg-emerald-50 text-[12.5px] font-bold text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-50">Lägg till depå</button>
          </form>
        </>
      }
      detail={
        !depot ? (
          <EmptyDetail text="Välj en depå för att redigera." />
        ) : (
          <div className="grid gap-3.5">
            <div className={PANEL}>
              <h3 className="text-[13.5px] font-extrabold text-[#142c1b]">Grundinställningar</h3>
              <p className="mb-3 mt-0.5 text-[11.5px] text-slate-500">Depåns namn och plats.</p>
              <div className="grid grid-cols-2 gap-3">
                <div><span className={LABEL}>Namn</span><input value={depot.name} onChange={(e) => patchLocal(depot.id, { name: e.target.value })} className={crm.input} /></div>
                <div><span className={LABEL}>Plats</span><input value={depot.location ?? ''} onChange={(e) => patchLocal(depot.id, { location: e.target.value || null })} className={crm.input} /></div>
              </div>
              <label className="mt-3.5 flex cursor-pointer items-center justify-between gap-3">
                <span className="text-[12.5px] font-bold text-slate-800">Aktiv</span>
                <input type="checkbox" checked={depot.active} onChange={(e) => patchLocal(depot.id, { active: e.target.checked })} className="h-4 w-4 accent-emerald-600" />
              </label>
              <button onClick={onSave} disabled={busy} className={cn(crm.formButton, 'mt-3.5')} style={{ backgroundColor: 'var(--crm-primary)' }}>Spara</button>
            </div>
            <RiskZone title="Riskzon" body="Bilar kopplade till depån nollställs (utan depå). Ta bort bara om depån avvecklas." label="Ta bort depå" onConfirm={onRemove} busy={busy} />
          </div>
        )
      }
    />
  );
}

// ── Jobbtyper ───────────────────────────────────────────────────────────────
function JobTypePanel({ crud, onChanged }: { crud: ReturnType<typeof useEntityCrud<JobTypeRow>>; onChanged: () => void }) {
  const { items, loading, busy, patchLocal, save, remove, add } = crud;
  const [sel, setSel] = useState<string | null>(null);
  const [newLabel, setNewLabel] = useState('');
  const [newColor, setNewColor] = useState('#0d9488');

  useEffect(() => {
    if (!items.some((t) => t.id === sel)) setSel(items[0]?.id ?? null);
  }, [items, sel]);

  const jt = items.find((t) => t.id === sel) ?? null;

  async function onSave() {
    if (jt && (await save(jt))) onChanged();
  }
  async function onRemove() {
    if (jt && (await remove(jt.id))) onChanged();
  }
  async function onAdd(e: FormEvent) {
    e.preventDefault();
    if (!newLabel.trim()) return;
    const created = await add({ label: newLabel.trim(), color: newColor });
    if (created) {
      setNewLabel('');
      setSel(created.id);
      onChanged();
    }
  }

  if (loading) return <div className="grid h-full place-items-center text-[12.5px] text-slate-400">Laddar…</div>;

  return (
    <MasterDetail
      list={
        <>
          <div className="mb-2 px-1 text-[10.5px] font-extrabold uppercase tracking-wider text-slate-400">Jobbtyper</div>
          {items.map((t) => (
            <button key={t.id} onClick={() => setSel(t.id)} className={cn('mb-2 flex w-full items-center gap-2.5 rounded-xl border bg-white p-3 text-left transition', t.id === sel ? 'border-emerald-400 ring-2 ring-emerald-500/15' : 'border-[#e0e8dc] hover:border-[#c8d4c3]', !t.active && 'opacity-60')}>
              <span className="h-3.5 w-3.5 shrink-0 rounded-[5px]" style={{ backgroundColor: t.color, boxShadow: 'inset 0 0 0 1px rgba(0,0,0,.08)' }} />
              <span className="text-[13.5px] font-bold text-slate-800">{t.label}</span>
            </button>
          ))}
          <form onSubmit={onAdd} className="mt-1 rounded-xl border border-dashed border-[#c6d3c0] bg-[#fbfdfa] p-3">
            <p className="mb-1 text-[12px] font-extrabold text-slate-700">Lägg till jobbtyp</p>
            <p className="mb-2.5 text-[11px] text-slate-400">Namn och färg — visas som prick på korten.</p>
            <input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="Namn, t.ex. Sanering" className={cn(crm.input, 'mb-2')} aria-label="Namn på ny jobbtyp" />
            <div className="grid grid-cols-[2.5rem_1fr] items-center gap-2.5">
              <input type="color" value={newColor} onChange={(e) => setNewColor(e.target.value)} className={crm.colorInput} aria-label="Färg" />
              <input value={newColor} onChange={(e) => setNewColor(e.target.value)} className={crm.input} aria-label="Färgkod" />
            </div>
            <button type="submit" disabled={busy || !newLabel.trim()} className="mt-2.5 h-9 w-full rounded-lg border border-emerald-200 bg-emerald-50 text-[12.5px] font-bold text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-50">Lägg till jobbtyp</button>
          </form>
        </>
      }
      detail={
        !jt ? (
          <EmptyDetail text="Välj en jobbtyp för att redigera." />
        ) : (
          <div className="grid gap-3.5">
            <div className={PANEL}>
              <h3 className="text-[13.5px] font-extrabold text-[#142c1b]">{jt.label}</h3>
              <p className="mb-3 mt-0.5 text-[11.5px] text-slate-500">Färgen styr prickens kulör på planeringskorten.</p>
              <div className="grid grid-cols-2 gap-3">
                <div><span className={LABEL}>Namn</span><input value={jt.label} onChange={(e) => patchLocal(jt.id, { label: e.target.value })} className={crm.input} /></div>
                <div><span className={LABEL}>Färg</span><div className="grid grid-cols-[2.5rem_1fr] items-center gap-2"><input type="color" value={jt.color} onChange={(e) => patchLocal(jt.id, { color: e.target.value })} className={crm.colorInput} aria-label="Färg" /><input value={jt.color} onChange={(e) => patchLocal(jt.id, { color: e.target.value })} className={crm.input} /></div></div>
              </div>
              <label className="mt-3.5 flex cursor-pointer items-center justify-between gap-3">
                <span className="text-[12.5px] font-bold text-slate-800">Aktiv</span>
                <input type="checkbox" checked={jt.active} onChange={(e) => patchLocal(jt.id, { active: e.target.checked })} className="h-4 w-4 accent-emerald-600" />
              </label>
              <button onClick={onSave} disabled={busy} className={cn(crm.formButton, 'mt-3.5')} style={{ backgroundColor: 'var(--crm-primary)' }}>Spara</button>
            </div>
            <div className={PANEL}>
              <h3 className="mb-2 text-[12.5px] font-extrabold text-[#142c1b]">Förhandsvisning</h3>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-[#e0e8dc] bg-white px-2.5 py-1 text-[11.5px] font-bold text-slate-800">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: jt.color }} />
                {jt.label}
              </span>
            </div>
            <RiskZone title="Riskzon" body="Befintliga jobb som använder typen behåller den. Ta bort bara om den inte längre används." label="Ta bort jobbtyp" onConfirm={onRemove} busy={busy} />
          </div>
        )
      }
    />
  );
}

// ── Lager ───────────────────────────────────────────────────────────────────
const STOCK_API = '/api/crm/planering/depot-stock';
const DELIVERIES_API = '/api/crm/planering/depot-deliveries';

function balanceClass(b: number) {
  return b < 0 ? 'text-rose-600' : b === 0 ? 'text-amber-600' : 'text-emerald-700';
}

function StockPanel({ canWrite }: { canWrite: boolean }) {
  const toast = useToast();
  const [depots, setDepots] = useState<DepotBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const today = new Date().toISOString().slice(0, 10);
  const [depotId, setDepotId] = useState('');
  const [material, setMaterial] = useState(MATERIAL_SHORTS[0] ?? '');
  const [sacks, setSacks] = useState('');
  const [deliveredOn, setDeliveredOn] = useState(today);
  const [note, setNote] = useState('');

  async function load() {
    const r = await fetch(STOCK_API, { cache: 'no-store' });
    const j = await r.json();
    if (j.ok) {
      const list = j.data.depots as DepotBalance[];
      setDepots(list);
      setDepotId((cur) => cur || (list[0]?.depot_id ?? ''));
    }
  }
  useEffect(() => {
    load().finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function record(e: FormEvent) {
    e.preventDefault();
    if (!depotId || !material || !(Number(sacks) > 0)) return;
    setBusy(true);
    try {
      const r = await fetch(DELIVERIES_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ depot_id: depotId, material, sacks: Number(sacks), delivered_on: deliveredOn, note: note.trim() || null }),
      });
      const j = await r.json();
      if (!j.ok) return toast.error(j.error || 'Kunde inte registrera leveransen');
      toast.success('Leverans registrerad');
      setSacks('');
      setNote('');
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div className="grid h-full place-items-center text-[12.5px] text-slate-400">Laddar…</div>;

  return (
    <div className="h-full overflow-y-auto bg-gradient-to-b from-[#fcfdfb] to-[#f9fbf7] p-5">
      <div className="grid gap-3.5">
        {canWrite && (
          <form onSubmit={record} className={PANEL}>
            <h3 className="text-[13.5px] font-extrabold text-[#142c1b]">Registrera leverans</h3>
            <p className="mb-3 mt-0.5 text-[11.5px] text-slate-500">Saldot = levererat − förbrukat (förbrukning härleds från blåsta säckar).</p>
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              <div className="sm:col-span-1"><span className={LABEL}>Depå</span>
                <select value={depotId} onChange={(e) => setDepotId(e.target.value)} className={crm.select} aria-label="Depå">
                  {depots.length === 0 && <option value="">Ingen depå</option>}
                  {depots.map((d) => <option key={d.depot_id} value={d.depot_id}>{d.depot_name}</option>)}
                </select>
              </div>
              <div><span className={LABEL}>Material</span>
                <select value={material} onChange={(e) => setMaterial(e.target.value)} className={crm.select} aria-label="Material">
                  {MATERIAL_SHORTS.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div><span className={LABEL}>Säckar</span><input type="number" min={1} value={sacks} onChange={(e) => setSacks(e.target.value)} placeholder="0" className={crm.input} aria-label="Antal säckar" /></div>
              <div><span className={LABEL}>Datum</span><input type="date" value={deliveredOn} onChange={(e) => setDeliveredOn(e.target.value)} className={cn(crm.input, 'tabular-nums')} aria-label="Datum" /></div>
            </div>
            <div className="mt-2.5 grid grid-cols-[1fr_auto] gap-2.5">
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Notering (valfritt)" className={crm.input} aria-label="Notering" />
              <button type="submit" disabled={busy || !depotId || !(Number(sacks) > 0)} className={crm.formButton} style={{ backgroundColor: 'var(--crm-primary)' }}>Registrera</button>
            </div>
          </form>
        )}

        {depots.length === 0 ? (
          <p className="py-6 text-center text-[12px] text-slate-400">Inga depåer upplagda än. Lägg till under Depåer.</p>
        ) : (
          <div className={PANEL}>
            <h3 className="mb-3 text-[13.5px] font-extrabold text-[#142c1b]">Saldo per depå</h3>
            <div className="grid gap-2.5">
              {depots.map((d) => (
                <div key={d.depot_id} className="rounded-xl border border-[#e0e8dc] bg-[#f9fbf7] p-3">
                  <div className="mb-1.5 flex items-baseline justify-between gap-2">
                    <span className="flex items-center gap-2">
                      <span className="text-[13px] font-bold text-slate-800">{d.depot_name}</span>
                      {d.rows.some((r) => r.balance < 0) && <span className="rounded-full border border-rose-200 bg-rose-50 px-2 py-px text-[9px] font-bold text-rose-700">Underskott</span>}
                    </span>
                    <span className={cn('shrink-0 text-[12px] font-bold tabular-nums', balanceClass(d.total_balance))}>{d.total_balance} säck</span>
                  </div>
                  {d.rows.length === 0 ? (
                    <p className="text-[11px] text-slate-400">Inga rörelser än.</p>
                  ) : (
                    <table className="w-full text-[11.5px]">
                      <thead><tr className="text-left text-[10px] uppercase tracking-wide text-slate-400"><th className="font-semibold">Material</th><th className="text-right font-semibold">Levererat</th><th className="text-right font-semibold">Förbrukat</th><th className="text-right font-semibold">Saldo</th></tr></thead>
                      <tbody>
                        {d.rows.map((r) => (
                          <tr key={r.material} className="border-t border-[#eef3eb]">
                            <td className="py-1 font-semibold text-slate-700">{r.material}</td>
                            <td className="py-1 text-right tabular-nums text-slate-500">{r.delivered}</td>
                            <td className="py-1 text-right tabular-nums text-slate-500">{r.consumed}</td>
                            <td className={cn('py-1 text-right font-bold tabular-nums', balanceClass(r.balance))}>{r.balance}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              ))}
              <p className="text-[10.5px] text-slate-400">Förbrukning fylls i automatiskt när installatörernas säckrapportering är på plats.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
