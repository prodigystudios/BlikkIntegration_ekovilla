"use client";

import { useEffect, useState } from 'react';
import { useToast } from '@/lib/Toast';
import type { TimeEntryItem, TimeDraft } from './WorkOrderTimeTab';
import type { CommentItem } from './WorkOrderCommentsTab';
import type { MentionUser } from '@/app/crm/components/MentionTextarea';

// Shared time-entry + comment + @-mention loading and owner-scoped CRUD for a work
// order. Used by both the full editor (/crm) and the installer field view (/arbetsorder)
// so the write logic lives in one place. Handlers return a boolean so callers can reset
// their own form/edit state on success.
export function useWorkOrderActivity(workOrderId: string) {
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
          fetch(`/api/crm/work-orders/${workOrderId}/time-entries`, { cache: 'no-store' }),
          fetch(`/api/crm/work-orders/${workOrderId}/comments`, { cache: 'no-store' }),
          fetch('/api/crm/work-orders/mention-users', { cache: 'no-store' }),
        ]);
        const [timeJson, commentJson, mentionJson] = await Promise.all([
          timeRes.json().catch(() => ({})), commentRes.json().catch(() => ({})), mentionRes.json().catch(() => ({})),
        ]);
        if (!active) return;
        setTimeEntries(timeRes.ok && timeJson.ok ? timeJson.data?.items || [] : []);
        setComments(commentRes.ok && commentJson.ok ? commentJson.data?.items || [] : []);
        setMentionUsers(mentionRes.ok && mentionJson.ok ? mentionJson.data?.items || [] : []);
      } catch { /* non-fatal */ }
      finally { if (active) { setTimeEntriesLoading(false); setCommentsLoading(false); } }
    }
    load();
    return () => { active = false; };
  }, [workOrderId]);

  async function createTimeEntry(data: TimeDraft): Promise<boolean> {
    if (!data.work_date || !data.hours.trim()) { toast.error('Datum och timmar krävs'); return false; }
    try {
      const res = await fetch(`/api/crm/work-orders/${workOrderId}/time-entries`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ work_date: data.work_date, hours: Number(data.hours.replace(',', '.')), note: data.note }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) { toast.error(json?.error || 'Kunde inte logga tid'); return false; }
      if (json.data?.item) setTimeEntries((c) => [json.data.item, ...c]);
      toast.success('Tid loggad');
      return true;
    } catch { toast.error('Kunde inte logga tid'); return false; }
  }

  async function updateTimeEntry(id: string, data: TimeDraft): Promise<boolean> {
    if (!data.work_date || !data.hours.trim()) { toast.error('Datum och timmar krävs'); return false; }
    try {
      const res = await fetch(`/api/crm/work-orders/${workOrderId}/time-entries/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ work_date: data.work_date, hours: Number(data.hours.replace(',', '.')), note: data.note }),
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

  async function createComment(body: string): Promise<boolean> {
    if (!body.trim()) { toast.error('Kommentar krävs'); return false; }
    try {
      const res = await fetch(`/api/crm/work-orders/${workOrderId}/comments`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
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
    timeEntries, comments, mentionUsers, timeEntriesLoading, commentsLoading,
    createTimeEntry, updateTimeEntry, deleteTimeEntry, createComment, updateComment, deleteComment,
  };
}
