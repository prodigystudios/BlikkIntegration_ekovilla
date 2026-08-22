"use client";
import React from 'react';
import { crm } from '../../crm/lib/crmTokens';
import { cn } from '../../../lib/shared/cn';
import { ADMIN_CARD, ADMIN_CHECKBOX, ADMIN_ERROR_BOX, ADMIN_LABEL, ADMIN_NOTICE_BOX, AdminFilterChip } from '../components/adminUi';


type CatalogEntry = { key: string; description: string };
type RoleBundles = Record<string, string[]>;
type UserRow = { id: string; full_name: string | null; email: string | null; role: string };
type UserState = { role: string; roleKeys: string[]; overrides: Array<{ key: string; effect: 'grant' | 'revoke' }>; effective: string[] };

const ROLE_LABELS: Record<string, string> = {
  member: 'Member (installatör)',
  sales: 'Sales (säljare)',
  konsult: 'Konsult (läsbehörig)',
  admin: 'Admin',
};

// Group catalog keys by their top-level domain (crm / fortnox) for readable sections.
function groupByDomain(catalog: CatalogEntry[]) {
  const groups: Record<string, CatalogEntry[]> = {};
  for (const entry of catalog) {
    const domain = entry.key.split('.')[0];
    (groups[domain] ??= []).push(entry);
  }
  return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
}

async function getJson(url: string) {
  const res = await fetch(url, { credentials: 'same-origin' });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.ok) throw new Error(body?.error || `Fel (${res.status})`);
  return body.data;
}

async function postJson(url: string, payload: unknown) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.ok) throw new Error(body?.error || `Fel (${res.status})`);
  return body.data;
}

export default function AdminPermissions() {
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [catalog, setCatalog] = React.useState<CatalogEntry[]>([]);
  const [roleBundles, setRoleBundles] = React.useState<RoleBundles>({});
  const [roles, setRoles] = React.useState<string[]>([]);
  const [selectedRole, setSelectedRole] = React.useState<string>('sales');
  const [busyKey, setBusyKey] = React.useState<string | null>(null);

  const [users, setUsers] = React.useState<UserRow[]>([]);
  const [selectedUserId, setSelectedUserId] = React.useState<string>('');
  const [userState, setUserState] = React.useState<UserState | null>(null);
  const [userLoading, setUserLoading] = React.useState(false);

  React.useEffect(() => {
    (async () => {
      try {
        const [perms, usersData] = await Promise.all([
          getJson('/api/admin/permissions'),
          getJson('/api/admin/users').catch(() => ({ users: [] })),
        ]);
        setCatalog(perms.catalog);
        setRoleBundles(perms.roleBundles);
        setRoles(perms.roles);
        setUsers(usersData.users || []);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const grouped = React.useMemo(() => groupByDomain(catalog), [catalog]);

  async function toggleRole(key: string, present: boolean) {
    setBusyKey(`role:${key}`);
    // Optimistic update.
    setRoleBundles((prev) => {
      const list = new Set(prev[selectedRole] ?? []);
      if (present) list.add(key); else list.delete(key);
      return { ...prev, [selectedRole]: [...list] };
    });
    try {
      await postJson('/api/admin/permissions', { scope: 'role', role: selectedRole, key, present });
    } catch (e) {
      setError((e as Error).message);
      // Revert on failure.
      setRoleBundles((prev) => {
        const list = new Set(prev[selectedRole] ?? []);
        if (present) list.delete(key); else list.add(key);
        return { ...prev, [selectedRole]: [...list] };
      });
    } finally {
      setBusyKey(null);
    }
  }

  async function loadUser(id: string) {
    setSelectedUserId(id);
    setUserState(null);
    if (!id) return;
    setUserLoading(true);
    try {
      setUserState(await getJson(`/api/admin/permissions/users/${id}`));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUserLoading(false);
    }
  }

  async function setUserOverride(key: string, effect: 'grant' | 'revoke' | null) {
    if (!selectedUserId) return;
    setBusyKey(`user:${key}`);
    try {
      await postJson('/api/admin/permissions', { scope: 'user', userId: selectedUserId, key, effect });
      setUserState(await getJson(`/api/admin/permissions/users/${selectedUserId}`));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyKey(null);
    }
  }

  if (loading) return <p role="status" className="m-0 p-5 text-sm text-slate-500">Laddar…</p>;

  return (
    <div className="grid gap-4 p-5">
      <div className="grid gap-1">
        <h2 className="m-0 text-lg font-bold text-slate-900">Behörigheter</h2>
        <p className="m-0 text-sm text-slate-600">Roller är knippen av behörigheter; per-användar-overrides läggs ovanpå (neka vinner).</p>
      </div>

      {error ? (
        <div role="alert" className={ADMIN_ERROR_BOX}>
          {error}
          <button type="button" onClick={() => setError(null)} className="ml-3 underline">Stäng</button>
        </div>
      ) : null}

      <div className={ADMIN_NOTICE_BOX}>
        Ändringar slår igenom direkt i både appen och databasen (RLS).
      </div>

      {/* ── Role bundles ─────────────────────────────────────────── */}
      <section className="grid gap-3">
        <h3 className="m-0 text-base font-bold text-slate-900">Rollbehörigheter</h3>
        <div className="flex flex-wrap gap-2">
          {roles.map((role) => (
            <AdminFilterChip
              key={role}
              active={selectedRole === role}
              onClick={() => setSelectedRole(role)}
            >
              {ROLE_LABELS[role] ?? role}
            </AdminFilterChip>
          ))}
        </div>

        {selectedRole === 'admin' ? (
          <p className="text-sm text-slate-500">Admin har alla behörigheter och redigeras inte här.</p>
        ) : null}

        <div className="grid gap-4">
          {grouped.map(([domain, entries]) => (
            <div key={domain} className={cn(ADMIN_CARD, 'p-4')}>
              <div className={cn('mb-2', ADMIN_LABEL)}>{domain}</div>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {entries.map((entry) => {
                  const checked = (roleBundles[selectedRole] ?? []).includes(entry.key);
                  const disabled = selectedRole === 'admin' || busyKey === `role:${entry.key}`;
                  return (
                    <label key={entry.key} className="flex w-auto items-start gap-2.5 rounded-lg px-2 py-1.5 hover:bg-[#f9fbf7]">
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={disabled}
                        onChange={(e) => toggleRole(entry.key, e.target.checked)}
                        className={cn('mt-0.5', ADMIN_CHECKBOX)}
                      />
                      <span className="grid">
                        <span className="font-mono text-[12px] text-slate-800">{entry.key}</span>
                        <span className="text-[11px] text-slate-500">{entry.description}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Per-user overrides ───────────────────────────────────── */}
      <section className="grid gap-3">
        <h3 className="m-0 text-base font-bold text-slate-900">Per användare</h3>
        <select
          value={selectedUserId}
          onChange={(e) => loadUser(e.target.value)}
          className={cn(crm.select, 'max-w-md')}
        >
          <option value="">Välj användare…</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {(u.full_name || u.email || u.id)} — {u.role}
            </option>
          ))}
        </select>

        {userLoading ? <p role="status" className="m-0 text-sm text-slate-500">Laddar…</p> : null}

        {userState ? (
          <div className="grid gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className={cn(crm.badge, 'border-slate-200 bg-slate-50 text-slate-600')}>Roll: {ROLE_LABELS[userState.role] ?? userState.role}</span>
              <span className={cn(crm.badge, 'border-slate-200 bg-slate-50 text-slate-600 tabular-nums')}>{userState.effective.length} effektiva behörigheter</span>
            </div>
            {grouped.map(([domain, entries]) => (
              <div key={domain} className={cn(ADMIN_CARD, 'p-4')}>
                <div className={cn('mb-2', ADMIN_LABEL)}>{domain}</div>
                <div className="grid gap-1.5">
                  {entries.map((entry) => {
                    const fromRole = userState.roleKeys.includes(entry.key);
                    const override = userState.overrides.find((o) => o.key === entry.key);
                    const effective = userState.effective.includes(entry.key);
                    const busy = busyKey === `user:${entry.key}`;
                    const current: 'inherit' | 'grant' | 'revoke' = override?.effect ?? 'inherit';
                    return (
                      <div key={entry.key} className="flex flex-wrap items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-[#f9fbf7]">
                        <span className="min-w-[200px] grow">
                          <span className="font-mono text-[12px] text-slate-800">{entry.key}</span>
                          <span className="ml-2 text-[11px] text-slate-500">{fromRole ? 'i rollen' : 'ej i rollen'}</span>
                        </span>
                        <span className={cn(crm.badge, effective ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-50 text-slate-500')}>
                          {effective ? 'aktiv' : 'av'}
                        </span>
                        {/* Segmenterad trestatuskontroll — strukturen behålls med flit
                            (Ärv/Ge/Neka är ett val, inte tre knappar); precedent i
                            AdminTimeCorrectionModal:s kind-väljare. */}
                        <div className="flex overflow-hidden rounded-lg border border-[#e0e8dc]">
                          {(['inherit', 'grant', 'revoke'] as const).map((mode) => (
                            <button
                              key={mode}
                              type="button"
                              aria-pressed={current === mode}
                              disabled={busy || (mode === 'revoke' && entry.key === 'crm.admin' && userState.role === 'admin')}
                              onClick={() => setUserOverride(entry.key, mode === 'inherit' ? null : mode)}
                              className={cn(
                                'px-2.5 py-1 text-[11px] font-semibold transition',
                                current === mode
                                  ? mode === 'revoke'
                                    ? 'bg-rose-600 text-white'
                                    : mode === 'grant'
                                      ? 'bg-emerald-600 text-white'
                                      : 'bg-slate-700 text-white'
                                  : 'bg-white text-slate-600 hover:bg-[#f9fbf7]',
                              )}
                            >
                              {mode === 'inherit' ? 'Ärv' : mode === 'grant' ? 'Ge' : 'Neka'}
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </section>
    </div>
  );
}
