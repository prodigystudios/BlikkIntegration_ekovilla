"use client";
export const dynamic = 'force-dynamic';
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useProjectComments, formatRelativeTime } from '@/lib/useProjectComments';
import { createClientComponentClient } from "@supabase/auth-helpers-nextjs";
import TimeReportModal, { TimeReportModalProps } from "../../components/dashboard/TimeReportModal";
import { useToast } from "@/lib/Toast";
import { buildTimeReportBody } from "@/lib/domains/time-reports/payload";
import { mergeMyJobs, type BlikkJobRow, type CrmJobRow, type MyJob } from "@/lib/domains/planning/myJobs";
import { crm, workOrderStatusLabel, workOrderStatusClass, type WorkOrderStatus } from "@/app/crm/lib/crmTokens";
import { cn } from "@/lib/shared/cn";

// The installer's feed during the CRM cutover. Two planning worlds are live at once:
//   • legacy (Blikk)  → get_my_jobs      → planning_segments; time/comments stay in Blikk
//   • new CRM         → get_my_crm_jobs  → ops_segments → crm_work_orders; opens the field view
// They are merged into one chronological list (lib/domains/planning/myJobs.ts) so a person just
// sees their week. The legacy rows drain toward zero as planning moves into CRM.

const primaryBtn =
  'inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm font-semibold text-white transition hover:opacity-90';

const dayHeadingFmt = new Intl.DateTimeFormat('sv-SE', { weekday: 'long', day: 'numeric', month: 'long' });

function formatDayHeading(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  const label = dayHeadingFmt.format(d);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

// Local calendar day, not UTC. toISOString() would return yesterday's date between midnight and
// 02:00 Swedish time — the feed would open on "tomorrow" and today's job would read as past.
function localISO(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function isToday(iso: string): boolean {
  return iso === localISO(new Date());
}

export default function MinaJobbPage() {
  const supabase = createClientComponentClient();
  const [jobs, setJobs] = useState<MyJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // A partial failure must not blank the feed: if one planning world is unreachable the other
  // still renders, with a note saying what is missing.
  const [missingSource, setMissingSource] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [prefill, setPrefill] = useState<{ project?: string; projectId?: string; date?: string } | null>(null);
  const toast = useToast();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setMissingSource(null);
    const end = new Date();
    end.setDate(end.getDate() + 30);
    const start_date = localISO(new Date());
    const end_date = localISO(end);

    // allSettled, not all: one RPC erroring (or not deployed yet) must not take the other down.
    const [legacy, crmJobs] = await Promise.allSettled([
      supabase.rpc('get_my_jobs', { start_date, end_date }),
      supabase.rpc('get_my_crm_jobs', { start_date, end_date }),
    ]);

    const unwrap = (r: PromiseSettledResult<{ data: unknown; error: unknown }>) =>
      r.status === 'fulfilled' && !r.value.error && Array.isArray(r.value.data) ? r.value.data : null;

    const blikkRows = unwrap(legacy) as BlikkJobRow[] | null;
    const crmRows = unwrap(crmJobs) as CrmJobRow[] | null;

    if (blikkRows === null && crmRows === null) {
      setError('Kunde inte hämta dina jobb. Dra ner för att försöka igen.');
      setJobs([]);
    } else {
      if (blikkRows === null) setMissingSource('planeringen');
      if (crmRows === null) setMissingSource('CRM');
      setJobs(mergeMyJobs(blikkRows, crmRows));
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  // Group into day sections — a schedule reads by day, not as a flat list. mergeMyJobs already
  // returns day-ascending order, so a single pass preserves it.
  const days = useMemo(() => {
    const out: Array<{ day: string; items: MyJob[] }> = [];
    for (const job of jobs) {
      const last = out[out.length - 1];
      if (last && last.day === job.day) last.items.push(job);
      else out.push({ day: job.day, items: [job] });
    }
    return out;
  }, [jobs]);

  return (
    <div className="mx-auto grid w-full max-w-[900px] grid-cols-1 gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className={cn('m-0', crm.pageTitle)}>Mina jobb</h1>
          <p className={cn('m-0 mt-1', crm.pageSubtitle)}>Dina planerade jobb de närmaste 30 dagarna.</p>
        </div>
        <button type="button" onClick={() => { setPrefill(null); setModalOpen(true); }} className={primaryBtn} style={{ backgroundColor: 'var(--crm-primary)' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" fill="none" aria-hidden><path d="M12 5v14M5 12h14" strokeLinecap="round" strokeLinejoin="round" /></svg>
          Rapportera tid
        </button>
      </div>

      {loading && <div className="text-sm text-slate-400">Laddar…</div>}
      {error && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-solid border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <span>{error}</span>
          <button type="button" onClick={() => void load()} className="rounded-lg border border-solid border-rose-300 bg-white px-2.5 py-1 text-xs font-semibold text-rose-700">Försök igen</button>
        </div>
      )}
      {!error && missingSource && (
        <div className="rounded-xl border border-solid border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-800">
          Jobb från {missingSource} kunde inte hämtas just nu — listan kan vara ofullständig.
        </div>
      )}
      {!loading && !error && jobs.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-200 px-4 py-10 text-center text-sm text-slate-400">Inga planerade jobb.</div>
      )}

      {days.map(({ day, items }) => (
        <section key={day} className="grid grid-cols-1 gap-2">
          <div className="flex items-center gap-2">
            <h2 className={cn('m-0', crm.sectionTitle)}>{formatDayHeading(day)}</h2>
            {isToday(day) && <span className={cn(crm.badge, 'border-emerald-200 bg-emerald-50 text-emerald-700')}>Idag</span>}
            <div className="h-px flex-1 bg-[#e0e8dc]" />
          </div>

          {items.map((job) =>
            job.source === 'crm' ? (
              <CrmJobCard key={job.key} job={job} />
            ) : (
              <BlikkJobCard
                key={job.key}
                job={job}
                expanded={!!job.projectId && !!expanded[job.projectId]}
                onToggleComments={() => {
                  if (!job.projectId) return;
                  setExpanded((prev) => ({ ...prev, [job.projectId!]: !prev[job.projectId!] }));
                }}
                onReportTime={() => {
                  setPrefill({
                    project: job.ref || job.projectName || job.projectId || undefined,
                    projectId: job.projectId || undefined,
                    date: job.day,
                  });
                  setModalOpen(true);
                }}
              />
            ),
          )}
        </section>
      ))}

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

// ── Cards ───────────────────────────────────────────────────────────────────
// The two sources look alike on purpose (same card, same rhythm) — a person should read their
// week, not two systems. What differs is where the row leads: a CRM job opens the field view,
// a legacy job keeps the Blikk time/comment flow.

// Left rail, same idiom as the CRM list rows. The colour is data (the truck's colour from
// ops_trucks), so it has to be an inline style; `accentClass` is the static fallback.
function JobCardShell({
  accentClass,
  accentColor,
  children,
}: {
  accentClass: string;
  accentColor?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[3px_1fr] overflow-hidden rounded-xl border border-solid border-[#e3e9df] bg-[#f9fbf7] shadow-[0_1px_2px_rgba(15,23,42,0.05)]">
      <div className={accentColor ? undefined : accentClass} style={accentColor ? { backgroundColor: accentColor } : undefined} />
      <div className="grid gap-1 px-3.5 py-3">{children}</div>
    </div>
  );
}

function JobMeta({ job }: { job: MyJob }) {
  const bits = [
    job.truck || 'Ingen lastbil',
    job.jobType,
    typeof job.bagCount === 'number' ? `${job.bagCount} säckar` : null,
  ].filter(Boolean);
  return <div className="text-[12px] text-slate-500">{bits.join(' • ')}</div>;
}

function CrmJobCard({ job }: { job: MyJob }) {
  const status = (job.status || 'scheduled') as WorkOrderStatus;
  return (
    <JobCardShell accentClass="bg-emerald-500" accentColor={job.truckColor}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="text-[15px] font-bold text-slate-900">{job.projectName || job.ref || 'Arbetsorder'}</div>
        {workOrderStatusLabel[status] && (
          <span className={cn(crm.badge, workOrderStatusClass[status])}>{workOrderStatusLabel[status]}</span>
        )}
      </div>
      <div className="text-[12px] text-slate-500">{[job.customer, job.ref].filter(Boolean).join(' • ')}</div>
      {job.address && <div className="text-[12px] text-slate-600">{job.address}</div>}
      <JobMeta job={job} />
      {job.workOrderId && (
        <div className="mt-2 flex flex-wrap gap-2">
          <Link
            href={`/arbetsorder/${job.workOrderId}`}
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold text-white transition hover:opacity-90"
            style={{ backgroundColor: 'var(--crm-primary)' }}
          >
            Öppna arbetsorder
          </Link>
        </div>
      )}
    </JobCardShell>
  );
}

function BlikkJobCard({
  job,
  expanded,
  onToggleComments,
  onReportTime,
}: {
  job: MyJob;
  expanded: boolean;
  onToggleComments: () => void;
  onReportTime: () => void;
}) {
  return (
    <JobCardShell accentClass="bg-slate-300">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="text-[15px] font-bold text-slate-900">{job.projectName || job.ref || 'Jobb'}</div>
        {/* The source only needs calling out while both worlds are live — it explains why this
            card reports time here instead of on a work order. Goes away with the last legacy row. */}
        <span className={cn(crm.badge, 'border-slate-200 bg-slate-100 text-slate-500')}>Äldre planering</span>
      </div>
      <div className="text-[12px] text-slate-500">{[job.customer, job.ref].filter(Boolean).join(' • ')}</div>
      <JobMeta job={job} />
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onReportTime}
          className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold text-white transition hover:opacity-90"
          style={{ backgroundColor: 'var(--crm-primary)' }}
        >
          Rapportera tid
        </button>
        {job.projectId && (
          <button
            type="button"
            onClick={onToggleComments}
            className="inline-flex items-center gap-1.5 rounded-lg border border-solid border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-800"
          >
            {expanded ? 'Dölj kommentarer' : 'Visa kommentarer'}
          </button>
        )}
        {expanded && job.projectId && <ProjectComments projectId={job.projectId} />}
      </div>
    </JobCardShell>
  );
}

function ProjectComments({ projectId }: { projectId: string }) {
  const { comments, loading, error, refresh } = useProjectComments(projectId, { ttlMs: 120_000 });
  return (
    <div className="mt-2 grid w-full gap-1.5">
      <div className="flex items-center gap-2">
        <strong className="text-[12px] text-slate-900">Kommentarer</strong>
        <div className="h-px flex-1 bg-[#e0e8dc]" />
        <button type="button" onClick={() => refresh(true)} className="inline-flex items-center gap-1 rounded-lg border border-solid border-slate-200 bg-white px-2 py-1 text-[10px] font-semibold text-slate-600 hover:border-slate-300">Uppdatera</button>
      </div>
      {loading && comments.length === 0 && <div className="text-[11px] text-slate-500">Hämtar kommentarer…</div>}
      {error && <div className="text-[11px] text-rose-700">Fel: {error}</div>}
      {!loading && !error && comments.length === 0 && <div className="text-[11px] text-slate-500">Inga kommentarer.</div>}
      {!loading && !error && comments.length > 0 && (
        <div className="grid gap-1.5">
          {comments.slice(0, 6).map(c => (
            <div key={c.id} className="grid gap-1 rounded-lg border border-solid border-[#e3e9df] bg-white px-2.5 py-1.5">
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
