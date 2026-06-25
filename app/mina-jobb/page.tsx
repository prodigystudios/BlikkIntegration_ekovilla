"use client";
export const dynamic = 'force-dynamic';
import { useEffect, useState } from "react";
import { useProjectComments, formatRelativeTime } from '@/lib/useProjectComments';
import { createClientComponentClient } from "@supabase/auth-helpers-nextjs";
import TimeReportModal, { TimeReportModalProps } from "../../components/dashboard/TimeReportModal";
import { useToast } from "@/lib/Toast";
import { buildTimeReportBody } from "@/lib/domains/time-reports/payload";

const primaryBtn =
  'inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm font-semibold text-white transition hover:opacity-90';

export default function MinaJobbPage() {
  const supabase = createClientComponentClient();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [prefill, setPrefill] = useState<{ project?: string; projectId?: string; date?: string } | null>(null);
  const toast = useToast();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const today = new Date();
        const end = new Date(); end.setDate(end.getDate() + 30);
        const startStr = today.toISOString().slice(0, 10);
        const endStr = end.toISOString().slice(0, 10);
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
    <div className="mx-auto grid w-full max-w-[900px] grid-cols-1 gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="m-0 text-lg font-bold tracking-tight text-slate-900">Mina jobb</h1>
          <p className="m-0 mt-1 text-sm text-slate-500">Dina planerade jobb de närmaste 30 dagarna.</p>
        </div>
        <button type="button" onClick={() => { setPrefill(null); setModalOpen(true); }} className={primaryBtn} style={{ backgroundColor: 'var(--crm-primary)' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" fill="none" aria-hidden><path d="M12 5v14M5 12h14" strokeLinecap="round" strokeLinejoin="round" /></svg>
          Rapportera tid
        </button>
      </div>

      {loading && <div className="text-sm text-slate-400">Laddar…</div>}
      {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">Fel: {error}</div>}
      {!loading && !error && items.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-200 px-4 py-10 text-center text-sm text-slate-400">Inga planerade jobb.</div>
      )}

      <div className="grid grid-cols-1 gap-2">
        {items
          .slice()
          .sort((a, b) => String(a.job_day || a.start_day).localeCompare(String(b.job_day || b.start_day)))
          .map((it) => {
            const day = it.job_day || it.start_day;
            const projectId = String(it.project_id || it.projectId || "");
            const projectLabel = it.order_number ? `#${it.order_number}` : (it.project_name || projectId);
            return (
              <div key={`${it.segment_id}|${day}`} className="grid gap-1 rounded-xl border border-[#e3e9df] bg-[#f9fbf7] px-3.5 py-3 shadow-[0_1px_2px_rgba(15,23,42,0.05)]">
                <div className="text-[15px] font-bold text-slate-900">{it.project_name}</div>
                <div className="text-[12px] text-slate-500">{it.customer}{it.order_number ? ` • #${it.order_number}` : ''}</div>
                <div className="text-[12px] font-medium text-slate-700">{day}</div>
                <div className="text-[12px] text-slate-500">{it.truck || 'Ingen lastbil'}{it.job_type ? ` • ${it.job_type}` : ''}{typeof it.bag_count === 'number' ? ` • ${it.bag_count} säckar` : ''}</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => { setPrefill({ project: projectLabel, projectId, date: day ? String(day) : undefined }); setModalOpen(true); }}
                    className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold text-white transition hover:opacity-90"
                    style={{ backgroundColor: 'var(--crm-primary)' }}
                  >
                    Rapportera tid
                  </button>
                  <button
                    type="button"
                    onClick={() => { setExpanded(prev => ({ ...prev, [projectId]: !prev[projectId] })); }}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-800"
                  >
                    {expanded[projectId] ? 'Dölj kommentarer' : 'Visa kommentarer'}
                  </button>
                  {expanded[projectId] && <ProjectComments projectId={projectId} />}
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
            const body = buildTimeReportBody(payload as any);
            const url = process.env.NODE_ENV !== 'production' ? '/api/blikk/time-reports?debug=1' : '/api/blikk/time-reports';
            const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
            const json = await res.json().catch(() => ({}));
            if (!res.ok || !json.ok) {
              toast.error(json?.error || 'Misslyckades att spara tid');
            } else {
              toast.success('Tidrapport sparad');
              setModalOpen(false);
            }
          } catch {
            toast.error('Fel vid sparande av tid');
          }
        }}
      />
    </div>
  );
}

function ProjectComments({ projectId }: { projectId: string }) {
  const { comments, loading, error, refresh } = useProjectComments(projectId, { ttlMs: 120_000 });
  return (
    <div className="mt-2 grid w-full gap-1.5">
      <div className="flex items-center gap-2">
        <strong className="text-[12px] text-slate-900">Kommentarer</strong>
        <div className="h-px flex-1 bg-[#e0e8dc]" />
        <button type="button" onClick={() => refresh(true)} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[10px] font-semibold text-slate-600 hover:border-slate-300">Uppdatera</button>
      </div>
      {loading && comments.length === 0 && <div className="text-[11px] text-slate-500">Hämtar kommentarer…</div>}
      {error && <div className="text-[11px] text-rose-700">Fel: {error}</div>}
      {!loading && !error && comments.length === 0 && <div className="text-[11px] text-slate-500">Inga kommentarer.</div>}
      {!loading && !error && comments.length > 0 && (
        <div className="grid gap-1.5">
          {comments.slice(0, 6).map(c => (
            <div key={c.id} className="grid gap-1 rounded-lg border border-[#e3e9df] bg-white px-2.5 py-1.5">
              <div className="flex flex-wrap items-center gap-1.5">
                {c.userName && <span className="text-[10px] font-semibold text-slate-600">{c.userName}</span>}
                {c.createdAt && <span className="text-[10px] text-slate-400">{formatRelativeTime(c.createdAt)}</span>}
              </div>
              <div className="whitespace-pre-wrap text-[11px] text-slate-700">{c.text}</div>
            </div>
          ))}
          {comments.length > 6 && <div className="text-[10px] text-slate-400">Visar första 6 av {comments.length}.</div>}
        </div>
      )}
    </div>
  );
}
