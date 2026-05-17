"use client";
import React, { useEffect, useState } from 'react';
import Link from 'next/link';

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
  const [error, setError] = useState<string | null>(null);
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
    <main style={pageStyle}>
      <section style={heroStyle}>
        <div style={{ display:'flex', justifyContent:'space-between', gap:16, flexWrap:'wrap', alignItems:'flex-start' }}>
          <div style={{ display:'grid', gap:6, maxWidth:720 }}>
            <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
              <span style={eyebrowStyle}>Användare</span>
              <span style={chipStyle}>{users.length} totalt</span>
              <span style={chipStyle}>{roleCounts.admin || 0} admins</span>
            </div>
            <h1 style={{ margin:0, fontSize:28, lineHeight:1.08, letterSpacing:-0.4, color:'#0f172a' }}>Konton, roller och snabbare administration</h1>
            <p style={{ margin:0, fontSize:14, color:'#526275', lineHeight:1.55 }}>Skapa användare, filtrera listan och gör snabba ändringar utan att tabeller och knappar bryter layouten.</p>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(140px, 1fr))', gap:8, minWidth:'min(100%, 360px)' }}>
            <div style={miniStatStyle}><span style={miniLabelStyle}>Medlemmar</span><strong style={miniValueStyle}>{roleCounts.member || 0}</strong></div>
            <div style={miniStatStyle}><span style={miniLabelStyle}>Sales</span><strong style={miniValueStyle}>{roleCounts.sales || 0}</strong></div>
            <div style={miniStatStyle}><span style={miniLabelStyle}>Konsulter</span><strong style={miniValueStyle}>{roleCounts.konsult || 0}</strong></div>
          </div>
        </div>
      </section>

      <section style={contentGridStyle}>
        <section style={createCardStyle}>
        <div style={{ display:'grid', gap:4 }}>
          <span style={sectionEyebrowStyle}>Ny användare</span>
          <h2 style={{ margin: 0, fontSize: 20, color:'#0f172a' }}>Skapa konto</h2>
          <span style={{ fontSize:13, color:'#64748b' }}>Lägg till konto och sätt rätt grundroll direkt.</span>
        </div>
        <form onSubmit={createUser} style={{ display: 'grid', gap: 12 }}>
          <input required type="email" placeholder="E-post" value={email} onChange={e => setEmail(e.target.value)} style={fieldStyle} />
          <input required type="password" placeholder="Lösenord" value={password} onChange={e => setPassword(e.target.value)} style={fieldStyle} />
          <input type="text" placeholder="Namn (valfritt)" value={name} onChange={e => setName(e.target.value)} style={fieldStyle} />
          <label style={{ fontSize: 12, fontWeight: 500, color: '#374151' }}>Roll
            <select value={role} onChange={e => setRole(e.target.value as any)} style={{ ...fieldStyle, marginTop: 4 }}>
              <option value="member">Member</option>
              <option value="sales">Sales</option>
              <option value="konsult">Konsult</option>
              <option value="admin">Admin</option>
            </select>
          </label>
          <button disabled={creating} type="submit" style={buttonStyle}>{creating ? 'Skapar…' : 'Skapa användare'}</button>
          {error && <div style={{ color: '#b91c1c', fontSize: 13 }}>{error}</div>}
        </form>
        </section>

      <section style={listCardStyle}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:12, flexWrap:'wrap' }}>
          <div style={{ display:'grid', gap:4 }}>
            <h2 style={{ margin: 0, fontSize: 20 }}>Alla användare</h2>
            <span style={{ fontSize:13, color:'#64748b' }}>Sök, filtrera och uppdatera direkt i en mer läsbar listvy.</span>
          </div>
          <div style={{ display:'grid', gap:8, gridTemplateColumns:'repeat(auto-fit, minmax(180px, 1fr))', width:'min(100%, 560px)' }}>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Sök e-post, namn, telefon eller tagg" style={{ ...fieldStyle, minWidth: 0 }} />
            <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value as any)} style={{ ...fieldStyle, minWidth: 0 }}>
              <option value="all">Alla roller</option>
              <option value="member">Member</option>
              <option value="sales">Sales</option>
              <option value="konsult">Konsult</option>
              <option value="admin">Admin</option>
            </select>
          </div>
        </div>
        {loading && <div style={{ fontSize:14, color:'#475569' }}>Laddar…</div>}
        {!loading && users.length === 0 && <div style={{ fontSize: 14, color: '#374151' }}>Inga användare hittades.</div>}
        {!loading && users.length > 0 && (
          <div style={userListStyle}>
            {filteredUsers.map(u => (
              <UserCard key={u.id} user={u} onChanged={(nu)=>setUsers(list=>list.map(x=>x.id===nu.id?nu:x))} onDeleted={(id)=>setUsers(list=>list.filter(x=>x.id!==id))} />
            ))}
          </div>
        )}
        {!loading && users.length > 0 && filteredUsers.length === 0 && <div style={{ fontSize:14, color:'#64748b' }}>Ingen användare matchar nuvarande sökning eller rollfilter.</div>}
      </section>
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
    <article style={userCardStyle}>
      <div style={{ display:'flex', justifyContent:'space-between', gap:12, flexWrap:'wrap', alignItems:'flex-start' }}>
        <div style={{ display:'grid', gap:6, minWidth:0, flex: '1 1 280px' }}>
          <div style={{ display:'flex', gap:8, flexWrap:'wrap', alignItems:'center' }}>
            <span style={userNameStyle}>{user.full_name || 'Namn saknas'}</span>
            <span style={rolePillStyle(roleDraft)}>{roleDraft}</span>
          </div>
          <span style={userEmailStyle}>{user.email}</span>
        </div>
        <div style={{ display:'flex', gap:8, flexWrap:'wrap', alignItems:'center' }}>
          <span style={metaTextStyle}>Skapad {new Date(user.created_at).toLocaleDateString()}</span>
          <Link href={`/admin/users/${user.id}`} style={profileLinkStyle}>Öppna profil</Link>
        </div>
      </div>

      <div style={userFieldsGridStyle}>
        <FieldBlock label="Namn">
        {editingName ? (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <input value={nameDraft} onChange={e=>setNameDraft(e.target.value)} style={{ ...fieldStyle, padding: '8px 10px', fontSize: 13, minWidth: 180, flex: '1 1 180px' }} />
            <button onClick={saveChanges} disabled={saving} style={{ ...miniBtn }}>{saving ? '...' : 'Spara'}</button>
            <button onClick={()=>{setEditingName(false); setNameDraft(user.full_name||'');}} style={{ ...ghostMiniBtn }}>Avbryt</button>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap:'wrap' }}>
            <span style={{ fontSize: 14, color:'#0f172a' }}>{user.full_name || '—'}</span>
            <button onClick={()=>setEditingName(true)} style={{ ...iconBtn }} aria-label="Redigera namn">✏️</button>
          </div>
        )}
        </FieldBlock>

        <FieldBlock label="Telefon">
        <input
          value={phoneDraft}
          onChange={e=>setPhoneDraft(e.target.value)}
          onBlur={saveChanges}
          placeholder="070-123 45 67"
          style={{ ...fieldStyle, padding: '8px 10px', fontSize: 13, minWidth: 0 }}
        />
        </FieldBlock>

        <FieldBlock label="Roll">
        <select value={roleDraft} onChange={e=>setRoleDraft(e.target.value)} onBlur={saveChanges} style={{ ...fieldStyle, padding: '4px 6px', fontSize: 13 }}>
          <option value="member">member</option>
          <option value="sales">sales</option>
          <option value="konsult">konsult</option>
          <option value="admin">admin</option>
        </select>
        </FieldBlock>

        <FieldBlock label="Taggar">
        <input
          value={tagsDraft}
          onChange={e=>setTagsDraft(e.target.value)}
          onBlur={saveChanges}
          placeholder="t.ex. crew, trainee"
          style={{ ...fieldStyle, padding: '8px 10px', fontSize: 13, minWidth: 0 }}
        />
        </FieldBlock>
      </div>

      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:12, flexWrap:'wrap' }}>
        <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
          {(user.tags || []).length > 0 && user.tags!.map((tag) => (
            <span key={tag} style={tagPillStyle}>{tag}</span>
          ))}
          {(!user.tags || user.tags.length === 0) && <span style={emptyMetaStyle}>Inga taggar ännu</span>}
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:8, position:'relative' }}>
          <button onClick={()=>setConfirmDelete(true)} disabled={busyDelete} style={{ ...iconBtn, color:'#b91c1c' }} aria-label="Ta bort">🗑️</button>
          {confirmDelete && (
            <div role="dialog" aria-modal="true" aria-label="Bekräfta borttagning"
              style={{ position:'absolute', top:'calc(100% + 8px)', right:0, background:'#fff', padding:12, border:'1px solid #e5e7eb', borderRadius:10, boxShadow:'0 8px 28px rgba(0,0,0,0.12)', minWidth:210, zIndex:10, display:'flex', flexDirection:'column', gap:8 }}>
              <div style={{ fontSize:13, fontWeight:500 }}>Ta bort användare?</div>
              <div style={{ fontSize:12, color:'#6b7280' }}>{user.email}</div>
              <div style={{ display:'flex', gap:8, justifyContent:'flex-end' }}>
                <button onClick={()=>setConfirmDelete(false)} disabled={busyDelete} style={{ ...ghostMiniBtn }}>Avbryt</button>
                <button onClick={deleteUser} disabled={busyDelete} style={{ ...miniBtn, background:'#b91c1c', border:'1px solid #b91c1c' }}>{busyDelete ? 'Tar bort…' : 'Ta bort'}</button>
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
    <label style={{ display:'grid', gap:6 }}>
      <span style={fieldBlockLabelStyle}>{label}</span>
      {children}
    </label>
  );
}

const pageStyle: React.CSSProperties = {
  padding: 12,
  display: 'grid',
  gap: 18,
};

const heroStyle: React.CSSProperties = {
  border: '1px solid #dbe4ef',
  background: 'linear-gradient(180deg, #ffffff 0%, #f8fbff 100%)',
  borderRadius: 24,
  padding: 20,
  display: 'grid',
  gap: 16,
  boxShadow: '0 14px 36px rgba(15,23,42,0.04)'
};

const contentGridStyle: React.CSSProperties = {
  display:'grid',
  gap:16,
  gridTemplateColumns:'minmax(300px, 380px) minmax(0, 1fr)'
};

const createCardStyle: React.CSSProperties = {
  border: '1px solid #dbe4ef',
  background: '#fff',
  borderRadius: 20,
  padding: 18,
  display: 'grid',
  gap: 18,
  alignContent:'start',
  boxShadow:'0 10px 28px rgba(15,23,42,0.03)'
};

const listCardStyle: React.CSSProperties = {
  border: '1px solid #dbe4ef',
  background: '#fff',
  borderRadius: 20,
  padding: 18,
  display: 'grid',
  gap: 16,
  boxShadow:'0 10px 28px rgba(15,23,42,0.03)'
};

const userListStyle: React.CSSProperties = {
  display:'grid',
  gap:12,
};

const userCardStyle: React.CSSProperties = {
  display:'grid',
  gap:14,
  padding:'16px 16px 14px',
  border:'1px solid #e2e8f0',
  borderRadius:18,
  background:'#fcfdff'
};

const userFieldsGridStyle: React.CSSProperties = {
  display:'grid',
  gap:12,
  gridTemplateColumns:'repeat(auto-fit, minmax(180px, 1fr))'
};

const userNameStyle: React.CSSProperties = {
  fontSize:16,
  fontWeight:800,
  color:'#0f172a'
};

const userEmailStyle: React.CSSProperties = {
  fontSize:13,
  color:'#64748b',
  wordBreak:'break-all'
};

const metaTextStyle: React.CSSProperties = {
  fontSize:12,
  color:'#64748b',
  fontWeight:600
};

const rolePillStyle = (role: string): React.CSSProperties => ({
  display:'inline-flex',
  alignItems:'center',
  padding:'4px 8px',
  borderRadius:999,
  background: role === 'admin' ? '#fee2e2' : role === 'sales' ? '#dcfce7' : role === 'konsult' ? '#fef3c7' : '#eff6ff',
  border:'1px solid '+(role === 'admin' ? '#fecaca' : role === 'sales' ? '#bbf7d0' : role === 'konsult' ? '#fde68a' : '#bfdbfe'),
  color:'#334155',
  fontSize:11,
  fontWeight:800,
  textTransform:'uppercase',
  letterSpacing:0.35
});

const fieldBlockLabelStyle: React.CSSProperties = {
  fontSize:11,
  fontWeight:800,
  textTransform:'uppercase',
  letterSpacing:0.35,
  color:'#64748b'
};

const miniBtn: React.CSSProperties = {
  padding: '7px 10px',
  background: '#111827',
  color: '#fff',
  borderRadius: 8,
  fontSize: 12,
  cursor: 'pointer',
  border: '1px solid #111827'
};

const ghostMiniBtn: React.CSSProperties = {
  ...miniBtn,
  background:'#fff',
  color:'#111827',
  border:'1px solid #d1d5db'
};

const iconBtn: React.CSSProperties = {
  padding: '6px 8px',
  fontSize: 12,
  lineHeight: 1,
  cursor: 'pointer',
  background: '#f3f4f6',
  borderRadius: 6,
  border: '1px solid #e5e7eb'
};

const profileLinkStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '9px 11px',
  borderRadius: 8,
  border: '1px solid #cbd5e1',
  background: '#f8fafc',
  color: '#0f172a',
  fontSize: 13,
  fontWeight: 700,
  textDecoration: 'none'
};

const tagPillStyle: React.CSSProperties = {
  display:'inline-flex',
  alignItems:'center',
  padding:'4px 8px',
  borderRadius:999,
  background:'#eef2ff',
  border:'1px solid #c7d2fe',
  color:'#4338ca',
  fontSize:11,
  fontWeight:700
};

const emptyMetaStyle: React.CSSProperties = {
  fontSize:12,
  color:'#94a3b8'
};

const eyebrowStyle: React.CSSProperties = {
  display:'inline-flex',
  alignItems:'center',
  padding:'4px 10px',
  borderRadius:999,
  background:'#dbeafe',
  border:'1px solid #bfdbfe',
  color:'#2563eb',
  fontSize:11,
  fontWeight:800,
  letterSpacing:0.35,
  textTransform:'uppercase'
};

const chipStyle: React.CSSProperties = {
  display:'inline-flex',
  alignItems:'center',
  padding:'4px 8px',
  borderRadius:999,
  background:'#f8fafc',
  border:'1px solid #e2e8f0',
  color:'#475569',
  fontSize:12,
  fontWeight:700
};

const miniStatStyle: React.CSSProperties = {
  display:'grid',
  gap:5,
  padding:'12px 12px 10px',
  borderRadius:16,
  border:'1px solid #dbe4ef',
  background:'#fff'
};

const miniLabelStyle: React.CSSProperties = {
  fontSize:11,
  fontWeight:800,
  letterSpacing:0.3,
  textTransform:'uppercase',
  color:'#64748b'
};

const miniValueStyle: React.CSSProperties = {
  fontSize:20,
  fontWeight:800,
  color:'#0f172a'
};

const sectionEyebrowStyle: React.CSSProperties = {
  fontSize:11,
  fontWeight:800,
  letterSpacing:0.35,
  textTransform:'uppercase',
  color:'#64748b'
};
