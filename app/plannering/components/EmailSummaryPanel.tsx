"use client";
import { useMemo, useState } from 'react';

type EmailProject = { id: string; customerEmail?: string | null; customer?: string | null };

export default function EmailSummaryPanel({ projects }: { projects: EmailProject[] }) {
  const [open, setOpen] = useState(false);
  const emails = useMemo(() => {
    const map = new Map<string, { email: string; customers: Set<string>; projectIds: Set<string> }>();
    for (const p of projects) {
      if (!p?.customerEmail) continue;
      const key = p.customerEmail.toLowerCase();
      if (!map.has(key)) map.set(key, { email: p.customerEmail, customers: new Set(), projectIds: new Set() });
      const entry = map.get(key)!;
      if (p.customer) entry.customers.add(p.customer);
      if (p.id) entry.projectIds.add(p.id);
    }
    return Array.from(map.values()).sort((a, b) => a.email.localeCompare(b.email));
  }, [projects]);

  const total = emails.length;
  const copyAll = () => {
    const list = emails.map(e => e.email).join(', ');
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(list).catch(() => {});
    }
  };
  if (!total) return null;

  return (
    <div style={{ position: 'absolute', top: 8, right: 8, zIndex: 20, maxWidth: 320, fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ background: '#ffffffdd', backdropFilter: 'blur(4px)', border: '1px solid #e2e8f0', borderRadius: 8, padding: 8, boxShadow: '0 4px 12px rgba(0,0,0,0.08)', display: 'grid', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#0f172a' }}>E‑post ({total})</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => setOpen(o => !o)} style={{ fontSize: 11, border: '1px solid #cbd5e1', background: '#fff', padding: '2px 6px', borderRadius: 4, cursor: 'pointer' }}>{open ? 'Göm' : 'Visa'}</button>
            <button onClick={copyAll} disabled={!total} title="Kopiera alla" style={{ fontSize: 11, border: '1px solid #2563eb', background: '#1d4ed8', color: '#fff', padding: '2px 6px', borderRadius: 4, cursor: 'pointer' }}>Kopiera</button>
          </div>
        </div>
        {open && (
          <div style={{ maxHeight: 240, overflowY: 'auto', display: 'grid', gap: 4 }}>
            {emails.map(e => (
              <div key={e.email} style={{ border: '1px solid #e2e8f0', borderRadius: 6, padding: '4px 6px', background: '#f8fafc', display: 'grid', gap: 2 }}>
                <div style={{ fontSize: 12, fontWeight: 500, color: '#1e293b', wordBreak: 'break-all' }}>{e.email}</div>
                <div style={{ fontSize: 10, color: '#475569', display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  <span style={{ background: '#e2e8f0', padding: '1px 4px', borderRadius: 4 }}>{e.customers.size} kund</span>
                  <span style={{ background: '#e2e8f0', padding: '1px 4px', borderRadius: 4 }}>{e.projectIds.size} proj</span>
                  <button onClick={() => typeof navigator !== 'undefined' && navigator.clipboard?.writeText(e.email)} style={{ fontSize: 10, border: '1px solid #cbd5e1', background: '#fff', padding: '0 4px', borderRadius: 4, cursor: 'pointer' }}>kopiera</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
