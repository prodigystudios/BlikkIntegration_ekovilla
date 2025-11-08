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

  return (
    <section style={{ border: '1px solid #e5e7eb', background: '#fff', borderRadius: 16, padding: 24, display: 'grid', gap: 16 }}>
      <h2 style={{ margin: 0, fontSize: 20 }}>Blikk-koppling • Användare</h2>
      <p style={{ margin: 0, color: '#374151', fontSize: 14 }}>
        Matcha interna profiler mot Blikk-användare så tidrapporter och uppgifter får rätt användar-ID.
      </p>
      {loading && <div>Laddar…</div>}
      {error && <div style={{ color: '#b91c1c', fontSize: 13 }}>{error}</div>}
      {!loading && rows.length === 0 && <div style={{ fontSize: 14, color: '#374151' }}>Inga profiler att visa.</div>}
      {!loading && rows.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 900 }}>
            <thead>
              <tr style={{ textAlign: 'left' }}>
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
              {rows.map((r) => (
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
    </section>
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
  outline: 'none'
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
