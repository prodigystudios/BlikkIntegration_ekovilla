'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { cn } from '@/lib/shared/cn';
import { useToast } from '@/lib/Toast';
import { crm } from '@/app/crm/lib/crmTokens';
import { MATERIAL_SHORTS } from '@/lib/domains/crm/materials';
import { useEntityCrud } from './useEntityCrud';
import { shortDayISO, stockholmTodayISO } from './planningDates';
import { TrashIcon } from './managerModalUi';
// Husets listbox. En `<select>` duger inte: LISTAN som fälls ut ur en sådan ritas av
// operativsystemet och går inte att styla — grå och fyrkantig mitt i den här ytan.
// `min-h-9`, inte `h-9`: se noten i Select.tsx om tailwind-merge-grupperna.
import SelectMenu from '@/components/ui/SelectMenu';
import type { OpsTruck, OpsDepot } from '@/lib/domains/planning/types';
import type { JobTypeRow } from '@/lib/domains/planning/jobTypes';
import type { DepotBalance } from '@/lib/domains/planning/depotStock';
import { describeSuggestion, rowsNeedingOrder, type DepotForecast } from '@/lib/domains/planning/depotForecast';
import type { ExpectedDelivery } from '@/lib/domains/planning/expectedDeliveries';
import { validateSupplier, type MaterialSupplier, type SupplierProblem } from '@/lib/domains/planning/materialSuppliers';
import type { AssignablePerson } from '@/lib/domains/planning/crew';
import { crewInitials, crewColor } from '@/lib/domains/planning/crew';
import { defaultCrewByTruck, type DefaultCrewMember } from '@/lib/domains/planning/defaultCrew';

// One consolidated admin workspace for the planning board (replaces the separate Bilar/Depåer/
// Jobbtyper/Lager modals). Master-detail: left "Områden" nav → list → detail/editor. Areas are
// filtered by permission (Option A): admins see the management areas, everyone sees Lager.
// Reuses the existing domain/API + useEntityCrud — no behaviour change, just one surface.

type AreaKey = 'trucks' | 'depots' | 'suppliers' | 'jobtypes' | 'stock';

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
  // Leverantörsregistret. Hela registret ligger bakom planning.depot.manage — ÄVEN läsningen, till
  // skillnad från depåerna ovan — eftersom raden bär fabrikens mailadress och kontaktperson.
  // Hämtningen sker ändå ovillkorligt, som för bilarna (vars GET också är manage-gatad): den som
  // saknar nyckeln får 403, hooken sväljer det och området är dolt.
  const suppliersCrud = useEntityCrud<MaterialSupplier>({
    api: '/api/crm/planering/material-suppliers',
    listKey: 'suppliers',
    toPayload: (s) => ({
      name: s.name,
      email: s.email,
      contact_name: s.contact_name,
      phone: s.phone,
      materials: s.materials,
      lead_time_days: s.lead_time_days,
      note: s.note,
      active: s.active,
    }),
    labels: { saveFail: 'Kunde inte spara leverantören', removeFail: 'Kunde inte ta bort leverantören', addFail: 'Kunde inte lägga till leverantören' },
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
        { key: 'suppliers' as const, label: 'Leverantörer', sub: 'Fabriker, material och ledtid', count: suppliersCrud.items.length, show: canManageDepots },
        { key: 'jobtypes' as const, label: 'Jobbtyper', sub: 'Färger och materialkoppling', count: jobTypesCrud.items.length, show: canManageTrucks },
        { key: 'stock' as const, label: 'Lager', sub: 'Saldo och leveranser', count: null, show: true },
      ].filter((a) => a.show),
    [canManageTrucks, canManageDepots, trucksCrud.items.length, depotsCrud.items.length, suppliersCrud.items.length, jobTypesCrud.items.length],
  );

  const [active, setActive] = useState<AreaKey>(areas[0]?.key ?? 'stock');
  // If permissions resolve to fewer areas than the default, keep the active area valid.
  useEffect(() => {
    if (!areas.some((a) => a.key === active)) setActive(areas[0]?.key ?? 'stock');
  }, [areas, active]);

  return (
    <div className="fixed inset-0 z-[2800] flex items-center justify-center bg-slate-900/40 p-4 sm:p-6" onClick={onClose}>
      <div
        className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-[#e0e8dc] bg-[#f9fbf7] shadow-xl"
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
            {active === 'suppliers' && <SupplierPanel crud={suppliersCrud} onChanged={onChanged} />}
            {active === 'jobtypes' && <JobTypePanel crud={jobTypesCrud} onChanged={onChanged} />}
            {active === 'stock' && (
              <StockPanel
                canWrite={canWrite}
                canManageDepots={canManageDepots}
                // Depålistan kommer från depåregistret, INTE ur lagersaldot: saldot failar stängt,
                // och då hade väljarna stått tomma — trots att väntade leveranser ska gå att
                // hantera även när saldot inte gick att räkna ut.
                depotOptions={depotsCrud.items.filter((d) => d.active)}
              />
            )}
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

// Shared empty team for trucks with no standing crew. ⚠️ Must be a stable reference: the effect
// below re-syncs on `initial`, and a fresh `[]` literal at the call site made it fire on EVERY
// parent render — wiping an unsaved pick the moment you typed in a field above. That hit exactly
// the case you were setting a team up in (a truck that has none yet).
const NO_CREW: DefaultCrewMember[] = [];

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
      <SelectMenu
        value={leaderId}
        onChange={setLeaderId}
        className="min-h-9 py-0 text-[13px]"
        aria-label="Teamledare"
        options={[{ value: '', label: 'Ingen teamledare' }, ...people.map((p) => ({ value: p.id, label: p.full_name || 'Namnlös' }))]}
      />

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
        // Värdet är alltid tomt — fältet är en ÅTGÄRD (lägg till), inte ett tillstånd. Därför
        // står platshållaren kvar efter varje val.
        <div className="mt-2">
          <SelectMenu
            value=""
            onChange={(v) => {
              const p = people.find((x) => x.id === v);
              if (p) setMembers((prev) => [...prev, { member_id: p.id, member_name: p.full_name }]);
            }}
            className="min-h-9 py-0 text-[13px]"
            aria-label="Lägg till personal"
            placeholder="+ Lägg till personal…"
            options={available.map((p) => ({ value: p.id, label: p.full_name || 'Namnlös' }))}
          />
        </div>
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
                <input type="checkbox" checked={truck.active} onChange={(e) => patchLocal(truck.id, { active: e.target.checked })} className="h-4 w-4 accent-[color:var(--ek-accent)]" />
              </label>
              <button onClick={onSave} disabled={busy} className={cn(crm.formButton, 'mt-3.5')} style={{ backgroundColor: 'var(--crm-primary)' }}>Spara</button>
            </div>

            <div className={PANEL}>
              <h3 className="text-[13.5px] font-extrabold text-[#142c1b]">Depåkoppling</h3>
              <p className="mb-3 mt-0.5 text-[11.5px] text-slate-500">Vilken depå bilen drar säckar från (styr förbrukning).</p>
              <SelectMenu
                value={truck.depot_id ?? ''}
                onChange={(v) => patchLocal(truck.id, { depot_id: v || null })}
                className="min-h-9 py-0 text-[13px]"
                aria-label="Depå"
                options={[{ value: '', label: 'Ingen depå' }, ...activeDepots.map((d) => ({ value: d.id, label: d.name }))]}
              />
              <button onClick={onSave} disabled={busy} className={cn(crm.formButton, 'mt-3')} style={{ backgroundColor: 'var(--crm-primary)' }}>Spara depå</button>
            </div>

            <StandardCrewEditor key={truck.id} truckId={truck.id} initial={defaultByTruck.get(truck.id) ?? NO_CREW} people={people} onSaved={onCrewSaved} />

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
                <input type="checkbox" checked={depot.active} onChange={(e) => patchLocal(depot.id, { active: e.target.checked })} className="h-4 w-4 accent-[color:var(--ek-accent)]" />
              </label>
              <button onClick={onSave} disabled={busy} className={cn(crm.formButton, 'mt-3.5')} style={{ backgroundColor: 'var(--crm-primary)' }}>Spara</button>
            </div>
            {/* Texten säger vad som FAKTISKT händer. Att bilar nollställs stod här förut, men inte
                att leveranshistoriken följer med — och sedan väntade leveranser fick en FK med
                RESTRICT går borttagningen dessutom oftast inte igenom alls. Ett löfte som inte
                håller är sämre än inget löfte. */}
            <RiskZone
              title="Riskzon"
              body="Bilar kopplade till depån nollställs (utan depå), och depåns leveranshistorik försvinner. Har depån någon väntad eller kvitterad leverans går den inte att ta bort — avaktivera den i stället."
              label="Ta bort depå"
              onConfirm={onRemove}
              busy={busy}
            />
          </div>
        )
      }
    />
  );
}

// ── Leverantörer ────────────────────────────────────────────────────────────
//
// Vem materialet beställs FRÅN. Registret är etapp 2 av beställningsspåret: prognosen använder
// ledtiden för att datera förslaget, och beställningsmailet slår upp adressen på servern via
// supplier_id — klienten skickar aldrig en mailadress.
//
// ⚠️ Området är grindat på canManageDepots, och API:t kräver planning.depot.manage även för
// LÄSNING. Raden bär fabrikens adress och kontaktperson; rollen konsult håller schedule.read och
// hade annars kunnat läsa hela registret. Sänk inte grinden här utan att sänka den i RLS först —
// och det ska inte göras.

// Record över hela unionen, inte ett uppslag med fallback: läggs ett nytt SupplierProblem till i
// domänen failar type-check här i stället för att visa ett tomt felmeddelande.
const SUPPLIER_PROBLEM_TEXT: Record<SupplierProblem, string> = {
  name_required: 'Ange ett namn',
  name_too_long: 'Namnet är för långt',
  email_required: 'Ange en e-postadress — beställningen skickas dit',
  email_invalid: 'Ogiltig e-postadress',
  materials_required: 'Välj minst ett material, annars kan leverantören aldrig väljas som mottagare',
  material_unknown: 'Okänt material',
  lead_time_invalid: 'Ledtiden anges i hela dagar, 0–365',
};

// Flervalet över materialkatalogen. Ingen delad multi-select finns i repot, och den här ska inte
// bli en: listan är fem fasta koder och hör till den här ytan.
//
// ⚠️ Native <input type="checkbox"> bär bara `h-4 w-4 accent-*`. Preflight nollar border-width och
// globals.css återställer den bara för knappar, så `rounded`/`border-*` är tyst verkningslöst här.
// Samma klasser som Aktiv-rutorna i den här filen.
// `columns`: listkolumnen i MasterDetail är 300 px bred, och materialkoderna är långa
// ('ISOCELL/ISECO', 'KNAUF SUPAFIL', 'HUNTON NATIVO'). I två spalter radbryter de mitt i namnet.
// Detaljvyn är bred och tar två.
//
// 🧨 RENDERAR UNIONEN AV KATALOGEN OCH DET VALDA, INTE BARA KATALOGEN. En rad kan bära en kod som
// inte finns i MATERIAL_SHORTS — seedad via SQL (det finns med flit ingen CHECK), eller efterlämnad
// den dag ett `short` döps om i lib/domains/crm/materials.ts, vilket repot redan behandlar som en
// levande risk (se materialRenameEffect).
//
// Med bara katalogen hade den koden saknat kryssruta: osynlig, omöjlig att kryssa ur, men skickad
// vid varje sparning — där validateSupplier nekar den med "Okänt material". Leverantören gick då
// inte att rätta, inte ens att AVAKTIVERA, eftersom Aktiv sparas genom samma knapp. Enda utvägen
// var att radera raden. Nu är koden synlig, förkryssad och går att ta bort; grinden mot att LÄGGA
// TILL en okänd kod är oförändrad, eftersom katalogen är det enda man kan kryssa I.
function MaterialChecklist({
  selected,
  onToggle,
  columns = 2,
}: {
  selected: string[];
  onToggle: (material: string) => void;
  columns?: 1 | 2;
}) {
  const rows = [...new Set([...MATERIAL_SHORTS, ...selected])];
  return (
    <div className={cn('grid gap-1.5', columns === 2 && 'sm:grid-cols-2')}>
      {rows.map((m) => {
        const unknown = !MATERIAL_SHORTS.includes(m);
        return (
          <label
            key={m}
            className={cn(
              'flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1.5',
              unknown ? 'border-rose-300 bg-rose-50' : 'border-[#e0e8dc] bg-white',
            )}
          >
            <input
              type="checkbox"
              checked={selected.includes(m)}
              onChange={() => onToggle(m)}
              className="h-4 w-4 accent-[color:var(--ek-accent)]"
            />
            <span className={cn('text-[12px] font-semibold', unknown ? 'text-rose-700' : 'text-slate-700')}>{m}</span>
            {unknown && <span className="ml-auto text-[10px] font-bold uppercase tracking-wide text-rose-500">okänd kod</span>}
          </label>
        );
      })}
    </div>
  );
}

function SupplierPanel({ crud, onChanged }: { crud: ReturnType<typeof useEntityCrud<MaterialSupplier>>; onChanged: () => void }) {
  const { items, loading, loadError, busy, reload, patchLocal, save, remove, add } = crud;
  const toast = useToast();
  const [sel, setSel] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newMaterials, setNewMaterials] = useState<string[]>([]);

  useEffect(() => {
    if (!items.some((s) => s.id === sel)) setSel(items[0]?.id ?? null);
  }, [items, sel]);

  const supplier = items.find((s) => s.id === sel) ?? null;

  function toggle(list: string[], material: string): string[] {
    return list.includes(material) ? list.filter((m) => m !== material) : [...list, material];
  }

  // Samma regel som createSupplierSchema, men på klientsidan — så felet syns vid fältet i stället
  // för som ett 400-svar. Grinden som räknas sitter i schemat och i RLS.
  async function onSave() {
    if (!supplier) return;
    const problem = validateSupplier({
      name: supplier.name,
      email: supplier.email,
      materials: supplier.materials,
      leadTimeDays: supplier.lead_time_days,
    });
    if (problem) return toast.error(SUPPLIER_PROBLEM_TEXT[problem]);
    if (await save(supplier)) {
      onChanged();
      return;
    }
    // 🧨 EN NEKAD SPARNING FÅR INTE LÄMNA KVAR SITT UTKAST. `patchLocal` skrev optimistiskt redan
    // vid tangenttrycket, så efter ett 409 (namnet bärs av en annan AKTIV leverantör) står raden
    // kvar och visar precis det databasen vägrade — kryssrutan ikryssad, raden utan opacity-60 —
    // medan registret säger något annat. Toasten är övergående; det felaktiga tillståndet är det
    // inte. Att gissa fram ett "före" räcker inte, för utkastet är äldre än knapptrycket: hämta om.
    await reload();
  }
  async function onRemove() {
    if (supplier && (await remove(supplier.id))) onChanged();
  }
  async function onAdd(e: FormEvent) {
    e.preventDefault();
    const problem = validateSupplier({ name: newName, email: newEmail, materials: newMaterials });
    if (problem) return toast.error(SUPPLIER_PROBLEM_TEXT[problem]);
    const created = await add({
      name: newName.trim(),
      email: newEmail.trim(),
      materials: newMaterials,
      lead_time_days: 0,
    });
    if (created) {
      setNewName('');
      setNewEmail('');
      setNewMaterials([]);
      setSel(created.id);
      onChanged();
    }
  }

  if (loading) return <div className="grid h-full place-items-center text-[12.5px] text-slate-400">Laddar…</div>;

  // 🧨 Ett fel får inte se ut som ett tomt register — "Inga leverantörer upplagda än" är ett
  // påstående om verkligheten, och en 403 eller ett nätverksfel vet ingenting om verkligheten.
  // Hela panelen ersätts, inte bara listan: formuläret nedanför hade bjudit in till att lägga upp
  // en fabrik som redan finns. Samma gren som StockPanel har för lagersaldot.
  if (loadError) {
    return (
      <div className="h-full overflow-y-auto p-5">
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-[12px] text-rose-700">
          <div className="font-semibold">Leverantörsregistret kunde inte hämtas</div>
          <p className="mt-0.5 text-rose-600">{loadError}</p>
          <p className="mt-1 text-[11px] text-rose-500">
            Listan visas inte, eftersom ett fel annars hade sett ut som ett tomt register. Ladda om sidan och hör av dig
            om det står kvar.
          </p>
        </div>
      </div>
    );
  }

  return (
    <MasterDetail
      list={
        <>
          <div className="mb-2 px-1 text-[10.5px] font-extrabold uppercase tracking-wider text-slate-400">Leverantörer</div>
          {items.length === 0 && (
            <p className="mb-2 px-1 text-[11.5px] text-slate-400">Inga leverantörer upplagda än.</p>
          )}
          {items.map((s) => (
            <button
              key={s.id}
              onClick={() => setSel(s.id)}
              className={cn('mb-2 block w-full rounded-xl border bg-white p-3 text-left transition', s.id === sel ? 'border-emerald-400 ring-2 ring-emerald-500/15' : 'border-[#e0e8dc] hover:border-[#c8d4c3]', !s.active && 'opacity-60')}
            >
              <div className="truncate text-[13.5px] font-bold text-slate-800">{s.name}</div>
              <div className="mt-0.5 truncate text-[11.5px] text-slate-500">{s.email}</div>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {s.materials.length === 0 ? (
                  // En leverantör utan material matchar aldrig ett behov och kan alltså aldrig
                  // väljas som mottagare. Säg det, i stället för att visa en tom rad.
                  <span className="rounded-full border border-amber-200 bg-amber-50 px-1.5 py-px text-[10px] font-bold text-amber-700">Inget material</span>
                ) : (
                  s.materials.map((m) => (
                    <span key={m} className="rounded-full border border-[#e0e8dc] bg-[#f9fbf7] px-1.5 py-px text-[10px] font-semibold text-slate-600">{m}</span>
                  ))
                )}
              </div>
            </button>
          ))}
          <form onSubmit={onAdd} className="mt-1 rounded-xl border border-dashed border-[#c6d3c0] bg-[#fbfdfa] p-3">
            <p className="mb-1 text-[12px] font-extrabold text-slate-700">Lägg till leverantör</p>
            <p className="mb-2.5 text-[11px] text-slate-400">Fabriken materialet beställs från. Ledtid och kontaktuppgifter fyller du i sedan.</p>
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Namn, t.ex. Ekovilla AB" className={cn(crm.input, 'mb-2')} aria-label="Namn på ny leverantör" />
            <input type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="Beställningsadress" className={cn(crm.input, 'mb-2')} aria-label="E-postadress" />
            {/* Etiketten säger också VARFÖR minst ett krävs — knappen är avstängd tills något är
                valt, och utan förklaring ser det ut som att formuläret hänger sig. */}
            <span className={LABEL}>Levererar</span>
            <MaterialChecklist columns={1} selected={newMaterials} onToggle={(m) => setNewMaterials((prev) => toggle(prev, m))} />
            <p className="mt-1.5 text-[11px] text-slate-400">Minst ett — materialet avgör när leverantören föreslås som mottagare.</p>
            <button type="submit" disabled={busy || !newName.trim() || !newEmail.trim() || newMaterials.length === 0} className="mt-2.5 h-9 w-full rounded-lg border border-emerald-200 bg-emerald-50 text-[12.5px] font-bold text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-50">Lägg till leverantör</button>
          </form>
        </>
      }
      detail={
        !supplier ? (
          <EmptyDetail text="Välj en leverantör för att redigera." />
        ) : (
          <div className="grid gap-3.5">
            <div className={PANEL}>
              <h3 className="text-[13.5px] font-extrabold text-[#142c1b]">Grunduppgifter</h3>
              <p className="mb-3 mt-0.5 text-[11.5px] text-slate-500">
                Beställningen mailas till adressen här — den hämtas på servern och skickas aldrig med från webbläsaren.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div><span className={LABEL}>Namn</span><input value={supplier.name} onChange={(e) => patchLocal(supplier.id, { name: e.target.value })} className={crm.input} /></div>
                <div><span className={LABEL}>E-post</span><input type="email" value={supplier.email} onChange={(e) => patchLocal(supplier.id, { email: e.target.value })} className={crm.input} /></div>
                <div><span className={LABEL}>Kontaktperson</span><input value={supplier.contact_name ?? ''} onChange={(e) => patchLocal(supplier.id, { contact_name: e.target.value || null })} className={crm.input} /></div>
                <div><span className={LABEL}>Telefon</span><input value={supplier.phone ?? ''} onChange={(e) => patchLocal(supplier.id, { phone: e.target.value || null })} className={crm.input} /></div>
              </div>
              <label className="mt-3.5 flex cursor-pointer items-center justify-between gap-3">
                <span>
                  <span className="block text-[12.5px] font-bold text-slate-800">Aktiv</span>
                  <span className="block text-[11px] text-slate-400">Inaktiva leverantörer ligger kvar i registret men kan inte väljas som mottagare</span>
                </span>
                <input type="checkbox" checked={supplier.active} onChange={(e) => patchLocal(supplier.id, { active: e.target.checked })} className="h-4 w-4 accent-[color:var(--ek-accent)]" />
              </label>
              <button onClick={onSave} disabled={busy} className={cn(crm.formButton, 'mt-3.5')} style={{ backgroundColor: 'var(--crm-primary)' }}>Spara</button>
            </div>

            <div className={PANEL}>
              <h3 className="text-[13.5px] font-extrabold text-[#142c1b]">Material och ledtid</h3>
              <p className="mb-3 mt-0.5 text-[11.5px] text-slate-500">
                Materialet avgör vilken leverantör som föreslås som mottagare. Ledtiden styr hur långt före depån tar slut beställningen dateras.
              </p>
              <span className={LABEL}>Levererar</span>
              <MaterialChecklist selected={supplier.materials} onToggle={(m) => patchLocal(supplier.id, { materials: toggle(supplier.materials, m) })} />
              <div className="mt-3.5 grid grid-cols-2 gap-3">
                <div>
                  <span className={LABEL}>Ledtid (dagar)</span>
                  <input
                    type="number"
                    min={0}
                    max={365}
                    value={supplier.lead_time_days}
                    // Ett tomt fält ger '' → NaN, som skrivs som null och failar i schemat. Noll är
                    // ett giltigt svar ("levererar samma dag") och rätt förval här.
                    onChange={(e) => patchLocal(supplier.id, { lead_time_days: Number(e.target.value) || 0 })}
                    className={cn(crm.input, 'tabular-nums')}
                    aria-label="Ledtid i dagar"
                  />
                </div>
                <div><span className={LABEL}>Notering</span><input value={supplier.note ?? ''} onChange={(e) => patchLocal(supplier.id, { note: e.target.value || null })} className={crm.input} /></div>
              </div>
              <p className="mt-1.5 text-[11px] text-slate-400">
                Beställningsförslaget avrundas upp till hela pallar för de material vars packning är känd
                (Ekovilla och Knauf Supafil). Pallstorleken hör till materialet, inte till leverantören, och
                ligger i materialkatalogen — för övriga material föreslås ett exakt säckantal tills packningen
                fyllts i.
              </p>
              <button onClick={onSave} disabled={busy} className={cn(crm.formButton, 'mt-3.5')} style={{ backgroundColor: 'var(--crm-primary)' }}>Spara</button>
            </div>

            <RiskZone
              title="Riskzon"
              body="Avaktivera hellre än ta bort — en avaktiverad leverantör kan inte väljas som mottagare men finns kvar i registret. Ta bort bara en rad som lagts upp av misstag."
              label="Ta bort leverantör"
              onConfirm={onRemove}
              busy={busy}
            />
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
                <input type="checkbox" checked={jt.active} onChange={(e) => patchLocal(jt.id, { active: e.target.checked })} className="h-4 w-4 accent-[color:var(--ek-accent)]" />
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
const EXPECTED_API = '/api/crm/planering/expected-deliveries';

function balanceClass(b: number) {
  return b < 0 ? 'text-rose-600' : b === 0 ? 'text-amber-600' : 'text-emerald-700';
}

/**
 * En rad i listan över väntade leveranser, med inbyggd redigering.
 *
 * Egen komponent, och utkastet bor HÄR och inte i panelen: med ett delat redigeringstillstånd bär
 * fälten kvar föregående rads värden när man öppnar nästa, och det syns inte förrän någon sparar
 * fel siffra på fel leverans. Samma skäl som `key`-noten på PlaceholderModal.
 *
 * Att ändra i stället för att avboka och lägga upp på nytt är hela poängen: en flyttad leverans är
 * SAMMA beställning, och två rader hade sett ut som två.
 */
function ExpectedRow({
  item,
  depots,
  today,
  canManage,
  onSaved,
  onCancel,
}: {
  item: ExpectedDelivery;
  depots: OpsDepot[];
  today: string;
  canManage: boolean;
  onSaved: () => Promise<void>;
  onCancel: (id: string) => Promise<void>;
}) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [depotId, setDepotId] = useState(item.depot_id);
  const [material, setMaterial] = useState(item.material);
  const [sacks, setSacks] = useState(String(item.sacks));
  const [expectedOn, setExpectedOn] = useState(item.expected_on);
  const [note, setNote] = useState(item.note ?? '');
  const [saving, setSaving] = useState(false);

  const late = item.expected_on < today;

  function startEditing() {
    // Läs om ur raden varje gång: ett avbrutet försök ska inte lämna kvar sina ändringar till nästa.
    setDepotId(item.depot_id);
    setMaterial(item.material);
    setSacks(String(item.sacks));
    setExpectedOn(item.expected_on);
    setNote(item.note ?? '');
    setEditing(true);
  }

  async function save() {
    const count = Number(sacks);
    if (!depotId || !material || !(count > 0) || saving) return;
    setSaving(true);
    try {
      const r = await fetch(`${EXPECTED_API}/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          depot_id: depotId,
          material,
          sacks: count,
          expected_on: expectedOn,
          note: note.trim() || null,
        }),
      });
      const j = await r.json().catch(() => null);
      if (!j?.ok) return toast.error(j?.error || 'Kunde inte spara ändringen');
      toast.success('Leveransen ändrad');
      setEditing(false);
      await onSaved();
    } catch {
      toast.error('Kunde inte spara ändringen');
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <li className="flex items-center justify-between gap-3 rounded-xl border border-dashed border-[#dce4d8] bg-[#fcfdfb] px-3 py-2">
        <div className="min-w-0">
          <div className="truncate text-[12.5px] font-semibold text-slate-700">
            {item.depot_name} · {item.sacks} säck {item.material}
          </div>
          <div className={cn('text-[11px] tabular-nums', late ? 'font-semibold text-amber-700' : 'text-slate-400')}>
            {late ? 'Skulle ha kommit' : 'Väntas'} {item.expected_on}
            {item.note ? ` · ${item.note}` : ''}
          </div>
        </div>
        {canManage && (
          <div className="flex shrink-0 items-center gap-2">
            <button type="button" onClick={startEditing} className={crm.ghostButton}>
              Ändra
            </button>
            {/* "Avboka", inte "Avbryt". Samma komponent använder "Avbryt" för det ofarliga
                stänga-utan-att-spara, och ReceiveDeliveryModal likaså — samma ord för två motsatta
                handlingar, varav den ena inte går att ångra. */}
            <button type="button" onClick={() => onCancel(item.id)} className={crm.dangerButton}>
              Avboka
            </button>
          </div>
        )}
      </li>
    );
  }

  return (
    <li className="rounded-xl border border-[color:var(--ek-accent)] bg-white px-3 py-2.5">
      <div className="grid gap-2.5 sm:grid-cols-4">
        <div>
          <span className={LABEL}>Depå</span>
          <SelectMenu
            value={depotId}
            onChange={setDepotId}
            aria-label="Depå"
            options={depots.map((d) => ({ value: d.id, label: d.name }))}
          />
        </div>
        <div>
          <span className={LABEL}>Material</span>
          <SelectMenu
            value={material}
            onChange={setMaterial}
            aria-label="Material"
            options={MATERIAL_SHORTS.map((m) => ({ value: m, label: m }))}
          />
        </div>
        <div>
          <span className={LABEL}>Säckar</span>
          <input type="number" min={1} value={sacks} onChange={(ev) => setSacks(ev.target.value)} className={crm.input} aria-label="Antal säckar" />
        </div>
        {/* Inget max: en väntad leverans ligger normalt framåt, och ska kunna flyttas åt båda håll. */}
        <div>
          <span className={LABEL}>Väntas</span>
          <input type="date" value={expectedOn} onChange={(ev) => setExpectedOn(ev.target.value)} className={cn(crm.input, 'tabular-nums')} aria-label="Väntat datum" />
        </div>
      </div>
      <div className="mt-2.5 grid grid-cols-[1fr_auto_auto] gap-2.5">
        <input value={note} onChange={(ev) => setNote(ev.target.value)} placeholder="Notering (valfritt)" className={crm.input} aria-label="Notering" />
        <button type="button" onClick={() => setEditing(false)} className={crm.ghostButton}>
          Avbryt
        </button>
        <button
          type="button"
          onClick={save}
          disabled={saving || !depotId || !(Number(sacks) > 0)}
          className={crm.formButton}
          style={{ backgroundColor: 'var(--crm-primary)' }}
        >
          {saving ? 'Sparar…' : 'Spara'}
        </button>
      </div>
    </li>
  );
}

const EXCLUDED_SHOWN = 8;

const EXCLUSION_TEXT: Record<'no_depot' | 'no_material' | 'no_date', string> = {
  no_depot: 'ligger på en bil utan depå — behovet tillhör ingen depå',
  no_material: 'inget material gick att härleda ur artikelnamnen',
  no_date: 'saknar startdag — räknas i saldot, men kan inte placeras på en dag',
};

/**
 * Prognoskortet: när tar depån slut, hur mycket behövs och senast vilken dag måste det beställas.
 *
 * ⚠️ REDOVISAR VAD SOM INTE KUNDE RÄKNAS. Jobb utan depå eller utan igenkänt material hoppades förr
 * tyst över, och ett underlag med hål såg då exakt ut som ett komplett. Skillnaden är ett
 * beställningsförslag som är för lågt utan att någon kan se det — därför står bortfallet i kortet,
 * inte i en logg.
 */
function ForecastCard({ forecast }: { forecast: DepotForecast }) {
  const needed = rowsNeedingOrder(forecast);
  const overdue = forecast.rows.filter((r) => r.overdue_inflow > 0);
  if (needed.length === 0 && overdue.length === 0 && forecast.excluded.length === 0) return null;

  return (
    <div className={PANEL}>
      <h3 className="text-[13.5px] font-extrabold text-[#142c1b]">Prognos</h3>
      <p className="mb-3 mt-0.5 text-[11.5px] text-slate-500">
        När depån tar slut, och hur mycket som behöver beställas. Väntade leveranser är inräknade.
      </p>

      {needed.length === 0 ? (
        <p className="text-[12px] text-emerald-700">
          Lagret räcker för allt som är bokat.{' '}
          {/* ⚠️ Kan stå ovanför ett rött "Lager räcker inte" på depåkortet nedan, och det är inte
              en motsägelse utan två olika frågor: saldot räknar inte väntade leveranser (de står
              inte på depån), prognosen gör det (de kommer innan behovet). Sägs det inte rakt ut
              läses det som att en av dem har fel. */}
          <span className="text-slate-500">Väntade leveranser är inräknade här, men inte i saldot nedan.</span>
        </p>
      ) : (
        <ul className="grid gap-1.5">
          {needed.map((r) => (
            <li
              key={`${r.depot_id}-${r.material}`}
              className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 rounded-xl border border-[#e0e8dc] bg-[#f9fbf7] px-3 py-2"
            >
              <span className="text-[12.5px] font-semibold text-slate-700">
                {r.depot_name} · {r.material}
              </span>
              <span className="text-[11.5px] tabular-nums text-slate-500">
                {/* run_out_day kan inte vara null här (worst_deficit > 0), men texten ska inte
                    bero på att den invarianten håller. */}
                {r.run_out_day ? <>tar slut <strong className="text-rose-600">{shortDayISO(r.run_out_day)}</strong></> : 'underskott'}
                {' · behöver '}
                {/* Orden kommer ur describeSuggestion (ren, enhetstestad); färgerna hör hit.
                    Pallen är beställningsenheten — säckantalet är det man räknar i. */}
                {(() => {
                  const p = describeSuggestion(r);
                  if (p.kind === 'unknown_pallet') {
                    // ⚠️ Okänd packning får inte se ut som "inga pallar". Ett säckantal utan
                    // pallstorlek är inget man kan beställa.
                    return (
                      <>
                        <strong className="text-slate-700">{p.sacks} säck</strong>
                        <span className="text-amber-700"> · pallstorlek okänd för {p.material}</span>
                      </>
                    );
                  }
                  return (
                    <>
                      <strong className="text-slate-700">
                        {p.pallets} {p.unit}
                      </strong>
                      <span className="text-slate-400">
                        {' ('}
                        {p.sacks} säck
                        {p.deficit !== null && <>, behovet är {p.deficit}</>}
                        {')'}
                      </span>
                    </>
                  );
                })()}
                {r.suggested_date ? (
                  <> · beställ senast {shortDayISO(r.suggested_date)}</>
                ) : (
                  // 🧨 Aldrig ett datum vi inte kan räkna. Med okänd ledtid blev "beställ senast"
                  // run-out-dagen själv — alltså "beställ den dag depån är tom", ett senare datum
                  // som såg ut som en instruktion.
                  <span className="text-amber-700"> · ledtid okänd, sätt leverantör för materialet</span>
                )}
                {r.beyond_horizon > 0 && (
                  <span className="text-slate-400"> · {r.beyond_horizon} säck bokade längre fram</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* En försenad leverans räknas inte som anländ — men den som ska beställa behöver veta att
          den finns, annars beställs samma lass en gång till. */}
      {overdue.length > 0 && (
        <div className="mt-2.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
          <div className="text-[11.5px] font-bold text-amber-800">Beställt men försenat</div>
          <ul className="mt-0.5 grid gap-0.5">
            {overdue.map((r) => (
              <li key={`late-${r.depot_id}-${r.material}`} className="text-[11px] tabular-nums text-amber-700">
                {r.depot_name} · {r.material}: {r.overdue_inflow} säck skulle ha kommit
              </li>
            ))}
          </ul>
          <p className="mt-1 text-[10.5px] text-amber-600">
            Räknas inte i prognosen ovan — hör av dig till fabriken hellre än att beställa igen.
          </p>
        </div>
      )}

      {forecast.excluded.length > 0 && (
        <div className="mt-2.5 rounded-xl border border-slate-200 bg-white px-3 py-2">
          <div className="text-[11.5px] font-bold text-slate-700">
            {forecast.excluded.length} jobb kunde inte räknas
          </div>
          <ul className="mt-0.5 grid gap-0.5">
            {/* Tak: listan är inte en logg. Utan det kunde ett systematiskt fel (t.ex. en bil som
                tappat sin depå) fylla modalen med hundratals rader och trycka ned siffrorna som
                faktiskt ska läsas. Antalet står i rubriken, så inget döljs. */}
            {forecast.excluded.slice(0, EXCLUDED_SHOWN).map((e) => (
              <li key={`${e.work_order_id}-${e.reason}`} className="text-[11px] text-slate-500">
                {/* Åtta tecken av ett uuid går inte att söka på någonstans i appen. Länken gör
                    raden användbar: den öppnar arbetsordern där felet faktiskt går att rätta. */}
                <a href={`/crm/arbetsorder/${e.work_order_id}`} className={crm.link} target="_blank" rel="noreferrer">
                  Öppna arbetsordern
                </a>{' '}
                — {EXCLUSION_TEXT[e.reason]}
              </li>
            ))}
            {forecast.excluded.length > EXCLUDED_SHOWN && (
              <li className="text-[11px] font-semibold text-slate-500">
                … och {forecast.excluded.length - EXCLUDED_SHOWN} till
              </li>
            )}
          </ul>
          <p className="mt-1 text-[10.5px] text-slate-400">
            Siffrorna ovan är alltså för låga. Rätta jobben så räknas de med.
          </p>
        </div>
      )}
    </div>
  );
}

function StockPanel({
  canWrite,
  canManageDepots,
  depotOptions,
}: {
  canWrite: boolean;
  canManageDepots: boolean;
  depotOptions: OpsDepot[];
}) {
  const toast = useToast();
  const [depots, setDepots] = useState<DepotBalance[]>([]);
  const [forecast, setForecast] = useState<DepotForecast | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Swedish calendar day, not UTC: toISOString() booked the delivery to yesterday when recorded
  // between midnight and 02:00.
  const today = stockholmTodayISO();
  const [depotId, setDepotId] = useState('');
  const [material, setMaterial] = useState(MATERIAL_SHORTS[0] ?? '');
  const [sacks, setSacks] = useState('');
  const [deliveredOn, setDeliveredOn] = useState(today);
  const [note, setNote] = useState('');

  // Väntad leverans — eget formulär, egna fält. Delas de med det ovan blir det oklart vilken
  // knapp som gör vad, och skillnaden mellan "står på depån" och "är på väg" är hela poängen.
  const [expDepotId, setExpDepotId] = useState('');
  const [expMaterial, setExpMaterial] = useState(MATERIAL_SHORTS[0] ?? '');
  const [expSacks, setExpSacks] = useState('');
  const [expOn, setExpOn] = useState(today);
  const [expNote, setExpNote] = useState('');
  const [expBusy, setExpBusy] = useState(false);
  const [open, setOpen] = useState<ExpectedDelivery[]>([]);

  // Förval när depåregistret landat. Inte ur lagersaldot: det failar stängt, och då hade
  // väljaren stått tom på en yta som ska fungera även när saldot inte gick att räkna ut.
  useEffect(() => {
    setExpDepotId((cur) => cur || (depotOptions[0]?.id ?? ''));
  }, [depotOptions]);

  // 🧨 Ett fel får inte se ut som ett tomt lager. Saldot failar stängt sedan lagerläsningarna
  // började propagera sina fel (getDepotStock), och utan den här grenen renderades 500:an som
  // "Inga depåer upplagda än" — alltså ett påstående om verkligheten, byggt på att vi inte vet.
  // Samma felklass som "ej rapporterat" kontra "0 st".
  async function load() {
    try {
      const r = await fetch(STOCK_API, { cache: 'no-store' });
      const j = await r.json().catch(() => null);
      if (!j?.ok) throw new Error(j?.error || 'Kunde inte hämta lagersaldo');
      const list = j.data.depots as DepotBalance[];
      setDepots(list);
      // Samma svar som saldot, med flit — se getDepotStockWithForecast. Två hämtningar kan se
      // olika ögonblick, och då säger kortet och tabellen olika saker om samma depå.
      setForecast((j.data.forecast as DepotForecast | null) ?? null);
      setDepotId((cur) => cur || (list[0]?.depot_id ?? ''));
      setLoadError(null);
    } catch (e: any) {
      setLoadError(e?.message || 'Kunde inte hämta lagersaldo');
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

  // Öppna väntade leveranser — utan datumfönster, se listOpenExpected. Egen läsning: den lever
  // vidare även när saldot failar, för listan är det enda stället en utebliven leverans går att
  // hitta och avbryta.
  const loadOpen = useCallback(async () => {
    const r = await fetch(EXPECTED_API, { cache: 'no-store' });
    const j = await r.json().catch(() => null);
    if (j?.ok) setOpen(j.data.expected as ExpectedDelivery[]);
  }, []);
  useEffect(() => {
    loadOpen().catch(() => {});
  }, [loadOpen]);

  // Väntade leveranser och prognosen hör ihop: den ena är inflödet i den andra. Samlad så att
  // ingen ändringsväg kan råka uppdatera bara halva bilden.
  const reloadExpectedAndForecast = useCallback(async () => {
    await Promise.all([loadOpen(), load()]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadOpen]);

  async function cancelExpected(id: string) {
    try {
      const r = await fetch(`${EXPECTED_API}/${id}`, { method: 'DELETE' });
      const j = await r.json().catch(() => null);
      if (!j?.ok) return toast.error(j?.error || 'Kunde inte avboka leveransen');
      toast.success('Väntad leverans avbokad');
      // Prognosen räknar in väntade leveranser — en avbokning ÖPPNAR en brist som kortet annars
      // fortsatte visa som täckt. Åt det hållet är tystnaden farlig.
      await Promise.all([loadOpen(), load()]);
    } catch {
      // Utan grenen är ett nätverksfel helt tyst, och raden står kvar som om ingenting hänt.
      toast.error('Kunde inte avboka leveransen');
    }
  }

  async function recordExpected(e: FormEvent) {
    e.preventDefault();
    if (!expDepotId || !expMaterial || !(Number(expSacks) > 0)) return;
    setExpBusy(true);
    try {
      const r = await fetch(EXPECTED_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          depot_id: expDepotId,
          material: expMaterial,
          sacks: Number(expSacks),
          expected_on: expOn,
          note: expNote.trim() || null,
        }),
      });
      const j = await r.json().catch(() => null);
      if (!j?.ok) return toast.error(j?.error || 'Kunde inte lägga in leveransen');
      toast.success('Väntad leverans inlagd');
      setExpSacks('');
      setExpNote('');
      // ⚠️ SALDOT ändras inte av en väntad leverans — men PROGNOSEN gör det, och de kommer ur samma
      // svar. Kommentaren här sa förut att ingen omladdning behövdes, vilket var sant ända tills
      // prognosen fanns: utan den här raden stod kortet kvar och sa "tar slut tors" för en brist
      // som just täcktes, och nästa person beställde samma lass en gång till.
      await Promise.all([loadOpen(), load()]);
    } catch {
      // Utan den här grenen gav ett nätverksfel ingen återkoppling alls, och formuläret stod kvar
      // ifyllt — vilket bjuder in till ett andra tryck och en dubblett som ingen kan se.
      toast.error('Kunde inte lägga in leveransen');
    } finally {
      setExpBusy(false);
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
                <SelectMenu
                  value={depotId}
                  onChange={setDepotId}
                  className="min-h-9 py-0 text-[13px]"
                  aria-label="Depå"
                  placeholder="Ingen depå"
                  options={depots.map((d) => ({ value: d.depot_id, label: d.depot_name }))}
                />
              </div>
              <div><span className={LABEL}>Material</span>
                <SelectMenu
                  value={material}
                  onChange={setMaterial}
                  className="min-h-9 py-0 text-[13px]"
                  aria-label="Material"
                  options={MATERIAL_SHORTS.map((m) => ({ value: m, label: m }))}
                />
              </div>
              <div><span className={LABEL}>Säckar</span><input type="number" min={1} value={sacks} onChange={(e) => setSacks(e.target.value)} placeholder="0" className={crm.input} aria-label="Antal säckar" /></div>
              {/* max: en framtida leverans hade höjt saldot redan idag och tystat bristbanderollen.
                  Grinden som räknas sitter i createDeliverySchema — det här är bara affordansen. */}
              <div><span className={LABEL}>Datum</span><input type="date" value={deliveredOn} max={today} onChange={(e) => setDeliveredOn(e.target.value)} className={cn(crm.input, 'tabular-nums')} aria-label="Datum" /></div>
            </div>
            <div className="mt-2.5 grid grid-cols-[1fr_auto] gap-2.5">
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Notering (valfritt)" className={crm.input} aria-label="Notering" />
              <button type="submit" disabled={busy || !depotId || !(Number(sacks) > 0)} className={crm.formButton} style={{ backgroundColor: 'var(--crm-primary)' }}>Registrera</button>
            </div>
          </form>
        )}

        {/* Väntad leverans — beställt men inte framme.
            Egen ruta, med flit skild från "Registrera leverans" ovan: den ena säger att materialet
            STÅR på depån och räknas i saldot, den andra att det är på väg och inte gör det.
            Grindad på depot.manage — att säga att något är beställt är inköpsbeslutet. */}
        {canManageDepots && (
          <form onSubmit={recordExpected} className={PANEL}>
            <h3 className="text-[13.5px] font-extrabold text-[#142c1b]">Lägg in väntad leverans</h3>
            <p className="mb-3 mt-0.5 text-[11.5px] text-slate-500">
              Syns på veckotavlan som <span className="font-semibold text-slate-600">Ankommer</span>. Räknas
              <span className="font-semibold text-slate-600"> inte </span>
              i saldot förrän någon bekräftar ankomsten.
            </p>
            <div className="grid gap-2.5 sm:grid-cols-4">
              <div className="sm:col-span-1">
                <span className={LABEL}>Depå</span>
                <SelectMenu
                  value={expDepotId}
                  onChange={setExpDepotId}
                  placeholder="Välj depå"
                  aria-label="Depå"
                  options={depotOptions.map((d) => ({ value: d.id, label: d.name }))}
                />
              </div>
              <div>
                <span className={LABEL}>Material</span>
                <SelectMenu
                  value={expMaterial}
                  onChange={setExpMaterial}
                  aria-label="Material"
                  options={MATERIAL_SHORTS.map((m) => ({ value: m, label: m }))}
                />
              </div>
              <div><span className={LABEL}>Säckar</span><input type="number" min={1} value={expSacks} onChange={(e) => setExpSacks(e.target.value)} placeholder="0" className={crm.input} aria-label="Antal säckar" /></div>
              {/* INGET max här — spegelvänt mot formuläret ovan. En väntad leverans SKA normalt
                  ligga i framtiden; det är just därför den bor i en egen tabell. */}
              <div><span className={LABEL}>Väntas</span><input type="date" value={expOn} onChange={(e) => setExpOn(e.target.value)} className={cn(crm.input, 'tabular-nums')} aria-label="Väntat datum" /></div>
            </div>
            <div className="mt-2.5 grid grid-cols-[1fr_auto] gap-2.5">
              <input value={expNote} onChange={(e) => setExpNote(e.target.value)} placeholder="Notering (valfritt)" className={crm.input} aria-label="Notering" />
              <button type="submit" disabled={expBusy || !expDepotId || !(Number(expSacks) > 0)} className={crm.formButton} style={{ backgroundColor: 'var(--crm-primary)' }}>Lägg in</button>
            </div>
          </form>
        )}

        {/* Öppna väntade leveranser. Egen lista, UTAN datumfönster: tavlans remsa visar bara den
            vecka som ritas, så en leverans som aldrig kom föll tyst ur synfältet när veckan
            passerade — och det är precis den som behöver jagas. */}
        {open.length > 0 && (
          <div className={PANEL}>
            <h3 className="text-[13.5px] font-extrabold text-[#142c1b]">Väntade leveranser</h3>
            <p className="mb-3 mt-0.5 text-[11.5px] text-slate-500">
              Beställt men inte framme. Räknas inte i saldot nedan.
            </p>
            <ul className="grid gap-1.5">
              {open.map((e) => (
                <ExpectedRow
                  key={e.id}
                  item={e}
                  depots={depotOptions}
                  today={today}
                  canManage={canManageDepots}
                  // Både listan OCH prognosen: en ändrad leverans flyttar datumet den täcker.
                  onSaved={reloadExpectedAndForecast}
                  onCancel={cancelExpected}
                />
              ))}
            </ul>
            {canWrite && (
              <p className="mt-2 text-[11px] text-slate-400">
                Bekräfta ankomst gör du på veckotavlan, där leveransen står på sin dag.
              </p>
            )}
          </div>
        )}

        {loadError ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-[12px] text-rose-700">
            <div className="font-semibold">Lagersaldot kunde inte räknas ut</div>
            <p className="mt-0.5 text-rose-600">{loadError}</p>
            <p className="mt-1 text-[11px] text-rose-500">
              Siffrorna nedan visas inte, eftersom ett halvt underlag ser ut som ett fullt lager. Ladda om sidan och hör
              av dig om det står kvar.
            </p>
          </div>
        ) : depots.length === 0 ? (
          <p className="py-6 text-center text-[12px] text-slate-400">Inga depåer upplagda än. Lägg till under Depåer.</p>
        ) : (
          <>
          {forecast && <ForecastCard forecast={forecast} />}
          <div className={PANEL}>
            <h3 className="mb-3 text-[13.5px] font-extrabold text-[#142c1b]">Saldo per depå</h3>
            <div className="grid gap-2.5">
              {depots.map((d) => {
                const shortfall = d.rows.reduce((s, r) => s + r.shortfall, 0);
                return (
                <div key={d.depot_id} className="rounded-xl border border-[#e0e8dc] bg-[#f9fbf7] p-3">
                  <div className="mb-1.5 flex items-baseline justify-between gap-2">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-[13px] font-bold text-slate-800">{d.depot_name}</span>
                      {shortfall > 0 && <span className="rounded-full border border-rose-200 bg-rose-50 px-2 py-px text-[9px] font-bold text-rose-700">Lager räcker inte · −{shortfall}</span>}
                      {shortfall === 0 && d.rows.some((r) => r.balance < 0) && <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-px text-[9px] font-bold text-amber-700">Underskott</span>}
                    </span>
                    <span className={cn('shrink-0 text-[12px] font-bold tabular-nums', balanceClass(d.total_balance))}>{d.total_balance} säck</span>
                  </div>
                  {d.rows.length === 0 ? (
                    <p className="text-[11px] text-slate-400">Inga rörelser än.</p>
                  ) : (
                    <table className="w-full text-[11.5px]">
                      <thead><tr className="text-left text-[10px] uppercase tracking-wide text-slate-400"><th className="font-semibold">Material</th><th className="text-right font-semibold">Levererat</th><th className="text-right font-semibold">Förbrukat</th><th className="text-right font-semibold">Saldo</th><th className="text-right font-semibold">Planerat</th><th className="text-right font-semibold">Räcker?</th></tr></thead>
                      <tbody>
                        {d.rows.map((r) => (
                          <tr key={r.material} className="border-t border-[#eef3eb]">
                            <td className="py-1 font-semibold text-slate-700">{r.material}</td>
                            <td className="py-1 text-right tabular-nums text-slate-500">{r.delivered}</td>
                            <td className="py-1 text-right tabular-nums text-slate-500">{r.consumed}</td>
                            <td className={cn('py-1 text-right font-bold tabular-nums', balanceClass(r.balance))}>{r.balance}</td>
                            <td className="py-1 text-right tabular-nums text-slate-500">{r.planned}</td>
                            <td className="py-1 text-right font-bold tabular-nums">
                              {r.shortfall > 0 ? <span className="text-rose-600">−{r.shortfall}</span> : <span className="text-emerald-600">✓</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
                );
              })}
              <p className="text-[10.5px] text-slate-400">Planerat = säckar bokade på öppna jobb från depån. "Räcker?" visar om lagret täcker det planerade. Förbrukning fylls i automatiskt när installatörernas säckrapportering är på plats.</p>
            </div>
          </div>
          </>
        )}
      </div>
    </div>
  );
}
