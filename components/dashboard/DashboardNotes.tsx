"use client";
import React, { useEffect, useState, useCallback, useRef } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { useToast } from '@/lib/Toast';
import { cn } from '@/lib/shared/cn';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import Input from '../ui/Input';
import Textarea from '../ui/Textarea';

interface NoteItem {
  id: string;
  kind: 'note' | 'meeting';
  title: string;
  body: string | null;
  status: 'active' | 'done' | 'cancelled';
  created: number;
  startsAt: string | null;
  endsAt: string | null;
  dueAt: string | null;
  remindAt: string | null;
  reminderSentAt: string | null;
  location: string | null;
  linkUrl: string | null;
  relatedType: string | null;
  relatedId: string | null;
  metadata: Record<string, unknown> | null;
  syncing?: boolean;
  error?: string;
}

type WorkItemUpdate = {
  title?: string;
  body?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
  dueAt?: string | null;
  remindAt?: string | null;
  reminderSentAt?: string | null;
  location?: string | null;
  linkUrl?: string | null;
};

const STORAGE_KEY = 'dashboard_work_items_v1';
const PUSH_DEBUG_STORAGE_KEY = 'dashboard_notes_push_debug_v1';
const REMINDER_INTERVAL_MINUTES = 5;
const TIME_OPTIONS = createTimeOptions();

export function DashboardNotes({ compact, desktopMode }: { compact?: boolean; desktopMode?: boolean }) {
  const toast = useToast();
  const [items, setItems] = useState<NoteItem[]>([]);
  const [composerKind, setComposerKind] = useState<'note'|'meeting'>('note');
  const [draftTitle, setDraftTitle] = useState('');
  const [draftBody, setDraftBody] = useState('');
  const [newReminderDraft, setNewReminderDraft] = useState('');
  const [meetingStartDraft, setMeetingStartDraft] = useState('');
  const [meetingEndDraft, setMeetingEndDraft] = useState('');
  const [meetingLocationDraft, setMeetingLocationDraft] = useState('');
  const [meetingLinkDraft, setMeetingLinkDraft] = useState('');
  const [filter, setFilter] = useState<'all'|'open'|'meetings'|'notes'|'today'|'done'>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pushSupported, setPushSupported] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [notificationPermission, setNotificationPermission] = useState<'default' | 'denied' | 'granted'>('default');
  const [pushPublicKey, setPushPublicKey] = useState<string>('');
  const [pushLoading, setPushLoading] = useState(false);
  const [dispatching, setDispatching] = useState(false);
  const [pushDiagnostics, setPushDiagnostics] = useState<string[]>([]);
  const [pushDebugMode, setPushDebugMode] = useState(false);
  const [pushPanelOpen, setPushPanelOpen] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [crmProspectNames, setCrmProspectNames] = useState<Record<string, string>>({});
  const supabase = createClientComponentClient();
  const mounted = useRef(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [live, setLive] = useState<'connecting'|'on'|'off'>('off');

  const syncPushState = useCallback(async () => {
    if (typeof window === 'undefined') return;
    const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    setPushSupported(supported);
    if (!supported) return;
    setNotificationPermission(Notification.permission);
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      setPushEnabled(Boolean(subscription));
      if (subscription) {
        await fetch('/api/push/subscription', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ subscription: subscription.toJSON(), userAgent: navigator.userAgent }),
        }).catch(() => null);
      }
    } catch {
      setPushEnabled(false);
    }
  }, []);

  const loadPushPublicKey = useCallback(async () => {
    try {
      const res = await fetch('/api/push/public-key');
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setPushDiagnostics((prev) => [...prev.slice(-7), `public-key: ${String(json?.error || res.status)}`]);
        setPushPublicKey('');
        return;
      }
      setPushPublicKey(String(json?.publicKey || ''));
      setPushDiagnostics((prev) => [...prev.slice(-7), 'public-key: loaded']);
    } catch {
      setPushDiagnostics((prev) => [...prev.slice(-7), 'public-key: fetch failed']);
      setPushPublicKey('');
    }
  }, []);

  // Initial load: fetch from Supabase; fallback to localStorage if offline / error
  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const { data: { user }, error: userErr } = await supabase.auth.getUser();
        if (userErr) throw userErr;
        if (!user) {
          setItems([]);
          return;
        }
        setUserId(user.id);
        const { data, error: selErr } = await supabase
          .from('dashboard_work_items')
          .select('id,kind,title,body,status,created_at,starts_at,ends_at,due_at,remind_at,reminder_sent_at,location,link_url,related_type,related_id,metadata')
          .order('created_at', { ascending: true });
        if (selErr) throw selErr;
        const rows = (data || []).map(mapWorkItemRow);
        setItems(rows);
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(rows)); } catch {}
      } catch (e:any) {
        // fallback
        try { const raw = localStorage.getItem(STORAGE_KEY); if (raw) setItems(JSON.parse(raw)); } catch {}
        setError('Kunde inte hämta anteckningar (offline?).');
      } finally {
        setLoading(false); mounted.current = true;
      }
    })();
  }, [supabase]);

  useEffect(() => {
    void syncPushState();
  }, [syncPushState]);

  useEffect(() => {
    void loadPushPublicKey();
  }, [loadPushPublicKey]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const params = new URLSearchParams(window.location.search);
    const pushDebug = params.get('pushdebug');

    if (pushDebug === '1') {
      setPushDebugMode(true);
      try {
        localStorage.setItem(PUSH_DEBUG_STORAGE_KEY, '1');
      } catch {}
      return;
    }

    if (pushDebug === '0') {
      setPushDebugMode(false);
      try {
        localStorage.removeItem(PUSH_DEBUG_STORAGE_KEY);
      } catch {}
      return;
    }

    try {
      setPushDebugMode(localStorage.getItem(PUSH_DEBUG_STORAGE_KEY) === '1');
    } catch {}
  }, []);

  useEffect(() => {
    if (pushDebugMode) {
      setPushPanelOpen(true);
    }
  }, [pushDebugMode]);

  // Realtime subscription
  useEffect(() => {
    if (!userId) return;
    setLive('connecting');
    const channel = supabase
      .channel('realtime:dashboard_notes')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'dashboard_work_items',
        filter: `user_id=eq.${userId}`
      }, (payload) => {
        setItems(prev => {
          switch (payload.eventType) {
            case 'INSERT': {
              const r: any = payload.new;
              if (prev.some(p => p.id === r.id)) return prev.map(p => p.id === r.id ? { ...p, syncing: false } : p);
              return [...prev, mapWorkItemRow(r)];
            }
            case 'UPDATE': {
              const r: any = payload.new;
              return prev.map(p => p.id === r.id ? { ...mapWorkItemRow(r), syncing: false } : p);
            }
            case 'DELETE': {
              const r: any = payload.old;
              return prev.filter(p => p.id !== r.id);
            }
            default:
              return prev;
          }
        });
      })
      .subscribe(status => {
        if (status === 'SUBSCRIBED') setLive('on');
        if (status === 'CHANNEL_ERROR' || status === 'CLOSED') setLive('off');
      });

    return () => {
      supabase.removeChannel(channel);
      setLive('off');
    };
  }, [supabase, userId]);

  // Persist local cache for offline resilience
  useEffect(() => {
    if (!mounted.current) return; // skip first set from load
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(items)); } catch {}
  }, [items]);

  useEffect(() => {
    const ids = Array.from(
      new Set(
        items
          .filter((item) => item.relatedType === 'crm_prospect' && item.relatedId)
          .map((item) => item.relatedId as string),
      ),
    ).filter((id) => !crmProspectNames[id]);

    if (ids.length === 0) return;

    let active = true;

    (async () => {
      const { data, error: prospectsError } = await supabase
        .from('crm_prospects')
        .select('id,company_name')
        .in('id', ids);

      if (!active || prospectsError || !data) return;

      setCrmProspectNames((current) => {
        const next = { ...current };
        for (const prospect of data as Array<{ id: string; company_name: string | null }>) {
          next[prospect.id] = prospect.company_name || 'Okänt prospekt';
        }
        return next;
      });
    })();

    return () => {
      active = false;
    };
  }, [crmProspectNames, items, supabase]);

  const addItem = useCallback(async () => {
    const title = draftTitle.trim();
    const body = draftBody.trim() || null;
    if (!title) return;
    if (!userId) {
      setError('Ingen användare inloggad.');
      return;
    }
    if (composerKind === 'meeting' && meetingStartDraft && !isCompleteDateTimeDraft(meetingStartDraft)) {
      toast.error('Välj både datum och tid för mötesstart.');
      return;
    }
    if (composerKind === 'meeting' && meetingEndDraft && !isCompleteDateTimeDraft(meetingEndDraft)) {
      toast.error('Välj både datum och tid för mötesslut.');
      return;
    }
    if (newReminderDraft && !isCompleteDateTimeDraft(newReminderDraft)) {
      toast.error('Välj både datum och tid för påminnelsen.');
      return;
    }
    const startsAt = composerKind === 'meeting' ? draftToRoundedIso(meetingStartDraft) : null;
    const endsAt = composerKind === 'meeting' ? draftToRoundedIso(meetingEndDraft) : null;
    const nextReminder = draftToRoundedIso(newReminderDraft);
    const tempId = crypto.randomUUID();
    const optimistic: NoteItem = {
      id: tempId,
      kind: composerKind,
      title,
      body,
      status: 'active',
      created: Date.now(),
      startsAt,
      endsAt,
      dueAt: startsAt,
      remindAt: nextReminder,
      reminderSentAt: null,
      location: composerKind === 'meeting' ? meetingLocationDraft.trim() || null : null,
      linkUrl: composerKind === 'meeting' ? meetingLinkDraft.trim() || null : null,
      relatedType: null,
      relatedId: null,
      metadata: null,
      syncing: true,
    };
    setItems(list => [...list, optimistic]);
    setDraftTitle('');
    setDraftBody('');
    setNewReminderDraft('');
    setMeetingStartDraft('');
    setMeetingEndDraft('');
    setMeetingLocationDraft('');
    setMeetingLinkDraft('');
    setComposerOpen(false);
    const { data, error: insErr } = await supabase
      .from('dashboard_work_items')
      .insert({
        kind: composerKind,
        title,
        body,
        status: 'active',
        user_id: userId,
        starts_at: startsAt,
        ends_at: endsAt,
        due_at: startsAt,
        remind_at: nextReminder,
        location: composerKind === 'meeting' ? meetingLocationDraft.trim() || null : null,
        link_url: composerKind === 'meeting' ? meetingLinkDraft.trim() || null : null,
      })
      .select('id,kind,title,body,status,created_at,starts_at,ends_at,due_at,remind_at,reminder_sent_at,location,link_url,related_type,related_id,metadata')
      .single();
    if (insErr || !data) {
      setItems(list => list.map(i => i.id === tempId ? { ...i, syncing: false, error: 'Ej sparad' } : i));
      return;
    }
    setItems(list => list.map(i => i.id === tempId ? mapWorkItemRow(data) : i));
  }, [composerKind, draftBody, draftTitle, meetingEndDraft, meetingLinkDraft, meetingLocationDraft, meetingStartDraft, newReminderDraft, supabase, toast, userId]);

  const toggle = async (id: string) => {
    setItems(list => list.map(i => i.id === id ? { ...i, status: i.status === 'done' ? 'active' : 'done', syncing: true } : i));
    const item = items.find(i => i.id === id);
    if (!item) return;
    const nextStatus = item.status === 'done' ? 'active' : 'done';
    const { error: updErr } = await supabase
      .from('dashboard_work_items')
      .update({ status: nextStatus, completed_at: nextStatus === 'done' ? new Date().toISOString() : null })
      .eq('id', id);
    if (updErr) {
      // revert
      setItems(list => list.map(i => i.id === id ? { ...i, status: item.status, syncing: false } : i));
    } else {
      setItems(list => list.map(i => i.id === id ? { ...i, syncing: false } : i));
    }
  };
  const remove = async (id: string) => {
    const prev = items;
    setItems(list => list.filter(i => i.id !== id));
    const { error: delErr } = await supabase.from('dashboard_work_items').delete().eq('id', id);
    if (delErr) {
      // restore
      setItems(prev);
    }
  };
  const edit = async (id: string, title: string) => {
    setItems(list => list.map(i => i.id === id ? { ...i, title, syncing: true } : i));
    const { error: updErr } = await supabase.from('dashboard_work_items').update({ title }).eq('id', id);
    setItems(list => list.map(i => i.id === id ? { ...i, syncing: !!updErr } : i));
  };

  const saveItemDetails = useCallback(async (id: string, updates: WorkItemUpdate) => {
    const current = items.find(i => i.id === id);
    if (!current) return;

    if (updates.startsAt && !isCompleteDateTimeDraft(updates.startsAt)) {
      toast.error('Välj både datum och tid för mötesstart.');
      return;
    }
    if (updates.endsAt && !isCompleteDateTimeDraft(updates.endsAt)) {
      toast.error('Välj både datum och tid för mötesslut.');
      return;
    }
    if (updates.remindAt && !isCompleteDateTimeDraft(updates.remindAt)) {
      toast.error('Välj både datum och tid för påminnelsen.');
      return;
    }

    const normalizedUpdates: WorkItemUpdate = {
      ...updates,
      startsAt: updates.startsAt === undefined ? undefined : draftToRoundedIso(updates.startsAt),
      endsAt: updates.endsAt === undefined ? undefined : draftToRoundedIso(updates.endsAt),
      dueAt: updates.dueAt === undefined ? undefined : draftToRoundedIso(updates.dueAt),
      remindAt: updates.remindAt === undefined ? undefined : draftToRoundedIso(updates.remindAt),
    };

    const optimistic: Partial<NoteItem> = {};
    if (normalizedUpdates.title !== undefined) optimistic.title = normalizedUpdates.title;
    if (normalizedUpdates.body !== undefined) optimistic.body = normalizedUpdates.body;
    if (normalizedUpdates.startsAt !== undefined) optimistic.startsAt = normalizedUpdates.startsAt;
    if (normalizedUpdates.endsAt !== undefined) optimistic.endsAt = normalizedUpdates.endsAt;
    if (normalizedUpdates.dueAt !== undefined) optimistic.dueAt = normalizedUpdates.dueAt;
    if (normalizedUpdates.remindAt !== undefined) optimistic.remindAt = normalizedUpdates.remindAt;
    if (normalizedUpdates.reminderSentAt !== undefined) optimistic.reminderSentAt = normalizedUpdates.reminderSentAt;
    if (normalizedUpdates.location !== undefined) optimistic.location = normalizedUpdates.location;
    if (normalizedUpdates.linkUrl !== undefined) optimistic.linkUrl = normalizedUpdates.linkUrl;

    setItems(list => list.map(i => i.id === id ? { ...i, ...optimistic, syncing: true } : i));

    const dbUpdate: Record<string, string | null> = {};
    if (normalizedUpdates.title !== undefined) dbUpdate.title = normalizedUpdates.title;
    if (normalizedUpdates.body !== undefined) dbUpdate.body = normalizedUpdates.body;
    if (normalizedUpdates.startsAt !== undefined) dbUpdate.starts_at = normalizedUpdates.startsAt;
    if (normalizedUpdates.endsAt !== undefined) dbUpdate.ends_at = normalizedUpdates.endsAt;
    if (normalizedUpdates.dueAt !== undefined) dbUpdate.due_at = normalizedUpdates.dueAt;
    if (normalizedUpdates.remindAt !== undefined) dbUpdate.remind_at = normalizedUpdates.remindAt;
    if (normalizedUpdates.reminderSentAt !== undefined) dbUpdate.reminder_sent_at = normalizedUpdates.reminderSentAt;
    if (normalizedUpdates.location !== undefined) dbUpdate.location = normalizedUpdates.location;
    if (normalizedUpdates.linkUrl !== undefined) dbUpdate.link_url = normalizedUpdates.linkUrl;

    const { error: updErr } = await supabase.from('dashboard_work_items').update(dbUpdate).eq('id', id);
    if (updErr) {
      setItems(list => list.map(i => i.id === id ? { ...current, syncing: false } : i));
      toast.error('Kunde inte spara mötesdetaljerna.');
      return;
    }

    setItems(list => list.map(i => i.id === id ? { ...i, syncing: false } : i));
    toast.success('Posten uppdaterad.');
  }, [items, supabase, toast]);

  const saveReminder = useCallback(async (id: string, reminderAt: string | null) => {
    const current = items.find(i => i.id === id) || null;
    if (reminderAt && !isCompleteDateTimeDraft(reminderAt)) {
      toast.error('Välj både datum och tid för påminnelsen.');
      return;
    }
    const nextReminder = draftToRoundedIso(reminderAt);
    setItems(list => list.map(i => i.id === id ? { ...i, remindAt: nextReminder, reminderSentAt: null, syncing: true } : i));
    const { error: updErr } = await supabase
      .from('dashboard_work_items')
      .update({ remind_at: nextReminder, reminder_sent_at: null })
      .eq('id', id);
    if (updErr) {
      setItems(list => list.map(i => i.id === id ? { ...i, remindAt: current?.remindAt || null, reminderSentAt: current?.reminderSentAt || null, syncing: false } : i));
      toast.error('Kunde inte spara påminnelsen.');
      return;
    }
    setItems(list => list.map(i => i.id === id ? { ...i, syncing: false } : i));
    toast.success(nextReminder ? 'Påminnelse sparad.' : 'Påminnelse borttagen.');
  }, [items, supabase, toast]);

  const enablePush = useCallback(async () => {
    if (!pushSupported) {
      toast.error('Den här enheten stöder inte pushnotiser.');
      return;
    }
    setPushLoading(true);
    setPushDiagnostics([]);
    try {
      setPushDiagnostics((prev) => [...prev, `env: standalone=${String(window.matchMedia('(display-mode: standalone)').matches)} secure=${String(window.isSecureContext)} permission=${Notification.permission}`]);
      const registrationPromise = navigator.serviceWorker.getRegistration('/sw.js').then((registration) => registration || navigator.serviceWorker.ready);
      setPushDiagnostics((prev) => [...prev, 'service-worker: awaiting registration']);
      let publicKey = pushPublicKey;
      if (!publicKey) {
        const keyRes = await fetch('/api/push/public-key');
        const keyJson = await keyRes.json().catch(() => null);
        if (!keyRes.ok) throw new Error(keyJson?.error || 'Kunde inte läsa push-nyckel.');
        publicKey = String(keyJson?.publicKey || '');
        setPushPublicKey(publicKey);
        setPushDiagnostics((prev) => [...prev, 'public-key: loaded during activation']);
      }

      const permission = await Notification.requestPermission();
      setNotificationPermission(permission);
      setPushDiagnostics((prev) => [...prev, `permission: ${permission}`]);
      if (permission !== 'granted') {
        throw new Error('Notiser måste tillåtas för att påminnelser ska nå telefonen.');
      }

      const registration = await registrationPromise;
      setPushDiagnostics((prev) => [...prev, `service-worker: ready scope=${registration.scope}`]);
      let subscription = await registration.pushManager.getSubscription();
      setPushDiagnostics((prev) => [...prev, `subscription: existing=${subscription ? 'yes' : 'no'}`]);
      if (!subscription) {
        setPushDiagnostics((prev) => [...prev, 'subscription: creating']);
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: base64ToUint8Array(publicKey),
        });
        setPushDiagnostics((prev) => [...prev, 'subscription: created']);
      }

      setPushDiagnostics((prev) => [...prev, 'subscription: saving to backend']);
      const saveRes = await fetch('/api/push/subscription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: subscription.toJSON(), userAgent: navigator.userAgent }),
      });
      const saveJson = await saveRes.json().catch(() => null);
      if (!saveRes.ok) throw new Error(saveJson?.error || 'Kunde inte aktivera push.');
      setPushDiagnostics((prev) => [...prev, 'subscription: saved']);

      setPushEnabled(true);
      toast.success('Mobilnotiser aktiverade.');
    } catch (e: any) {
      const message = String(e?.message || e || 'Kunde inte aktivera notiser.');
      const name = String(e?.name || 'Error');
      setPushDiagnostics((prev) => [...prev, `error: ${name}: ${message}`, `permission-now: ${Notification.permission}`]);
      if (/denied permission|notallowederror|permission denied/i.test(message)) {
        toast.error('iPhone nekade push-prenumerationen efter prompten. Det brukar bero på att iOS tappat användargesten eller att PWA-instansen har ett sparat notisläge.');
      } else {
        toast.error(message);
      }
    } finally {
      setPushLoading(false);
    }
  }, [pushPublicKey, pushSupported, toast]);

  const disablePush = useCallback(async () => {
    if (!pushSupported) return;
    setPushLoading(true);
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await fetch('/api/push/subscription', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
        await subscription.unsubscribe();
      }
      setPushEnabled(false);
      toast.success('Mobilnotiser avaktiverade.');
    } catch (e: any) {
      toast.error(e?.message || 'Kunde inte stänga av notiser.');
    } finally {
      setPushLoading(false);
    }
  }, [pushSupported, toast]);

  const dispatchDueReminders = useCallback(async () => {
    setDispatching(true);
    try {
      const res = await fetch('/api/dashboard-notes/reminders/dispatch', { method: 'POST' });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error || 'Kunde inte köra påminnelserna.');
      const sent = Array.isArray(json?.results) ? json.results.reduce((sum: number, item: any) => sum + Number(item?.sent || 0), 0) : 0;
      if (sent > 0) {
        toast.success(`${sent} pushnotis${sent === 1 ? '' : 'er'} skickad${sent === 1 ? '' : 'e'}.`);
      } else {
        toast.success('Inga förfallna påminnelser att skicka just nu.');
      }
      await syncPushState();
    } catch (e: any) {
      toast.error(e?.message || 'Kunde inte köra påminnelserna.');
    } finally {
      setDispatching(false);
    }
  }, [syncPushState, toast]);

  const togglePushDebugMode = useCallback(() => {
    setPushDebugMode((prev) => {
      const next = !prev;
      try {
        if (next) {
          localStorage.setItem(PUSH_DEBUG_STORAGE_KEY, '1');
        } else {
          localStorage.removeItem(PUSH_DEBUG_STORAGE_KEY);
        }
      } catch {}
      return next;
    });
  }, []);

  const clearDone = async () => {
    const doneIds = items.filter(i => i.status !== 'active').map(i => i.id);
    if (!doneIds.length) return;
    const prev = items;
    setItems(list => list.filter(i => i.status === 'active'));
    const { error: delErr } = await supabase.from('dashboard_work_items').delete().in('id', doneIds);
    if (delErr) {
      setItems(prev);
    }
  };

  const visible = items.filter(i => matchesFilter(i, filter));
  const openCount = items.filter(i => i.status === 'active').length;
  const doneCount = items.length - openCount;
  const meetingCount = items.filter(i => i.kind === 'meeting' && i.status === 'active').length;
  const todayCount = items.filter(i => matchesFilter(i, 'today')).length;
  const composerExpectedDispatch = newReminderDraft ? getExpectedDispatchTime(newReminderDraft) : null;
  const utilityCardStyle = desktopMode ? compactUtilityCard : sectionCard;
  const shouldConstrainList = !!desktopMode && visible.length > 4;
  const visibleMeetings = visible.filter(i => i.status === 'active' && i.kind === 'meeting').sort(sortMeetingItems);
  const visibleNotes = visible.filter(i => i.status === 'active' && i.kind === 'note').sort(sortWorkItems);
  const visibleDone = visible.filter(i => i.status !== 'active').sort(sortWorkItems);
  const visibleToday = filter === 'today' ? visible.sort(sortTodayItems) : [];
  const hasSections = filter !== 'today';
  const urgentMeetingCount = visibleMeetings.filter(item => {
    const priority = getPriorityInfo(item);
    return priority?.tone === 'danger' || priority?.tone === 'warning';
  }).length;
  const urgentNoteCount = visibleNotes.filter(item => {
    const priority = getPriorityInfo(item);
    return priority?.tone === 'danger' || priority?.tone === 'warning';
  }).length;
  const nextMeeting = visibleMeetings[0] || null;
  const overdueReminderCount = items.filter(item => {
    const priority = getPriorityInfo(item);
    return priority?.label === 'Påminnelse sen';
  }).length;
  const activeNotesWithoutReminderCount = items.filter(item => item.status === 'active' && item.kind === 'note' && !item.remindAt).length;
  const filterHelperText = getFilterHelperText(filter, {
    openCount,
    meetingCount,
    todayCount,
    doneCount,
    overdueReminderCount,
    urgentMeetingCount,
    activeNotesWithoutReminderCount,
  });
  const liveTextClass =
    live === 'on'
      ? 'text-emerald-700'
      : live === 'connecting'
        ? 'text-amber-600'
        : 'text-slate-500';
  const liveDotClass =
    live === 'on'
      ? 'bg-emerald-500 shadow-[0_0_4px_#10b981]'
      : live === 'connecting'
        ? 'bg-amber-500'
        : 'bg-slate-400';
  const composerFieldLabelClass = cn('grid gap-1 text-slate-700', compact ? 'text-[13px]' : 'text-xs');
  const composerInputClass = cn(compact ? 'min-h-11 px-3 py-2.5 text-[13px]' : 'min-h-10 px-3 py-2.5 text-sm');

  return (
    <div className={cn('flex flex-col', compact ? 'gap-3' : 'gap-4')}>
      <div className={cn('flex flex-wrap items-start', compact ? 'gap-2' : 'gap-3')}>
        <div className="grid gap-1.5">
          <h2 className={cn('m-0 flex flex-wrap items-center gap-2 font-bold text-slate-900', compact ? 'text-base' : 'text-xl')}>
          Arbetsyta
          <span className={cn('inline-flex items-center gap-1 text-[11px] font-medium', liveTextClass)}>
            <span className={cn('h-2 w-2 rounded-full', liveDotClass)} />
            {live==='on' ? 'Live' : live==='connecting' ? 'Ansluter…' : 'Offline'}
          </span>
          </h2>
          <div className="flex flex-wrap gap-2">
            <Badge className="px-2.5 py-1 text-[11px]">{openCount} öppna</Badge>
            <span style={statusPillOpen}>{meetingCount} möten</span>
            <Badge className="px-2.5 py-1 text-[11px]">{doneCount} klara</Badge>
          </div>
          <p className="m-0 text-xs leading-[1.5] text-slate-500">
            {filterHelperText}
          </p>
        </div>
        <div className={cn('ml-auto flex flex-wrap justify-end', compact ? 'gap-1' : 'gap-1.5')}>
          {([
            ['all', 'Alla'],
            ['open', 'Öppna'],
            ['meetings', `Möten ${meetingCount}`],
            ['notes', 'Anteckningar'],
            ['today', `Idag ${todayCount}`],
            ['done', 'Klart'],
          ] as const).map(([value, label]) => (
            <button key={value} onClick={()=>setFilter(value)} style={{ ...filterBtn, ...(filter===value? filterBtnActive : {}), ...(compact ? compactFilterBtn : {}) }}>{label}</button>
          ))}
        </div>
      </div>
      {error && (
        <div className="text-xs text-red-700">{error}</div>
      )}
      <section style={utilityCardStyle}>
        <div style={summaryGridStyle}>
          <div style={summaryInfoCardStyle}>
            <span style={summaryInfoLabelStyle}>Nästa möte</span>
            <strong style={summaryInfoValueStyle}>{nextMeeting ? nextMeeting.title : 'Inget möte bokat'}</strong>
            <span style={summaryInfoHintStyle}>{nextMeeting?.startsAt ? formatReminderLabel(nextMeeting.startsAt) : 'Skapa ett möte när du vill blocka tid eller följa upp något.'}</span>
          </div>
          <div style={summaryInfoCardStyle}>
            <span style={summaryInfoLabelStyle}>Påminnelser att agera på</span>
            <strong style={summaryInfoValueStyle}>{overdueReminderCount}</strong>
            <span style={summaryInfoHintStyle}>{overdueReminderCount > 0 ? 'Det finns poster där påminnelsen redan passerat.' : 'Inga sena påminnelser just nu.'}</span>
          </div>
          <div style={summaryInfoCardStyle}>
            <span style={summaryInfoLabelStyle}>Anteckningar utan tid</span>
            <strong style={summaryInfoValueStyle}>{activeNotesWithoutReminderCount}</strong>
            <span style={summaryInfoHintStyle}>{activeNotesWithoutReminderCount > 0 ? 'Bra för lösa idéer, men lägg gärna påminnelse på sådant som inte får tappas.' : 'Alla öppna anteckningar har redan en tidsmarkör eller är möten.'}</span>
          </div>
        </div>
      </section>
      <section style={utilityCardStyle}>
        <div className="grid gap-2.5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="grid gap-1">
              <strong style={sectionTitle}>Notiser på den här enheten</strong>
              {(!desktopMode || pushPanelOpen) && <span style={helperText}>Push används när en påminnelse blir förfallen. Automatisk körning sker i 5-minutersintervall.</span>}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span style={{ ...pushStateBadge, color: pushEnabled ? '#166534' : '#475569', background: pushEnabled ? '#dcfce7' : '#f8fafc', borderColor: pushEnabled ? '#86efac' : '#d1d5db' }}>
                {pushSupported ? (pushEnabled ? 'Mobilnotiser aktiva' : notificationPermission === 'denied' ? 'Notiser blockerade' : 'Mobilnotiser av') : 'Push stöds inte här'}
              </span>
              <Button type="button" onClick={() => setPushPanelOpen((prev) => !prev)} variant="secondary" size="sm">
                {pushPanelOpen ? 'Dölj inställningar' : 'Visa inställningar'}
              </Button>
            </div>
          </div>
          {pushPanelOpen && (
            <div className={cn('flex flex-wrap items-center', compact ? 'gap-1.5' : 'gap-2')}>
              {pushSupported && !pushEnabled && (
                <Button type="button" onClick={enablePush} size="sm" disabled={pushLoading} className="border-slate-900 bg-slate-900 text-white hover:bg-slate-950">
                  {pushLoading ? 'Aktiverar…' : 'Aktivera mobilnotiser'}
                </Button>
              )}
              {pushSupported && pushEnabled && (
                <Button type="button" onClick={disablePush} variant="secondary" size="sm" disabled={pushLoading}>
                  {pushLoading ? 'Uppdaterar…' : 'Stäng av notiser'}
                </Button>
              )}
              <Button type="button" onClick={dispatchDueReminders} size="sm" disabled={dispatching} className="border-blue-600 bg-blue-600 text-white hover:bg-blue-700">
                {dispatching ? 'Kör…' : 'Kör förfallna påminnelser nu'}
              </Button>
              {pushDebugMode && (
                <Button type="button" onClick={togglePushDebugMode} variant="secondary" size="sm">
                  Dölj pushdebug
                </Button>
              )}
            </div>
          )}
        </div>
      </section>
      {pushDebugMode && (
        <div className="grid gap-1 rounded-[10px] border border-slate-300 bg-slate-50 px-3 py-2.5">
          <strong className="text-xs text-slate-700">Pushdiagnostik</strong>
          <div className="text-[11px] text-slate-500">Aktiverat via <strong>?pushdebug=1</strong>. Stäng av med knappen ovan eller <strong>?pushdebug=0</strong>.</div>
          {pushDiagnostics.length === 0 && (
            <div className="font-mono text-[11px] text-slate-600">Inga pushhändelser loggade ännu.</div>
          )}
          {pushDiagnostics.map((line, index) => (
            <div key={`${index}-${line}`} className="font-mono text-[11px] text-slate-600">{line}</div>
          ))}
        </div>
      )}
      <section style={utilityCardStyle}>
        <div className="grid gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="grid gap-1">
              <strong style={sectionTitle}>Ny post</strong>
              {(!desktopMode || composerOpen) && <span style={helperText}>Lägg till fria anteckningar eller boka ett eget möte. Påminnelser ligger separat från mötestiden.</span>}
            </div>
            <button type="button" onClick={() => setComposerOpen((prev) => !prev)} style={addComposerBtn} aria-expanded={composerOpen}>
              <span style={addComposerIcon}>{composerOpen ? '−' : '+'}</span>
              {composerOpen ? 'Stäng' : 'Ny post'}
            </button>
          </div>
          {composerOpen && (
            <form onSubmit={e=>{e.preventDefault(); addItem();}} className="grid gap-3">
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => setComposerKind('note')} style={{ ...quickActionBtn, ...(composerKind === 'note' ? composerModeBtnActive : {}) }}>Anteckning</button>
                <button type="button" onClick={() => setComposerKind('meeting')} style={{ ...quickActionBtn, ...(composerKind === 'meeting' ? composerModeBtnActive : {}) }}>Möte</button>
              </div>
              <Input
                value={draftTitle}
                onChange={e=>setDraftTitle(e.target.value)}
                placeholder={composerKind === 'meeting' ? 'Vad gäller mötet?' : 'Rubrik eller snabb anteckning'}
                className={composerInputClass}
              />
              <Textarea
                value={draftBody}
                onChange={e=>setDraftBody(e.target.value)}
                placeholder={composerKind === 'meeting' ? 'Agenda, syfte eller extra detaljer' : 'Beskrivning eller kompletterande text'}
                rows={compact ? 2 : 3}
                className={cn('min-h-0', compact ? 'min-h-[84px] px-3 py-2.5 text-[13px]' : 'min-h-[96px] px-3 py-2.5 text-sm')}
              />
              {composerKind === 'meeting' && (
                <div className="grid gap-2">
                  <div className="grid gap-1">
                    <span style={fieldLabel}>Mötestid</span>
                    <div className="flex flex-wrap gap-2">
                      <DateTimeField value={meetingStartDraft} onChange={setMeetingStartDraft} compact={compact} label="Start" />
                      <DateTimeField value={meetingEndDraft} onChange={setMeetingEndDraft} compact={compact} label="Slut" />
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Input
                      value={meetingLocationDraft}
                      onChange={e=>setMeetingLocationDraft(e.target.value)}
                      placeholder="Plats eller kanal"
                      className={cn(composerInputClass, 'flex-[1_1_220px]', compact ? 'min-w-[180px]' : 'min-w-[220px]')}
                    />
                    <Input
                      value={meetingLinkDraft}
                      onChange={e=>setMeetingLinkDraft(e.target.value)}
                      placeholder="Länk till mötet"
                      className={cn(composerInputClass, 'flex-[1_1_220px]', compact ? 'min-w-[180px]' : 'min-w-[220px]')}
                    />
                  </div>
                </div>
              )}
              <div className="grid gap-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span style={fieldLabel}>Påminnelse</span>
                  <span style={fieldHint}>{composerExpectedDispatch ? `Skickas cirka ${formatReminder(composerExpectedDispatch)}` : 'Ingen påminnelse vald'}</span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <DateTimeField value={newReminderDraft} onChange={setNewReminderDraft} compact={compact} label="Påminnelse" />
                  {newReminderDraft && (
                    <Button type="button" onClick={()=>setNewReminderDraft('')} variant="secondary" size="sm">Rensa tid</Button>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={()=>setNewReminderDraft(getRelativeReminderDraftValue(15))} style={quickActionBtn}>Om 15 min</button>
                  <button type="button" onClick={()=>setNewReminderDraft(getRelativeReminderDraftValue(30))} style={quickActionBtn}>Om 30 min</button>
                  <button type="button" onClick={()=>setNewReminderDraft(getRelativeReminderDraftValue(60))} style={quickActionBtn}>Om 1 timme</button>
                  <button type="button" onClick={()=>setNewReminderDraft(getTomorrowReminderDraftValue(8, 0))} style={quickActionBtn}>Imorgon 08:00</button>
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2.5">
                <span style={helperText}>{newReminderDraft ? 'Påminnelsen sparas direkt med posten.' : composerKind === 'meeting' ? 'Mötet kan ha egen tid och separat påminnelse.' : 'Du kan lägga till påminnelse i efterhand.'}</span>
                <Button type="submit" size={compact ? 'sm' : 'md'} className={cn('border-slate-900 bg-slate-900 text-white hover:bg-slate-950', compact ? 'min-w-[140px]' : 'min-w-[170px]')} disabled={!draftTitle.trim()}>
                  {composerKind === 'meeting' ? 'Boka möte' : 'Lägg till anteckning'}
                </Button>
              </div>
            </form>
          )}
        </div>
      </section>
      {loading && <p className="m-0 text-xs text-slate-500">Laddar…</p>}
      {!loading && items.length === 0 && (
        <p className={cn('m-0 text-slate-500', compact ? 'text-xs' : 'text-sm')}>Inga poster ännu. Lägg till din första anteckning eller ditt första möte ovan.</p>
      )}
      {!loading && items.length > 0 && visible.length === 0 && (
        <div style={emptyStateCardStyle}>
          <strong className="text-[13.5px] text-slate-900">{getEmptyStateTitle(filter)}</strong>
          <p className={cn('m-0 leading-[1.55] text-slate-500', compact ? 'text-xs' : 'text-sm')}>{getEmptyStateDescription(filter)}</p>
        </div>
      )}
      {items.length > 0 && (
        <div style={shouldConstrainList ? constrainedListWrap : undefined}>
          {filter === 'today' ? (
            <WorkItemSection
              title="Idag"
              subtitle="Poster med mötestid eller påminnelse under dagen."
              items={visibleToday}
              crmProspectNames={crmProspectNames}
              compact={compact}
              desktopMode={desktopMode}
              onToggle={toggle}
              onRemove={remove}
              onEdit={edit}
              onSaveReminder={saveReminder}
              onSaveDetails={saveItemDetails}
            />
          ) : (
            <div className="grid gap-3">
              {hasSections && visibleMeetings.length > 0 && (
                <WorkItemSection
                  title="Kommande möten"
                  subtitle={urgentMeetingCount > 0 ? `${urgentMeetingCount} möten kräver uppmärksamhet just nu.` : 'Möten du planerat framåt eller behöver hålla koll på.'}
                  items={visibleMeetings}
                  crmProspectNames={crmProspectNames}
                  compact={compact}
                  desktopMode={desktopMode}
                  onToggle={toggle}
                  onRemove={remove}
                  onEdit={edit}
                  onSaveReminder={saveReminder}
                  onSaveDetails={saveItemDetails}
                />
              )}
              {hasSections && visibleNotes.length > 0 && (
                <WorkItemSection
                  title="Öppna anteckningar"
                  subtitle={urgentNoteCount > 0 ? `${urgentNoteCount} anteckningar har en påminnelse som närmar sig eller är sen.` : 'Snabba saker att komma ihåg eller följa upp.'}
                  items={visibleNotes}
                  crmProspectNames={crmProspectNames}
                  compact={compact}
                  desktopMode={desktopMode}
                  onToggle={toggle}
                  onRemove={remove}
                  onEdit={edit}
                  onSaveReminder={saveReminder}
                  onSaveDetails={saveItemDetails}
                />
              )}
              {visibleDone.length > 0 && (
                <WorkItemSection
                  title={filter === 'done' ? 'Klart' : 'Avslutade poster'}
                  subtitle="Sådant som redan är klart eller stängt."
                  items={visibleDone}
                  crmProspectNames={crmProspectNames}
                  compact={compact}
                  desktopMode={desktopMode}
                  onToggle={toggle}
                  onRemove={remove}
                  onEdit={edit}
                  onSaveReminder={saveReminder}
                  onSaveDetails={saveItemDetails}
                />
              )}
            </div>
          )}
        </div>
      )}
      {items.some(i=>i.status !== 'active') && (
        <div className="flex justify-end">
          <Button variant="secondary" size="sm" onClick={clearDone}>Rensa klara</Button>
        </div>
      )}
    </div>
  );
}

function WorkItemSection({ title, subtitle, items, crmProspectNames, onToggle, onRemove, onEdit, onSaveReminder, onSaveDetails, compact, desktopMode }: { title: string; subtitle: string; items: NoteItem[]; crmProspectNames: Record<string, string>; onToggle:(id: string)=>void; onRemove:(id: string)=>void; onEdit:(id: string, title: string)=>void; onSaveReminder:(id: string, value: string | null)=>void; onSaveDetails:(id: string, updates: WorkItemUpdate)=>void; compact?: boolean; desktopMode?: boolean }) {
  return (
    <section className="grid gap-2">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-0.5">
          <strong className="text-[13.5px] text-slate-900">{title}</strong>
          <span className="text-[11.5px] text-slate-500">{subtitle}</span>
        </div>
        <span style={sectionCountPillStyle}>{items.length} st</span>
      </div>
      <ul className={cn('m-0 flex list-none flex-col p-0', compact ? 'gap-1' : 'gap-1.5')}>
        {items.map(item => (
          <NoteRow key={item.id} item={item} crmProspectName={item.relatedId ? crmProspectNames[item.relatedId] || null : null} onToggle={()=>onToggle(item.id)} onRemove={()=>onRemove(item.id)} onEdit={(t)=>onEdit(item.id,t)} onSaveReminder={(value)=>onSaveReminder(item.id, value)} onSaveDetails={(updates)=>onSaveDetails(item.id, updates)} compact={compact} desktopMode={desktopMode} />
        ))}
      </ul>
    </section>
  );
}

function NoteRow({ item, crmProspectName, onToggle, onRemove, onEdit, onSaveReminder, onSaveDetails, compact, desktopMode }: { item: NoteItem; crmProspectName: string | null; onToggle: ()=>void; onRemove: ()=>void; onEdit:(t:string)=>void; onSaveReminder:(value:string | null)=>void; onSaveDetails:(updates: WorkItemUpdate)=>void; compact?: boolean; desktopMode?: boolean }) {
  const [editing, setEditing] = useState(false);
  const [reminderOpen, setReminderOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [draft, setDraft] = useState(item.title);
  const [reminderDraft, setReminderDraft] = useState(toDateTimeLocalValue(item.remindAt));
  const [bodyDraft, setBodyDraft] = useState(item.body || '');
  const [startsAtDraft, setStartsAtDraft] = useState(toDateTimeLocalValue(item.startsAt));
  const [endsAtDraft, setEndsAtDraft] = useState(toDateTimeLocalValue(item.endsAt));
  const [locationDraft, setLocationDraft] = useState(item.location || '');
  const [linkDraft, setLinkDraft] = useState(item.linkUrl || '');
  useEffect(()=>{ setDraft(item.title); }, [item.title]);
  useEffect(() => { setReminderDraft(toDateTimeLocalValue(item.remindAt)); }, [item.remindAt]);
  useEffect(() => { setBodyDraft(item.body || ''); }, [item.body]);
  useEffect(() => { setStartsAtDraft(toDateTimeLocalValue(item.startsAt)); }, [item.startsAt]);
  useEffect(() => { setEndsAtDraft(toDateTimeLocalValue(item.endsAt)); }, [item.endsAt]);
  useEffect(() => { setLocationDraft(item.location || ''); }, [item.location]);
  useEffect(() => { setLinkDraft(item.linkUrl || ''); }, [item.linkUrl]);
  useEffect(() => {
    if (!item.remindAt) {
      setReminderOpen(false);
    }
  }, [item.remindAt]);
  const expectedDispatch = item.remindAt ? getExpectedDispatchTime(item.remindAt) : null;
  const isDone = item.status !== 'active';
  const priority = getPriorityInfo(item);
  const crmMeta = getCrmMeta(item);
  const isCrmItem = crmMeta.isCrm;
  const isMobileCard = !!compact && !desktopMode;
  const mobileDetailSummary = [
    item.kind === 'meeting' && item.startsAt ? `Start ${formatClockLabel(item.startsAt)}` : null,
    item.kind === 'meeting' && item.endsAt ? `Slut ${formatClockLabel(item.endsAt)}` : null,
    item.location || null,
  ].filter(Boolean).join(' • ');
  const rowInputClass = cn(compact ? 'min-h-0 px-1.5 py-1 text-[12.5px]' : 'min-h-0 px-2 py-1.5 text-[13px]');

  const saveMeetingDetails = () => {
    onSaveDetails({
      body: bodyDraft.trim() || null,
      startsAt: startsAtDraft || null,
      endsAt: endsAtDraft || null,
      dueAt: startsAtDraft || null,
      location: locationDraft.trim() || null,
      linkUrl: linkDraft.trim() || null,
    });
    setDetailsOpen(false);
  };

  return (
  <li className={cn('grid', compact ? 'gap-2.5 px-3 py-2.5' : 'gap-3 px-4 py-3.5')} style={{ ...noteCard, ...getPriorityCardStyle(priority), opacity:item.syncing?0.7:1 }}>
      <div className={cn('flex flex-wrap items-start justify-between', isMobileCard ? 'gap-2.5' : 'gap-3')}>
        <div className="grid min-w-0 flex-[1_1_420px] gap-2.5">
          {!editing && (
            <div onDoubleClick={()=>setEditing(true)} className={cn('flex cursor-text flex-wrap items-center gap-1.5 leading-[1.45]', compact ? 'text-[13px]' : 'text-[15px]', isDone ? 'text-slate-500 line-through' : 'text-slate-900')}>
              <span className="font-semibold">{item.title}</span>
              {item.syncing && !item.error && <span className="text-[10px] text-slate-500">⟳</span>}
              {item.error && <span className="text-[10px] text-red-700" title={item.error}>⚠</span>}
            </div>
          )}
          {editing && (
            <form onSubmit={e=>{e.preventDefault(); onEdit(draft.trim() || item.title); setEditing(false);}} className="flex-1">
              <Input autoFocus value={draft} onChange={e=>setDraft(e.target.value)} onBlur={()=>{ setEditing(false); setDraft(item.title); }} className={rowInputClass} />
            </form>
          )}
          {item.body && <div className={cn('whitespace-pre-wrap leading-[1.5] text-slate-600', compact ? 'text-xs' : 'text-[13px]')}>{item.body}</div>}
          {isCrmItem && (
            <div className="flex flex-wrap items-center gap-2">
              <span style={statusPillMuted}>CRM</span>
              {crmProspectName && <span style={subtleMetaText}>Prospekt {crmProspectName}</span>}
              {crmMeta.source && <span style={subtleMetaText}>Källa {crmMeta.source}</span>}
              {crmMeta.priority && <span style={getPriorityPillStyle(crmMeta.priorityTone)}>{crmMeta.priority}</span>}
              {item.dueAt && item.kind !== 'meeting' && <span style={subtleMetaText}>Deadline {formatReminderShort(item.dueAt)}</span>}
            </div>
          )}
          <div className={cn('grid', isMobileCard ? 'gap-1.5' : 'gap-2')}>
            <div className="flex flex-wrap items-center gap-2">
              <span style={item.kind === 'meeting' ? subtleReminderPill : statusPillMuted}>{item.kind === 'meeting' ? 'Möte' : isCrmItem ? 'CRM-uppgift' : 'Anteckning'}</span>
              <span style={isDone ? statusPillDone : statusPillOpen}>{isDone ? 'Klar' : 'Öppen'}</span>
              {priority && <span style={getPriorityPillStyle(priority.tone)}>{priority.label}</span>}
            </div>
            {isMobileCard ? (
              <div className="grid gap-1">
                {mobileDetailSummary && <span style={subtleMetaText}>{mobileDetailSummary}</span>}
                {item.linkUrl && <a href={item.linkUrl} target="_blank" rel="noreferrer" className="text-[11.5px] text-blue-600 no-underline hover:text-blue-700">Öppna möteslänk</a>}
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                {item.kind === 'meeting' && item.startsAt && <span style={subtleMetaText}>Start {formatClockLabel(item.startsAt)}</span>}
                {item.kind === 'meeting' && item.endsAt && <span style={subtleMetaText}>Slut {formatClockLabel(item.endsAt)}</span>}
                {item.location && <span style={subtleMetaText}>{item.location}</span>}
                {item.linkUrl && <a href={item.linkUrl} target="_blank" rel="noreferrer" className="text-[11.5px] text-blue-600 no-underline hover:text-blue-700">Öppna länk</a>}
              </div>
            )}
          </div>
        </div>
        {isMobileCard ? (
          <div className="grid w-full gap-1.5">
            <button onClick={onToggle} aria-label={isDone? 'Markera som ej klar':'Markera som klar'} style={{ ...(isDone ? completePillBtnDone : completePillBtn), width:'100%', justifyContent:'center' }}>
              <span style={{ ...checkBtn, width:16, height:16, ...(isDone? checkBtnDone : {}) }}>
                {isDone && (
                  <svg width="12" height="12" viewBox="0 0 24 24" stroke="#fff" strokeWidth={3} fill="none"><path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" /></svg>
                )}
              </span>
              <span style={{ fontSize:12, fontWeight:700, color:isDone ? '#166534' : '#0f172a', lineHeight:1.2, whiteSpace:'nowrap' }}>
                {isDone ? 'Öppna igen' : 'Markera klar'}
              </span>
            </button>
            <div className={cn('grid gap-1.5', item.kind === 'meeting' ? 'grid-cols-3' : 'grid-cols-2')}>
              <button onClick={()=>setEditing(true)} style={mobileActionBtn} aria-label="Redigera">Redigera</button>
              {item.kind === 'meeting' && (
                <button type="button" onClick={() => setDetailsOpen((prev) => !prev)} style={mobileActionBtn} aria-label="Redigera mötesdetaljer">
                  {detailsOpen ? 'Stäng' : 'Möte'}
                </button>
              )}
              <button onClick={onRemove} style={mobileDangerBtn} aria-label="Ta bort">Ta bort</button>
            </div>
          </div>
        ) : (
          <div className={cn('flex flex-wrap items-center justify-end', compact ? 'w-full gap-1.5' : 'gap-2')}>
            <button onClick={onToggle} aria-label={isDone? 'Markera som ej klar':'Markera som klar'} style={isDone ? completePillBtnDone : completePillBtn}>
              <span style={{ ...checkBtn, width: compact?16:18, height: compact?16:18, ...(isDone? checkBtnDone : {}) }}>
                {isDone && (
                  <svg width="12" height="12" viewBox="0 0 24 24" stroke="#fff" strokeWidth={3} fill="none"><path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" /></svg>
                )}
              </span>
              <span style={{ fontSize:12, fontWeight:700, color:isDone ? '#166534' : '#0f172a', lineHeight:1.2, whiteSpace:'nowrap' }}>
                {isDone ? 'Öppna igen' : 'Markera klar'}
              </span>
            </button>
            <Button onClick={()=>setEditing(true)} variant="secondary" size="sm" className={desktopMode ? 'border-transparent bg-transparent shadow-none hover:bg-slate-100' : ''} aria-label="Redigera">Redigera</Button>
            {item.kind === 'meeting' && (
              <Button type="button" onClick={() => setDetailsOpen((prev) => !prev)} variant="secondary" size="sm" className={desktopMode ? 'border-transparent bg-transparent shadow-none hover:bg-slate-100' : ''} aria-label="Redigera mötesdetaljer">
                {detailsOpen ? 'Stäng möte' : 'Redigera möte'}
              </Button>
            )}
            <Button onClick={onRemove} size="sm" className={desktopMode ? 'border-transparent bg-transparent text-red-700 shadow-none hover:bg-red-50' : 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100'} aria-label="Ta bort">Ta bort</Button>
          </div>
        )}
      </div>
      {item.kind === 'meeting' && detailsOpen && (
        <div style={reminderBox}>
          <div className="grid gap-1">
            <strong className="text-[12.5px] text-slate-900">Mötesdetaljer</strong>
            <span className="text-[11.5px] leading-[1.45] text-slate-500">Uppdatera tid, plats, länk och beskrivning för mötet.</span>
          </div>
          <Textarea
            value={bodyDraft}
            onChange={e=>setBodyDraft(e.target.value)}
            rows={compact ? 2 : 3}
            disabled={isDone}
            placeholder="Agenda eller detaljer"
            className={cn('min-h-0', compact ? 'min-h-[72px] px-3 py-2 text-[12.5px]' : 'min-h-[88px] px-3 py-2.5 text-[13px]')}
          />
          <div className="flex flex-wrap items-center gap-2">
            <DateTimeField value={startsAtDraft} onChange={setStartsAtDraft} compact={compact} disabled={isDone} label="Start" />
            <DateTimeField value={endsAtDraft} onChange={setEndsAtDraft} compact={compact} disabled={isDone} label="Slut" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={locationDraft}
              onChange={e=>setLocationDraft(e.target.value)}
              disabled={isDone}
              placeholder="Plats eller kanal"
              className={cn('flex-[1_1_220px]', compact ? 'min-w-[180px] px-3 py-2 text-[12.5px]' : 'min-w-[220px] px-3 py-2.5 text-[13px]')}
            />
            <Input
              value={linkDraft}
              onChange={e=>setLinkDraft(e.target.value)}
              disabled={isDone}
              placeholder="Möteslänk"
              className={cn('flex-[1_1_220px]', compact ? 'min-w-[180px] px-3 py-2 text-[12.5px]' : 'min-w-[220px] px-3 py-2.5 text-[13px]')}
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span style={fieldHint}>Starttid används också som mötets förfallotid i nuläget.</span>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="secondary" size="sm" onClick={() => {
                setBodyDraft(item.body || '');
                setStartsAtDraft(toDateTimeLocalValue(item.startsAt));
                setEndsAtDraft(toDateTimeLocalValue(item.endsAt));
                setLocationDraft(item.location || '');
                setLinkDraft(item.linkUrl || '');
                setDetailsOpen(false);
              }}>
                Avbryt
              </Button>
              <Button type="button" onClick={saveMeetingDetails} size="sm" className={cn('border-slate-900 bg-slate-900 text-white hover:bg-slate-950', compact ? 'min-w-[136px]' : 'min-w-[156px]')} disabled={isDone}>
                Spara möte
              </Button>
            </div>
          </div>
        </div>
      )}
      <div style={reminderMetaRow}>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {item.remindAt ? (
            <span style={subtleReminderPill}>Påminn {isMobileCard ? formatClockLabel(item.remindAt) : formatReminderShort(item.remindAt)}</span>
          ) : (
            <span style={subtleMetaText}>Ingen påminnelse</span>
          )}
          {item.reminderSentAt && (
            <span style={subtleMetaText}>{isMobileCard ? `Skickad ${formatClockLabel(item.reminderSentAt)}` : `Senast skickad ${formatReminderShort(item.reminderSentAt)}`}</span>
          )}
        </div>
        <Button type="button" onClick={() => setReminderOpen((prev) => !prev)} variant="secondary" size="sm" disabled={isDone}>
          {reminderOpen ? 'Stäng' : isMobileCard ? 'Påminn' : item.remindAt ? 'Ändra påminnelse' : 'Lägg till påminnelse'}
        </Button>
      </div>
      {reminderOpen && (
        <div style={reminderBox}>
          <div className="grid gap-1">
            <strong className="text-[12.5px] text-slate-900">Påminnelse</strong>
            <span className="text-[11.5px] leading-[1.45] text-slate-500">
              {item.remindAt ? `Aktiv ${formatReminderLabel(item.remindAt)}` : 'Ingen tid satt'}
              {expectedDispatch ? ` • skickas cirka ${formatReminderLabel(expectedDispatch)}` : ''}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <DateTimeField value={reminderDraft} onChange={setReminderDraft} compact={compact} disabled={isDone} label="Påminnelse" />
            <Button type="button" onClick={()=>{ onSaveReminder(reminderDraft || null); setReminderOpen(false); }} size="sm" className={cn('border-slate-900 bg-slate-900 text-white hover:bg-slate-950', compact ? 'min-w-[140px]' : 'min-w-[156px]')} disabled={isDone}>
              Spara
            </Button>
            {item.remindAt && (
              <Button type="button" onClick={()=>{ setReminderDraft(''); onSaveReminder(null); setReminderOpen(false); }} variant="secondary" size="sm">
                Rensa
              </Button>
            )}
          </div>
          <span style={fieldHint}>Skickas i 5-minutersintervall.</span>
        </div>
      )}
    </li>
  );
}

function DateTimeField({ value, onChange, compact, disabled, label }: { value: string; onChange: (value: string) => void; compact?: boolean; disabled?: boolean; label?: string }) {
  const { datePart, timePart } = splitDateTimeDraftValue(value);

  return (
    <div className={cn('grid gap-1 flex-[1_1_220px]', compact ? 'min-w-[180px]' : 'min-w-[240px]')}>
      {label && <span style={fieldHint}>{label}</span>}
      <div style={dateTimeFieldStyle}>
        <Input
          type="date"
          value={datePart}
          onChange={e=>onChange(combineDateAndTimeDraft(e.target.value, timePart))}
          disabled={disabled}
          className="min-w-0 flex-[1_1_130px]"
        />
        <select
          value={timePart}
          onChange={e=>onChange(combineDateAndTimeDraft(datePart, e.target.value))}
          disabled={disabled}
          className="min-w-0 flex-[1_1_110px] rounded-xl border border-ui-border bg-white px-3 py-2 text-sm text-ui-text-strong transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ui-accent/20"
        >
          <option value="">Tid</option>
          {TIME_OPTIONS.map(option => (
            <option key={option} value={option}>{option}</option>
          ))}
        </select>
      </div>
    </div>
  );
}

function mapWorkItemRow(row: any): NoteItem {
  return {
    id: row.id,
    kind: row.kind === 'meeting' ? 'meeting' : 'note',
    title: row.title,
    body: row.body || null,
    status: row.status === 'done' || row.status === 'cancelled' ? row.status : 'active',
    created: new Date(row.created_at).getTime(),
    startsAt: row.starts_at || null,
    endsAt: row.ends_at || null,
    dueAt: row.due_at || null,
    remindAt: row.remind_at || null,
    reminderSentAt: row.reminder_sent_at || null,
    location: row.location || null,
    linkUrl: row.link_url || null,
    relatedType: row.related_type || null,
    relatedId: row.related_id || null,
    metadata: row.metadata && typeof row.metadata === 'object' ? row.metadata : null,
  };
}

function getCrmMeta(item: NoteItem) {
  const metadata = item.metadata && typeof item.metadata === 'object' ? item.metadata : null;
  const rawPriority = metadata && typeof metadata.priority === 'string' ? metadata.priority : null;
  const rawSource = metadata && typeof metadata.source === 'string' ? metadata.source : null;
  const isCrm = item.relatedType === 'crm_prospect' || (metadata && metadata.crm === true);

  return {
    isCrm,
    source: rawSource,
    priority: rawPriority === 'high' ? 'Hög prioritet' : rawPriority === 'low' ? 'Låg prioritet' : rawPriority === 'normal' ? 'Normal prioritet' : null,
    priorityTone: rawPriority === 'high' ? 'danger' : rawPriority === 'low' ? 'info' : 'info',
  } as const;
}

function sortWorkItems(a: NoteItem, b: NoteItem) {
  const aDone = a.status !== 'active';
  const bDone = b.status !== 'active';
  if (aDone !== bDone) return aDone ? 1 : -1;
  const priorityDiff = comparePriority(a, b);
  if (priorityDiff !== 0) return priorityDiff;
  if (!aDone && (a.kind === 'meeting' || b.kind === 'meeting')) {
    const aStartsAt = a.startsAt ? new Date(a.startsAt).getTime() : Number.MAX_SAFE_INTEGER;
    const bStartsAt = b.startsAt ? new Date(b.startsAt).getTime() : Number.MAX_SAFE_INTEGER;
    if (aStartsAt !== bStartsAt) return aStartsAt - bStartsAt;
  }
  return b.created - a.created;
}

function sortMeetingItems(a: NoteItem, b: NoteItem) {
  const priorityDiff = comparePriority(a, b);
  if (priorityDiff !== 0) return priorityDiff;
  const aStartsAt = a.startsAt ? new Date(a.startsAt).getTime() : Number.MAX_SAFE_INTEGER;
  const bStartsAt = b.startsAt ? new Date(b.startsAt).getTime() : Number.MAX_SAFE_INTEGER;
  if (aStartsAt !== bStartsAt) return aStartsAt - bStartsAt;
  return b.created - a.created;
}

function sortTodayItems(a: NoteItem, b: NoteItem) {
  const aDate = getRelevantTime(a);
  const bDate = getRelevantTime(b);
  if (aDate !== bDate) return aDate - bDate;
  return sortWorkItems(a, b);
}

function matchesFilter(item: NoteItem, filter: 'all'|'open'|'meetings'|'notes'|'today'|'done') {
  switch (filter) {
    case 'all':
      return true;
    case 'open':
      return item.status === 'active';
    case 'meetings':
      return item.status === 'active' && item.kind === 'meeting';
    case 'notes':
      return item.status === 'active' && item.kind === 'note';
    case 'today':
      return isScheduledForToday(item);
    case 'done':
      return item.status !== 'active';
    default:
      return true;
  }
}

function getRelevantTime(item: NoteItem) {
  const value = item.startsAt || item.remindAt;
  if (!value) return Number.MAX_SAFE_INTEGER;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? Number.MAX_SAFE_INTEGER : time;
}

function getFilterHelperText(filter: 'all'|'open'|'meetings'|'notes'|'today'|'done', stats: { openCount: number; meetingCount: number; todayCount: number; doneCount: number; overdueReminderCount: number; urgentMeetingCount: number; activeNotesWithoutReminderCount: number; }) {
  switch (filter) {
    case 'all':
      return stats.urgentMeetingCount > 0
        ? `${stats.urgentMeetingCount} möten behöver extra uppmärksamhet just nu. Resten ligger kvar i arbetsytan för överblick.`
        : 'Här ser du hela din personliga arbetsyta med möten, anteckningar och sådant som redan är klart.';
    case 'open':
      return stats.overdueReminderCount > 0
        ? `${stats.openCount} öppna poster, varav ${stats.overdueReminderCount} har en påminnelse som redan passerat.`
        : `${stats.openCount} öppna poster som fortfarande kräver någon form av handling eller uppföljning.`;
    case 'meetings':
      return stats.meetingCount > 0
        ? `${stats.meetingCount} aktiva möten. Lägg plats, länk och påminnelse för att göra dem självbärande.`
        : 'Här samlas alla aktiva möten så att du snabbt ser vad som är bokat.';
    case 'notes':
      return stats.activeNotesWithoutReminderCount > 0
        ? `${stats.activeNotesWithoutReminderCount} anteckningar saknar tid eller påminnelse och fungerar som fria kom-ihåg-poster.`
        : 'Här ser du dina öppna anteckningar och uppföljningar som inte är bokade som möten.';
    case 'today':
      return stats.todayCount > 0
        ? `${stats.todayCount} poster är tidsatta för idag via mötestid eller påminnelse.`
        : 'Den här vyn hjälper dig fokusera på det som faktiskt landar idag.';
    case 'done':
      return stats.doneCount > 0
        ? `${stats.doneCount} poster är klara eller stängda och ligger kvar för snabb återblick tills du rensar dem.`
        : 'Här visas sådant som redan är klart eller avslutat.';
    default:
      return '';
  }
}

function getEmptyStateTitle(filter: 'all'|'open'|'meetings'|'notes'|'today'|'done') {
  switch (filter) {
    case 'all':
      return 'Arbetsytan är tom';
    case 'open':
      return 'Inga öppna poster';
    case 'meetings':
      return 'Inga aktiva möten';
    case 'notes':
      return 'Inga öppna anteckningar';
    case 'today':
      return 'Inget planerat för idag';
    case 'done':
      return 'Inget klart ännu';
    default:
      return 'Tom vy';
  }
}

function getEmptyStateDescription(filter: 'all'|'open'|'meetings'|'notes'|'today'|'done') {
  switch (filter) {
    case 'all':
      return 'Skapa en anteckning för något löpande eller boka ett möte när du vill låsa en tid direkt i dashboarden.';
    case 'open':
      return 'Allt som fanns här är just nu markerat som klart eller så har du ännu inte lagt till några poster.';
    case 'meetings':
      return 'När du bokar möten här hamnar de i en egen sektion med tid, plats, länk och separat påminnelse.';
    case 'notes':
      return 'Anteckningsvyn passar för uppföljningar, idéer och sådant som inte behöver ett bokat möte.';
    case 'today':
      return 'Lägg en påminnelse eller en mötestid på en post så dyker den upp här samma dag.';
    case 'done':
      return 'När du markerar poster som klara samlas de här tills du väljer att rensa dem.';
    default:
      return 'Det finns inget att visa i den här vyn just nu.';
  }
}

function parseTime(value: string | null) {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
}

function getPriorityInfo(item: NoteItem): { label: string; tone: 'danger' | 'warning' | 'info' } | null {
  if (item.status !== 'active') return null;
  const now = Date.now();
  const soonThreshold = 30 * 60 * 1000;
  const start = parseTime(item.startsAt);
  const end = parseTime(item.endsAt);
  const reminder = parseTime(item.remindAt);

  if (item.kind === 'meeting' && start !== null && start <= now && (end === null || end >= now)) {
    return { label: 'Pågår nu', tone: 'danger' };
  }
  if (reminder !== null && reminder <= now && !item.reminderSentAt) {
    return { label: 'Påminnelse sen', tone: 'danger' };
  }
  if (item.kind === 'meeting' && start !== null && end !== null && end < now) {
    return { label: 'Mötet passerat', tone: 'danger' };
  }
  if (item.kind === 'meeting' && start !== null && start >= now && start - now <= soonThreshold) {
    return { label: 'Startar snart', tone: 'warning' };
  }
  if (reminder !== null && reminder >= now && reminder - now <= soonThreshold) {
    return { label: 'Påminnelse snart', tone: 'warning' };
  }
  if (isScheduledForToday(item)) {
    return { label: 'Idag', tone: 'info' };
  }
  return null;
}

function getPriorityRank(item: NoteItem) {
  const priority = getPriorityInfo(item);
  if (!priority) return 99;
  if (priority.label === 'Pågår nu') return 0;
  if (priority.label === 'Påminnelse sen') return 1;
  if (priority.label === 'Mötet passerat') return 2;
  if (priority.label === 'Startar snart') return 3;
  if (priority.label === 'Påminnelse snart') return 4;
  if (priority.label === 'Idag') return 5;
  return 99;
}

function comparePriority(a: NoteItem, b: NoteItem) {
  const aRank = getPriorityRank(a);
  const bRank = getPriorityRank(b);
  if (aRank !== bRank) return aRank - bRank;
  return 0;
}

function isScheduledForToday(item: NoteItem) {
  const candidate = item.startsAt || item.remindAt;
  if (!candidate) return false;
  const date = new Date(candidate);
  if (Number.isNaN(date.getTime())) return false;
  const now = new Date();
  return date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate();
}

function toDateTimeLocalValue(value: string | null) {
  if (!value) return '';
  const date = roundReminderToInterval(value);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function splitDateTimeDraftValue(value: string) {
  if (!value) {
    return { datePart: '', timePart: '' };
  }
  const [datePart, timePart = ''] = value.split('T');
  return { datePart, timePart: timePart.slice(0, 5) };
}

function combineDateAndTimeDraft(datePart: string, timePart: string) {
  if (!datePart && !timePart) return '';
  if (!datePart) return '';
  if (!timePart) return datePart;
  return normalizeReminderDraftValue(`${datePart}T${timePart}`);
}

function isCompleteDateTimeDraft(value: string | null) {
  if (!value) return false;
  const { datePart, timePart } = splitDateTimeDraftValue(value);
  return Boolean(datePart && timePart);
}

function draftToRoundedIso(value: string | null) {
  if (!value) return null;
  if (!isCompleteDateTimeDraft(value)) return null;
  return roundReminderToInterval(value).toISOString();
}

function createTimeOptions() {
  const options: string[] = [];
  for (let hour = 0; hour < 24; hour += 1) {
    for (let minute = 0; minute < 60; minute += REMINDER_INTERVAL_MINUTES) {
      options.push(`${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`);
    }
  }
  return options;
}

function normalizeReminderDraftValue(value: string) {
  if (!value) return '';
  return toDateTimeLocalValue(roundReminderToInterval(value).toISOString());
}

function roundReminderToInterval(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return date;

  date.setSeconds(0, 0);
  const minutes = date.getMinutes();
  const roundedMinutes = Math.ceil(minutes / REMINDER_INTERVAL_MINUTES) * REMINDER_INTERVAL_MINUTES;
  date.setMinutes(roundedMinutes);
  return date;
}

function getExpectedDispatchTime(value: string) {
  const reminderAt = roundReminderToInterval(value);
  if (Number.isNaN(reminderAt.getTime())) return null;
  return reminderAt.toISOString();
}

function getRelativeReminderDraftValue(minutesFromNow: number) {
  const date = new Date(Date.now() + minutesFromNow * 60 * 1000);
  return toDateTimeLocalValue(date.toISOString());
}

function getTomorrowReminderDraftValue(hours: number, minutes: number) {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(hours, minutes, 0, 0);
  return toDateTimeLocalValue(date.toISOString());
}

function formatReminder(value: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('sv-SE', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatClockLabel(value: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `kl ${date.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })}`;
}

function formatReminderLabel(value: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const now = new Date();
  const sameDay = date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate();
  if (sameDay) {
    return `idag ${formatClockLabel(value)}`;
  }
  return `${date.toLocaleDateString('sv-SE', { day: 'numeric', month: 'short' })} ${formatClockLabel(value)}`;
}

function formatReminderShort(value: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('sv-SE', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function base64ToUint8Array(value: string) {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const normalized = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(normalized);
  const output = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) {
    output[index] = raw.charCodeAt(index);
  }
  return output;
}

// Shared styles (mirrors admin styling look & feel)
const input: React.CSSProperties = { padding:'8px 10px', border:'1px solid #d1d5db', borderRadius:8, fontSize:14, outline:'none', background:'#fff' };
const selectInputStyle: React.CSSProperties = { ...input, appearance:'none', background:'#fff' };
const textareaInput: React.CSSProperties = { ...input, minHeight:92, resize:'vertical', width:'100%', lineHeight:1.5, fontFamily:'inherit' };
const dateTimeFieldStyle: React.CSSProperties = { display:'flex', gap:8, flexWrap:'wrap', alignItems:'center' };
const btnPrimary: React.CSSProperties = { padding:'8px 14px', borderRadius:8, border:'1px solid #111827', background:'#111827', color:'#fff', fontSize:14, cursor:'pointer', fontWeight:500 };
const filterBtn: React.CSSProperties = { padding:'6px 12px', borderRadius:999, background:'linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)', border:'1px solid #d1d5db', cursor:'pointer', fontSize:12, color:'#111827', whiteSpace:'nowrap', boxShadow:'0 3px 10px rgba(15, 23, 42, 0.06), inset 0 1px 0 rgba(255,255,255,0.85)' };
const filterBtnActive: React.CSSProperties = { background:'linear-gradient(180deg, #3b82f6 0%, #2563eb 100%)', color:'#fff', border:'1px solid #2563eb', boxShadow:'0 10px 18px rgba(37, 99, 235, 0.22)' };
const compactFilterBtn: React.CSSProperties = { padding:'6px 10px', fontSize:11.5 };
const iconBtn: React.CSSProperties = { padding:'4px 6px', fontSize:12, lineHeight:1, cursor:'pointer', background:'#f1f5f9', borderRadius:6, border:'1px solid #e2e8f0' };
const miniBtn: React.CSSProperties = { padding:'6px 10px', background:'#334155', color:'#fff', borderRadius:6, fontSize:12, cursor:'pointer', border:'1px solid #334155' };
const checkBtn: React.CSSProperties = { width:20, height:20, borderRadius:6, border:'1px solid #cbd5e1', background:'#fff', display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer' };
const checkBtnDone: React.CSSProperties = { background:'#16a34a', border:'1px solid #16a34a' };
const pushStateBadge: React.CSSProperties = { display:'inline-flex', alignItems:'center', padding:'6px 10px', borderRadius:999, border:'1px solid #d1d5db', fontSize:11.5, fontWeight:700 };
const sectionCard: React.CSSProperties = { display:'grid', gap:10, padding:'16px 18px', border:'1px solid #dbe4ef', borderRadius:18, background:'linear-gradient(180deg, #ffffff 0%, #f7fbff 100%)', boxShadow:'0 12px 28px rgba(15, 23, 42, 0.08), inset 0 1px 0 rgba(255,255,255,0.78)' };
const compactUtilityCard: React.CSSProperties = { display:'grid', gap:8, padding:'12px 14px', border:'1px solid #dbe4ef', borderRadius:16, background:'linear-gradient(180deg, #fcfdff 0%, #f6f9fd 100%)', boxShadow:'0 10px 22px rgba(15, 23, 42, 0.06), inset 0 1px 0 rgba(255,255,255,0.8)' };
const summaryGridStyle: React.CSSProperties = { display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(160px, 1fr))', gap:10 };
const summaryInfoCardStyle: React.CSSProperties = { display:'grid', gap:4, padding:'12px 14px', border:'1px solid #dbe4ef', borderRadius:16, background:'linear-gradient(180deg, #ffffff 0%, #fbfdff 100%)', boxShadow:'0 8px 18px rgba(15, 23, 42, 0.05)' };
const summaryInfoLabelStyle: React.CSSProperties = { fontSize:11.5, color:'#64748b', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.04em' };
const summaryInfoValueStyle: React.CSSProperties = { fontSize:14, color:'#0f172a' };
const summaryInfoHintStyle: React.CSSProperties = { fontSize:11.5, color:'#64748b', lineHeight:1.45 };
const sectionTitle: React.CSSProperties = { fontSize:14, color:'#0f172a' };
const helperText: React.CSSProperties = { fontSize:12, color:'#64748b', lineHeight:1.5 };
const fieldLabel: React.CSSProperties = { fontSize:12, fontWeight:700, color:'#334155', letterSpacing:'0.01em' };
const fieldHint: React.CSSProperties = { fontSize:11, color:'#64748b' };
const secondaryBtn: React.CSSProperties = { padding:'8px 12px', background:'#ffffff', color:'#0f172a', borderRadius:8, fontSize:12.5, cursor:'pointer', border:'1px solid #cbd5e1', fontWeight:600, whiteSpace:'nowrap' };
const compactSecondaryBtn: React.CSSProperties = { padding:'6px 10px', background:'#ffffff', color:'#334155', borderRadius:999, fontSize:11.5, cursor:'pointer', border:'1px solid #dbe4ef', fontWeight:700, whiteSpace:'nowrap' };
const quickActionBtn: React.CSSProperties = { padding:'7px 10px', background:'#eff6ff', color:'#1d4ed8', borderRadius:999, fontSize:12, cursor:'pointer', border:'1px solid #bfdbfe', fontWeight:600, whiteSpace:'nowrap' };
const composerModeBtnActive: React.CSSProperties = { background:'#1d4ed8', color:'#ffffff', border:'1px solid #1d4ed8' };
const dangerBtn: React.CSSProperties = { padding:'8px 12px', background:'#fff1f2', color:'#be123c', borderRadius:8, fontSize:12.5, cursor:'pointer', border:'1px solid #fecdd3', fontWeight:600, whiteSpace:'nowrap' };
const subtleActionBtn: React.CSSProperties = { padding:'6px 9px', background:'#ffffff', color:'#475569', borderRadius:999, fontSize:11.5, cursor:'pointer', border:'1px solid #e2e8f0', fontWeight:700, whiteSpace:'nowrap' };
const subtleDangerBtn: React.CSSProperties = { padding:'6px 9px', background:'#fff7f7', color:'#be123c', borderRadius:999, fontSize:11.5, cursor:'pointer', border:'1px solid #ffe4e6', fontWeight:700, whiteSpace:'nowrap' };
const mobileActionBtn: React.CSSProperties = { padding:'8px 10px', background:'#ffffff', color:'#334155', borderRadius:10, fontSize:11.5, cursor:'pointer', border:'1px solid #dbe4ef', fontWeight:700, whiteSpace:'nowrap', width:'100%', textAlign:'center' };
const mobileDangerBtn: React.CSSProperties = { ...mobileActionBtn, background:'#fff7f7', color:'#be123c', border:'1px solid #fecdd3' };
const summaryPill: React.CSSProperties = { display:'inline-flex', alignItems:'center', padding:'5px 10px', borderRadius:999, background:'#dcfce7', color:'#166534', fontSize:11.5, fontWeight:700 };
const summaryPillMuted: React.CSSProperties = { display:'inline-flex', alignItems:'center', padding:'5px 10px', borderRadius:999, background:'#e2e8f0', color:'#475569', fontSize:11.5, fontWeight:700 };
const noteCard: React.CSSProperties = { display:'grid', gap:12, background:'#ffffff', border:'1px solid #e2e8f0', borderRadius:16, boxShadow:'0 6px 20px rgba(15, 23, 42, 0.05)', overflow:'hidden' };
const emptyStateCardStyle: React.CSSProperties = { display:'grid', gap:6, padding:'14px 16px', border:'1px dashed #cbd5e1', borderRadius:14, background:'#f8fafc' };
const constrainedListWrap: React.CSSProperties = { maxHeight: 560, overflowY:'auto', paddingRight:4 };
const reminderMetaRow: React.CSSProperties = { display:'flex', justifyContent:'space-between', gap:10, flexWrap:'wrap', alignItems:'center', paddingTop:2, borderTop:'1px solid #eef2f7' };
const reminderBox: React.CSSProperties = { display:'grid', gap:8, padding:'10px 12px', border:'1px solid #e2e8f0', borderRadius:12, background:'#fbfdff' };
const subtleReminderPill: React.CSSProperties = { display:'inline-flex', alignItems:'center', padding:'4px 9px', borderRadius:999, background:'#eff6ff', color:'#1d4ed8', fontSize:11, fontWeight:700 };
const subtleMetaText: React.CSSProperties = { fontSize:11.5, color:'#64748b', lineHeight:1.4, wordBreak:'break-word' };
const statusPillOpen: React.CSSProperties = { display:'inline-flex', alignItems:'center', padding:'4px 9px', borderRadius:999, background:'linear-gradient(180deg, #dbeafe 0%, #bfdbfe 100%)', color:'#1d4ed8', fontSize:11, fontWeight:700, border:'1px solid #bfdbfe', boxShadow:'inset 0 1px 0 rgba(255,255,255,0.72)' };
const statusPillDone: React.CSSProperties = { display:'inline-flex', alignItems:'center', padding:'4px 9px', borderRadius:999, background:'#dcfce7', color:'#166534', fontSize:11, fontWeight:700 };
const statusPillMuted: React.CSSProperties = { display:'inline-flex', alignItems:'center', padding:'4px 9px', borderRadius:999, background:'#f1f5f9', color:'#475569', fontSize:11, fontWeight:700 };
const sectionCountPillStyle: React.CSSProperties = { display:'inline-flex', alignItems:'center', padding:'4px 9px', borderRadius:999, background:'#f8fafc', color:'#475569', border:'1px solid #e2e8f0', fontSize:11, fontWeight:700 };
const addComposerBtn: React.CSSProperties = { display:'inline-flex', alignItems:'center', gap:10, padding:'10px 14px', background:'linear-gradient(180deg, #1e293b 0%, #0f172a 100%)', color:'#fff', borderRadius:14, fontSize:13, cursor:'pointer', border:'1px solid #0f172a', fontWeight:700, boxShadow:'0 14px 26px rgba(15, 23, 42, 0.16)' };
const addComposerIcon: React.CSSProperties = { display:'inline-flex', alignItems:'center', justifyContent:'center', width:22, height:22, borderRadius:'50%', background:'rgba(255,255,255,0.16)', fontSize:16, lineHeight:1 };
const completePillBtn: React.CSSProperties = { display:'inline-flex', alignItems:'center', gap:8, padding:'7px 10px', background:'#f8fafc', border:'1px solid #dbe4ef', borderRadius:999, cursor:'pointer', boxShadow:'inset 0 1px 0 rgba(255,255,255,0.7)', whiteSpace:'nowrap', flexShrink:0, maxWidth:'100%' };
const completePillBtnDone: React.CSSProperties = { ...completePillBtn, background:'#f0fdf4', border:'1px solid #bbf7d0' };

function getPriorityPillStyle(tone: 'danger' | 'warning' | 'info'): React.CSSProperties {
  if (tone === 'danger') {
    return { display:'inline-flex', alignItems:'center', padding:'4px 9px', borderRadius:999, background:'#fff1f2', color:'#be123c', fontSize:11, fontWeight:700 };
  }
  if (tone === 'warning') {
    return { display:'inline-flex', alignItems:'center', padding:'4px 9px', borderRadius:999, background:'#fef3c7', color:'#b45309', fontSize:11, fontWeight:700 };
  }
  return { display:'inline-flex', alignItems:'center', padding:'4px 9px', borderRadius:999, background:'#e0f2fe', color:'#0369a1', fontSize:11, fontWeight:700 };
}

function getPriorityCardStyle(priority: { tone: 'danger' | 'warning' | 'info' } | null): React.CSSProperties {
  if (!priority) return {};
  if (priority.tone === 'danger') {
    return { border:'1px solid #fecdd3', boxShadow:'0 8px 24px rgba(190, 24, 93, 0.08)' };
  }
  if (priority.tone === 'warning') {
    return { border:'1px solid #fcd34d', boxShadow:'0 8px 24px rgba(217, 119, 6, 0.08)' };
  }
  return { border:'1px solid #bae6fd', boxShadow:'0 8px 24px rgba(2, 132, 199, 0.08)' };
}

export default DashboardNotes;
