"use client";
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useProjectComments, formatRelativeTime } from '../../lib/useProjectComments';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { cn } from '@/lib/shared/cn';
import Input from '../ui/Input';
import Textarea from '../ui/Textarea';

function startOfISOWeek(d: Date) {
  const day = d.getDay(); // 0..6, 1=Mon
  const mondayDelta = (day + 6) % 7; // days since Monday
  const res = new Date(d);
  res.setHours(0, 0, 0, 0);
  res.setDate(res.getDate() - mondayDelta);
  return res;
}
function addDays(d: Date, n: number) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function toISODateLocal(d: Date) { const y = d.getFullYear(); const m = String(d.getMonth()+1).padStart(2,'0'); const dd = String(d.getDate()).padStart(2,'0'); return `${y}-${m}-${dd}`; }
function getISOWeekNumber(d: Date) {
  const date = new Date(d);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + 3 - ((date.getDay() + 6) % 7));
  const week1 = new Date(date.getFullYear(), 0, 4);
  return 1 + Math.round(((date.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
}
function normalizePersonName(value: string | null | undefined) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

type ContactDirectoryEntry = {
  name: string;
  phone: string;
  role?: string | null;
  location?: string | null;
  category?: string | null;
};

export default function DashboardSchedule({ compact = false, onReportTime }: { compact?: boolean; onReportTime?: (info: { projectId?: string; projectName?: string; orderNumber?: string; day?: string }) => void }) {
  const supabase = createClientComponentClient();
  const [weekOffset, setWeekOffset] = useState(0);
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [segmentSortIndexMap, setSegmentSortIndexMap] = useState<Record<string, number | null>>({});
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [currentUserName, setCurrentUserName] = useState<string | null>(null);
  const [dayIdx, setDayIdx] = useState<number | null>(() => {
    // Default to current weekday (Mon=0..Fri=4). On weekend, show all (null).
    const dow = new Date().getDay(); // Sun=0 .. Sat=6
    return dow >= 1 && dow <= 5 ? dow - 1 : null;
  }); // 0=Mon .. 4=Fri, null=all

  // Detail modal state
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailData, setDetailData] = useState<any | null>(null);
  const [detailBase, setDetailBase] = useState<any | null>(null);
  const [commentsExpanded, setCommentsExpanded] = useState(false);
  const [reportDraft, setReportDraft] = useState<{ day: string; amount: string }>({ day: '', amount: '' });
  const [commentDraft, setCommentDraft] = useState<string>('');
  const [reportError, setReportError] = useState<string | null>(null);
  const [reportSending, setReportSending] = useState(false);
  // Shared project comments hook
  const { comments, loading: commentsLoading, error: commentsError, refresh: refreshComments } = useProjectComments(detailBase?.project_id ? String(detailBase.project_id) : null, { ttlMs: 120_000 });

  type SegmentReport = { id: string; segment_id: string; report_day: string; amount: number; created_by: string | null; created_by_name: string | null; created_at: string };
  const [segmentReportsMap, setSegmentReportsMap] = useState<Record<string, SegmentReport[]>>({}); // key: segment_id
  // Per-segment extra crew map for rendering team on cards
  const [segmentCrewMap, setSegmentCrewMap] = useState<Record<string, Array<{ id: string | null; name: string }>>>({});
  const [contactDirectory, setContactDirectory] = useState<ContactDirectoryEntry[]>([]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch('/api/contacts', { cache: 'no-store' });
        if (!res.ok) return;
        const json = await res.json();
        if (!active || !json || typeof json !== 'object') return;
        const rows = Array.isArray((json as any).contacts) ? (json as any).contacts : [];
        const entries: ContactDirectoryEntry[] = [];
        for (const row of rows) {
          if (!row || typeof row !== 'object' || !row.name || !row.phone) continue;
          entries.push({
            name: String(row.name),
            phone: String(row.phone),
            role: row.role ? String(row.role) : null,
            location: row.location ? String(row.location) : null,
            category: row.category ? String(row.category) : null,
          });
        }
        setContactDirectory(entries);
      } catch {
        // ignore directory lookup failures
      }
    })();
    return () => { active = false; };
  }, []);

  const openDetail = useCallback(async (it: any) => {
    setDetailOpen(true);
    setDetailBase(it);
    setDetailError(null);
    setDetailData(null);
    setReportError(null);
    setCommentsExpanded(false);
    // Default report draft: clamp to job range if possible
    try {
  const s = (it.job_day as string) || (it.start_day as string) || null;
  const e = (it.job_day as string) || (it.end_day as string) || s;
      const today = toISODateLocal(new Date());
      const def = s && e && s <= today && today <= e ? today : (s || today);
      setReportDraft({ day: def, amount: '' });
    } catch { setReportDraft({ day: '', amount: '' }); }
    setCommentDraft('');
    // Load reports for this segment lazily if not present
    if (it.segment_id) {
      try {
        const known = segmentReportsMap[it.segment_id];
        if (!known) {
          const { data: rows } = await supabase
            .from('planning_segment_reports')
            .select('id, segment_id, report_day, amount, created_by, created_by_name, created_at')
            .eq('segment_id', it.segment_id)
            .order('report_day');
          if (Array.isArray(rows)) {
            setSegmentReportsMap(prev => ({ ...prev, [it.segment_id]: rows as any }));
          }
        }
      } catch { /* ignore */ }
    }
    // Try to enrich from Blikk API by order number, fallback to id
    const fetchViaLookup = async (): Promise<any | null> => {
      try {
        if (it.order_number) {
          const r = await fetch(`/api/projects/lookup?orderId=${encodeURIComponent(String(it.order_number))}`);
          const j = await r.json();
          if (r.ok) return j;
        }
      } catch { /* ignore */ }
      try {
        const idNum = Number(it.project_id);
        if (Number.isFinite(idNum) && idNum > 0) {
          const r = await fetch(`/api/projects/lookup?id=${idNum}`);
          const j = await r.json();
          if (r.ok) return j;
        }
      } catch { /* ignore */ }
      return null;
    };
    setDetailLoading(true);
    try {
      const j = await fetchViaLookup();
      if (j) setDetailData(j);
    } catch (e: any) {
      setDetailError(String(e?.message || e));
    } finally {
      setDetailLoading(false);
    }
  }, []);
  const closeDetail = useCallback(() => {
    setDetailOpen(false);
    setDetailData(null);
    setDetailBase(null);
    setDetailError(null);
    setCommentsExpanded(false);
  }, []);

  const range = useMemo(() => {
    const today = new Date();
    const weekStart = startOfISOWeek(today);
    const base = addDays(weekStart, weekOffset * 7);
    const startISO = toISODateLocal(base);
    const endISO = toISODateLocal(addDays(base, 6));
    const weekNumber = getISOWeekNumber(base);
    const year = base.getFullYear();
    const label = weekOffset === 0 ? 'Denna vecka' : weekOffset === -1 ? 'Förra veckan' : weekOffset === 1 ? 'Nästa vecka' : weekOffset < 0 ? `${Math.abs(weekOffset)} veckor bak` : `${weekOffset} veckor fram`;
    // Build Mon..Sun ISO dates; only show Mon..Fri selector
    const days = Array.from({ length: 7 }, (_, i) => toISODateLocal(addDays(base, i)));
    return { startISO, endISO, label, weekNumber, year, weekStartISO: startISO, days };
  }, [weekOffset]);

  useEffect(() => {
    // Load current user and name
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          setCurrentUserId(user.id);
          let resolvedName: string | null = null;
          try {
            const { data: profile } = await supabase.from('profiles').select('full_name').eq('id', user.id).maybeSingle();
            if (profile && (profile as any).full_name) resolvedName = (profile as any).full_name as string;
          } catch {}
          if (!resolvedName) {
            const meta: any = user.user_metadata || {};
            resolvedName = meta.full_name || meta.name || (user.email ? user.email.split('@')[0] : null);
          }
          setCurrentUserName(resolvedName);
        }
      } catch {}
    })();
  }, [supabase]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase.rpc('get_my_jobs', { start_date: range.startISO, end_date: range.endISO });
        if (!cancelled) {
          if (error) {
            console.warn('[dashboard schedule] get_my_jobs error', error);
            setItems([]);
          } else {
            setItems(Array.isArray(data) ? data : []);
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [supabase, range.startISO, range.endISO]);

  // Enrich items with per-segment sort_index (used for ordering, same as Planning page)
  useEffect(() => {
    const ids = Array.from(new Set((items.map(it => it.segment_id) as Array<unknown>)
      .filter((v): v is string => typeof v === 'string' && v.length > 0)));
    if (ids.length === 0) return;

    let cancelled = false;
    (async () => {
      try {
        const { data: rows, error } = await supabase
          .from('planning_segments')
          .select('id, sort_index')
          .in('id', ids);
        if (cancelled) return;
        if (error) {
          // If RLS blocks this for some users, keep working with fallback ordering.
          console.warn('[dashboard schedule] failed to load segment sort_index', error);
          return;
        }
        const next: Record<string, number | null> = {};
        for (const r of (rows as any[]) || []) {
          const id = String(r.id);
          const v = (r.sort_index ?? null);
          next[id] = (typeof v === 'number' && Number.isFinite(v)) ? v : null;
        }
        setSegmentSortIndexMap(prev => {
          const prevKeys = Object.keys(prev);
          const nextKeys = Object.keys(next);
          if (prevKeys.length !== nextKeys.length) return next;
          for (const k of nextKeys) {
            if (!(k in prev)) return next;
            if (prev[k] !== next[k]) return next;
          }
          return prev;
        });
      } catch (e) {
        console.warn('[dashboard schedule] failed to load segment sort_index', e);
      }
    })();

    return () => { cancelled = true; };
  }, [items, supabase]);

  // When items change, fetch reports for listed segments
  useEffect(() => {
    const ids = Array.from(new Set((items.map(it => it.segment_id) as Array<unknown>)
      .filter((v): v is string => typeof v === 'string' && v.length > 0)));
    if (ids.length === 0) return;
    (async () => {
      try {
        const { data: rows } = await supabase
          .from('planning_segment_reports')
          .select('id, segment_id, report_day, amount, created_by, created_by_name, created_at')
          .in('segment_id', ids);
        if (Array.isArray(rows)) {
          const grouped: Record<string, SegmentReport[]> = {};
          for (const r of rows as any as SegmentReport[]) {
            if (!grouped[r.segment_id]) grouped[r.segment_id] = [];
            grouped[r.segment_id].push(r);
          }
          setSegmentReportsMap(prev => ({ ...prev, ...grouped }));
        }
      } catch {}
    })();
  }, [items, supabase]);

  // When items change, fetch extra crew for listed segments
  useEffect(() => {
    const ids = Array.from(new Set((items.map(it => it.segment_id) as Array<unknown>)
      .filter((v): v is string => typeof v === 'string' && v.length > 0)));
    if (ids.length === 0) return;
    (async () => {
      try {
        const { data: rows } = await supabase
          .from('planning_segment_team_members')
          .select('segment_id, member_id, member_name')
          .in('segment_id', ids);
        if (Array.isArray(rows)) {
          const grouped: Record<string, Array<{ id: string | null; name: string }>> = {};
          for (const r of rows as any[]) {
            const sid = r.segment_id as string;
            if (!grouped[sid]) grouped[sid] = [];
            grouped[sid].push({ id: r.member_id || null, name: r.member_name || '' });
          }
          setSegmentCrewMap(prev => ({ ...prev, ...grouped }));
        }
      } catch {}
    })();
  }, [items, supabase]);

  // Realtime updates for segment reports
  useEffect(() => {
    const channel = supabase.channel('dashboard-segment-reports')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'planning_segment_reports' }, payload => {
        const row: any = payload.new || payload.old;
        if (!row?.segment_id) return;
        setSegmentReportsMap(prev => {
          const arr = prev[row.segment_id] ? [...prev[row.segment_id]] : [];
          if (payload.eventType === 'INSERT') {
            // avoid dup
            if (!arr.some(x => x.id === row.id)) arr.push(row);
          } else if (payload.eventType === 'UPDATE') {
            const i = arr.findIndex(x => x.id === row.id);
            if (i >= 0) arr[i] = row; else arr.push(row);
          } else if (payload.eventType === 'DELETE') {
            const i = arr.findIndex(x => x.id === row.id);
            if (i >= 0) arr.splice(i, 1);
          }
          // sort by day
          arr.sort((a, b) => (a.report_day || '').localeCompare(b.report_day));
          return { ...prev, [row.segment_id]: arr };
        });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'planning_segment_team_members' }, payload => {
        const row: any = payload.new || payload.old;
        if (!row?.segment_id) return;
        setSegmentCrewMap(prev => {
          const next = { ...prev };
          const sid = row.segment_id as string;
          const list = Array.isArray(next[sid]) ? [...next[sid]] : [];
          if (payload.eventType === 'DELETE') {
            const idx = list.findIndex(m => (m.id || null) === (row.member_id || null) && (m.name || '') === (row.member_name || ''));
            if (idx >= 0) list.splice(idx, 1);
          } else {
            // INSERT/UPDATE: upsert by id+name combo
            const idx = list.findIndex(m => (m.id || null) === (row.member_id || null) && (m.name || '') === (row.member_name || ''));
            if (idx >= 0) list[idx] = { id: row.member_id || null, name: row.member_name || '' };
            else list.push({ id: row.member_id || null, name: row.member_name || '' });
          }
          next[sid] = list;
          return next;
        });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [supabase]);

  const reportedBySegment = useMemo(() => {
    const map = new Map<string, number>();
    for (const [segId, list] of Object.entries(segmentReportsMap)) {
      map.set(segId, list.reduce((sum, r) => sum + (Number(r.amount) || 0), 0));
    }
    return map;
  }, [segmentReportsMap]);

  const addPartialReport = useCallback(async () => {
    if (reportSending) return;
    const segId = detailBase?.segment_id as string | undefined;
    const projectId = String(detailBase?.project_id || '').trim();
    const day = (reportDraft.day || '').trim();
    const amount = parseInt(reportDraft.amount, 10);
    const hasAmount = Number.isFinite(amount) && amount > 0;
    const commentOneLine = String(commentDraft || '').replace(/\s+/g, ' ').trim();
    const hasComment = commentOneLine.length > 0;

    setReportError(null);
    if (!projectId) {
      setReportError('Saknar projekt-id.');
      return;
    }
    if (hasAmount && !segId) {
      setReportError('Saknar segment-id: kan inte rapportera säckar här.');
      return;
    }
    if (!day) {
      setReportError('Välj ett datum.');
      return;
    }
    if (hasAmount && !hasComment) {
      setReportError('Kommentar krävs när du rapporterar säckar. EG: "Yta Isolerad".');
      return;
    }
    if (!hasAmount && !hasComment) {
      setReportError('Skriv en kommentar eller ange antal säckar.');
      return;
    }

    setReportSending(true);
    try {
      let insertedReportId: string | null = null;

      if (hasAmount) {
        const payload: any = {
          segment_id: segId,
          project_id: projectId,
          report_day: day,
          amount,
          created_by: currentUserId,
          created_by_name: currentUserName || null
        };
        const { data, error } = await supabase.from('planning_segment_reports').insert(payload).select('*').single();
        if (error) throw error;
        insertedReportId = data?.id ? String(data.id) : null;

        // Also withdraw from correct depot with idempotency key based on this partial report
        try {
          const jt = String(detailBase?.job_type || '').toLowerCase();
          const materialKind = jt.startsWith('vit') ? 'Vitull' : (jt.startsWith('eko') ? 'Ekovilla' : undefined);
          const resp = await fetch('/api/planning/consume-bags', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              projectId,
              orderNumber: detailBase?.order_number ? String(detailBase.order_number) : undefined,
              installationDate: day,
              totalBags: amount,
              segmentId: segId,
              reportKey: insertedReportId ? `partial:${insertedReportId}` : undefined,
              materialKind,
            })
          });
          try { const j = await resp.json(); console.log('[consume-bags dashboard]', j); } catch {}
        } catch {}
      }

      // Post a short comment to Blikk project timeline (single-line to avoid UI truncation)
      try {
        const parts = [
          `DELRAPPORTERERING`,
          ...(hasAmount ? [`Säckar blåsta: ${amount}`] : []),
          `Datum: ${day}`,
          ...(currentUserName ? [`Av: ${currentUserName}`] : []),
          ...(hasComment ? [`Kommentar: ${commentOneLine}`] : []),
        ];
        const commentText = parts.join(' — ');
        const resp2 = await fetch('/api/blikk/project/comment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId, text: commentText })
        });
        try { const j2 = await resp2.json(); console.log('[blikk comment dashboard]', j2); } catch {}
      } catch {}

      // Reset inputs and refresh comments panel
      setReportDraft(d => ({ ...d, amount: '' }));
      setCommentDraft('');
      if (hasComment) setCommentsExpanded(true);
      try { refreshComments(true); } catch {}
    } catch (e: any) {
      console.warn('[dashboard schedule] addPartialReport failed', e);
      setReportError('Kunde inte skicka rapport. Försök igen.');
    } finally {
      setReportSending(false);
    }
  }, [reportSending, detailBase?.segment_id, detailBase?.job_type, detailBase?.project_id, reportDraft.amount, reportDraft.day, commentDraft, supabase, currentUserId, currentUserName, refreshComments]);

  const deletePartialReport = useCallback(async (id: string) => {
    await supabase.from('planning_segment_reports').delete().eq('id', id);
  }, [supabase]);

  const grouped = useMemo(() => {
    // If a specific Mon..Fri day is selected, show only jobs that include that date (start..end inclusive)
    if (dayIdx != null) {
      const selISO = range.days[dayIdx];
      const arr = items.filter((it) => (it.job_day as string) === selISO);
      return arr.length ? [{ day: selISO, arr }] : [];
    }
    // Otherwise group by job_day (per-day rows)
    const map = new Map<string, any[]>();
    for (const it of items) {
      const k = (it.job_day as string) || (it.start_day as string) || 'okänd';
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(it);
    }
    return Array.from(map.entries()).sort(([a],[b]) => a.localeCompare(b, 'sv')).map(([day, arr]) => ({ day, arr }));
  }, [items, dayIdx, range.days]);

  // Visual theme based on job type/material
  const getMaterialTheme = useCallback((jobType?: string) => {
    const jt = (jobType || '').toLowerCase();
    if (jt.startsWith('eko')) return { accent: '#16a34a', badgeBg: '#dcfce7', badgeFg: '#166534', label: 'Ekovilla' };
    if (jt.startsWith('vit')) return { accent: '#0284c7', badgeBg: '#e0f2fe', badgeFg: '#075985', label: 'Vitull' };
    return { accent: '#64748b', badgeBg: '#f1f5f9', badgeFg: '#334155', label: null as string | null };
  }, []);

  const selectedDayLabel = dayIdx == null ? 'Alla dagar' : ['Måndag', 'Tisdag', 'Onsdag', 'Torsdag', 'Fredag'][dayIdx];
  const visibleJobCount = grouped.reduce((sum, group) => sum + group.arr.length, 0);
  const scheduleCardStyle: React.CSSProperties = {
    border: compact ? '1px solid #dbe4ef' : '1px solid #d5e1ee',
    background: 'linear-gradient(180deg, #ffffff 0%, #f7fbff 100%)',
    borderRadius: compact ? 18 : 22,
    padding: compact ? 12 : 18,
    display: 'grid',
    gap: compact ? 10 : 14,
    boxShadow: '0 14px 32px rgba(15,23,42,0.08), inset 0 1px 0 rgba(255,255,255,0.82)'
  };
  const weekNavButtonClass = cn(
    'w-fit rounded-[12px] border border-slate-200 bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)] font-semibold text-slate-900 shadow-[0_8px_18px_rgba(15,23,42,0.08)] transition-[transform,background-color,border-color,box-shadow] hover:-translate-y-0.5 hover:border-sky-200 hover:bg-[linear-gradient(180deg,#ffffff_0%,#eff6ff_100%)] hover:text-slate-900 hover:shadow-[0_12px_24px_rgba(14,165,233,0.16)] active:translate-y-0',
    compact ? 'min-w-[100px] px-2.5 py-[5px] text-[11px]' : 'min-w-[112px] px-3 py-1.5 text-xs'
  );
  const metaPillClass = cn(
    'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-[#dbe4ef] bg-[linear-gradient(180deg,#ffffff_0%,#f8fbff_100%)] font-semibold text-slate-600 shadow-[inset_0_1px_0_rgba(255,255,255,0.78)]',
    compact ? 'px-[9px] py-[5px] text-[10.5px]' : 'px-[9px] py-[5px] text-[11.5px]'
  );

  return (
    <section
      style={scheduleCardStyle}
    >
      <div className={cn('grid', compact ? 'gap-2' : 'gap-2.5')}>
        <div className={cn('flex flex-wrap items-start justify-between', compact ? 'gap-2' : 'gap-3')}>
          <div className="grid gap-1">
            <div className="inline-flex flex-wrap items-center gap-2">
              <h2 className={cn('m-0 text-slate-900', compact ? 'text-[15px]' : 'text-lg')}>Arbetsschema</h2>
              <span className={cn('inline-flex items-center gap-1.5 rounded-full border border-blue-100 bg-[#eef6ff] font-bold text-blue-700', compact ? 'px-2 py-1 text-[10.5px]' : 'px-2 py-1 text-[11px]')}>
                Vecka {range.weekNumber}
              </span>
            </div>
            <span className={cn('text-slate-500', compact ? 'text-[11px]' : 'text-xs')}>{range.label} • {range.startISO} – {range.endISO}</span>
            <div className={cn('flex items-center gap-2', compact ? 'max-w-full flex-nowrap overflow-x-auto pb-0.5 pr-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden' : 'flex-wrap')}>
              <span className={metaPillClass}>
                {visibleJobCount} {visibleJobCount === 1 ? 'jobb' : 'jobb'}
              </span>
              <span className={metaPillClass}>
                {selectedDayLabel}
              </span>
            </div>
          </div>
        </div>

        <div className={cn('grid w-full box-border items-center gap-1.5 rounded-[16px] border border-slate-200 bg-[linear-gradient(180deg,#fdfefe_0%,#f4f8fc_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.85)] [grid-template-columns:minmax(0,1fr)_auto_minmax(0,1fr)]', compact ? 'p-1.5' : 'p-2.5')}>
          <button
            type="button"
            onClick={()=>setWeekOffset(prev => prev - 1)}
            className={cn(weekNavButtonClass, 'justify-self-start')}
          >
            <span aria-hidden="true" className="text-[12px] leading-none">←</span>
            <span className="leading-none">Föregående</span>
          </button>
          <div className={cn('inline-flex items-center justify-center rounded-[10px] font-bold text-slate-900', compact ? 'min-w-[116px] px-2.5 py-[5px] text-[11px]' : 'min-w-[132px] px-3 py-1.5 text-xs')}>
            Vecka {range.weekNumber}
          </div>
          <button
            type="button"
            onClick={()=>setWeekOffset(prev => prev + 1)}
            className={cn(weekNavButtonClass, 'justify-self-end')}
          >
            <span className="leading-none">Nästa</span>
            <span aria-hidden="true" className="text-[12px] leading-none">→</span>
          </button>
        </div>
      </div>

      {/* Mon–Fri selector */}
      <div className={cn('grid gap-2 rounded-[20px] border border-slate-200 bg-[linear-gradient(180deg,#ffffff_0%,#fbfdff_100%)] shadow-[0_10px_22px_rgba(15,23,42,0.05)]', compact ? 'px-2.5 pb-2 pt-2.5' : 'p-3.5')}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-xs font-semibold text-slate-500">Visa dag</span>
          <span className={cn('text-slate-500', compact ? 'text-[10.5px]' : 'text-[11.5px]')}>{selectedDayLabel}</span>
        </div>
        <div className="grid w-full grid-cols-6 items-stretch gap-1.5">
        {['Mån','Tis','Ons','Tor','Fre'].map((label, idx) => {
          const active = dayIdx===idx;
          return (
            <button
              key={label}
              type="button"
              onClick={() => setDayIdx(idx)}
              aria-pressed={active}
              className={cn(
                'w-full justify-center rounded-full border transition-[background,color,border-color,box-shadow]',
                compact ? 'px-2.5 py-[5px] text-[11px]' : 'px-3 py-1.5 text-xs',
                active
                  ? 'border-sky-600 bg-[linear-gradient(135deg,#0ea5e9_0%,#0284c7_100%)] font-bold text-white shadow-[0_8px_18px_rgba(2,132,199,0.24)]'
                  : 'border-slate-200 bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)] font-medium text-slate-700 shadow-[0_4px_10px_rgba(15,23,42,0.05)] hover:border-sky-200 hover:bg-[linear-gradient(180deg,#ffffff_0%,#eff6ff_100%)] hover:text-slate-900 hover:shadow-[0_10px_18px_rgba(14,165,233,0.12)]'
              )}
              title={range.days[idx]}
            >{label}</button>
          );
        })}
        {(() => {
          const active = dayIdx==null;
          return (
            <button
              type="button"
              onClick={() => setDayIdx(null)}
              aria-pressed={active}
              className={cn(
                'w-full justify-center rounded-full border transition-[background,color,border-color,box-shadow]',
                compact ? 'px-2.5 py-[5px] text-[11px]' : 'px-3 py-1.5 text-xs',
                active
                  ? 'border-sky-600 bg-[linear-gradient(135deg,#0ea5e9_0%,#0284c7_100%)] font-bold text-white shadow-[0_8px_18px_rgba(2,132,199,0.24)]'
                  : 'border-slate-200 bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)] font-medium text-slate-700 shadow-[0_4px_10px_rgba(15,23,42,0.05)] hover:border-sky-200 hover:bg-[linear-gradient(180deg,#ffffff_0%,#eff6ff_100%)] hover:text-slate-900 hover:shadow-[0_10px_18px_rgba(14,165,233,0.12)]'
              )}
            >Alla</button>
          );
        })()}
        </div>
      </div>

      {loading && <div className="px-0.5 pt-0 text-xs text-slate-500">Laddar…</div>}
      {!loading && grouped.length === 0 && (
        <div className={cn('inline-flex w-fit items-center gap-2 rounded-full border border-slate-200 bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)] text-slate-500 shadow-[0_6px_14px_rgba(15,23,42,0.04)]', compact ? 'px-[11px] py-[9px] text-xs' : 'px-3 py-2.5 text-xs')}>
          Inga jobb planerade för vald period.
        </div>
      )}

      {!loading && grouped.length > 0 && (
        <div style={{ display:'grid', gap: compact ? 8 : 10 }}>
          {grouped.map(({ day, arr }) => (
            <div key={day} style={{ display:'grid', gap: compact ? 4 : 6 }}>
              <div style={{ fontWeight:600, fontSize: compact ? 11 : 12, color:'#0f172a' }}>{day}</div>
              <div style={{ display:'grid', gap: compact ? 6 : 8 }}>
                {(() => {
                  const getSortIndex = (x: any): number | null => {
                    const v = (x.sort_index ?? x.sortIndex);
                    if (typeof v === 'number' && Number.isFinite(v)) return v;
                    const sid = (x.segment_id || x.segmentId || '') as string;
                    if (sid && sid in segmentSortIndexMap) return segmentSortIndexMap[sid];
                    return null;
                  };
                  const orderCmp = (a: any, b: any) => {
                    const ta = (a.truck || '').toString();
                    const tb = (b.truck || '').toString();
                    if (ta !== tb) return ta.localeCompare(tb, 'sv');
                    const sa = getSortIndex(a);
                    const sb = getSortIndex(b);
                    if (sa != null && sb != null && sa !== sb) return sa - sb;
                    if (sa != null && sb == null) return -1;
                    if (sb != null && sa == null) return 1;
                    const ao = (a.order_number || '').toString();
                    const bo = (b.order_number || '').toString();
                    if (ao && bo && ao !== bo) return ao.localeCompare(bo, 'sv');
                    const an = (a.project_name || '').toString();
                    const bn = (b.project_name || '').toString();
                    return an.localeCompare(bn, 'sv');
                  };
                  const arrSorted = [...arr].sort(orderCmp);
                  return arrSorted.map((it: any) => {
                  const title = [it.order_number ? String(it.order_number) : null, it.project_name].filter(Boolean).join(' - ');
                  const theme = getMaterialTheme(it.job_type);
                  const bagLabel = typeof it.bag_count === 'number' ? `${it.bag_count} säckar${theme.label ? ' ' + theme.label : ''}` : null;
                  const reported = it.segment_id ? (reportedBySegment.get(it.segment_id) || 0) : 0;
                  const positionLabel = (() => {
                    const hasTruck = !!it.truck;
                    if (!hasTruck) return null;
                    const sameTruckSorted = arrSorted.filter((x: any) => x.truck === it.truck);
                    const pos = Math.max(0, sameTruckSorted.findIndex((x: any) => (x.segment_id || '') === (it.segment_id || '')));
                    const total = sameTruckSorted.length;
                    if (total <= 0) return null;
                    return `${pos + 1}/${total}`;
                  })();
                  const crewNames = (() => {
                    const arr = segmentCrewMap[it.segment_id] || [];
                    const uniq = Array.from(new Set(arr.map(m => (m.name || '').trim()).filter(Boolean)));
                    return uniq;
                  })();
                  return (
                    <div
                      key={`${it.segment_id || `${it.project_id}|${it.start_day}`}|${it.job_day || ''}`}
                      onClick={() => openDetail(it)}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(it); } }}
                      role="button"
                      tabIndex={0}
                      className={cn(
                        'relative grid cursor-pointer rounded-[14px] border border-[#dbe4ef] bg-[linear-gradient(180deg,#ffffff_0%,#fcfdff_100%)] shadow-[0_8px_18px_rgba(15,23,42,0.05)]',
                        compact ? 'gap-2 p-2.5' : 'gap-2.5 p-3'
                      )}
                      style={{ borderLeft: `3px solid ${theme.accent}` }}
                    >
                      <div className="grid items-start gap-2.5 [grid-template-columns:minmax(0,1fr)_auto]">
                        <div className="grid min-w-0 gap-1.5">
                          <div className="flex min-w-0 items-center gap-2">
                            <div className="h-2.5 w-2.5 rounded-full opacity-90" style={{ background: theme.accent, boxShadow:`0 0 0 4px ${theme.accent}14` }} />
                            <span className={cn('min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap font-extrabold leading-[1.3] tracking-[-0.1px] text-slate-900', compact ? 'text-[12.5px]' : 'text-[13.5px]')}>{title}</span>
                          </div>
                          {it.truck && (
                            <div className={cn('inline-flex w-fit items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-slate-500', compact ? 'text-[10.5px]' : 'text-[11px]')}>
                              <svg width={14} height={14} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                                <path fill="currentColor" d="M3 4h11v8h-1.5a2.5 2.5 0 0 0-2.45 2H8A3 3 0 0 0 5 17H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zm13 5h2.586A2 2 0 0 1 20 9.586L21.414 11A2 2 0 0 1 22 12.414V16a1 1 0 0 1-1 1h-1a3 3 0 0 0-3-3h-1V9zM7 18a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm10 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4z" />
                              </svg>
                              {it.truck}
                            </div>
                          )}
                        </div>
                        <div className="grid justify-items-end gap-2">
                          {onReportTime && (
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); onReportTime({ projectId: String(it.project_id || ''), projectName: it.project_name, orderNumber: it.order_number ? String(it.order_number) : undefined, day: (it.job_day || it.start_day) ? String(it.job_day || it.start_day) : undefined }); }}
                              className={cn('inline-flex items-center gap-[5px] rounded-[10px] border border-green-600 bg-green-600 text-white shadow-[0_8px_16px_rgba(22,163,74,0.16)]', compact ? 'px-2.5 py-1.5 text-[10.5px]' : 'px-[11px] py-[7px] text-[11px]')}
                              aria-label="Rapportera tid för detta jobb"
                            >
                              <svg width={12} height={12} viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" fill="none"><path d="M12 5v14M5 12h14" strokeLinecap="round" strokeLinejoin="round"/></svg>
                              Tid
                            </button>
                          )}
                          <div className="inline-flex items-center gap-2">
                            <svg width={16} height={16} viewBox="0 0 24 24" aria-hidden="true" focusable="false" className="text-slate-400">
                              <path fill="currentColor" d="M9 18l6-6-6-6" />
                            </svg>
                            {positionLabel && (
                              <span title="Placering i dag/lastbil" className="min-w-[34px] rounded-full border border-slate-700 bg-slate-900 px-[7px] py-1 text-center text-[10px] font-bold text-white">
                                {positionLabel}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className={cn('flex flex-wrap gap-1.5', compact ? 'mt-1.5' : 'mt-2')}>
                        {bagLabel && (
                          <span className={cn('inline-flex items-center gap-1.5 rounded-full bg-white px-[9px] py-[5px] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.5)]', compact ? 'text-[10.5px]' : 'text-[11px]')} style={{ color: theme.badgeFg, border:`1px solid ${theme.accent}26` }}>
                            <svg width={14} height={14} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                              <path fill="currentColor" d="M7 6h10l1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L7 6zm1-2a4 4 0 0 1 8 0v2H8V4zm2 0a2 2 0 1 1 4 0v2h-4V4z" />
                            </svg>
                            {bagLabel}
                          </span>
                        )}
                          {reported > 0 && (
                            <span className={cn('inline-flex items-center gap-1.5 rounded-full border border-sky-200 bg-[#f8fdff] px-[9px] py-[5px] text-slate-900', compact ? 'text-[10.5px]' : 'text-[11px]')} title={`Rapporterat: ${reported} säckar`}>
                              <svg width={14} height={14} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                                <path fill="currentColor" d="M9 16.2l-3.5-3.5L4 14.2 9 19l12-12-1.5-1.5z" />
                              </svg>
                              Rapporterat: {reported}
                            </span>
                          )}
                        {crewNames.length > 0 && (
                          <span className={cn('inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-[#fafafa] px-[9px] py-[5px] text-slate-700', compact ? 'text-[10.5px]' : 'text-[11px]')} title={`Team: ${crewNames.join(', ')}`}>
                            <svg width={14} height={14} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                              <path fill="currentColor" d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5s-3 1.34-3 3 1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h10v-2.5C11 14.17 6.33 13 4 13zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h8v-2.5c0-2.33-4.67-3.5-7-3.5z"/>
                            </svg>
                            Team: {crewNames.join(', ')}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                }); })()}
              </div>
            </div>
          ))}
        </div>
      )}
      {/* Detail Modal (project info) */}
      {detailOpen && (() => {
        const raw = (detailData?.project ?? detailData) || null;
        const location = raw?.workSiteAddress || raw?.location || null;
        const street = location?.streetAddress || raw?.street || raw?.addressLine1 || null;
        const postalCode = location?.postalCode || raw?.postalCode || raw?.zip || null;
        const city = location?.city || raw?.city || null;
        const address = [street, postalCode, city].filter(Boolean).join(', ');
        const mapsHref = address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}` : null;
        const description = raw?.description || raw?.notes || raw?.note || null;
        // Extract potential phone numbers from description
        const phoneList: Array<{ display: string; tel: string }> = (() => {
          if (!description || typeof description !== 'string') return [];
          const rx = /(\+?46|0)[\s\-]?(?:\d[\s\-]?){6,12}\d/g; // simple Swedish-friendly matcher
          const found = description.match(rx) || [];
          const norm = (s: string) => {
            const cleaned = s.replace(/[^\d+]/g, '');
            if (cleaned.startsWith('+')) return cleaned;
            if (cleaned.startsWith('0')) return '+46' + cleaned.slice(1);
            return cleaned.startsWith('46') ? ('+' + cleaned) : cleaned;
          };
          const uniq = Array.from(new Set(found.map(f => f.trim())));
          return uniq.map(display => ({ display, tel: norm(display) }));
        })();
  const headerTitle = [detailBase?.order_number ? `#${detailBase.order_number}` : null, detailBase?.project_name || 'Projekt'].filter(Boolean).join(' ');
        const segId = detailBase?.segment_id as string | undefined;
        const segReports = segId ? (segmentReportsMap[segId] || []) : [];
        const reportedTotal = segReports.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
        const detailTheme = getMaterialTheme(detailBase?.job_type);
        const sellerInfo = (() => {
          const normalizePhone = (value: string | null) => {
            if (!value) return null;
            const cleaned = value.replace(/[^\d+]/g, '');
            if (!cleaned) return null;
            if (cleaned.startsWith('+')) return cleaned;
            if (cleaned.startsWith('0')) return `+46${cleaned.slice(1)}`;
            return cleaned.startsWith('46') ? `+${cleaned}` : cleaned;
          };
          const pickSeller = (input: any) => {
            if (!input) return { name: null as string | null, email: null as string | null, phone: null as string | null };
            if (typeof input === 'string') return { name: input, email: null, phone: null };
            if (Array.isArray(input)) {
              const names = input.map((entry: any) => entry?.name || entry?.fullName || entry?.title || null).filter(Boolean);
              const firstWithContact = input.find((entry: any) => entry && (entry.email || entry.mail || entry.phone || entry.mobilePhone || entry.mobile || entry.phoneNumber));
              return {
                name: names.length ? names.join(', ') : null,
                email: firstWithContact?.email || firstWithContact?.mail || null,
                phone: firstWithContact?.phone || firstWithContact?.mobilePhone || firstWithContact?.mobile || firstWithContact?.phoneNumber || null,
              };
            }
            if (typeof input === 'object') {
              return {
                name: input.name || input.fullName || input.title || null,
                email: input.email || input.mail || null,
                phone: input.phone || input.mobilePhone || input.mobile || input.phoneNumber || null,
              };
            }
            return { name: null, email: null, phone: null };
          };
          const findDirectoryMatch = (sellerName: string | null) => {
            const normalized = normalizePersonName(sellerName);
            if (!normalized) return null;
            const exact = contactDirectory.find(entry => normalizePersonName(entry.name) === normalized);
            if (exact) return exact;
            return contactDirectory.find(entry => {
              const candidate = normalizePersonName(entry.name);
              return candidate.includes(normalized) || normalized.includes(candidate);
            }) || null;
          };
          const picked = pickSeller(raw?.salesResponsible || raw?.salesResponsibleUser || raw?.salesUser || raw?.salesRep || raw?.responsibleSalesUser);
          const name = picked.name || raw?.salesResponsibleName || raw?.salesResponsibleFullName || null;
          const email = picked.email || raw?.salesResponsibleEmail || raw?.salesEmail || raw?.responsibleSalesEmail || null;
          const directoryMatch = findDirectoryMatch(name);
          const phone = picked.phone || raw?.salesResponsiblePhone || raw?.salesPhone || raw?.responsibleSalesPhone || raw?.salesResponsibleMobile || raw?.salesMobile || directoryMatch?.phone || null;
          const tel = normalizePhone(phone);
          return {
            name,
            email,
            phone,
            tel,
            role: directoryMatch?.role || null,
            location: directoryMatch?.location || null,
          };
        })();
        const isDesktopModal = !compact;
        const modalActionClass = cn(
          'inline-flex w-full items-center justify-center box-border font-bold leading-[1.2]',
          isDesktopModal ? 'rounded-lg px-2 py-[5px] text-[9px]' : 'min-h-[42px] rounded-xl px-3 py-2.5 text-xs'
        );
        const infoCardClass = cn(
          'grid border border-slate-200 bg-white',
          isDesktopModal ? 'gap-1.5 rounded-[10px] px-[9px] py-2' : 'gap-1.5 rounded-[14px] px-3 pb-2.5 pt-3'
        );
        const modalSectionClass = cn(
          'grid border border-slate-200 bg-white',
          isDesktopModal ? 'gap-1.5 rounded-xl px-3 py-2.5' : 'gap-2 rounded-2xl p-[14px]'
        );
        const modalFieldLabelClass = 'grid min-w-0 gap-[5px] text-xs';
        return (
          <div
            className={cn(
              'fixed inset-0 z-[260] flex justify-center overscroll-none bg-[rgba(15,23,42,0.56)] [backdrop-filter:blur(4px)]',
              compact
                ? 'items-start px-3 pb-[calc(env(safe-area-inset-bottom,0px)+20px)] pt-[calc(env(safe-area-inset-top,0px)+72px)]'
                : 'items-center p-6'
            )}
            onClick={closeDetail}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-busy={detailLoading ? true : undefined}
              onClick={e => e.stopPropagation()}
              className={cn(
                'grid min-w-0 overflow-x-hidden overflow-y-auto overscroll-contain border border-[#dbe4ef] bg-white shadow-[0_24px_60px_rgba(15,23,42,0.28)]',
                isDesktopModal ? 'w-[min(660px,88vw)] max-h-[78vh] gap-2.5 rounded-2xl p-3' : 'w-[min(760px,94vw)] max-h-[calc(100vh-env(safe-area-inset-top,0px)-env(safe-area-inset-bottom,0px)-104px)] gap-3.5 rounded-[20px] px-4 pb-[calc(env(safe-area-inset-bottom,0px)+24px)] pt-4'
              )}
            >
              <div
                className={cn(
                  'grid bg-[linear-gradient(180deg,#ffffff_0%,#f8fbff_100%)]',
                  isDesktopModal ? 'gap-2.5 rounded-[14px] px-3 py-2.5' : 'gap-3.5 rounded-[18px] px-[14px] py-[14px]'
                )}
                style={{ border: `1px solid ${detailTheme.accent}22` }}
              >
                <div className={cn(isDesktopModal ? 'flex flex-wrap items-start justify-between gap-2.5' : 'grid gap-3.5')}>
                  <div className="grid min-w-0 gap-2">
                    <div className="inline-flex flex-wrap items-center gap-2">
                      <span className={cn('inline-flex items-center gap-1.5 rounded-full font-bold', isDesktopModal ? 'px-[7px] py-[3px] text-[10px]' : 'px-2 py-1 text-[11px]')} style={{ background: detailTheme.badgeBg, color: detailTheme.badgeFg }}>
                        {detailBase?.job_type || 'Planering'}
                      </span>
                      {segId && reportedTotal > 0 && <span className={cn('inline-flex items-center gap-1.5 rounded-full bg-cyan-50 font-bold text-cyan-700', isDesktopModal ? 'px-[7px] py-[3px] text-[10px]' : 'px-2 py-1 text-[11px]')}>Rapporterat {reportedTotal} säckar</span>}
                    </div>
                    <strong className={cn('break-words leading-[1.15] text-slate-900', isDesktopModal ? 'text-base' : 'text-xl')}>{headerTitle}</strong>
                    {detailBase?.customer && <span className={cn('break-words font-semibold text-slate-600', isDesktopModal ? 'text-xs' : 'text-sm')}>{detailBase.customer}</span>}
                    <div className="flex flex-wrap items-center gap-2">
                      {detailBase?.truck && <span className={cn('rounded-full border border-slate-200 bg-slate-50 text-slate-600', isDesktopModal ? 'px-[7px] py-[3px] text-[10.5px]' : 'px-2 py-1 text-[10.5px]')}>Lastbil: {detailBase.truck}</span>}
                      {typeof detailBase?.bag_count === 'number' && <span className={cn('rounded-full border border-slate-200 bg-slate-50 text-slate-600', isDesktopModal ? 'px-[7px] py-[3px] text-[10.5px]' : 'px-2 py-1 text-[10.5px]')}>Plan: {detailBase.bag_count} säckar</span>}
                    </div>
                  </div>
                  {isDesktopModal ? (
                    <div className="grid w-[min(100%,104px)] grid-cols-1 items-stretch gap-[5px]">
                      {detailBase?.order_number && (
                        <a
                          href={`/egenkontroll?orderId=${encodeURIComponent(String(detailBase.order_number))}`}
                          className={cn(modalActionClass, 'border border-green-300 bg-green-50 text-green-700 no-underline')}
                        >Starta egenkontroll</a>
                      )}
                      {onReportTime && (
                        <button
                          type="button"
                          onClick={() => onReportTime({ projectId: String(detailBase?.project_id || ''), projectName: detailBase?.project_name, orderNumber: detailBase?.order_number ? String(detailBase.order_number) : undefined, day: (detailBase?.job_day || detailBase?.start_day) ? String(detailBase?.job_day || detailBase?.start_day) : undefined })}
                          className={cn(modalActionClass, 'border border-green-600 bg-green-600 text-white shadow-[0_6px_12px_rgba(22,163,74,0.12)]')}
                        >Rapportera tid</button>
                      )}
                      <button type="button" onClick={closeDetail} className={cn(modalActionClass, 'border border-red-200 bg-red-50 text-red-700')}>Stäng</button>
                    </div>
                  ) : (
                    <div className="grid gap-2.5 rounded-[16px] border border-slate-200 bg-white/80 p-2.5 shadow-[0_10px_20px_rgba(15,23,42,0.05)]">
                      <div className="grid gap-2">
                        {onReportTime && (
                          <button
                            type="button"
                            onClick={() => onReportTime({ projectId: String(detailBase?.project_id || ''), projectName: detailBase?.project_name, orderNumber: detailBase?.order_number ? String(detailBase.order_number) : undefined, day: (detailBase?.job_day || detailBase?.start_day) ? String(detailBase?.job_day || detailBase?.start_day) : undefined })}
                            className={cn(modalActionClass, 'min-h-[46px] border border-green-600 bg-green-600 text-white shadow-[0_10px_18px_rgba(22,163,74,0.16)]')}
                          >Rapportera tid</button>
                        )}
                        {detailBase?.order_number && (
                          <a
                            href={`/egenkontroll?orderId=${encodeURIComponent(String(detailBase.order_number))}`}
                            className={cn(modalActionClass, 'min-h-[44px] border border-green-300 bg-green-50 text-green-700 no-underline shadow-[0_8px_16px_rgba(34,197,94,0.08)]')}
                          >Starta egenkontroll</a>
                        )}
                        <button
                          type="button"
                          onClick={closeDetail}
                          className={cn(modalActionClass, 'min-h-[44px] border border-red-200 bg-red-50 text-red-700')}
                        >Stäng</button>
                      </div>
                      <span className="block w-full break-words text-center text-[11px] leading-[1.45] text-slate-500">Snabbaste vägen för installatören ligger överst. Övriga åtgärder finns direkt under.</span>
                    </div>
                  )}
                </div>
                {(mapsHref || detailBase?.customer || phoneList.length > 0 || sellerInfo.name || sellerInfo.email || sellerInfo.phone) && (
                  <div className={cn('grid', compact ? 'grid-cols-1' : 'grid-cols-3', isDesktopModal ? 'gap-2' : 'gap-2.5')}>
                  {(detailBase?.customer || phoneList.length > 0) && (
                  <div className={infoCardClass}>
                    <span className="text-[11px] font-bold text-slate-700">Kontakt</span>
                    {detailBase?.customer && <span className={cn('leading-[1.35] text-slate-700', isDesktopModal ? 'text-xs' : 'text-sm')}>{detailBase.customer}</span>}
                    {phoneList.length > 0 ? (
                      <div className="flex flex-wrap items-center gap-2">
                        {phoneList.map(p => (
                          <a key={p.display} href={`tel:${p.tel}`} className={cn('rounded-full border border-slate-300 bg-sky-50 text-sky-700 no-underline', isDesktopModal ? 'px-[7px] py-[3px] text-[9px]' : 'px-2.5 py-1 text-xs')}>Ring {p.display}</a>
                        ))}
                      </div>
                    ) : (
                      <span className="text-xs text-slate-500">Inget telefonnummer hittades i beskrivningen.</span>
                    )}
                  </div>
                  )}
                  {(sellerInfo.name || sellerInfo.email || sellerInfo.phone) && (
                  <div className={infoCardClass}>
                    <span className="text-[11px] font-bold text-slate-700">Ansvarig säljare</span>
                    {sellerInfo.name && <span className={cn('leading-[1.35] text-slate-700', isDesktopModal ? 'text-xs' : 'text-sm')}>{sellerInfo.name}</span>}
                    {(sellerInfo.role || sellerInfo.location) && <span className={cn('text-slate-500', isDesktopModal ? 'text-[10px]' : 'text-xs')}>{[sellerInfo.role, sellerInfo.location].filter(Boolean).join(' • ')}</span>}
                    <div className="flex flex-wrap items-center gap-2">
                      {sellerInfo.tel && sellerInfo.phone && (
                        <a href={`tel:${sellerInfo.tel}`} className={cn('rounded-full border border-slate-300 bg-sky-50 text-sky-700 no-underline', isDesktopModal ? 'px-[7px] py-[3px] text-[9px]' : 'px-2.5 py-1 text-xs')}>Ring {sellerInfo.phone}</a>
                      )}
                      {sellerInfo.email && (
                        <a href={`mailto:${sellerInfo.email}`} className={cn('rounded-full border border-slate-300 bg-slate-50 text-sky-700 no-underline', isDesktopModal ? 'px-[7px] py-[3px] text-[9px]' : 'px-2.5 py-1 text-xs')}>Maila</a>
                      )}
                    </div>
                  </div>
                  )}
                  {mapsHref && (
                  <div className={infoCardClass}>
                    <div className="flex flex-wrap items-center justify-between gap-2.5">
                      <span className="text-[11px] font-bold text-slate-700">Adress</span>
                      <a href={mapsHref} target="_blank" rel="noopener noreferrer" className={cn('rounded-full border border-slate-300 bg-sky-100 text-sky-700 no-underline', isDesktopModal ? 'px-[7px] py-[3px] text-[9px]' : 'px-2.5 py-1 text-[11px]')}>Öppna i Kartor</a>
                    </div>
                    <span className={cn('break-words leading-[1.35] text-slate-700', isDesktopModal ? 'text-xs' : 'text-sm')}>{address}</span>
                  </div>
                  )}
                  </div>
                )}
              </div>
              {detailLoading && (
                <div role="status" aria-live="polite" className="grid gap-2.5 py-2">
                  <div className="flex items-center gap-2.5">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <circle cx="12" cy="12" r="9" stroke="#cbd5e1" strokeWidth="3" opacity="0.35" />
                      <path d="M21 12a9 9 0 0 0-9-9" stroke="#0ea5e9" strokeWidth="3" strokeLinecap="round">
                        <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.8s" repeatCount="indefinite" />
                      </path>
                    </svg>
                    <span className="text-xs text-slate-600">Hämtar detaljer…</span>
                  </div>
                  <div className="grid gap-1.5">
                    <div className="h-3 rounded-md bg-slate-200" />
                    <div className="h-3 w-[85%] rounded-md bg-slate-200" />
                    <div className="h-3 w-[70%] rounded-md bg-slate-200" />
                    <div className="h-20 rounded-lg border border-slate-200 bg-slate-50" />
                  </div>
                </div>
              )}
              {detailError && <div className="rounded-lg border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-700">Fel: {detailError}</div>}
              <div className="grid gap-3">
                {description && (
                  <div className={modalSectionClass}>
                    <span className={cn('font-bold text-slate-700', isDesktopModal ? 'text-[11px]' : 'text-[13px]')}>Beskrivning</span>
                    <p className={cn('m-0 whitespace-pre-wrap break-words leading-[1.45] text-slate-600', isDesktopModal ? 'text-[11px]' : 'text-sm')}>{description}</p>
                  </div>
                )}
                {/* Project comments */}
                {detailBase?.project_id && (
                  <div className={cn(modalSectionClass, 'min-w-0')}>
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <strong className={cn('text-slate-900', isDesktopModal ? 'text-xs' : 'text-sm')}>Kommentarer</strong>
                      <span className={cn('rounded-full border border-slate-200 bg-slate-100 font-semibold text-slate-600', isDesktopModal ? 'px-1.5 py-[2px] text-[9px]' : 'px-2 py-[3px] text-[11px]')}>
                        {commentsLoading && comments.length === 0 ? 'Laddar…' : comments.length > 0 ? `${comments.length} st` : 'Inga'}
                      </span>
                      <div className="h-px flex-1 bg-slate-200" />
                      <button
                        type="button"
                        onClick={() => setCommentsExpanded(v => !v)}
                        disabled={!commentsLoading && !commentsError && comments.length === 0}
                        className={cn(
                          'rounded-full border font-semibold transition',
                          !commentsLoading && !commentsError && comments.length === 0
                            ? 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400'
                            : 'border-slate-300 bg-white text-slate-700 hover:border-slate-400 hover:bg-slate-100',
                          isDesktopModal ? 'px-[7px] py-[3px] text-[9px]' : 'px-2.5 py-[5px] text-[11px]'
                        )}
                      >{commentsExpanded ? 'Dölj' : 'Visa'}</button>
                      <button
                        type="button"
                        onClick={() => refreshComments(true)}
                        className={cn('rounded-full border border-slate-300 bg-slate-100 text-slate-900', isDesktopModal ? 'px-[7px] py-[3px] text-[9px]' : 'px-2.5 py-[5px] text-[11px]')}
                      >Uppdatera</button>
                    </div>
                    {!commentsExpanded && !commentsLoading && !commentsError && comments.length > 0 && (
                      <div className="text-xs text-slate-500">{comments.length === 1 ? '1 kommentar finns för projektet.' : `${comments.length} kommentarer finns för projektet.`}</div>
                    )}
                    {commentsExpanded && commentsLoading && comments.length === 0 && <div className="text-xs text-slate-500">Hämtar kommentarer…</div>}
                    {commentsExpanded && commentsError && <div className="text-xs text-red-700">Fel: {commentsError}</div>}
                    {!commentsExpanded && commentsError && <div className="text-xs text-red-700">Kommentarerna kunde inte hämtas.</div>}
                    {commentsExpanded && !commentsLoading && !commentsError && comments.length === 0 && <div className="text-xs text-slate-500">Inga kommentarer.</div>}
                    {commentsExpanded && !commentsLoading && !commentsError && comments.length > 0 && (
                      <div className="grid min-w-0 gap-1.5">
                        {comments.slice(0,10).map(c => (
                          <div key={c.id} className={cn('grid min-w-0 gap-1 rounded-[12px] border border-slate-200 bg-[#fbfdff]', isDesktopModal ? 'px-[9px] py-[7px]' : 'px-3 py-2.5')}>
                            <div className="flex min-w-0 flex-wrap items-center gap-2">
                              {c.userName && <span className="text-[11px] font-bold text-slate-600">{c.userName}</span>}
                              {c.createdAt && <span className="text-[10px] text-slate-500">{formatRelativeTime(c.createdAt)}</span>}
                            </div>
                            <div className={cn('min-w-0 whitespace-pre-wrap break-all leading-[1.4] text-slate-700', isDesktopModal ? 'text-[11px]' : 'text-[13px]')}>{c.text}</div>
                          </div>
                        ))}
                        {comments.length > 10 && <div className="text-[11px] text-slate-500">Visar 10 av {comments.length} kommentarer.</div>}
                      </div>
                    )}
                  </div>
                )}
                {/* Rapportering UI for installers */}
                <div className={cn('grid border border-[#dbe4ef] bg-[linear-gradient(180deg,#f8fafc_0%,#ffffff_100%)]', isDesktopModal ? 'gap-2 rounded-xl p-2.5' : 'gap-2.5 rounded-2xl p-[14px]')}>
                  <div className="flex items-center gap-2">
                    <strong className={cn('text-slate-900', isDesktopModal ? 'text-xs' : 'text-sm')}>Rapportering</strong>
                    <div className="h-px flex-1 bg-slate-200" />
                    {segId && <span className="text-[11px] font-semibold text-slate-500">Totalt: {reportedTotal} säckar</span>}
                  </div>
                  {!detailBase?.project_id && <div className="text-xs text-slate-500">Denna post saknar projekt-id och kan inte rapporteras här.</div>}
                  {detailBase?.project_id && (
                    <>
                      {!segId && <div className="text-xs text-slate-500">Denna post saknar segment-id (kan inte rapportera säckar), men du kan skicka en kommentar.</div>}
                      <div className="grid gap-2.5">
                        <div className={cn('grid', compact ? 'grid-cols-1' : 'grid-cols-2', isDesktopModal ? 'gap-2' : 'gap-2.5')}>
                        <label className={modalFieldLabelClass}>
                          <span>Dag</span>
                          <Input type="date" value={reportDraft.day} onChange={e => setReportDraft(d => ({ ...d, day: e.target.value }))} className={cn(isDesktopModal ? 'min-h-0 rounded-[10px] px-[9px] py-[7px] text-[11px]' : 'rounded-xl px-3 py-2.5 text-sm')} />
                        </label>
                        {segId && (
                          <label className={modalFieldLabelClass}>
                            <span>Antal säckar</span>
                            <Input type="number" min={1} value={reportDraft.amount} onChange={e => setReportDraft(d => ({ ...d, amount: e.target.value }))} placeholder="t.ex. 8" className={cn(isDesktopModal ? 'min-h-0 rounded-[10px] px-[9px] py-[7px] text-[11px]' : 'rounded-xl px-3 py-2.5 text-sm')} />
                          </label>
                        )}
                        </div>
                        <div className={cn('grid items-end', compact ? 'grid-cols-1' : '[grid-template-columns:minmax(0,1fr)_auto]', 'gap-2.5')}>
                        <label className={modalFieldLabelClass}>
                          <span>Kommentar</span>
                          <Textarea value={commentDraft} onChange={e => setCommentDraft(e.target.value)} placeholder="t.ex. 25 kvm klart / kunde inte utföra p.g.a. ..." rows={isDesktopModal ? 2 : 3} className={cn('min-h-0', isDesktopModal ? 'rounded-[10px] px-[9px] py-[7px] text-[11px]' : 'rounded-xl px-3 py-2.5 text-sm')} />
                        </label>
                        <button type="button" onClick={addPartialReport} disabled={reportSending} className={cn('self-stretch border border-green-600 font-bold text-white', reportSending ? 'bg-green-300' : 'bg-green-600', compact ? 'w-full min-h-[42px]' : '', isDesktopModal ? 'rounded-[10px] px-[14px] py-2 text-[11px] shadow-[0_6px_12px_rgba(22,163,74,0.12)]' : 'rounded-xl px-4 py-2.5 text-sm shadow-[0_10px_18px_rgba(22,163,74,0.16)]')}>
                          {reportSending ? 'Skickar…' : 'Skicka'}
                        </button>
                        </div>
                      </div>
                      {reportError && <div className="rounded-lg border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-700">{reportError}</div>}
                      {segId && segReports.length > 0 ? (
                        <div className="grid gap-1.5">
                          {segReports.map(r => (
                            <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5">
                              <div className="flex flex-wrap items-center gap-2.5">
                                <span className="text-xs text-slate-900">{r.report_day}</span>
                                <span className="rounded-full border border-slate-200 bg-slate-100 px-2.5 py-1 text-xs text-slate-700">{r.amount} säckar</span>
                                {r.created_by_name && <span className="text-[11px] text-slate-500">av {r.created_by_name}</span>}
                              </div>
                              <button type="button" onClick={() => deletePartialReport(r.id)} className="rounded-[10px] border border-red-200 bg-red-100 px-2.5 py-1.5 text-[11px] text-red-700">Ta bort</button>
                            </div>
                          ))}
                        </div>
                      ) : segId ? (
                        <div className="text-xs text-slate-500">Inga delrapporter ännu.</div>
                      ) : null}
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </section>
  );
}
