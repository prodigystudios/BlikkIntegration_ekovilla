"use client";
import React from 'react';
import Badge from '../../../components/ui/Badge';
import Button from '../../../components/ui/Button';
import EmptyState from '../../../components/ui/EmptyState';
import ErrorState from '../../../components/ui/ErrorState';
import Input from '../../../components/ui/Input';
import LoadingState from '../../../components/ui/LoadingState';
import PageShell from '../../../components/ui/PageShell';
import Select from '../../../components/ui/Select';
import { cn } from '../../../lib/shared/cn';

type ProfileRow = {
  id: string;
  email: string;
  role: string;
  full_name: string | null;
  blikk_id: number | null;
  bestMatch: { id: number; email: string | null; name: string | null } | null;
};

type BlikkUserLite = { id: number; email: string | null; name: string | null };

export default function AdminBlikkUsersMapping() {
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [rows, setRows] = React.useState<ProfileRow[]>([]);
  const [blikkUsers, setBlikkUsers] = React.useState<BlikkUserLite[]>([]);
  const [saving, setSaving] = React.useState<Record<string, boolean>>({});
  const [search, setSearch] = React.useState('');

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
    } finally {
      setSaving((s) => ({ ...s, [userId]: false }));
    }
  }

  const filteredRows = rows.filter((row) => {
    const term = search.trim().toLowerCase();
    if (!term) return true;
    return [row.email, row.full_name || '', row.role, String(row.blikk_id || ''), row.bestMatch?.name || '', row.bestMatch?.email || ''].some((value) => value.toLowerCase().includes(term));
  });

  const mappedCount = rows.filter((row) => row.blikk_id != null).length;
  const suggestionCount = rows.filter((row) => row.bestMatch != null).length;

  return (
    <PageShell className="max-w-[1280px] gap-5 px-3 py-3 sm:px-4 lg:px-5">
      <section className="grid gap-4 rounded-[24px] border border-ui-border bg-[linear-gradient(180deg,#ffffff_0%,#f8fbff_100%)] p-5 shadow-[0_14px_36px_rgba(15,23,42,0.04)]">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="grid max-w-[760px] gap-1.5">
            <div className="flex flex-wrap gap-2">
              <Badge variant="accent" className="px-2.5 py-1 text-[11px] uppercase tracking-[0.35px]">Blikk-koppling</Badge>
              <Badge>{rows.length} profiler</Badge>
              <Badge>{mappedCount} kopplade</Badge>
            </div>
            <h1 className="m-0 text-[28px] text-slate-900">Synka profiler mot rätt Blikk-användare</h1>
            <p className="m-0 text-sm text-slate-700">
              Matcha interna profiler mot Blikk-användare så tidrapporter och uppgifter får rätt användar-ID.
            </p>
          </div>
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Sök e-post, namn, roll eller Blikk-ID" className="min-w-[280px] sm:w-[320px]" />
        </div>
        <div className="grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(160px,1fr))]">
          <div className="grid gap-1 rounded-2xl border border-ui-border bg-white px-3 py-2.5"><span className="text-[11px] font-extrabold uppercase tracking-[0.3px] text-slate-500">Kopplade</span><strong className="text-xl font-extrabold text-slate-900">{mappedCount}</strong></div>
          <div className="grid gap-1 rounded-2xl border border-ui-border bg-white px-3 py-2.5"><span className="text-[11px] font-extrabold uppercase tracking-[0.3px] text-slate-500">Förslag finns</span><strong className="text-xl font-extrabold text-slate-900">{suggestionCount}</strong></div>
          <div className="grid gap-1 rounded-2xl border border-ui-border bg-white px-3 py-2.5"><span className="text-[11px] font-extrabold uppercase tracking-[0.3px] text-slate-500">Okopplade</span><strong className="text-xl font-extrabold text-slate-900">{rows.length - mappedCount}</strong></div>
        </div>
      </section>
      {loading && <LoadingState label="Laddar profiler" description="Hämtar profiler och Blikk-användare för matchning." />}
      {error && <ErrorState title="Kunde inte läsa Blikk-kopplingar" message={error} />}
      {!loading && rows.length === 0 && <EmptyState title="Inga profiler att visa" description="När profiler finns här kan de kopplas mot rätt Blikk-användare." />}
      {!loading && rows.length > 0 && (
        <div className="grid gap-3">
          {filteredRows.map((row) => {
            const selectedId = row.blikk_id ?? row.bestMatch?.id ?? null;
            const status = row.blikk_id != null ? 'Kopplad' : row.bestMatch ? 'Förslag finns' : 'Okopplad';

            return (
              <article key={row.id} className="grid gap-4 rounded-[20px] border border-ui-border bg-white p-4 shadow-[0_10px_28px_rgba(15,23,42,0.03)]">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="grid min-w-0 flex-1 basis-[260px] gap-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <strong className="text-base text-slate-900">{row.full_name || 'Namn saknas'}</strong>
                      <Badge className={cn('px-2 py-1 text-[11px] font-extrabold uppercase tracking-[0.35px]', roleBadgeClassName(row.role))}>{row.role}</Badge>
                      <Badge className={cn('px-2 py-1 text-[11px] font-extrabold uppercase tracking-[0.3px]', statusBadgeClassName(status))}>{status}</Badge>
                    </div>
                    <span className="break-all text-[13px] text-slate-500">{row.email}</span>
                  </div>
                  <div className="grid gap-1.5 justify-items-start sm:justify-items-end">
                    <span className="text-[11px] font-extrabold uppercase tracking-[0.3px] text-slate-500">Nuvarande Blikk-ID</span>
                    <strong className="text-lg text-slate-900">{row.blikk_id ?? '—'}</strong>
                  </div>
                </div>

                <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(240px,1fr))]">
                  <div className="grid gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3">
                    <span className="text-[11px] font-extrabold uppercase tracking-[0.3px] text-slate-500">Förslag</span>
                    {row.bestMatch ? (
                      <div className="grid gap-0.5">
                        <strong className="text-slate-900">#{row.bestMatch.id} • {row.bestMatch.name || row.bestMatch.email || '—'}</strong>
                        <span className="text-xs text-slate-500">{row.bestMatch.email || 'Ingen e-post'}</span>
                      </div>
                    ) : (
                      <span className="text-[13px] text-slate-500">Ingen tydlig matchning hittades.</span>
                    )}
                  </div>

                  <div className="grid gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3">
                    <span className="text-[11px] font-extrabold uppercase tracking-[0.3px] text-slate-500">Välj Blikk-användare</span>
                    <BlikkUserSelect
                      users={blikkUsers}
                      value={selectedId}
                      onChange={(val) => setRows((list) => list.map((x) => (x.id === row.id ? { ...x, blikk_id: val } : x)))}
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="text-xs text-slate-500">
                    Spara när rätt Blikk-användare är vald för att låsa kopplingen på profilen.
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {row.bestMatch && row.blikk_id == null && (
                      <Button
                        onClick={() => setRows((list) => list.map((x) => (x.id === row.id ? { ...x, blikk_id: row.bestMatch!.id } : x)))}
                        variant="secondary"
                        size="sm"
                        className="border-blue-200 text-blue-700 hover:bg-blue-50"
                      >
                        Använd förslag
                      </Button>
                    )}
                    <Button
                      onClick={() => saveMapping(row.id, selectedId)}
                      disabled={saving[row.id]}
                      variant="primary"
                      size="sm"
                    >
                      {saving[row.id] ? 'Sparar…' : 'Spara koppling'}
                    </Button>
                    {row.blikk_id != null && (
                      <Button
                        onClick={() => saveMapping(row.id, null)}
                        disabled={saving[row.id]}
                        variant="secondary"
                        size="sm"
                      >
                        Rensa
                      </Button>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
      {!loading && rows.length > 0 && filteredRows.length === 0 && <EmptyState title="Ingen profil matchar sökningen" description="Justera söktermen för att visa profiler igen." />}
    </PageShell>
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

function roleBadgeClassName(role: string) {
  if (role === 'admin') return 'border-red-200 bg-red-50 text-red-800';
  if (role === 'sales') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (role === 'konsult') return 'border-amber-200 bg-amber-50 text-amber-800';
  return 'border-blue-200 bg-blue-50 text-blue-700';
}

function statusBadgeClassName(status: string) {
  if (status === 'Kopplad') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (status === 'Förslag finns') return 'border-amber-200 bg-amber-50 text-amber-800';
  return 'border-slate-200 bg-slate-50 text-slate-600';
}
