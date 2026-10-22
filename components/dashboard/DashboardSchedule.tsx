"use client";
import { getBrowserClient } from '@/lib/supabase/browser';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useProjectComments, formatRelativeTime } from '../../lib/useProjectComments';
import { cn } from '@/lib/shared/cn';
import Input from '../ui/Input';
import Textarea from '../ui/Textarea';
import Badge from '../ui/Badge';
import DashboardCardHeader from './DashboardCardHeader';
import ScheduleStopCard from './schedule/ScheduleStopCard';
import ScheduleTruckGroup from './schedule/ScheduleTruckGroup';
import { getMaterialTheme } from './schedule/materialTheme';
import { crmJobToScheduleItem, type CrmJobRow } from '@/lib/domains/planning/myJobs';
import { countScheduleRowsOnDay, groupScheduleStops, mapsSearchHref, scheduleDayLabel, workOrderHref, type ScheduleTruckGroup as TruckGroup } from '@/lib/domains/planning/scheduleStops';
import { defaultScheduleDayIndex, scheduleWeekOffsetFor, scheduleWeekRange } from '@/lib/domains/planning/scheduleWeek';
import { stockholmTodayISO } from '@/lib/domains/planning/timezone';

// Vald vecka och vald dag bärs i adressfältet, inte bara i komponentens state.
//
// Ett CRM-jobb öppnas med en hård navigering till /arbetsorder/<id>, och fältvyns "← Tillbaka" är
// ett vanligt history.back(). Startsidan monteras alltså om på vägen tillbaka, och utan de här
// parametrarna landade installatören på dagens dag varje gång — den som ville gå igenom nästa
// veckas jobb fick bläddra fram en vecka på nytt för varje arbetsorder.
//
// Veckan bärs som måndagens datum, se scheduleWeekOffsetFor. Dagen bärs som knappens index eftersom
// den bara är meningsfull inom den vecka som står bredvid.
const WEEK_PARAM = 'vecka';
const DAY_PARAM = 'dag';
const DAY_ALL = 'alla';

const MONTHS_SHORT = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];

/**
 * '2026-08-17' + '2026-08-23' → '17–23 aug', eller '28 jul–3 aug' över ett månadsskifte.
 *
 * Veckoväljaren visade tidigare de råa ISO-datumen ('2026-08-17 – 2026-08-23').
 *
 * Fälten plockas ur strängen i stället för via `new Date()`, så formateringen inte kan flytta dagen.
 * Indata är sedan 2026-08-16 förankrade i svensk tid — se `scheduleWeekRange`.
 */
function weekRangeLabel(startISO: string, endISO: string): string {
  const start = startISO.split('-').map(Number);
  const end = endISO.split('-').map(Number);
  if (start.length !== 3 || end.length !== 3 || start.some(Number.isNaN) || end.some(Number.isNaN)) {
    return `${startISO} – ${endISO}`;
  }
  return start[1] === end[1]
    ? `${start[2]}–${end[2]} ${MONTHS_SHORT[end[1] - 1]}`
    : `${start[2]} ${MONTHS_SHORT[start[1] - 1]}–${end[2]} ${MONTHS_SHORT[end[1] - 1]}`;
}

// A CRM-planned job carries source: 'crm'; legacy rows from get_my_jobs have no source field.
// The enrichment queries, the detail modal and time reporting all assume the legacy world, so
// every one of them has to skip these rows.
const isCrmItem = (it: { source?: string } | null | undefined) => it?.source === 'crm';

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
  const supabase = getBrowserClient();
  const [weekOffset, setWeekOffset] = useState(0);
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [segmentSortIndexMap, setSegmentSortIndexMap] = useState<Record<string, number | null>>({});
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [currentUserName, setCurrentUserName] = useState<string | null>(null);
  // 0=mån .. 4=fre, null=alla. Svensk veckodag, inte serverns — se scheduleWeek.ts.
  const [dayIdx, setDayIdx] = useState<number | null>(() => defaultScheduleDayIndex());
  // URL:en läses först i en effekt, aldrig i en state-initierare: sidan är force-dynamic och
  // server-renderas, och servern har inget `window`. Ett `typeof window`-undantag i initieraren
  // hade gett servern förvalet och klienten den sparade vyn — alltså en hydreringskrock på precis
  // de knappar det handlar om. Flaggan håller också tillbaka jobbhämtningen tills vyn är känd, så
  // vi inte hämtar fel vecka först och rätt vecka direkt efteråt.
  const [viewRestored, setViewRestored] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const week = params.get(WEEK_PARAM);
    if (week) setWeekOffset(scheduleWeekOffsetFor(week));
    const day = params.get(DAY_PARAM);
    if (day === DAY_ALL) setDayIdx(null);
    else if (day && /^[0-4]$/.test(day)) setDayIdx(Number(day));
    setViewRestored(true);
  }, []);

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
    // A CRM job has its own field view; this modal is built for the legacy world. Letting it run
    // would be worse than useless: it enriches by looking a Blikk project up BY ORDER NUMBER, and
    // Fortnox numbers are numeric like Blikk's — so a CRM job could pull up an unrelated project's
    // details, and the segment reports/comments below belong to legacy tables entirely.
    //
    // ⚠️ Grinden står på KÄLLAN, inte på order-id:t. En CRM-rad kan sakna arbetsorder sedan
    // platshållare kan publiceras till entreprenaden — och `&& it.work_order_id` hade släppt
    // igenom just den raden till precis det modalen ovan säger att den aldrig får köra på: ett
    // uppslag mot planning_*-tabellerna med ett CRM-uuid, och ett Blikk-projekt sökt på
    // ordernummer. En platshållare har inget att öppna, och då är rätt svar att inte öppna något.
    if (isCrmItem(it)) {
      // ⚠️ PLACERINGEN MÅSTE MED (?segment=, etapperna) — workOrderHref bär den, och samma länk står
      // på kortets "Öppna arbetsorder". null på en platshållare: då navigerar ingenting.
      const href = workOrderHref(it);
      if (href) window.location.href = href;
      return;
    }
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
      // Svensk dag, inte enhetens: värdet är förifyllt i säckrapporten och SPARAS som den dag
      // rapporten gäller, så en telefon i fel zon hade skrivit rapporten på fel datum.
      const today = stockholmTodayISO();
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

  // startISO/endISO går rakt in i get_my_jobs / get_my_crm_jobs, alltså avgör de VILKA JOBB som
  // hämtas — inte bara vad etiketten säger. Beräkningen och dess tidszonsankare ligger i
  // lib/domains/planning/scheduleWeek.ts med tester (tests/planning/scheduleWeek.test.ts).
  const range = useMemo(() => scheduleWeekRange(weekOffset), [weekOffset]);

  // replaceState, inte router.replace: startsidan är force-dynamic, så en router-navigering hade
  // kostat en server-rundtur per tryck på en dagknapp. Och replace, inte push, så att "← Tillbaka"
  // i arbetsordern tar dig till schemat och inte bakåt genom varje vecka du bläddrat förbi.
  useEffect(() => {
    if (!viewRestored) return;
    const url = new URL(window.location.href);
    // ⚠️ Varje parameter står och faller för sig, aldrig som ett par. Den som står på sitt förval
    // ska SAKNAS i URL:en, för då räknas förvalet om vid nästa montering i stället för att frysas.
    // `range` memoiseras på weekOffset och läser klockan när den räknas, så en flik som stått öppen
    // över ett dygnsskifte håller ett gammalt måndagsdatum. Skrevs det ut vid offset 0 skulle
    // installatören som passerat en söndagsnatt låsas fast en vecka bakåt — förut läkte just den
    // omstarten felet. Nu skrivs ingenting vid offset 0, och en bortbläddrad vecka som hunnit bli
    // den aktuella läser tillbaka som 0. URL:en berättar alltid vad som stod på skärmen.
    if (weekOffset === 0) url.searchParams.delete(WEEK_PARAM);
    else url.searchParams.set(WEEK_PARAM, range.startISO);
    if (dayIdx === defaultScheduleDayIndex()) url.searchParams.delete(DAY_PARAM);
    else url.searchParams.set(DAY_PARAM, dayIdx == null ? DAY_ALL : String(dayIdx));
    window.history.replaceState({}, '', url.toString());
  }, [viewRestored, weekOffset, dayIdx, range.startISO]);

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
    if (!viewRestored) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        // Two planning worlds during the cutover. allSettled, not all: one source failing must not
        // blank the other — an installer's week is a week either way.
        const [legacy, crm] = await Promise.allSettled([
          supabase.rpc('get_my_jobs', { start_date: range.startISO, end_date: range.endISO }),
          supabase.rpc('get_my_crm_jobs', { start_date: range.startISO, end_date: range.endISO }),
        ]);
        if (cancelled) return;

        const unwrap = (r: PromiseSettledResult<{ data: unknown; error: unknown }>, label: string) => {
          if (r.status !== 'fulfilled') { console.warn(`[dashboard schedule] ${label} rejected`, r.reason); return []; }
          if (r.value.error) { console.warn(`[dashboard schedule] ${label} error`, r.value.error); return []; }
          return Array.isArray(r.value.data) ? r.value.data : [];
        };

        const legacyRows = unwrap(legacy, 'get_my_jobs');
        const crmRows = (unwrap(crm, 'get_my_crm_jobs') as CrmJobRow[]).map(crmJobToScheduleItem);
        setItems([...legacyRows, ...crmRows]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [supabase, viewRestored, range.startISO, range.endISO]);

  // Enrich items with per-segment sort_index (used for ordering, same as Planning page)
  useEffect(() => {
    const ids = Array.from(new Set((items.filter(it => !isCrmItem(it)).map(it => it.segment_id) as Array<unknown>)
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
    const ids = Array.from(new Set((items.filter(it => !isCrmItem(it)).map(it => it.segment_id) as Array<unknown>)
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
    const ids = Array.from(new Set((items.filter(it => !isCrmItem(it)).map(it => it.segment_id) as Array<unknown>)
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

  // Dag → lastbil → stopp. En vald dag visar bara den dagens utbredda rader; "Hela veckan" en grupp
  // per dag. Ordningen inom en bil är planeringstavlans — se groupScheduleStops.
  const days = useMemo(() => {
    // De gamla Blikk-radernas ordning hämtas separat ur planning_segments (segmentSortIndexMap).
    const getSortIndex = (x: any): number | null => {
      const v = (x.sort_index ?? x.sortIndex);
      if (typeof v === 'number' && Number.isFinite(v)) return v;
      const sid = (x.segment_id || x.segmentId || '') as string;
      if (sid && sid in segmentSortIndexMap) return segmentSortIndexMap[sid];
      return null;
    };
    return groupScheduleStops(items, getSortIndex, dayIdx != null ? range.days[dayIdx] : null);
  }, [items, dayIdx, range.days, segmentSortIndexMap]);
  const weekView = dayIdx == null;

  // Platshållarnas utfällning. En publicerad platshållare har ingen arbetsorder att öppna, och
  // beskrivningen är ofta allt som säger vad dagen går ut på. Kapad efter två rader fick
  // entreprenaden aldrig se resten: hela texten låg bara i `title`, som en telefon inte visar.
  // Kortet fälls därför ut på plats — samma text som /mina-jobb redan visar okapad.
  //
  // Bara ett kort där något FAKTISKT är kapat får "Visa hela texten" och blir tryckbart. Ett kort som
  // lovar mer och sedan inte visar något nytt är samma tomma löfte som en "Öppna"-knapp utan order
  // bakom. Beskrivningen bär därför `data-clip-key` (ScheduleStopCard) och mäts när listan renderas
  // om och när den ändrar storlek. Rubriken bryts på flera rader sedan omgörningen och kapas aldrig.
  //
  // ⚠️ Ett UTFÄLLT kort mäts inte, det behåller sitt senaste svar. Utfällt är det aldrig kapat, och
  // ett nytt mått hade tagit bort pilen. Då försvann knappen i samma ögonblick som kortet fälldes
  // ihop, och fokus följde med den.
  const [expandedKeys, setExpandedKeys] = useState<ReadonlySet<string>>(() => new Set());
  const [clippedKeys, setClippedKeys] = useState<ReadonlySet<string>>(() => new Set());
  const listRef = useRef<HTMLDivElement | null>(null);
  const toggleExpanded = useCallback((key: string) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);
  useEffect(() => {
    const root = listRef.current;
    if (!root) return;
    const targets = Array.from(root.querySelectorAll<HTMLElement>('[data-clip-key]'));
    const measure = () => {
      const measured = new Set<string>();
      const clipped = new Set<string>();
      for (const el of targets) {
        const key = el.dataset.clipKey as string;
        if (expandedKeys.has(key)) continue;
        measured.add(key);
        // Höjden får en pixels marginal, för line-clamp avrundar. Bredden får ingen: ellipsen syns
        // vid minsta överskott, och då ska kortet gå att fälla ut.
        if (el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth) clipped.add(key);
      }
      setClippedKeys((prev) => {
        const next = new Set(Array.from(prev).filter((k) => expandedKeys.has(k) && !measured.has(k)));
        clipped.forEach((k) => next.add(k));
        return next.size === prev.size && Array.from(next).every((k) => prev.has(k)) ? prev : next;
      });
    };
    if (typeof ResizeObserver === 'undefined') {
      measure();
      return;
    }
    // Bredden avgör var texten kapas: en vriden telefon, ett smalare fönster eller en bredare
    // högerkolumn i kortet ändrar svaret. Observern anropar `measure` en gång direkt också.
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    targets.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [days, loading, compact, expandedKeys]);

  const visibleJobCount = days.reduce((sum, group) => sum + group.count, 0);
  // Knapparnas räknare. Samma urval som dagen visar (countScheduleRowsOnDay), så knappen aldrig säger
  // "2 jobb" om en dag som visar ett.
  const dayCounts = useMemo(() => range.days.slice(0, 5).map((d) => countScheduleRowsOnDay(items, d)), [items, range.days]);
  // Svensk dag: "idag" på knappen och "Idag" i bilens rubrik ska inte flytta sig i en telefon i fel zon.
  const todayISO = stockholmTodayISO();
  const dayButtonClass = (active: boolean) => cn(
    'relative flex h-14 w-full flex-col items-center justify-center gap-0.5 rounded-xl border px-1 py-0 transition',
    active
      ? 'border-[#1a3f26] bg-[#1a3f26] text-white'
      : 'border-[#e0e8dc] bg-white text-slate-600 hover:border-[#c6dccd] hover:text-slate-900',
  );
  const daySubClass = (active: boolean) => cn('text-xs tabular-nums', active ? 'text-[#cfe3d5]' : 'text-slate-500');

  // Bilens underrad. Hela veckan har redan dagen i dagrubriken ovanför, så där står bara stoppen.
  const truckSubtitle = (group: TruckGroup<unknown>, day: string) => {
    const n = group.stops.length;
    if (group.truck == null) return `${n} jobb`;
    const stops = n === 1 ? '1 stopp' : compact ? `${n} stopp` : `${n} stopp i ordning`;
    if (weekView) return stops;
    const when = compact ? (day === todayISO ? 'Idag' : scheduleDayLabel(day, 'short')) : scheduleDayLabel(day);
    return `${when} · ${stops}`;
  };

  const weekNav = (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => setWeekOffset(prev => prev - 1)}
        aria-label="Föregående vecka"
        className="h-11 w-11 shrink-0 rounded-xl border border-[#d9e2d4] bg-white p-0 text-slate-600 transition hover:border-slate-400"
      >
        <ChevronIcon direction="left" />
      </button>
      <div className={cn('text-center', compact ? 'min-w-0 flex-1' : 'min-w-[150px]')}>
        <div className="text-[15px] font-semibold text-slate-900">Vecka {range.weekNumber}</div>
        <div className="text-[13px] tabular-nums text-slate-600">{weekRangeLabel(range.startISO, range.endISO)}</div>
      </div>
      <button
        type="button"
        onClick={() => setWeekOffset(prev => prev + 1)}
        aria-label="Nästa vecka"
        className="h-11 w-11 shrink-0 rounded-xl border border-[#d9e2d4] bg-white p-0 text-slate-600 transition hover:border-slate-400"
      >
        <ChevronIcon direction="right" />
      </button>
    </div>
  );

  // ⚠️ INGEN EGEN KORTRAM HÄR. ClientDashboard renderar redan <section className={cardClass}> runt
  // den här komponenten, och det gjorde schemat till ett kort inuti ett kort: dubbel kant, dubbel
  // bakgrund, dubbel skugga och dubbel padding. Det var därför schemat såg tyngre ut än allt annat
  // på sidan. Uppgifter, Dokument och Arbetsytan returnerar alla en naken <div> — samma sak här nu.
  return (
    <div className="grid gap-3">
      {/* "Vecka 33" stod tidigare BÅDE i en badge här och i veckoväljaren under. Veckan hör hemma i
          väljaren — det är där man ändrar den. Kvar i rubriken: antalet jobb, som inte står någon
          annanstans. Metapillen "Alla dagar" är borta; dagväljaren visar redan vilken dag som är
          vald genom vilken knapp som är intryckt. */}
      <DashboardCardHeader
        title="Arbetsschema"
        meta={<Badge variant="accent">{visibleJobCount} jobb</Badge>}
        action={compact ? undefined : weekNav}
      />

      {/* Veckoväljaren, samma form som /tid: pilar i kanterna, veckan och datumen i mitten. På datorn
          står den i rubrikraden, på mobilen på en egen rad. */}
      {compact && weekNav}

      {/* Ersätter etiketten "Denna vecka / Förra veckan": en knapp som tar dig tillbaka säger samma
          sak och gör något åt det, och den syns bara när du faktiskt är bortbläddrad. */}
      {weekOffset !== 0 ? (
        <button
          type="button"
          onClick={() => setWeekOffset(0)}
          className={cn('rounded-lg py-1.5 text-sm font-semibold text-slate-600 underline underline-offset-2', compact ? 'justify-self-center' : 'justify-self-end')}
        >
          Gå till denna vecka
        </button>
      ) : null}

      {/* Mån–fre plus "Hela veckan". Knapparna bär dag, datum och antal jobb, så man ser vilka dagar
          som har något utan att trycka på dem. Antalen visas först när veckan är hämtad — en nolla
          medan den laddar hade varit fel. Rubriken "Visa dag" är borta: den intryckta knappen är svaret. */}
      <div className={cn('grid grid-cols-6', compact ? 'gap-1.5' : 'gap-2')}>
        {['Mån','Tis','Ons','Tor','Fre'].map((label, idx) => {
          const iso = range.days[idx];
          const active = dayIdx === idx;
          const isToday = iso === todayISO;
          const count = dayCounts[idx];
          const date = Number(iso.slice(8, 10));
          return (
            <button
              key={label}
              type="button"
              onClick={() => setDayIdx(idx)}
              aria-pressed={active}
              aria-current={isToday ? 'date' : undefined}
              aria-label={`${scheduleDayLabel(iso)}${isToday ? ', idag' : ''}${loading ? '' : `, ${count} jobb`}`}
              className={dayButtonClass(active)}
            >
              {compact ? (
                <>
                  <span className={cn('text-xs font-semibold', active ? 'text-[#cfe3d5]' : 'text-slate-600')}>{label}</span>
                  <span className={cn('text-[15px] tabular-nums', active ? 'font-bold' : 'font-semibold text-slate-700')}>{date}</span>
                  {!loading && count > 0 && (
                    <span
                      aria-hidden="true"
                      className={cn(
                        // Över knappens överkant, som ett notismärke: inne i hörnet täckte det dagnamnet
                        // i en knapp som bara är ~55 px bred. Ringen skiljer det från knappens kant.
                        'absolute -right-1 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold tabular-nums ring-2 ring-[#f9fbf7]',
                        active ? 'bg-[#2f6b45] text-white' : 'bg-[#1a3f26] text-white',
                      )}
                    >{count}</span>
                  )}
                </>
              ) : (
                <>
                  <span className={cn('text-[13px]', active ? 'font-bold' : 'font-semibold')}>{isToday ? `${label} · idag` : label}</span>
                  <span className={daySubClass(active)}>{loading ? date : `${date} · ${count ? `${count} jobb` : '–'}`}</span>
                </>
              )}
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => setDayIdx(null)}
          aria-pressed={dayIdx == null}
          aria-label={`Hela veckan${loading ? '' : `, ${items.length} jobb`}`}
          className={dayButtonClass(dayIdx == null)}
        >
          {compact ? (
            // Två rader av sig själv i en knapp som är ~55 px bred. Antalet står redan i rubrikens
            // räknare när hela veckan är vald, och ett märke i hörnet hade krockat med texten.
            <span className="text-xs font-semibold leading-tight">Hela veckan</span>
          ) : (
            <>
              <span className={cn('text-[13px]', dayIdx == null ? 'font-bold' : 'font-semibold')}>Hela veckan</span>
              {!loading && <span className={daySubClass(dayIdx == null)}>{items.length ? `${items.length} jobb` : '–'}</span>}
            </>
          )}
        </button>
      </div>

      {loading && <div className="px-0.5 pt-0 text-xs text-slate-500">Laddar…</div>}
      {!loading && days.length === 0 && (
        <div className={cn('inline-flex w-fit items-center gap-2 rounded-full border border-[#e0e8dc] bg-[#f9fbf7] text-slate-500 shadow-[0_6px_14px_rgba(20,44,27,0.04)]', compact ? 'px-[11px] py-[9px] text-xs' : 'px-3 py-2.5 text-xs')}>
          Inga jobb planerade för vald period.
        </div>
      )}

      {/* Dag → lastbil → stopp. Hela veckan får en dagrubrik per dag; en vald dag har sin dag i
          dagväljaren och i bilens rubrik. */}
      {!loading && days.length > 0 && (
        <div ref={listRef} className={cn('grid', compact ? 'gap-6' : 'gap-7')}>
          {days.map(({ day, trucks }) => (
            <div key={day} className={cn('grid', compact ? 'gap-4' : 'gap-5')}>
              {weekView && <h3 className="m-0 text-base font-bold text-slate-900">{scheduleDayLabel(day)}</h3>}
              {trucks.map((group) => (
                <ScheduleTruckGroup
                  key={group.truck ?? ''}
                  truck={group.truck}
                  subtitle={truckSubtitle(group, day)}
                  compact={compact}
                  headingLevel={weekView ? 4 : 3}
                >
                  {group.stops.map(({ row: it, stop, of }, i) => {
                    const cardKey = `${it.segment_id || `${it.project_id}|${it.start_day}`}|${it.job_day || ''}`;
                    const isPlaceholder = isCrmItem(it) && !it.work_order_id;
                    const expanded = isPlaceholder && expandedKeys.has(cardKey);
                    const expandable = isPlaceholder && (expanded || clippedKeys.has(cardKey));
                    const reported = it.segment_id ? (reportedBySegment.get(it.segment_id) || 0) : 0;
                    const crewNames = Array.from(new Set((segmentCrewMap[it.segment_id] || []).map(m => (m.name || '').trim()).filter(Boolean)));
                    return (
                      <ScheduleStopCard
                        key={cardKey}
                        row={it}
                        stop={stop}
                        of={of}
                        last={i === group.stops.length - 1}
                        compact={compact}
                        headingLevel={weekView ? 5 : 4}
                        reported={reported}
                        crewNames={crewNames}
                        clipKey={cardKey}
                        expanded={expanded}
                        expandable={expandable}
                        onToggleExpanded={() => toggleExpanded(cardKey)}
                        onOpen={() => openDetail(it)}
                        onReportTime={onReportTime ? () => onReportTime({ projectId: String(it.project_id || ''), projectName: it.project_name, orderNumber: it.order_number ? String(it.order_number) : undefined, day: (it.job_day || it.start_day) ? String(it.job_day || it.start_day) : undefined }) : undefined}
                      />
                    );
                  })}
                </ScheduleTruckGroup>
              ))}
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
        const mapsHref = address ? mapsSearchHref(address) : null;
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
                'grid min-w-0 overflow-x-hidden overflow-y-auto overscroll-contain border border-[#e0e8dc] bg-white shadow-[0_24px_60px_rgba(15,23,42,0.28)]',
                isDesktopModal ? 'w-[min(660px,88vw)] max-h-[78vh] gap-2.5 rounded-2xl p-3' : 'w-[min(760px,94vw)] max-h-[calc(100vh-env(safe-area-inset-top,0px)-env(safe-area-inset-bottom,0px)-104px)] gap-3.5 rounded-[20px] px-4 pb-[calc(env(safe-area-inset-bottom,0px)+24px)] pt-4'
              )}
            >
              <div
                className={cn(
                  'grid bg-[linear-gradient(180deg,#ffffff_0%,#f9fbf7_100%)]',
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
                          <a key={p.display} href={`tel:${p.tel}`} className={cn('rounded-full border border-[color:var(--ek-accent-soft-border)] bg-[color:var(--ek-accent-soft)] text-[color:var(--ek-accent)] no-underline', isDesktopModal ? 'px-[7px] py-[3px] text-[9px]' : 'px-2.5 py-1 text-xs')}>Ring {p.display}</a>
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
                        <a href={`tel:${sellerInfo.tel}`} className={cn('rounded-full border border-[color:var(--ek-accent-soft-border)] bg-[color:var(--ek-accent-soft)] text-[color:var(--ek-accent)] no-underline', isDesktopModal ? 'px-[7px] py-[3px] text-[9px]' : 'px-2.5 py-1 text-xs')}>Ring {sellerInfo.phone}</a>
                      )}
                      {sellerInfo.email && (
                        <a href={`mailto:${sellerInfo.email}`} className={cn('rounded-full border border-[color:var(--ek-accent-soft-border)] bg-[color:var(--ek-accent-soft)] text-[color:var(--ek-accent)] no-underline', isDesktopModal ? 'px-[7px] py-[3px] text-[9px]' : 'px-2.5 py-1 text-xs')}>Maila</a>
                      )}
                    </div>
                  </div>
                  )}
                  {mapsHref && (
                  <div className={infoCardClass}>
                    <div className="flex flex-wrap items-center justify-between gap-2.5">
                      <span className="text-[11px] font-bold text-slate-700">Adress</span>
                      <a href={mapsHref} target="_blank" rel="noopener noreferrer" className={cn('rounded-full border border-[color:var(--ek-accent-soft-border)] bg-[color:var(--ek-accent-soft)] text-[color:var(--ek-accent)] no-underline', isDesktopModal ? 'px-[7px] py-[3px] text-[9px]' : 'px-2.5 py-1 text-[11px]')}>Öppna i Kartor</a>
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
                      <path d="M21 12a9 9 0 0 0-9-9" stroke="#1a3f26" strokeWidth="3" strokeLinecap="round">
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
                            ? 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-500'
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
                          <div key={c.id} className={cn('grid min-w-0 gap-1 rounded-[12px] border border-[#e0e8dc] bg-[#f9fbf7]', isDesktopModal ? 'px-[9px] py-[7px]' : 'px-3 py-2.5')}>
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
                <div className={cn('grid border border-[#e0e8dc] bg-[linear-gradient(180deg,#f9fbf7_0%,#ffffff_100%)]', isDesktopModal ? 'gap-2 rounded-xl p-2.5' : 'gap-2.5 rounded-2xl p-[14px]')}>
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
    </div>
  );
}

function ChevronIcon({ direction }: { direction: 'left' | 'right' }) {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" className="mx-auto">
      <path d={direction === 'left' ? 'M15 18l-6-6 6-6' : 'M9 18l6-6-6-6'} />
    </svg>
  );
}
