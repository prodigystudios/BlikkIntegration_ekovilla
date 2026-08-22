"use client";
import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import Input from '../../../components/ui/Input';
import Select from '../../../components/ui/Select';
import { crm } from '../../crm/lib/crmTokens';
import { cn } from '../../../lib/shared/cn';
import AdminPromptDialog from '../components/AdminPromptDialog';
import { ADMIN_CARD, ADMIN_ERROR_BOX, ADMIN_INSET, ADMIN_LABEL, AdminEmptyState, AdminField, AdminFilterChip, roleBadgeClass } from '../components/adminUi';

interface AdminUserRow {
  id: string;
  email: string;
  role: string;
  full_name: string | null;
  phone?: string | null;
  created_at: string;
  tags?: string[];
}

// En källa för rollistan — chips och båda rollväljarna deriverar härifrån.
const ROLES: Array<{ id: 'member' | 'sales' | 'konsult' | 'admin'; label: string }> = [
  { id: 'member', label: 'Member' },
  { id: 'sales', label: 'Sales' },
  { id: 'konsult', label: 'Konsult' },
  { id: 'admin', label: 'Admin' },
];

const ROLE_FILTERS: Array<{ id: 'all' | (typeof ROLES)[number]['id']; label: string }> = [
  { id: 'all', label: 'Alla' },
  ...ROLES,
];

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
      setUsers(data.data?.users || data.users || []);
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
    const nextUser = out.data?.user || out.user;
    if (nextUser) setUsers(u => [nextUser, ...u]);
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
    <div className="grid gap-4 p-5">
      <div className="grid gap-1">
        <h2 className="m-0 text-lg font-bold text-slate-900">Användare</h2>
        <p className="m-0 text-sm text-slate-600">Skapa konton, sätt roller och redigera direkt i listan.</p>
      </div>

      <section className="grid gap-4 xl:[grid-template-columns:minmax(300px,380px)_minmax(0,1fr)]">
        <section className={cn(ADMIN_CARD, 'grid content-start gap-3 p-4')}>
          <h3 className="m-0 text-base font-bold text-slate-900">Skapa konto</h3>

          <form onSubmit={createUser} className="grid gap-3">
            <Input required type="email" placeholder="E-post" value={email} onChange={e => setEmail(e.target.value)} />
            <Input required type="password" placeholder="Lösenord" value={password} onChange={e => setPassword(e.target.value)} />
            <Input type="text" placeholder="Namn (valfritt)" value={name} onChange={e => setName(e.target.value)} />
            <AdminField label="Roll">
              <Select
                value={role}
                onChange={e => setRole(e.target.value as any)}
              >
                {ROLES.map((r) => (
                  <option key={r.id} value={r.id}>{r.label}</option>
                ))}
              </Select>
            </AdminField>
            <button type="submit" disabled={creating} className={crm.saveButton}>
              {creating ? 'Skapar…' : 'Skapa användare'}
            </button>
            {createError && <div role="alert" className={ADMIN_ERROR_BOX}>{createError}</div>}
          </form>
        </section>

        <section className={cn(ADMIN_CARD, 'grid gap-4 p-4')}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <h3 className="m-0 text-base font-bold text-slate-900">Alla användare</h3>
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Sök e-post, namn, telefon eller tagg"
              className="sm:w-[320px]"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {ROLE_FILTERS.map((filter) => (
              <AdminFilterChip
                key={filter.id}
                active={roleFilter === filter.id}
                onClick={() => setRoleFilter(filter.id)}
                count={filter.id === 'all' ? users.length : roleCounts[filter.id] || 0}
              >
                {filter.label}
              </AdminFilterChip>
            ))}
          </div>
          {loadError && <div role="alert" className={ADMIN_ERROR_BOX}>{loadError}</div>}
          {loading && <p role="status" className="m-0 text-sm text-slate-400">Laddar…</p>}
          {!loading && users.length === 0 && !loadError && (
            <AdminEmptyState title="Inga användare hittades" description="Skapa första kontot eller uppdatera sidan igen senare." />
          )}
          {!loading && users.length > 0 && (
          <div className="grid gap-3">
            {filteredUsers.map(u => (
              <UserCard key={u.id} user={u} onChanged={(nu)=>setUsers(list=>list.map(x=>x.id===nu.id?nu:x))} onDeleted={(id)=>setUsers(list=>list.filter(x=>x.id!==id))} />
            ))}
          </div>
        )}
          {!loading && users.length > 0 && filteredUsers.length === 0 && (
            <AdminEmptyState title="Ingen användare matchar" description="Justera sökningen eller rollfiltret för att visa fler resultat." />
          )}
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
    try {
      await fetch(`/api/admin/users/${user.id}`, { method: 'DELETE' });
      onDeleted(user.id);
    } catch {
      // Nätverksfel: släpp busy så dialogen går att stänga igen (busy spärrar
      // alla stängvägar i AdminPromptDialog).
      setBusyDelete(false);
    }
  }

  return (
    <article className={cn(ADMIN_INSET, 'grid gap-3 p-3.5')}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid min-w-0 flex-1 gap-1 basis-[280px]">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] font-bold text-slate-900">{user.full_name || 'Namn saknas'}</span>
            <span className={cn(crm.badge, roleBadgeClass(roleDraft))}>{roleDraft}</span>
          </div>
          <span className="break-all text-[11px] text-slate-500">{user.email}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] text-slate-500">Skapad {new Date(user.created_at).toLocaleDateString()}</span>
          <Link href={`/admin/users/${user.id}`} className={crm.ghostButton}>
            Öppna profil
          </Link>
        </div>
      </div>

      <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(180px,1fr))]">
        {/* Medvetet div + span, inte AdminField: blocket innehåller knappar, och en
            <label> utan htmlFor aktiverar sin första knapp vid klick på rubriken. */}
        <div className="grid gap-1">
        <span className={ADMIN_LABEL}>Namn</span>
        {editingName ? (
          <div className="flex flex-wrap gap-2">
            <Input
              value={nameDraft}
              onChange={e=>setNameDraft(e.target.value)}
              className="min-h-9 min-w-[180px] flex-1 basis-[180px] px-2.5 py-2 text-[13px]"
            />
            <button
              type="button"
              onClick={saveChanges}
              disabled={saving}
              className={crm.formButton}
              style={{ backgroundColor: 'var(--ek-green)' }}
            >
              {saving ? '...' : 'Spara'}
            </button>
            <button
              type="button"
              onClick={()=>{setEditingName(false); setNameDraft(user.full_name||'');}}
              className={crm.ghostButton}
            >
              Avbryt
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-slate-900">{user.full_name || '—'}</span>
            <button type="button" onClick={()=>setEditingName(true)} className={crm.ghostButton}>
              Redigera
            </button>
          </div>
        )}
        </div>

        <AdminField label="Telefon">
        <Input
          value={phoneDraft}
          onChange={e=>setPhoneDraft(e.target.value)}
          onBlur={saveChanges}
          placeholder="070-123 45 67"
          className="min-h-9 min-w-0 px-2.5 py-2 text-[13px]"
        />
        </AdminField>

        <AdminField label="Roll">
        <Select value={roleDraft} onChange={e=>setRoleDraft(e.target.value)} onBlur={saveChanges} className="min-h-9 px-2.5 py-2 text-[13px]">
          {ROLES.map((r) => (
            <option key={r.id} value={r.id}>{r.label}</option>
          ))}
        </Select>
        </AdminField>

        <AdminField label="Taggar">
        <Input
          value={tagsDraft}
          onChange={e=>setTagsDraft(e.target.value)}
          onBlur={saveChanges}
          placeholder="t.ex. crew, trainee"
          className="min-h-9 min-w-0 px-2.5 py-2 text-[13px]"
        />
        </AdminField>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {(user.tags || []).length > 0 && user.tags!.map((tag) => (
            <span key={tag} className={cn(crm.badge, 'border-slate-200 bg-slate-50 text-slate-600')}>{tag}</span>
          ))}
          {(!user.tags || user.tags.length === 0) && <span className="text-xs text-slate-400">Inga taggar ännu</span>}
        </div>
        <button
          type="button"
          onClick={()=>setConfirmDelete(true)}
          disabled={busyDelete}
          className={crm.dangerButton}
        >
          Ta bort
        </button>
      </div>

      {confirmDelete && (
        <AdminPromptDialog
          title="Ta bort användare?"
          message={user.email}
          confirmLabel="Ta bort"
          danger
          busy={busyDelete}
          onConfirm={() => deleteUser()}
          onClose={() => setConfirmDelete(false)}
        />
      )}
    </article>
  );
}
