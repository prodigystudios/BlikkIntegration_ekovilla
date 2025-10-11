"use client";
export const dynamic = 'force-dynamic';
import { useEffect, useState } from "react";
import { createClientComponentClient } from "@supabase/auth-helpers-nextjs";

export default function MinaJobbPage() {
  const supabase = createClientComponentClient();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        // fetch next 30 days by default
        const today = new Date();
        const end = new Date(); end.setDate(end.getDate() + 30);
        const startStr = today.toISOString().slice(0,10);
        const endStr = end.toISOString().slice(0,10);
        const { data, error } = await supabase.rpc('get_my_jobs', { start_date: startStr, end_date: endStr });
        if (error) throw error;
        if (Array.isArray(data)) setItems(data);
      } catch (e: any) {
        setError(e?.message || String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [supabase]);

  return (
    <div style={{ padding: 16, display: 'grid', gap: 12 }}>
      <h1 style={{ margin: 0, fontSize: 18 }}>Mina jobb</h1>
      {loading && <div>Laddar…</div>}
      {error && <div style={{ color:'#b91c1c' }}>Fel: {error}</div>}
      {!loading && !error && items.length === 0 && <div>Inga planerade jobb.</div>}
      <div style={{ display: 'grid', gap: 8 }}>
        {items.map((it) => (
          <div key={it.segment_id} style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 10, background: '#fff' }}>
            <div style={{ fontWeight: 700 }}>{it.project_name}</div>
            <div style={{ fontSize: 12, color: '#475569' }}>{it.customer}{it.order_number ? ` • #${it.order_number}` : ''}</div>
            <div style={{ fontSize: 12, color: '#334155' }}>{it.start_day}{it.end_day !== it.start_day ? ` – ${it.end_day}` : ''}</div>
            <div style={{ fontSize: 12, color: '#64748b' }}>{it.truck || 'Ingen lastbil'}{it.job_type ? ` • ${it.job_type}` : ''}{typeof it.bag_count === 'number' ? ` • ${it.bag_count} säckar` : ''}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
