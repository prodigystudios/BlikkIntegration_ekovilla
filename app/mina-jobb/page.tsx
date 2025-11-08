"use client";
export const dynamic = 'force-dynamic';
import { useEffect, useState } from "react";
import { createClientComponentClient } from "@supabase/auth-helpers-nextjs";
import TimeReportModal, { TimeReportModalProps } from "../../components/dashboard/TimeReportModal";
import { useToast } from "@/lib/Toast";

export default function MinaJobbPage() {
  const supabase = createClientComponentClient();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [prefill, setPrefill] = useState<{ project?: string; projectId?: string; date?: string } | null>(null);
  const toast = useToast();

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
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap: 10 }}>
        <h1 style={{ margin: 0, fontSize: 18 }}>Mina jobb</h1>
        <button
          type="button"
          onClick={() => { setPrefill(null); setModalOpen(true); }}
          style={{ display:'inline-flex', alignItems:'center', gap:8, fontSize:12, fontWeight:600, padding:'10px 14px', border:'1px solid #16a34a', background:'#16a34a', color:'#fff', borderRadius:10, boxShadow:'0 2px 4px rgba(16,185,129,0.35)', cursor:'pointer' }}
        >
          <span aria-hidden style={{ display:'inline-flex' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" strokeWidth={2} stroke="#fff" fill="none"><path d="M12 5v14M5 12h14" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </span>
          Rapportera tid
        </button>
      </div>
      {loading && <div>Laddar…</div>}
      {error && <div style={{ color:'#b91c1c' }}>Fel: {error}</div>}
      {!loading && !error && items.length === 0 && <div>Inga planerade jobb.</div>}
      <div style={{ display: 'grid', gap: 8 }}>
        {items
          .slice()
          .sort((a, b) => String(a.job_day || a.start_day).localeCompare(String(b.job_day || b.start_day)))
          .map((it) => {
            const day = it.job_day || it.start_day;
            const projectId = String(it.project_id || it.projectId || "");
            const projectLabel = it.order_number ? `#${it.order_number}` : (it.project_name || projectId);
            return (
              <div key={`${it.segment_id}|${day}`} style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 10, background: '#fff' }}>
                <div style={{ fontWeight: 700 }}>{it.project_name}</div>
                <div style={{ fontSize: 12, color: '#475569' }}>{it.customer}{it.order_number ? ` • #${it.order_number}` : ''}</div>
                <div style={{ fontSize: 12, color: '#334155' }}>{day}</div>
                <div style={{ fontSize: 12, color: '#64748b' }}>{it.truck || 'Ingen lastbil'}{it.job_type ? ` • ${it.job_type}` : ''}{typeof it.bag_count === 'number' ? ` • ${it.bag_count} säckar` : ''}</div>
                <div style={{ marginTop: 8 }}>
                  <button
                    type="button"
                    onClick={() => { setPrefill({ project: projectLabel, projectId, date: day ? String(day) : undefined }); setModalOpen(true); }}
                    style={{ display:'inline-flex', alignItems:'center', gap:8, fontSize: 12, fontWeight: 600, padding: '8px 12px', border: '1px solid #16a34a', background: '#16a34a', color: '#fff', borderRadius: 10 }}
                  >
                    Rapportera tid
                  </button>
                </div>
              </div>
            );
          })}
      </div>
      <TimeReportModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        initialProject={prefill?.project || null}
        initialProjectId={prefill?.projectId || null}
        initialDate={prefill?.date || null}
        onSubmit={async (payload: Parameters<NonNullable<TimeReportModalProps['onSubmit']>>[0]) => {
          try {
            const minutes = Math.round(payload.totalHours * 60);
            const body = {
              date: payload.date,
              minutes,
              breakMinutes: payload.breakMinutes,
              start: payload.start,
              end: payload.end,
              projectId: payload.projectId ? Number(payload.projectId) : undefined,
              activityId: payload.activityId ? Number(payload.activityId) : undefined,
              timeCodeId: payload.timecodeId ? Number(payload.timecodeId) : undefined,
              description: payload.description || undefined,
            };
            const url = process.env.NODE_ENV !== 'production' ? '/api/blikk/time-reports?debug=1' : '/api/blikk/time-reports';
            const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
            const json = await res.json().catch(()=>({}));
            if (!res.ok || !json.ok) {
              console.warn('Time report create failed', json);
              toast.error(json?.error || 'Misslyckades att spara tid');
            } else {
              toast.success('Tidrapport sparad');
              setModalOpen(false);
            }
          } catch (e:any) {
            console.warn('Time report create error', e);
            toast.error('Fel vid sparande av tid');
          }
        }}
      />
    </div>
  );
}
