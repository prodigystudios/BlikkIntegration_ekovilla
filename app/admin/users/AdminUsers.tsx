"use client";
import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import Badge from '../../../components/ui/Badge';
import Button from '../../../components/ui/Button';
import EmptyState from '../../../components/ui/EmptyState';
import ErrorState from '../../../components/ui/ErrorState';
import Input from '../../../components/ui/Input';
import LoadingState from '../../../components/ui/LoadingState';
import Select from '../../../components/ui/Select';
import { cn } from '../../../lib/shared/cn';

interface AdminUserRow {
  id: string;
  email: string;
  role: string;
  full_name: string | null;
  phone?: string | null;
  created_at: string;
  tags?: string[];
}

export default function AdminUsers() {
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | 'member' | 'sales' | 'admin' | 'konsult'>('all');

  // Form state
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<'member' | 'sales' | 'admin' | 'konsult'>('member');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setLoadError(null);
      // We cannot list all auth.users from the client (needs service key). Instead call an API route.
      const res = await fetch('/api/admin/users');
      if (!res.ok) {
        setLoadError('Misslyckades att hämta användare');
        setLoading(false);
        return;
      }
      const data = await res.json();
      setUsers(data.users || []);
      setLoading(false);
    })();
  }, []);

  async function createUser(e: React.FormEvent) {
    e.preventDefault();
    if (!email || !password) return;
    setCreating(true);
    setCreateError(null);
    const res = await fetch('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, full_name: name, role })
    });
    if (!res.ok) {
      setCreateError('Kunde inte skapa användare');
      setCreating(false);
      return;
    }
    const out = await res.json();
    setUsers(u => [out.user, ...u]);
    setEmail(''); setPassword(''); setName(''); setRole('member');
    setCreating(false);
  }

  const filteredUsers = users.filter((user) => {
    const term = search.trim().toLowerCase();
    const matchesRole = roleFilter === 'all' ? true : user.role === roleFilter;
    const matchesTerm = !term
      ? true
      : [user.email, user.full_name || '', user.phone || '', (user.tags || []).join(' ')].some((value) => value.toLowerCase().includes(term));
    return matchesRole && matchesTerm;
  });

  const roleCounts = users.reduce<Record<string, number>>((acc, user) => {
    acc[user.role] = (acc[user.role] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="grid gap-[18px] p-3">
      <section className="grid gap-4 rounded-[24px] border border-ui-border bg-[linear-gradient(180deg,#ffffff_0%,#f8fbff_100%)] p-5 shadow-[0_14px_36px_rgba(15,23,42,0.04)]">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="grid max-w-[720px] gap-1.5">
            <div className="flex flex-wrap gap-2">
              <Badge variant="accent" className="px-2.5 py-1 text-[11px] uppercase tracking-[0.35px]">
                Användare
              </Badge>
              <Badge>{users.length} totalt</Badge>
              <Badge>{roleCounts.admin || 0} admins</Badge>
            </div>
            <h1 className="m-0 text-[28px] leading-[1.08] tracking-[-0.4px] text-slate-900">Konton, roller och snabbare administration</h1>
            <p className="m-0 text-sm leading-[1.55] text-slate-600">Skapa användare, filtrera listan och gör snabba ändringar utan att tabeller och knappar bryter layouten.</p>
          </div>
          <div className="grid min-w-full gap-2 [grid-template-columns:repeat(auto-fit,minmax(140px,1fr))] sm:min-w-[360px]">
            <div className="grid gap-1 rounded-2xl border border-ui-border bg-white px-3 py-2.5">
              <span className="text-[11px] font-extrabold uppercase tracking-[0.3px] text-slate-500">Medlemmar</span>
              <strong className="text-xl font-extrabold text-slate-900">{roleCounts.member || 0}</strong>
            </div>
            <div className="grid gap-1 rounded-2xl border border-ui-border bg-white px-3 py-2.5">
              <span className="text-[11px] font-extrabold uppercase tracking-[0.3px] text-slate-500">Sales</span>
              <strong className="text-xl font-extrabold text-slate-900">{roleCounts.sales || 0}</strong>
            </div>
            <div className="grid gap-1 rounded-2xl border border-ui-border bg-white px-3 py-2.5">
              <span className="text-[11px] font-extrabold uppercase tracking-[0.3px] text-slate-500">Konsulter</span>
              <strong className="text-xl font-extrabold text-slate-900">{roleCounts.konsult || 0}</strong>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 xl:[grid-template-columns:minmax(300px,380px)_minmax(0,1fr)]">
        <section className="grid content-start gap-[18px] rounded-[20px] border border-ui-border bg-white p-[18px] shadow-[0_10px_28px_rgba(15,23,42,0.03)]">
          <div className="grid gap-1">
            <span className="text-[11px] font-extrabold uppercase tracking-[0.35px] text-slate-500">Ny användare</span>
            <h2 className="m-0 text-xl text-slate-900">Skapa konto</h2>
            <span className="text-[13px] text-slate-500">Lägg till konto och sätt rätt grundroll direkt.</span>
          </div>

          <form onSubmit={createUser} className="grid gap-3">
            <Input required type="email" placeholder="E-post" value={email} onChange={e => setEmail(e.target.value)} />
            <Input required type="password" placeholder="Lösenord" value={password} onChange={e => setPassword(e.target.value)} />
            <Input type="text" placeholder="Namn (valfritt)" value={name} onChange={e => setName(e.target.value)} />
            <label className="grid gap-1 text-xs font-medium text-slate-700">
              <span>Roll</span>
              <Select
                value={role}
                onChange={e => setRole(e.target.value as any)}
              >
                <option value="member">Member</option>
                <option value="sales">Sales</option>
                <option value="konsult">Konsult</option>
                <option value="admin">Admin</option>
              </Select>
            </label>
            <Button disabled={creating} type="submit" variant="primary">
              {creating ? 'Skapar…' : 'Skapa användare'}
            </Button>
            {createError && <div className="text-sm text-red-700">{createError}</div>}
          </form>
        </section>

        <section className="grid gap-4 rounded-[20px] border border-ui-border bg-white p-[18px] shadow-[0_10px_28px_rgba(15,23,42,0.03)]">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="grid gap-1">
              <h2 className="m-0 text-xl text-slate-900">Alla användare</h2>
              <span className="text-[13px] text-slate-500">Sök, filtrera och uppdatera direkt i en mer läsbar listvy.</span>
            </div>
            <div className="grid w-full gap-2 [grid-template-columns:repeat(auto-fit,minmax(180px,1fr))] sm:[width:min(100%,560px)]">
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Sök e-post, namn, telefon eller tagg" />
              <Select
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value as any)}
              >
                <option value="all">Alla roller</option>
                <option value="member">Member</option>
                <option value="sales">Sales</option>
                <option value="konsult">Konsult</option>
                <option value="admin">Admin</option>
              </Select>
            </div>
          </div>
          {loadError && <ErrorState title="Kunde inte läsa användare" message={loadError} />}
          {loading && <LoadingState label="Laddar användare" description="Hämtar konton, roller och taggar för adminlistan." />}
          {!loading && users.length === 0 && <EmptyState title="Inga användare hittades" description="Skapa första kontot eller uppdatera sidan igen senare." />}
          {!loading && users.length > 0 && (
          <div className="grid gap-3">
            {filteredUsers.map(u => (
              <UserCard key={u.id} user={u} onChanged={(nu)=>setUsers(list=>list.map(x=>x.id===nu.id?nu:x))} onDeleted={(id)=>setUsers(list=>list.filter(x=>x.id!==id))} />
            ))}
          </div>
        )}
          {!loading && users.length > 0 && filteredUsers.length === 0 && <EmptyState title="Ingen användare matchar" description="Justera sökningen eller rollfiltret för att visa fler resultat." />}
        </section>
      </section>
    </div>
  );
}

function UserCard({ user, onChanged, onDeleted }: { user: AdminUserRow; onChanged: (u: AdminUserRow)=>void; onDeleted: (id: string)=>void }) {
  const [editingName, setEditingName] = React.useState(false);
  const [nameDraft, setNameDraft] = React.useState(user.full_name || '');
  const [phoneDraft, setPhoneDraft] = React.useState(user.phone || '');
  const [roleDraft, setRoleDraft] = React.useState(user.role);
  const [saving, setSaving] = React.useState(false);
  const [busyDelete, setBusyDelete] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [tagsDraft, setTagsDraft] = React.useState((user.tags || []).join(', '));

  async function saveChanges() {
    setSaving(true);
    const tags = tagsDraft.split(',').map(s=>s.trim()).filter(Boolean);
    const payload: any = {};
    if (nameDraft !== user.full_name) payload.full_name = nameDraft;
    if (phoneDraft !== (user.phone || '')) payload.phone = phoneDraft;
    if (roleDraft !== user.role) payload.role = roleDraft;
    payload.tags = tags; // always send tags from this input
    const res = await fetch(`/api/admin/users/${user.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (!res.ok) {
      try { const j = await res.json(); console.warn('saveChanges failed', j); } catch {}
    }
    onChanged({ ...user, full_name: nameDraft || null, phone: phoneDraft || null, role: roleDraft, tags });
    setEditingName(false);
    setSaving(false);
  }
  async function deleteUser() {
    setBusyDelete(true);
    await fetch(`/api/admin/users/${user.id}`, { method: 'DELETE' });
    onDeleted(user.id);
  }

  return (
    <article className="grid gap-3.5 rounded-[18px] border border-slate-200 bg-slate-50/60 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.6)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid min-w-0 flex-1 gap-1.5 basis-[280px]">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-base font-extrabold text-slate-900">{user.full_name || 'Namn saknas'}</span>
            <Badge className={cn('px-2 py-1 text-[11px] font-extrabold uppercase tracking-[0.35px]', roleBadgeClassName(roleDraft))}>
              {roleDraft}
            </Badge>
          </div>
          <span className="break-all text-[13px] text-slate-500">{user.email}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-slate-500">Skapad {new Date(user.created_at).toLocaleDateString()}</span>
          <Link
            href={`/admin/users/${user.id}`}
            className="inline-flex min-h-9 items-center justify-center rounded-xl border border-slate-300 bg-white px-3 text-[13px] font-semibold text-slate-900 transition-colors hover:bg-slate-100"
          >
            Öppna profil
          </Link>
        </div>
      </div>

      <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(180px,1fr))]">
        <FieldBlock label="Namn">
        {editingName ? (
          <div className="flex flex-wrap gap-2">
            <Input
              value={nameDraft}
              onChange={e=>setNameDraft(e.target.value)}
              className="min-h-9 min-w-[180px] flex-1 basis-[180px] px-2.5 py-2 text-[13px]"
            />
            <Button onClick={saveChanges} disabled={saving} size="sm" variant="primary">{saving ? '...' : 'Spara'}</Button>
            <Button onClick={()=>{setEditingName(false); setNameDraft(user.full_name||'');}} size="sm" variant="secondary">Avbryt</Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-slate-900">{user.full_name || '—'}</span>
            <Button onClick={()=>setEditingName(true)} size="sm" variant="secondary" className="min-h-8 px-2 text-xs" aria-label="Redigera namn">✏️</Button>
          </div>
        )}
        </FieldBlock>

        <FieldBlock label="Telefon">
        <Input
          value={phoneDraft}
          onChange={e=>setPhoneDraft(e.target.value)}
          onBlur={saveChanges}
          placeholder="070-123 45 67"
          className="min-h-9 min-w-0 px-2.5 py-2 text-[13px]"
        />
        </FieldBlock>

        <FieldBlock label="Roll">
        <Select value={roleDraft} onChange={e=>setRoleDraft(e.target.value)} onBlur={saveChanges} className="min-h-9 px-2.5 py-2 text-[13px]">
          <option value="member">member</option>
          <option value="sales">sales</option>
          <option value="konsult">konsult</option>
          <option value="admin">admin</option>
        </Select>
        </FieldBlock>

        <FieldBlock label="Taggar">
        <Input
          value={tagsDraft}
          onChange={e=>setTagsDraft(e.target.value)}
          onBlur={saveChanges}
          placeholder="t.ex. crew, trainee"
          className="min-h-9 min-w-0 px-2.5 py-2 text-[13px]"
        />
        </FieldBlock>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {(user.tags || []).length > 0 && user.tags!.map((tag) => (
            <Badge key={tag} variant="info" className="px-2 py-1 text-[11px] font-bold">{tag}</Badge>
          ))}
          {(!user.tags || user.tags.length === 0) && <span className="text-xs text-slate-400">Inga taggar ännu</span>}
        </div>
        <div className="relative flex items-center gap-2">
          <Button onClick={()=>setConfirmDelete(true)} disabled={busyDelete} size="sm" variant="secondary" className="min-h-8 px-2 text-xs text-red-700 hover:bg-red-50" aria-label="Ta bort">🗑️</Button>
          {confirmDelete && (
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Bekräfta borttagning"
              className="absolute right-0 top-[calc(100%+8px)] z-10 flex min-w-[210px] flex-col gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-[0_8px_28px_rgba(0,0,0,0.12)]"
            >
              <div className="text-[13px] font-medium text-slate-900">Ta bort användare?</div>
              <div className="text-xs text-slate-500">{user.email}</div>
              <div className="flex justify-end gap-2">
                <Button onClick={()=>setConfirmDelete(false)} disabled={busyDelete} size="sm" variant="secondary">Avbryt</Button>
                <Button onClick={deleteUser} disabled={busyDelete} size="sm" className="border-red-700 bg-red-700 text-white hover:bg-red-800">{busyDelete ? 'Tar bort…' : 'Ta bort'}</Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

function FieldBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1.5">
      <span className="text-[11px] font-extrabold uppercase tracking-[0.35px] text-slate-500">{label}</span>
      {children}
    </label>
  );
}

function roleBadgeClassName(role: string) {
  if (role === 'admin') return 'border-red-200 bg-red-50 text-red-800';
  if (role === 'sales') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (role === 'konsult') return 'border-amber-200 bg-amber-50 text-amber-800';
  return 'border-blue-200 bg-blue-50 text-blue-700';
}

