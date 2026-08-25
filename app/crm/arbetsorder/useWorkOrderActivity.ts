"use client";

import { useEffect, useMemo, useState } from 'react';
import { useToast } from '@/lib/Toast';
import type { TimeEntryItem, TimeDraft } from './WorkOrderTimeTab';
import type { CommentItem } from './WorkOrderCommentsTab';
import type { MentionUser } from '@/app/crm/components/MentionTextarea';

// Shared time-entry + comment + @-mention loading and owner-scoped CRUD for a work
// order. Used by both the full editor (/crm) and the installer field view (/arbetsorder)
// so the write logic lives in one place. Handlers return a boolean so callers can reset
// their own form/edit state on success.
// `includeTimeEntries: false` skips the time-entries request entirely. Fältvyn döljer Tid-fliken
// för alla utom attestansvariga (besättningen rapporterar fortfarande i Blikk), och att hämta en
// lista som ingenting renderar kostar en extra rundtur på en telefon i fält, varje gång ett jobb
// öppnas.
export function useWorkOrderActivity(workOrderId: string, options?: { includeTimeEntries?: boolean }) {
  const includeTimeEntries = options?.includeTimeEntries !== false;
  const toast = useToast();
  const [timeEntries, setTimeEntries] = useState<TimeEntryItem[]>([]);
  const [comments, setComments] = useState<CommentItem[]>([]);
  const [mentionUsers, setMentionUsers] = useState<MentionUser[]>([]);
  const [timeEntriesLoading, setTimeEntriesLoading] = useState(true);
  const [commentsLoading, setCommentsLoading] = useState(true);

  useEffect(() => {
    let active = true;
    async function load() {
      setTimeEntriesLoading(true); setCommentsLoading(true);
      try {
        const [timeRes, commentRes, mentionRes] = await Promise.all([
          includeTimeEntries ? fetch(`/api/crm/work-orders/${workOrderId}/time-entries`, { cache: 'no-store' }) : null,
          fetch(`/api/crm/work-orders/${workOrderId}/comments`, { cache: 'no-store' }),
          fetch('/api/crm/work-orders/mention-users', { cache: 'no-store' }),
        ]);
        const [timeJson, commentJson, mentionJson] = await Promise.all([
          timeRes ? timeRes.json().catch(() => ({})) : Promise.resolve({}),
          commentRes.json().catch(() => ({})), mentionRes.json().catch(() => ({})),
        ]);
        if (!active) return;
        setTimeEntries(timeRes?.ok && timeJson.ok ? timeJson.data?.items || [] : []);
        setComments(commentRes.ok && commentJson.ok ? commentJson.data?.items || [] : []);
        setMentionUsers(mentionRes.ok && mentionJson.ok ? mentionJson.data?.items || [] : []);
      } catch { /* non-fatal */ }
      finally { if (active) { setTimeEntriesLoading(false); setCommentsLoading(false); } }
    }
    load();
    return () => { active = false; };
  }, [workOrderId, includeTimeEntries]);

  // Namnregister för KOLLEGORS rader.
  //
  // `profiles` är self-read-only (profiles_select_self i auth_roles_setup.sql:71 är enda
  // SELECT-policyn). Kommentarerna och tidraderna läses med SESSIONSKLIENTEN, så de joinade
  // profilerna i selecten (`author:profiles(...)`, `user:profiles(...)` i lib/domains/crm/
  // work-orders.ts) är null för varje rad utom ens egna — kollegans namn föll tillbaka på
  // etiketterna "Kommentar" respektive "Medarbetare".
  //
  // @-omnämnandelistan hämtas däremot ELEVERAT (mention-users-rutten) och innehåller varje
  // namngiven anställd, installatörer inkluderade. Den är alltså redan det register som saknades —
  // den låg i samma svar, den användes bara inte. Samma grepp som assigneeNameById i
  // arbetsorderlistan och offertlistan.
  //
  // ⚠️ Det här är en LAPP på self-read-RLS, inte en lösning. Den riktiga fixen är en smal
  // employee_directory-vy; se minnet project_profiles_rls_rebuild.
  const namesById = useMemo(() => {
    const map = new Map<string, string>();
    for (const u of mentionUsers) if (u.full_name) map.set(u.id, u.full_name);
    return map;
  }, [mentionUsers]);

  // Klockslagen är obligatoriska sedan 2026-08-14: raden är löneunderlag, och lönen härleder OB och
  // övertid ur start och slut. Timmarna räknas på servern och skickas aldrig härifrån.
  function timeEntryBody(data: TimeDraft) {
    return {
      work_date: data.work_date,
      start_time: data.start_time,
      end_time: data.end_time,
      break_minutes: Number(data.break_minutes || 0),
      note: data.note,
    };
  }

  function missingClock(data: TimeDraft): boolean {
    if (data.work_date && data.start_time && data.end_time) return false;
    toast.error('Datum, starttid och sluttid krävs');
    return true;
  }

  async function createTimeEntry(data: TimeDraft): Promise<boolean> {
    if (missingClock(data)) return false;
    try {
      const res = await fetch(`/api/crm/work-orders/${workOrderId}/time-entries`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(timeEntryBody(data)),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) { toast.error(json?.error || 'Kunde inte logga tid'); return false; }
      if (json.data?.item) setTimeEntries((c) => [json.data.item, ...c]);
      toast.success('Tid loggad');
      return true;
    } catch { toast.error('Kunde inte logga tid'); return false; }
  }

  async function updateTimeEntry(id: string, data: TimeDraft): Promise<boolean> {
    if (missingClock(data)) return false;
    try {
      const res = await fetch(`/api/crm/work-orders/${workOrderId}/time-entries/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(timeEntryBody(data)),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) { toast.error(json?.error || 'Kunde inte uppdatera tidrad'); return false; }
      if (json.data?.item) setTimeEntries((c) => c.map((e) => (e.id === id ? json.data.item : e)));
      toast.success('Tidrad uppdaterad');
      return true;
    } catch { toast.error('Kunde inte uppdatera tidrad'); return false; }
  }

  async function deleteTimeEntry(id: string): Promise<boolean> {
    try {
      const res = await fetch(`/api/crm/work-orders/${workOrderId}/time-entries/${id}`, { method: 'DELETE' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) { toast.error(json?.error || 'Kunde inte ta bort tidrad'); return false; }
      setTimeEntries((c) => c.filter((e) => e.id !== id));
      toast.success('Tidrad borttagen');
      return true;
    } catch { toast.error('Kunde inte ta bort tidrad'); return false; }
  }

  async function createComment(body: string, mentionedUserIds: string[] = []): Promise<boolean> {
    if (!body.trim()) { toast.error('Kommentar krävs'); return false; }
    try {
      const res = await fetch(`/api/crm/work-orders/${workOrderId}/comments`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body, mentioned_user_ids: mentionedUserIds }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) { toast.error(json?.error || 'Kunde inte spara kommentar'); return false; }
      if (json.data?.item) setComments((c) => [json.data.item, ...c]);
      toast.success('Kommentar sparad');
      return true;
    } catch { toast.error('Kunde inte spara kommentar'); return false; }
  }

  async function updateComment(id: string, body: string): Promise<boolean> {
    if (!body.trim()) { toast.error('Kommentar krävs'); return false; }
    try {
      const res = await fetch(`/api/crm/work-orders/${workOrderId}/comments/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) { toast.error(json?.error || 'Kunde inte uppdatera kommentar'); return false; }
      if (json.data?.item) setComments((c) => c.map((e) => (e.id === id ? json.data.item : e)));
      toast.success('Kommentar uppdaterad');
      return true;
    } catch { toast.error('Kunde inte uppdatera kommentar'); return false; }
  }

  async function deleteComment(id: string): Promise<boolean> {
    try {
      const res = await fetch(`/api/crm/work-orders/${workOrderId}/comments/${id}`, { method: 'DELETE' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) { toast.error(json?.error || 'Kunde inte ta bort kommentar'); return false; }
      setComments((c) => c.filter((e) => e.id !== id));
      toast.success('Kommentar borttagen');
      return true;
    } catch { toast.error('Kunde inte ta bort kommentar'); return false; }
  }

  return {
    timeEntries, comments, mentionUsers, namesById, timeEntriesLoading, commentsLoading,
    createTimeEntry, updateTimeEntry, deleteTimeEntry, createComment, updateComment, deleteComment,
  };
}
