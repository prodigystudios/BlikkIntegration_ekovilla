"use client";
import React from 'react';
import Input from '../../../components/ui/Input';
import Select from '../../../components/ui/Select';
import { crm } from '../../crm/lib/crmTokens';
import { cn } from '../../../lib/shared/cn';
import { ADMIN_CARD, ADMIN_ERROR_BOX, ADMIN_INSET, ADMIN_LABEL, AdminEmptyState, AdminFilterChip, roleBadgeClass } from '../components/adminUi';

type ProfileRow = {
  id: string;
  email: string;
  role: string;
  full_name: string | null;
  blikk_id: number | null;
  bestMatch: { id: number; email: string | null; name: string | null } | null;
};

type BlikkUserLite = { id: number; email: string | null; name: string | null };

// Status utgår ALLTID från sparat läge (row.blikk_id) — aldrig från utkastet i
// dropdownen. Utkastet lever i `drafts` tills Spara lyckas; annars ljuger både
// badge, räknare och statusfilter om vad som faktiskt ligger i databasen.
type StatusKey = 'mapped' | 'suggested' | 'unmapped';
type StatusFilter = 'all' | StatusKey;

const STATUS_META: Record<StatusKey, { label: string; badge: string }> = {
  mapped: { label: 'Kopplad', badge: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  suggested: { label: 'Förslag finns', badge: 'border-amber-200 bg-amber-50 text-amber-800' },
  unmapped: { label: 'Okopplad', badge: 'border-slate-200 bg-slate-50 text-slate-600' },
};

function statusKeyFor(row: ProfileRow): StatusKey {
  if (row.blikk_id != null) return 'mapped';
  if (row.bestMatch) return 'suggested';
  return 'unmapped';
}

export default function AdminBlikkUsersMapping() {
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [rows, setRows] = React.useState<ProfileRow[]>([]);
  const [blikkUsers, setBlikkUsers] = React.useState<BlikkUserLite[]>([]);
  const [saving, setSaving] = React.useState<Record<string, boolean>>({});
  // Osparade dropdown-val per profil-id. `undefined` = inget utkast.
  const [drafts, setDrafts] = React.useState<Record<string, number | null>>({});
  const [search, setSearch] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState<StatusFilter>('all');

  React.useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch('/api/admin/blikk/users-sync');
        if (!res.ok) throw new Error('Kunde inte hämta Blikk-användare');
        const data = await res.json();
        setRows(data.data?.profiles || data.profiles || []);
        setBlikkUsers(data.data?.blikkUsers || data.blikkUsers || []);
      } catch (e: any) {
        setError(e?.message || 'Fel vid laddning');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function saveMapping(userId: string, blikkId: number | null) {
    setSaving((s) => ({ ...s, [userId]: true }));
    try {
      const res = await fetch('/api/admin/blikk/users-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, blikkId })
      });
      if (!res.ok) {
        try {
          const msg = await res.json();
          setError(msg?.error?.message || msg?.legacyError || msg?.error || 'Misslyckades att spara');
        } catch {
          setError('Misslyckades att spara');
        }
        return;
      }
      setRows((list) => list.map((r) => (r.id === userId ? { ...r, blikk_id: blikkId } : r)));
      // Sparat = utkastet är förbrukat.
      setDrafts((d) => {
        const next = { ...d };
        delete next[userId];
        return next;
      });
    } finally {
      setSaving((s) => ({ ...s, [userId]: false }));
    }
  }

  // Rent klientside-filter på SPARAT läge — påverkar aldrig saveMapping-payloads.
  const term = search.trim().toLowerCase();
  const filteredRows = rows.filter((row) => {
    if (statusFilter === 'unmapped' && row.blikk_id != null) return false;
    if (statusFilter === 'mapped' && row.blikk_id == null) return false;
    if (statusFilter === 'suggested' && statusKeyFor(row) !== 'suggested') return false;
    if (!term) return true;
    return [row.email, row.full_name || '', row.role, String(row.blikk_id || ''), row.bestMatch?.name || '', row.bestMatch?.email || ''].some((value) => value.toLowerCase().includes(term));
  });

  const mappedCount = rows.filter((row) => row.blikk_id != null).length;
  const suggestedCount = rows.filter((row) => statusKeyFor(row) === 'suggested').length;

  return (
    <div className="grid gap-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <h2 className="m-0 text-lg font-bold text-slate-900">Blikk-koppling</h2>
          <p className="m-0 text-sm text-slate-600">Matcha profiler mot Blikk-användare så tidrapporter får rätt användar-ID.</p>
        </div>
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Sök e-post, namn, roll eller Blikk-ID" className="sm:w-[320px]" />
      </div>

      <div className="flex flex-wrap gap-2">
        <AdminFilterChip active={statusFilter === 'all'} onClick={() => setStatusFilter('all')} count={rows.length}>
          Alla
        </AdminFilterChip>
        <AdminFilterChip active={statusFilter === 'mapped'} onClick={() => setStatusFilter('mapped')} count={mappedCount}>
          Kopplade
        </AdminFilterChip>
        <AdminFilterChip active={statusFilter === 'suggested'} onClick={() => setStatusFilter('suggested')} count={suggestedCount}>
          Förslag finns
        </AdminFilterChip>
        <AdminFilterChip active={statusFilter === 'unmapped'} onClick={() => setStatusFilter('unmapped')} count={rows.length - mappedCount}>
          Okopplade
        </AdminFilterChip>
      </div>

      {loading && <p role="status" className="m-0 text-sm text-slate-400">Laddar…</p>}
      {error && <div role="alert" className={ADMIN_ERROR_BOX}>{error}</div>}
      {!loading && rows.length === 0 && !error && (
        <AdminEmptyState title="Inga profiler att visa" description="När profiler finns här kan de kopplas mot rätt Blikk-användare." />
      )}
      {!loading && rows.length > 0 && (
        <div className="grid gap-3">
          {filteredRows.map((row) => {
            const draft = drafts[row.id];
            const selectedId = draft !== undefined ? draft : (row.blikk_id ?? row.bestMatch?.id ?? null);
            const isDirty = draft !== undefined && draft !== row.blikk_id;
            const statusKey = statusKeyFor(row);

            return (
              <article key={row.id} className={cn(ADMIN_CARD, 'grid gap-3 p-4')}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="grid min-w-0 flex-1 basis-[260px] gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <strong className="text-[13px] font-bold text-slate-900">{row.full_name || 'Namn saknas'}</strong>
                      <span className={cn(crm.badge, roleBadgeClass(row.role))}>{row.role}</span>
                      <span className={cn(crm.badge, STATUS_META[statusKey].badge)}>{STATUS_META[statusKey].label}</span>
                    </div>
                    <span className="break-all text-[11px] text-slate-500">{row.email}</span>
                  </div>
                  <div className="grid gap-1 justify-items-start sm:justify-items-end">
                    <span className={ADMIN_LABEL}>Nuvarande Blikk-ID</span>
                    <strong className="text-lg tabular-nums text-slate-900">{row.blikk_id ?? '—'}</strong>
                  </div>
                </div>

                <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(240px,1fr))]">
                  <div className={cn(ADMIN_INSET, 'grid gap-2 px-3 py-2.5')}>
                    <span className={ADMIN_LABEL}>Förslag</span>
                    {row.bestMatch ? (
                      <div className="grid gap-0.5">
                        <strong className="text-slate-900">#{row.bestMatch.id} • {row.bestMatch.name || row.bestMatch.email || '—'}</strong>
                        <span className="text-xs text-slate-500">{row.bestMatch.email || 'Ingen e-post'}</span>
                      </div>
                    ) : (
                      <span className="text-[13px] text-slate-500">Ingen tydlig matchning hittades.</span>
                    )}
                  </div>

                  <div className={cn(ADMIN_INSET, 'grid gap-2 px-3 py-2.5')}>
                    <span className={ADMIN_LABEL}>Välj Blikk-användare</span>
                    <BlikkUserSelect
                      users={blikkUsers}
                      value={selectedId}
                      onChange={(val) => setDrafts((d) => ({ ...d, [row.id]: val }))}
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-end gap-2">
                  {isDirty && (
                    <span className={cn(crm.badge, 'border-amber-200 bg-amber-50 text-amber-800')}>Osparat val</span>
                  )}
                  {row.bestMatch && row.blikk_id == null && (
                    <button
                      type="button"
                      onClick={() => setDrafts((d) => ({ ...d, [row.id]: row.bestMatch!.id }))}
                      className={cn(crm.ghostButton, 'hover:border-emerald-300 hover:text-emerald-700')}
                    >
                      Använd förslag
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => saveMapping(row.id, selectedId)}
                    disabled={saving[row.id]}
                    className={crm.formButton}
                    style={{ backgroundColor: 'var(--ek-green)' }}
                  >
                    {saving[row.id] ? 'Sparar…' : 'Spara koppling'}
                  </button>
                  {row.blikk_id != null && (
                    <button
                      type="button"
                      onClick={() => saveMapping(row.id, null)}
                      disabled={saving[row.id]}
                      className={crm.ghostButton}
                    >
                      Rensa
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
      {!loading && rows.length > 0 && filteredRows.length === 0 && (
        <AdminEmptyState title="Ingen profil matchar" description="Justera sökningen eller statusfiltret för att visa profiler igen." />
      )}
    </div>
  );
}

function BlikkUserSelect({ users, value, onChange }: { users: BlikkUserLite[]; value: number | null; onChange: (v: number | null) => void }) {
  return (
    <Select value={value == null ? '' : String(value)} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)} className="min-w-0">
      <option value="">— Välj —</option>
      {users.map((u) => (
        <option key={u.id} value={u.id}>
          #{u.id} • {u.name || u.email || 'okänd'}{u.email ? ` <${u.email}>` : ''}
        </option>
      ))}
    </Select>
  );
}
