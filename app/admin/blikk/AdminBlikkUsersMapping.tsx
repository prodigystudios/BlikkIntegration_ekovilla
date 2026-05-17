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
    <main style={{ padding:12, display:'grid', gap:20, maxWidth:1280, margin:'0 auto' }}>
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
        <div style={cardListStyle}>
          {filteredRows.map((row) => {
            const selectedId = row.blikk_id ?? row.bestMatch?.id ?? null;
            const status = row.blikk_id != null ? 'Kopplad' : row.bestMatch ? 'Förslag finns' : 'Okopplad';

            return (
              <article key={row.id} style={mappingCardStyle}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:12, flexWrap:'wrap' }}>
                  <div style={{ display:'grid', gap:6, minWidth:0, flex:'1 1 260px' }}>
                    <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
                      <strong style={{ fontSize:16, color:'#0f172a' }}>{row.full_name || 'Namn saknas'}</strong>
                      <span style={rolePillStyle}>{row.role}</span>
                      <span style={statusPillStyle(status)}>{status}</span>
                    </div>
                    <span style={{ fontSize:13, color:'#64748b', wordBreak:'break-all' }}>{row.email}</span>
                  </div>
                  <div style={{ display:'grid', gap:6, justifyItems:'end' }}>
                    <span style={metaLabelStyle}>Nuvarande Blikk-ID</span>
                    <strong style={{ fontSize:18, color:'#0f172a' }}>{row.blikk_id ?? '—'}</strong>
                  </div>
                </div>

                <div style={mappingGridStyle}>
                  <div style={infoCardStyle}>
                    <span style={metaLabelStyle}>Förslag</span>
                    {row.bestMatch ? (
                      <div style={{ display:'grid', gap:2 }}>
                        <strong style={{ color:'#0f172a' }}>#{row.bestMatch.id} • {row.bestMatch.name || row.bestMatch.email || '—'}</strong>
                        <span style={{ fontSize:12, color:'#64748b' }}>{row.bestMatch.email || 'Ingen e-post'}</span>
                      </div>
                    ) : (
                      <span style={{ color:'#64748b', fontSize:13 }}>Ingen tydlig matchning hittades.</span>
                    )}
                  </div>

                  <div style={infoCardStyle}>
                    <span style={metaLabelStyle}>Välj Blikk-användare</span>
                    <BlikkUserSelect
                      users={blikkUsers}
                      value={selectedId}
                      onChange={(val) => setRows((list) => list.map((x) => (x.id === row.id ? { ...x, blikk_id: val } : x)))}
                    />
                  </div>
                </div>

                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:12, flexWrap:'wrap' }}>
                  <span style={{ fontSize:12, color:'#64748b' }}>
                    Spara när rätt Blikk-användare är vald för att låsa kopplingen på profilen.
                  </span>
                  <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                    {row.bestMatch && row.blikk_id == null && (
                      <button
                        onClick={() => setRows((list) => list.map((x) => (x.id === row.id ? { ...x, blikk_id: row.bestMatch!.id } : x)))}
                        style={{ ...saveBtn, background:'#fff', color:'#2563eb', border:'1px solid #bfdbfe' }}
                      >
                        Använd förslag
                      </button>
                    )}
                    <button
                      onClick={() => saveMapping(row.id, selectedId)}
                      disabled={saving[row.id]}
                      style={saveBtn}
                    >
                      {saving[row.id] ? 'Sparar…' : 'Spara koppling'}
                    </button>
                    {row.blikk_id != null && (
                      <button
                        onClick={() => saveMapping(row.id, null)}
                        disabled={saving[row.id]}
                        style={{ ...saveBtn, background: '#fff', color: '#111827', border: '1px solid #d1d5db' }}
                      >
                        Rensa
                      </button>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
      {!loading && rows.length > 0 && filteredRows.length === 0 && <div style={{ fontSize:13, color:'#64748b' }}>Ingen profil matchar nuvarande sökning.</div>}
    </main>
  );
}

function BlikkUserSelect({ users, value, onChange }: { users: BlikkUserLite[]; value: number | null; onChange: (v: number | null) => void }) {
  return (
    <select value={value == null ? '' : String(value)} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)} style={{ ...fieldStyle, minWidth: 0, width:'100%' }}>
      <option value="">— Välj —</option>
      {users.map((u) => (
        <option key={u.id} value={u.id}>
          #{u.id} • {u.name || u.email || 'okänd'}{u.email ? ` <${u.email}>` : ''}
        </option>
      ))}
    </select>
  );
}

const cardListStyle: React.CSSProperties = {
  display:'grid',
  gap:12
};

const mappingCardStyle: React.CSSProperties = {
  display:'grid',
  gap:16,
  padding:'16px 16px 14px',
  border:'1px solid #dbe4ef',
  borderRadius:20,
  background:'#fff',
  boxShadow:'0 10px 28px rgba(15,23,42,0.03)'
};

const mappingGridStyle: React.CSSProperties = {
  display:'grid',
  gap:12,
  gridTemplateColumns:'repeat(auto-fit, minmax(240px, 1fr))'
};

const infoCardStyle: React.CSSProperties = {
  display:'grid',
  gap:8,
  padding:'12px 12px 10px',
  border:'1px solid #e2e8f0',
  borderRadius:16,
  background:'#f8fbff'
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

const rolePillStyle: React.CSSProperties = {
  display:'inline-flex',
  alignItems:'center',
  padding:'4px 8px',
  borderRadius:999,
  background:'#eff6ff',
  border:'1px solid #bfdbfe',
  color:'#334155',
  fontSize:11,
  fontWeight:800,
  textTransform:'uppercase',
  letterSpacing:0.35
};

const statusPillStyle = (status: string): React.CSSProperties => ({
  display:'inline-flex',
  alignItems:'center',
  padding:'4px 8px',
  borderRadius:999,
  background: status === 'Kopplad' ? '#dcfce7' : status === 'Förslag finns' ? '#fef3c7' : '#f8fafc',
  border:'1px solid ' + (status === 'Kopplad' ? '#bbf7d0' : status === 'Förslag finns' ? '#fde68a' : '#e2e8f0'),
  color:'#475569',
  fontSize:11,
  fontWeight:800,
  letterSpacing:0.3,
  textTransform:'uppercase'
});

const metaLabelStyle: React.CSSProperties = {
  fontSize:11,
  fontWeight:800,
  letterSpacing:0.3,
  textTransform:'uppercase',
  color:'#64748b'
};

const eyebrowStyle: React.CSSProperties = { display:'inline-flex', alignItems:'center', padding:'4px 10px', borderRadius:999, background:'#dbeafe', border:'1px solid #bfdbfe', color:'#2563eb', fontSize:11, fontWeight:800, letterSpacing:0.35, textTransform:'uppercase' };
const chipStyle: React.CSSProperties = { display:'inline-flex', alignItems:'center', padding:'4px 8px', borderRadius:999, background:'#f8fafc', border:'1px solid #e2e8f0', color:'#475569', fontSize:12, fontWeight:700 };
const miniStatStyle: React.CSSProperties = { display:'grid', gap:5, padding:'12px 12px 10px', borderRadius:16, border:'1px solid #dbe4ef', background:'#fff' };
const miniLabelStyle: React.CSSProperties = { fontSize:11, fontWeight:800, letterSpacing:0.3, textTransform:'uppercase', color:'#64748b' };
const miniValueStyle: React.CSSProperties = { fontSize:20, fontWeight:800, color:'#0f172a' };
