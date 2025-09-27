"use client";
import React, { useEffect, useState } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import type { UserProfile } from '../../../lib/getUserProfile';

interface AdminUserRow {
  id: string;
  email: string;
  role: string;
  full_name: string | null;
  created_at: string;
}

export default function AdminUsers() {
  const supabase = createClientComponentClient();
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<'member' | 'sales' | 'admin'>('member');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      // We cannot list all auth.users from the client (needs service key). Instead call an API route.
      const res = await fetch('/api/admin/users');
      if (!res.ok) {
        setError('Misslyckades att hämta användare');
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
    setError(null);
    const res = await fetch('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, full_name: name, role })
    });
    if (!res.ok) {
      setError('Kunde inte skapa användare');
      setCreating(false);
      return;
    }
    const out = await res.json();
    setUsers(u => [out.user, ...u]);
    setEmail(''); setPassword(''); setName(''); setRole('member');
    setCreating(false);
  }

  return (
    <main style={{ padding: 32, maxWidth: 1100, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 32 }}>
      <h1 style={{ margin: 0, fontSize: 30 }}>Admin • Användare</h1>

      <section style={{ border: '1px solid #e5e7eb', background: '#fff', borderRadius: 16, padding: 24, display: 'grid', gap: 24 }}>
        <h2 style={{ margin: 0, fontSize: 20 }}>Skapa ny användare</h2>
        <form onSubmit={createUser} style={{ display: 'grid', gap: 12, maxWidth: 420 }}>
          <input required type="email" placeholder="E-post" value={email} onChange={e => setEmail(e.target.value)} style={fieldStyle} />
          <input required type="password" placeholder="Lösenord" value={password} onChange={e => setPassword(e.target.value)} style={fieldStyle} />
          <input type="text" placeholder="Namn (valfritt)" value={name} onChange={e => setName(e.target.value)} style={fieldStyle} />
          <label style={{ fontSize: 12, fontWeight: 500, color: '#374151' }}>Roll
            <select value={role} onChange={e => setRole(e.target.value as any)} style={{ ...fieldStyle, marginTop: 4 }}>
              <option value="member">Member</option>
              <option value="sales">Sales</option>
              <option value="admin">Admin</option>
            </select>
          </label>
          <button disabled={creating} type="submit" style={buttonStyle}>{creating ? 'Skapar…' : 'Skapa användare'}</button>
          {error && <div style={{ color: '#b91c1c', fontSize: 13 }}>{error}</div>}
        </form>
      </section>

      <section style={{ border: '1px solid #e5e7eb', background: '#fff', borderRadius: 16, padding: 24, display: 'grid', gap: 16 }}>
        <h2 style={{ margin: 0, fontSize: 20 }}>Alla användare</h2>
        {loading && <div>Laddar…</div>}
        {!loading && users.length === 0 && <div style={{ fontSize: 14, color: '#374151' }}>Inga användare hittades.</div>}
        {!loading && users.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 700 }}>
              <thead>
                <tr style={thRowStyle}>
                  <th style={thCell}>E-post</th>
                  <th style={thCell}>Namn</th>
                  <th style={thCell}>Roll</th>
                  <th style={thCell}>Skapad</th>
                </tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <UserRow key={u.id} user={u} onChanged={(nu)=>setUsers(list=>list.map(x=>x.id===nu.id?nu:x))} onDeleted={(id)=>setUsers(list=>list.filter(x=>x.id!==id))} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}

const fieldStyle: React.CSSProperties = {
  padding: '10px 12px',
  border: '1px solid #d1d5db',
  borderRadius: 8,
  fontSize: 14,
  outline: 'none'
};

const buttonStyle: React.CSSProperties = {
  padding: '10px 14px',
  borderRadius: 8,
  fontSize: 14,
  border: '1px solid #111827',
  background: '#111827',
  color: '#fff',
  fontWeight: 500,
  cursor: 'pointer'
};

const thRowStyle: React.CSSProperties = {
  textAlign: 'left'
};

const thCell: React.CSSProperties = {
  padding: '6px 8px',
  fontSize: 12,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  fontWeight: 600,
  color: '#374151'
};

const tdCell: React.CSSProperties = {
  padding: '8px 8px',
  fontSize: 14,
  color: '#111827'
};

function UserRow({ user, onChanged, onDeleted }: { user: AdminUserRow; onChanged: (u: AdminUserRow)=>void; onDeleted: (id: string)=>void }) {
  const [editingName, setEditingName] = React.useState(false);
  const [nameDraft, setNameDraft] = React.useState(user.full_name || '');
  const [roleDraft, setRoleDraft] = React.useState(user.role);
  const [saving, setSaving] = React.useState(false);
  const [busyDelete, setBusyDelete] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);

  async function saveChanges() {
    setSaving(true);
    await fetch(`/api/admin/users/${user.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ full_name: nameDraft, role: roleDraft }) });
    onChanged({ ...user, full_name: nameDraft || null, role: roleDraft });
    setEditingName(false);
    setSaving(false);
  }
  async function deleteUser() {
    setBusyDelete(true);
    await fetch(`/api/admin/users/${user.id}`, { method: 'DELETE' });
    onDeleted(user.id);
  }
  return (
    <tr style={{ borderTop: '1px solid #e5e7eb', verticalAlign: 'middle' }}>
      <td style={tdCell}>{user.email}</td>
      <td style={tdCell}>
        {editingName ? (
          <div style={{ display: 'flex', gap: 6 }}>
            <input value={nameDraft} onChange={e=>setNameDraft(e.target.value)} style={{ ...fieldStyle, padding: '4px 6px', fontSize: 13 }} />
            <button onClick={saveChanges} disabled={saving} style={{ ...miniBtn }}>{saving ? '...' : 'Spara'}</button>
            <button onClick={()=>{setEditingName(false); setNameDraft(user.full_name||'');}} style={{ ...miniBtn, background:'#fff', color:'#111827', border:'1px solid #d1d5db' }}>Avbryt</button>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span>{user.full_name || '—'}</span>
            <button onClick={()=>setEditingName(true)} style={{ ...iconBtn }} aria-label="Redigera namn">✏️</button>
          </div>
        )}
      </td>
      <td style={tdCell}>
        <select value={roleDraft} onChange={e=>setRoleDraft(e.target.value)} onBlur={saveChanges} style={{ ...fieldStyle, padding: '4px 6px', fontSize: 13 }}>
          <option value="member">member</option>
            <option value="sales">sales</option>
            <option value="admin">admin</option>
        </select>
      </td>
      <td style={tdCell}>
        <div style={{ display:'flex', alignItems:'center', gap:8, position:'relative' }}>
          <span>{new Date(user.created_at).toLocaleDateString()}</span>
          <button onClick={()=>setConfirmDelete(true)} disabled={busyDelete} style={{ ...iconBtn, color:'#b91c1c' }} aria-label="Ta bort">🗑️</button>
          {confirmDelete && (
            <div role="dialog" aria-modal="true" aria-label="Bekräfta borttagning"
              style={{ position:'absolute', top:'50%', left:'50%', transform:'translate(-50%, -50%)', background:'#fff', padding:12, border:'1px solid #e5e7eb', borderRadius:10, boxShadow:'0 8px 28px rgba(0,0,0,0.12)', minWidth:190, zIndex:10, display:'flex', flexDirection:'column', gap:8 }}>
              <div style={{ fontSize:13, fontWeight:500 }}>Ta bort användare?</div>
              <div style={{ fontSize:12, color:'#6b7280' }}>{user.email}</div>
              <div style={{ display:'flex', gap:8, justifyContent:'flex-end' }}>
                <button onClick={()=>setConfirmDelete(false)} disabled={busyDelete} style={{ ...miniBtn, background:'#fff', color:'#111827', border:'1px solid #d1d5db' }}>Avbryt</button>
                <button onClick={deleteUser} disabled={busyDelete} style={{ ...miniBtn, background:'#b91c1c', border:'1px solid #b91c1c' }}>{busyDelete ? 'Tar bort…' : 'Ta bort'}</button>
              </div>
            </div>
          )}
        </div>
      </td>
    </tr>
  );
}

const miniBtn: React.CSSProperties = {
  padding: '4px 8px',
  background: '#111827',
  color: '#fff',
  borderRadius: 6,
  fontSize: 12,
  cursor: 'pointer',
  border: '1px solid #111827'
};

const iconBtn: React.CSSProperties = {
  padding: '2px 6px',
  fontSize: 12,
  lineHeight: 1,
  cursor: 'pointer',
  background: '#f3f4f6',
  borderRadius: 6,
  border: '1px solid #e5e7eb'
};
