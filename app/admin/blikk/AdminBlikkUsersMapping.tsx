"use client";
import React from 'react';

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
        setRows(data.profiles || []);
        setBlikkUsers(data.blikkUsers || []);
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
        try { const msg = await res.json(); setError(msg?.error || 'Misslyckades att spara'); } catch { setError('Misslyckades att spara'); }
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
    <main style={{ padding:12, display:'grid', gap:20 }}>
      <section style={{ border: '1px solid #dbe4ef', background: 'linear-gradient(180deg, #ffffff 0%, #f8fbff 100%)', borderRadius: 24, padding: 20, display: 'grid', gap: 16, boxShadow:'0 14px 36px rgba(15,23,42,0.04)' }}>
      <div style={{ display:'flex', justifyContent:'space-between', gap:16, flexWrap:'wrap', alignItems:'flex-start' }}>
        <div style={{ display:'grid', gap:6, maxWidth:760 }}>
          <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
            <span style={eyebrowStyle}>Blikk-koppling</span>
            <span style={chipStyle}>{rows.length} profiler</span>
            <span style={chipStyle}>{mappedCount} kopplade</span>
          </div>
          <h1 style={{ margin: 0, fontSize: 28, color:'#0f172a' }}>Synka profiler mot rätt Blikk-användare</h1>
      <p style={{ margin: 0, color: '#374151', fontSize: 14 }}>
        Matcha interna profiler mot Blikk-användare så tidrapporter och uppgifter får rätt användar-ID.
      </p>
        </div>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Sök e-post, namn, roll eller Blikk-ID" style={{ ...fieldStyle, minWidth:280 }} />
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(160px, 1fr))', gap:8 }}>
        <div style={miniStatStyle}><span style={miniLabelStyle}>Kopplade</span><strong style={miniValueStyle}>{mappedCount}</strong></div>
        <div style={miniStatStyle}><span style={miniLabelStyle}>Förslag finns</span><strong style={miniValueStyle}>{suggestionCount}</strong></div>
        <div style={miniStatStyle}><span style={miniLabelStyle}>Okopplade</span><strong style={miniValueStyle}>{rows.length - mappedCount}</strong></div>
      </div>
      </section>
      {loading && <div>Laddar…</div>}
      {error && <div style={{ color: '#b91c1c', fontSize: 13 }}>{error}</div>}
      {!loading && rows.length === 0 && <div style={{ fontSize: 14, color: '#374151' }}>Inga profiler att visa.</div>}
      {!loading && rows.length > 0 && (
        <div style={{ overflowX: 'auto', border:'1px solid #dbe4ef', borderRadius:20, background:'#fff', boxShadow:'0 10px 28px rgba(15,23,42,0.03)' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 900 }}>
            <thead>
              <tr style={{ textAlign: 'left', background:'#f8fafc' }}>
                <th style={thCell}>E-post</th>
                <th style={thCell}>Namn</th>
                <th style={thCell}>Roll</th>
                <th style={thCell}>Nuvarande Blikk-ID</th>
                <th style={thCell}>Förslag</th>
                <th style={thCell}>Välj Blikk-användare</th>
                <th style={thCell}></th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((r) => (
                <tr key={r.id} style={{ borderTop: '1px solid #e5e7eb' }}>
                  <td style={tdCell}>{r.email}</td>
                  <td style={tdCell}>{r.full_name || '—'}</td>
                  <td style={tdCell}>{r.role}</td>
                  <td style={tdCell}>{r.blikk_id ?? '—'}</td>
                  <td style={tdCell}>
                    {r.bestMatch ? (
                      <span title={r.bestMatch.email || undefined}>#{r.bestMatch.id} • {r.bestMatch.name || r.bestMatch.email || '—'}</span>
                    ) : (
                      <span style={{ color: '#6b7280' }}>Ingen</span>
                    )}
                  </td>
                  <td style={tdCell}>
                    <BlikkUserSelect
                      users={blikkUsers}
                      value={r.blikk_id ?? r.bestMatch?.id ?? null}
                      onChange={(val) => setRows((list) => list.map((x) => (x.id === r.id ? { ...x, blikk_id: val } : x)))}
                    />
                  </td>
                  <td style={tdCell}>
                    <div style={{ display: 'flex', gap: 8 }}>
                      {r.bestMatch && r.blikk_id == null && (
                        <button
                          onClick={() => setRows((list) => list.map((x) => (x.id === r.id ? { ...x, blikk_id: r.bestMatch!.id } : x)))}
                          style={{ ...saveBtn, background:'#fff', color:'#2563eb', border:'1px solid #bfdbfe' }}
                        >
                          Använd förslag
                        </button>
                      )}
                      <button
                        onClick={() => saveMapping(r.id, r.blikk_id ?? r.bestMatch?.id ?? null)}
                        disabled={saving[r.id]}
                        style={saveBtn}
                      >
                        {saving[r.id] ? 'Sparar…' : 'Spara'}
                      </button>
                      {r.blikk_id != null && (
                        <button
                          onClick={() => saveMapping(r.id, null)}
                          disabled={saving[r.id]}
                          style={{ ...saveBtn, background: '#fff', color: '#111827', border: '1px solid #d1d5db' }}
                        >
                          Rensa
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!loading && rows.length > 0 && filteredRows.length === 0 && <div style={{ fontSize:13, color:'#64748b' }}>Ingen profil matchar nuvarande sökning.</div>}
    </main>
  );
}

function BlikkUserSelect({ users, value, onChange }: { users: BlikkUserLite[]; value: number | null; onChange: (v: number | null) => void }) {
  return (
    <select value={value == null ? '' : String(value)} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)} style={{ ...fieldStyle, minWidth: 280 }}>
      <option value="">— Välj —</option>
      {users.map((u) => (
        <option key={u.id} value={u.id}>
          #{u.id} • {u.name || u.email || 'okänd'}{u.email ? ` <${u.email}>` : ''}
        </option>
      ))}
    </select>
  );
}

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

const fieldStyle: React.CSSProperties = {
  padding: '8px 10px',
  border: '1px solid #d1d5db',
  borderRadius: 8,
  fontSize: 14,
  outline: 'none',
  background: '#fff'
};

const saveBtn: React.CSSProperties = {
  padding: '8px 12px',
  borderRadius: 8,
  fontSize: 13,
  border: '1px solid #111827',
  background: '#111827',
  color: '#fff',
  fontWeight: 500,
  cursor: 'pointer'
};

const eyebrowStyle: React.CSSProperties = { display:'inline-flex', alignItems:'center', padding:'4px 10px', borderRadius:999, background:'#dbeafe', border:'1px solid #bfdbfe', color:'#2563eb', fontSize:11, fontWeight:800, letterSpacing:0.35, textTransform:'uppercase' };
const chipStyle: React.CSSProperties = { display:'inline-flex', alignItems:'center', padding:'4px 8px', borderRadius:999, background:'#f8fafc', border:'1px solid #e2e8f0', color:'#475569', fontSize:12, fontWeight:700 };
const miniStatStyle: React.CSSProperties = { display:'grid', gap:5, padding:'12px 12px 10px', borderRadius:16, border:'1px solid #dbe4ef', background:'#fff' };
const miniLabelStyle: React.CSSProperties = { fontSize:11, fontWeight:800, letterSpacing:0.3, textTransform:'uppercase', color:'#64748b' };
const miniValueStyle: React.CSSProperties = { fontSize:20, fontWeight:800, color:'#0f172a' };
