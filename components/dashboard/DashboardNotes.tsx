"use client";
import React, { useEffect, useState, useCallback, useRef } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { useToast } from '@/lib/Toast';

interface NoteItem {
  id: string;
  text: string;
  done: boolean;
  created: number;
  reminderAt: string | null;
  reminderSentAt: string | null;
  syncing?: boolean;
  error?: string;
}

const STORAGE_KEY = 'dashboard_notes_v1';
const PUSH_DEBUG_STORAGE_KEY = 'dashboard_notes_push_debug_v1';
const REMINDER_INTERVAL_MINUTES = 5;

export function DashboardNotes({ compact }: { compact?: boolean }) {
  const toast = useToast();
  const [items, setItems] = useState<NoteItem[]>([]);
  const [draft, setDraft] = useState('');
  const [newReminderDraft, setNewReminderDraft] = useState('');
  const [filter, setFilter] = useState<'all'|'open'|'done'>('all');
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
          .from('dashboard_notes')
          .select('id,text,done,created_at,reminder_at,reminder_sent_at')
          .order('created_at', { ascending: true });
        if (selErr) throw selErr;
        const rows = (data || []).map(r => ({
          id: r.id,
          text: r.text,
          done: r.done,
          created: new Date(r.created_at).getTime(),
          reminderAt: r.reminder_at || null,
          reminderSentAt: r.reminder_sent_at || null,
        } as NoteItem));
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
        table: 'dashboard_notes',
        filter: `user_id=eq.${userId}`
      }, (payload) => {
        setItems(prev => {
          switch (payload.eventType) {
            case 'INSERT': {
              const r: any = payload.new;
              if (prev.some(p => p.id === r.id)) return prev.map(p => p.id === r.id ? { ...p, syncing: false } : p);
              return [...prev, {
                id: r.id,
                text: r.text,
                done: r.done,
                created: new Date(r.created_at).getTime(),
                reminderAt: r.reminder_at || null,
                reminderSentAt: r.reminder_sent_at || null,
              }];
            }
            case 'UPDATE': {
              const r: any = payload.new;
              return prev.map(p => p.id === r.id ? {
                ...p,
                text: r.text,
                done: r.done,
                reminderAt: r.reminder_at || null,
                reminderSentAt: r.reminder_sent_at || null,
                syncing: false,
              } : p);
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

  const addItem = useCallback(async () => {
    const text = draft.trim();
    if (!text) return;
    if (!userId) {
      setError('Ingen användare inloggad.');
      return;
    }
    const nextReminder = newReminderDraft ? roundReminderToInterval(newReminderDraft).toISOString() : null;
    const tempId = crypto.randomUUID();
    const optimistic: NoteItem = { id: tempId, text, done: false, created: Date.now(), reminderAt: nextReminder, reminderSentAt: null, syncing: true };
    setItems(list => [...list, optimistic]);
    setDraft('');
    setNewReminderDraft('');
    setComposerOpen(false);
    const { data, error: insErr } = await supabase
      .from('dashboard_notes')
      .insert({ text, done: false, user_id: userId, reminder_at: nextReminder })
      .select('id,text,done,created_at,reminder_at,reminder_sent_at')
      .single();
    if (insErr || !data) {
      setItems(list => list.map(i => i.id === tempId ? { ...i, syncing: false, error: 'Ej sparad' } : i));
      return;
    }
    setItems(list => list.map(i => i.id === tempId ? {
      id: data.id,
      text: data.text,
      done: data.done,
      created: new Date(data.created_at).getTime(),
      reminderAt: data.reminder_at || null,
      reminderSentAt: data.reminder_sent_at || null,
    } : i));
  }, [draft, newReminderDraft, supabase, userId]);

  const toggle = async (id: string) => {
    setItems(list => list.map(i => i.id === id ? { ...i, done: !i.done, syncing: true } : i));
    const item = items.find(i => i.id === id);
    if (!item) return;
    const { error: updErr } = await supabase.from('dashboard_notes').update({ done: !item.done }).eq('id', id);
    if (updErr) {
      // revert
      setItems(list => list.map(i => i.id === id ? { ...i, done: item.done, syncing: false } : i));
    } else {
      setItems(list => list.map(i => i.id === id ? { ...i, syncing: false } : i));
    }
  };
  const remove = async (id: string) => {
    const prev = items;
    setItems(list => list.filter(i => i.id !== id));
    const { error: delErr } = await supabase.from('dashboard_notes').delete().eq('id', id);
    if (delErr) {
      // restore
      setItems(prev);
    }
  };
  const edit = async (id: string, text: string) => {
    setItems(list => list.map(i => i.id === id ? { ...i, text, syncing: true } : i));
    const { error: updErr } = await supabase.from('dashboard_notes').update({ text }).eq('id', id);
    setItems(list => list.map(i => i.id === id ? { ...i, syncing: !!updErr } : i));
  };

  const saveReminder = useCallback(async (id: string, reminderAt: string | null) => {
    const current = items.find(i => i.id === id) || null;
    const nextReminder = reminderAt ? roundReminderToInterval(reminderAt).toISOString() : null;
    setItems(list => list.map(i => i.id === id ? { ...i, reminderAt: nextReminder, reminderSentAt: null, syncing: true } : i));
    const { error: updErr } = await supabase
      .from('dashboard_notes')
      .update({ reminder_at: nextReminder, reminder_sent_at: null })
      .eq('id', id);
    if (updErr) {
      setItems(list => list.map(i => i.id === id ? { ...i, reminderAt: current?.reminderAt || null, reminderSentAt: current?.reminderSentAt || null, syncing: false } : i));
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
    const doneIds = items.filter(i => i.done).map(i => i.id);
    if (!doneIds.length) return;
    const prev = items;
    setItems(list => list.filter(i => !i.done));
    const { error: delErr } = await supabase.from('dashboard_notes').delete().in('id', doneIds);
    if (delErr) {
      setItems(prev);
    }
  };

  const visible = items.filter(i => filter==='all' ? true : filter==='open' ? !i.done : i.done);
  const openCount = items.filter(i => !i.done).length;
  const doneCount = items.length - openCount;
  const composerExpectedDispatch = newReminderDraft ? getExpectedDispatchTime(newReminderDraft) : null;

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:compact?12:16 }}>
      <div style={{ display:'flex', alignItems:'flex-start', gap:compact?8:12, flexWrap:'wrap' }}>
        <div style={{ display:'grid', gap:6 }}>
          <h2 style={{ margin:0, fontSize:compact?16:20, display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
          Anteckningar & Todo
          <span style={{ display:'inline-flex', alignItems:'center', gap:4, fontSize:11, fontWeight:500, color: live==='on'? '#059669': live==='connecting'? '#d97706':'#6b7280' }}>
            <span style={{ width:8, height:8, borderRadius:'50%', background: live==='on'? '#10b981': live==='connecting'? '#f59e0b':'#9ca3af', boxShadow: live==='on'? '0 0 4px #10b981':'' }} />
            {live==='on' ? 'Live' : live==='connecting' ? 'Ansluter…' : 'Offline'}
          </span>
          </h2>
          <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
            <span style={summaryPill}>{openCount} öppna</span>
            <span style={summaryPillMuted}>{doneCount} klara</span>
          </div>
        </div>
        <div style={{ marginLeft:'auto', display:'flex', gap:compact?4:6 }}>
          {(['all','open','done'] as const).map(f => (
            <button key={f} onClick={()=>setFilter(f)} style={{ ...filterBtn, ...(filter===f? filterBtnActive : {}), ...(compact ? compactFilterBtn : {}) }}>{f==='all'?'Alla': f==='open'?'Öppna':'Klart'}</button>
          ))}
        </div>
      </div>
      {error && (
        <div style={{ fontSize:12, color:'#b91c1c' }}>{error}</div>
      )}
      <section style={sectionCard}>
        <div style={{ display:'grid', gap:10 }}>
          <div style={{ display:'flex', justifyContent:'space-between', gap:12, flexWrap:'wrap', alignItems:'center' }}>
            <div style={{ display:'grid', gap:4 }}>
              <strong style={sectionTitle}>Notiser på den här enheten</strong>
              <span style={helperText}>Push används när en påminnelse blir förfallen. Automatisk körning sker i 5-minutersintervall.</span>
            </div>
            <div style={{ display:'flex', gap:8, flexWrap:'wrap', alignItems:'center' }}>
              <span style={{ ...pushStateBadge, color: pushEnabled ? '#166534' : '#475569', background: pushEnabled ? '#dcfce7' : '#f8fafc', borderColor: pushEnabled ? '#86efac' : '#d1d5db' }}>
                {pushSupported ? (pushEnabled ? 'Mobilnotiser aktiva' : notificationPermission === 'denied' ? 'Notiser blockerade' : 'Mobilnotiser av') : 'Push stöds inte här'}
              </span>
              <button type="button" onClick={() => setPushPanelOpen((prev) => !prev)} style={secondaryBtn}>
                {pushPanelOpen ? 'Dölj inställningar' : 'Visa inställningar'}
              </button>
            </div>
          </div>
          {pushPanelOpen && (
            <div style={{ display:'flex', gap:compact?6:8, flexWrap:'wrap', alignItems:'center' }}>
              {pushSupported && !pushEnabled && (
                <button type="button" onClick={enablePush} style={{ ...miniBtn, background:'#111827', border:'1px solid #111827' }} disabled={pushLoading}>
                  {pushLoading ? 'Aktiverar…' : 'Aktivera mobilnotiser'}
                </button>
              )}
              {pushSupported && pushEnabled && (
                <button type="button" onClick={disablePush} style={miniBtn} disabled={pushLoading}>
                  {pushLoading ? 'Uppdaterar…' : 'Stäng av notiser'}
                </button>
              )}
              <button type="button" onClick={dispatchDueReminders} style={{ ...miniBtn, background:'#2563eb', border:'1px solid #2563eb' }} disabled={dispatching}>
                {dispatching ? 'Kör…' : 'Kör förfallna påminnelser nu'}
              </button>
              {pushDebugMode && (
                <button type="button" onClick={togglePushDebugMode} style={miniBtn}>
                  Dölj pushdebug
                </button>
              )}
            </div>
          )}
        </div>
      </section>
      {pushDebugMode && (
        <div style={{ display:'grid', gap:4, padding:'10px 12px', border:'1px solid #cbd5e1', borderRadius:10, background:'#f8fafc' }}>
          <strong style={{ fontSize:12, color:'#334155' }}>Pushdiagnostik</strong>
          <div style={{ fontSize:11, color:'#64748b' }}>Aktiverat via <strong>?pushdebug=1</strong>. Stäng av med knappen ovan eller <strong>?pushdebug=0</strong>.</div>
          {pushDiagnostics.length === 0 && (
            <div style={{ fontSize:11, color:'#475569', fontFamily:'ui-monospace, SFMono-Regular, Menlo, monospace' }}>Inga pushhändelser loggade ännu.</div>
          )}
          {pushDiagnostics.map((line, index) => (
            <div key={`${index}-${line}`} style={{ fontSize:11, color:'#475569', fontFamily:'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{line}</div>
          ))}
        </div>
      )}
      <section style={sectionCard}>
        <div style={{ display:'grid', gap:12 }}>
          <div style={{ display:'flex', justifyContent:'space-between', gap:12, flexWrap:'wrap', alignItems:'center' }}>
            <div style={{ display:'grid', gap:4 }}>
              <strong style={sectionTitle}>Ny anteckning</strong>
              <span style={helperText}>Öppna formuläret när du vill lägga till något nytt. Tider avrundas uppåt till nästa 5-minutersfönster.</span>
            </div>
            <button type="button" onClick={() => setComposerOpen((prev) => !prev)} style={addComposerBtn} aria-expanded={composerOpen}>
              <span style={addComposerIcon}>{composerOpen ? '−' : '+'}</span>
              {composerOpen ? 'Stäng' : 'Lägg till anteckning'}
            </button>
          </div>
          {composerOpen && (
            <form onSubmit={e=>{e.preventDefault(); addItem();}} style={{ display:'grid', gap:12 }}>
              <textarea
                value={draft}
                onChange={e=>setDraft(e.target.value)}
                placeholder="Vad behöver du komma ihåg?"
                rows={compact ? 2 : 3}
                style={{ ...textareaInput, fontSize: compact?13:14 }}
              />
              <div style={{ display:'grid', gap:8 }}>
                <div style={{ display:'flex', justifyContent:'space-between', gap:8, flexWrap:'wrap', alignItems:'center' }}>
                  <span style={fieldLabel}>Påminnelse</span>
                  <span style={fieldHint}>{composerExpectedDispatch ? `Skickas cirka ${formatReminder(composerExpectedDispatch)}` : 'Ingen påminnelse vald'}</span>
                </div>
                <div style={{ display:'flex', gap:8, flexWrap:'wrap', alignItems:'center' }}>
                  <input
                    type="datetime-local"
                    value={newReminderDraft}
                    onChange={e=>setNewReminderDraft(normalizeReminderDraftValue(e.target.value))}
                    step={REMINDER_INTERVAL_MINUTES * 60}
                    style={{ ...input, flex:'1 1 220px', minWidth: compact ? 180 : 240 }}
                  />
                  {newReminderDraft && (
                    <button type="button" onClick={()=>setNewReminderDraft('')} style={secondaryBtn}>
                      Rensa tid
                    </button>
                  )}
                </div>
                <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                  <button type="button" onClick={()=>setNewReminderDraft(getRelativeReminderDraftValue(15))} style={quickActionBtn}>Om 15 min</button>
                  <button type="button" onClick={()=>setNewReminderDraft(getRelativeReminderDraftValue(30))} style={quickActionBtn}>Om 30 min</button>
                  <button type="button" onClick={()=>setNewReminderDraft(getRelativeReminderDraftValue(60))} style={quickActionBtn}>Om 1 timme</button>
                  <button type="button" onClick={()=>setNewReminderDraft(getTomorrowReminderDraftValue(8, 0))} style={quickActionBtn}>Imorgon 08:00</button>
                </div>
              </div>
              <div style={{ display:'flex', justifyContent:'space-between', gap:10, flexWrap:'wrap', alignItems:'center' }}>
                <span style={helperText}>{newReminderDraft ? 'Påminnelsen följer med direkt när anteckningen skapas.' : 'Du kan även lägga till eller ändra påminnelsen i efterhand.'}</span>
                <button type="submit" style={{ ...btnPrimary, minWidth: compact ? 140 : 170 }} disabled={!draft.trim()}>
                  Lägg till anteckning
                </button>
              </div>
            </form>
          )}
        </div>
      </section>
      {loading && <p style={{ margin:0, fontSize:12, color:'#6b7280' }}>Laddar…</p>}
      {!loading && items.length === 0 && (
        <p style={{ margin:0, fontSize:compact?12:14, color:'#6b7280' }}>Inga anteckningar ännu. Lägg till din första ovan.</p>
      )}
      {!loading && items.length > 0 && visible.length === 0 && (
        <p style={{ margin:0, fontSize:compact?12:14, color:'#6b7280' }}>
          {filter === 'open' ? 'Inga öppna anteckningar just nu.' : 'Inga klara anteckningar just nu.'}
        </p>
      )}
      {items.length > 0 && (
        <ul style={{ listStyle:'none', padding:0, margin:0, display:'flex', flexDirection:'column', gap:compact?4:6 }}>
          {visible.sort((a,b)=> a.done===b.done ? b.created - a.created : a.done?1:-1).map(item => (
            <NoteRow key={item.id} item={item} onToggle={()=>toggle(item.id)} onRemove={()=>remove(item.id)} onEdit={(t)=>edit(item.id,t)} onSaveReminder={(value)=>saveReminder(item.id, value)} compact={compact} />
          ))}
        </ul>
      )}
      {items.some(i=>i.done) && (
        <div style={{ display:'flex', justifyContent:'flex-end' }}>
          <button style={{ ...miniBtn, padding: compact? '5px 8px':'6px 10px', fontSize: compact?11:12 }} onClick={clearDone}>Rensa klara</button>
        </div>
      )}
    </div>
  );
}

function NoteRow({ item, onToggle, onRemove, onEdit, onSaveReminder, compact }: { item: NoteItem; onToggle: ()=>void; onRemove: ()=>void; onEdit:(t:string)=>void; onSaveReminder:(value:string | null)=>void; compact?: boolean }) {
  const [editing, setEditing] = useState(false);
  const [reminderOpen, setReminderOpen] = useState(false);
  const [draft, setDraft] = useState(item.text);
  const [reminderDraft, setReminderDraft] = useState(toDateTimeLocalValue(item.reminderAt));
  useEffect(()=>{ setDraft(item.text); }, [item.text]);
  useEffect(() => { setReminderDraft(toDateTimeLocalValue(item.reminderAt)); }, [item.reminderAt]);
  useEffect(() => {
    if (!item.reminderAt) {
      setReminderOpen(false);
    }
  }, [item.reminderAt]);
  const expectedDispatch = item.reminderAt ? getExpectedDispatchTime(item.reminderAt) : null;

  return (
  <li style={{ ...noteCard, padding: compact? '10px 12px':'14px 16px', opacity:item.syncing?0.7:1 }}>
      <div style={{ display:'flex', justifyContent:'space-between', gap:12, alignItems:'flex-start', flexWrap:'wrap' }}>
        <div style={{ display:'grid', gap:10, flex:'1 1 420px', minWidth:0 }}>
          {!editing && (
            <div onDoubleClick={()=>setEditing(true)} style={{ fontSize:compact?13:15, color:item.done? '#64748b':'#111827', textDecoration:item.done?'line-through':'none', cursor:'text', display:'flex', alignItems:'center', gap:6, flexWrap:'wrap', lineHeight:1.45 }}>
              <span style={{ fontWeight:600 }}>{item.text}</span>
              {item.syncing && !item.error && <span style={{ fontSize:10, color:'#6b7280' }}>⟳</span>}
              {item.error && <span style={{ fontSize:10, color:'#b91c1c' }} title={item.error}>⚠</span>}
            </div>
          )}
          {editing && (
            <form onSubmit={e=>{e.preventDefault(); onEdit(draft.trim() || item.text); setEditing(false);}} style={{ flex:1 }}>
              <input autoFocus value={draft} onChange={e=>setDraft(e.target.value)} onBlur={()=>{ setEditing(false); setDraft(item.text); }} style={{ ...input, padding: compact? '3px 5px':'4px 6px', fontSize:compact?12.5:13, width:'100%' }} />
            </form>
          )}
          <div style={{ display:'flex', justifyContent:'space-between', gap:10, flexWrap:'wrap', alignItems:'center' }}>
            <div style={{ display:'flex', gap:8, flexWrap:'wrap', alignItems:'center' }}>
              <span style={item.done ? statusPillDone : statusPillOpen}>{item.done ? 'Klar' : 'Öppen'}</span>
              {item.reminderAt && <span style={statusPillMuted}>Påminnelse aktiv</span>}
            </div>
          </div>
        </div>
        <div style={{ display:'flex', gap:8, flexWrap:'wrap', alignItems:'center', justifyContent:'flex-end' }}>
          <button onClick={onToggle} aria-label={item.done? 'Markera som ej klar':'Markera som klar'} style={item.done ? completePillBtnDone : completePillBtn}>
            <span style={{ ...checkBtn, width: compact?16:18, height: compact?16:18, ...(item.done? checkBtnDone : {}) }}>
              {item.done && (
                <svg width="12" height="12" viewBox="0 0 24 24" stroke="#fff" strokeWidth={3} fill="none"><path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" /></svg>
              )}
            </span>
            <span style={{ fontSize:12, fontWeight:700, color:item.done ? '#166534' : '#0f172a', lineHeight:1.2, whiteSpace:'nowrap' }}>
              {item.done ? 'Öppna igen' : 'Markera klar'}
            </span>
          </button>
          <button onClick={()=>setEditing(true)} style={secondaryBtn} aria-label="Redigera">Redigera</button>
          <button onClick={onRemove} style={dangerBtn} aria-label="Ta bort">Ta bort</button>
        </div>
      </div>
      <div style={reminderBox}>
        <div style={{ display:'flex', justifyContent:'space-between', gap:8, flexWrap:'wrap', alignItems:'center' }}>
          <div style={{ display:'grid', gap:4 }}>
            <strong style={{ fontSize:13, color:'#0f172a' }}>Påminnelse</strong>
            <span style={{ fontSize:12, color:'#64748b', lineHeight:1.5 }}>
              {item.reminderAt ? `Påminnelse ${formatReminder(item.reminderAt)}` : 'Ingen påminnelse satt'}
              {expectedDispatch ? ` • skickas cirka ${formatReminder(expectedDispatch)}` : ''}
              {item.reminderSentAt ? ` • skickad ${formatReminder(item.reminderSentAt)}` : ''}
            </span>
          </div>
          <button type="button" onClick={() => setReminderOpen((prev) => !prev)} style={secondaryBtn} disabled={item.done}>
            {reminderOpen ? 'Dölj tid' : item.reminderAt ? 'Ändra tid' : 'Lägg till tid'}
          </button>
        </div>
        {reminderOpen && (
          <>
            <div style={{ display:'flex', justifyContent:'space-between', gap:8, flexWrap:'wrap', alignItems:'center' }}>
              <span style={fieldHint}>Skickas i 5-minutersintervall</span>
            </div>
            <div style={{ display:'flex', gap:8, flexWrap:'wrap', alignItems:'center' }}>
              <input
                type="datetime-local"
                value={reminderDraft}
                onChange={e=>setReminderDraft(normalizeReminderDraftValue(e.target.value))}
                step={REMINDER_INTERVAL_MINUTES * 60}
                disabled={item.done}
                style={{ ...input, flex:'1 1 220px', minWidth: compact ? 180 : 240 }}
              />
              <button type="button" onClick={()=>{ onSaveReminder(reminderDraft || null); setReminderOpen(false); }} style={{ ...btnPrimary, minWidth: compact ? 140 : 156 }} disabled={item.done}>
                Spara påminnelse
              </button>
              {item.reminderAt && (
                <button type="button" onClick={()=>{ setReminderDraft(''); onSaveReminder(null); setReminderOpen(false); }} style={secondaryBtn}>
                  Rensa tid
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </li>
  );
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
  return date.toLocaleString('sv-SE');
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
const textareaInput: React.CSSProperties = { ...input, minHeight:92, resize:'vertical', width:'100%', lineHeight:1.5, fontFamily:'inherit' };
const btnPrimary: React.CSSProperties = { padding:'8px 14px', borderRadius:8, border:'1px solid #111827', background:'#111827', color:'#fff', fontSize:14, cursor:'pointer', fontWeight:500 };
const filterBtn: React.CSSProperties = { padding:'6px 12px', borderRadius:999, background:'#fff', border:'1px solid #d1d5db', cursor:'pointer', fontSize:12, color:'#111827' };
const filterBtnActive: React.CSSProperties = { background:'#2563eb', color:'#fff', border:'1px solid #2563eb' };
const compactFilterBtn: React.CSSProperties = { padding:'6px 10px', fontSize:11.5 };
const iconBtn: React.CSSProperties = { padding:'4px 6px', fontSize:12, lineHeight:1, cursor:'pointer', background:'#f1f5f9', borderRadius:6, border:'1px solid #e2e8f0' };
const miniBtn: React.CSSProperties = { padding:'6px 10px', background:'#334155', color:'#fff', borderRadius:6, fontSize:12, cursor:'pointer', border:'1px solid #334155' };
const checkBtn: React.CSSProperties = { width:20, height:20, borderRadius:6, border:'1px solid #cbd5e1', background:'#fff', display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer' };
const checkBtnDone: React.CSSProperties = { background:'#16a34a', border:'1px solid #16a34a' };
const pushStateBadge: React.CSSProperties = { display:'inline-flex', alignItems:'center', padding:'6px 10px', borderRadius:999, border:'1px solid #d1d5db', fontSize:11.5, fontWeight:700 };
const sectionCard: React.CSSProperties = { display:'grid', gap:10, padding:'16px 18px', border:'1px solid #e2e8f0', borderRadius:16, background:'linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)', boxShadow:'0 6px 20px rgba(15, 23, 42, 0.05)' };
const sectionTitle: React.CSSProperties = { fontSize:14, color:'#0f172a' };
const helperText: React.CSSProperties = { fontSize:12, color:'#64748b', lineHeight:1.5 };
const fieldLabel: React.CSSProperties = { fontSize:12, fontWeight:700, color:'#334155', letterSpacing:'0.01em' };
const fieldHint: React.CSSProperties = { fontSize:11, color:'#64748b' };
const secondaryBtn: React.CSSProperties = { padding:'8px 12px', background:'#ffffff', color:'#0f172a', borderRadius:8, fontSize:12.5, cursor:'pointer', border:'1px solid #cbd5e1', fontWeight:600, whiteSpace:'nowrap' };
const quickActionBtn: React.CSSProperties = { padding:'7px 10px', background:'#eff6ff', color:'#1d4ed8', borderRadius:999, fontSize:12, cursor:'pointer', border:'1px solid #bfdbfe', fontWeight:600, whiteSpace:'nowrap' };
const dangerBtn: React.CSSProperties = { padding:'8px 12px', background:'#fff1f2', color:'#be123c', borderRadius:8, fontSize:12.5, cursor:'pointer', border:'1px solid #fecdd3', fontWeight:600, whiteSpace:'nowrap' };
const summaryPill: React.CSSProperties = { display:'inline-flex', alignItems:'center', padding:'5px 10px', borderRadius:999, background:'#dcfce7', color:'#166534', fontSize:11.5, fontWeight:700 };
const summaryPillMuted: React.CSSProperties = { display:'inline-flex', alignItems:'center', padding:'5px 10px', borderRadius:999, background:'#e2e8f0', color:'#475569', fontSize:11.5, fontWeight:700 };
const noteCard: React.CSSProperties = { display:'grid', gap:12, background:'#ffffff', border:'1px solid #e2e8f0', borderRadius:16, boxShadow:'0 6px 20px rgba(15, 23, 42, 0.05)' };
const reminderBox: React.CSSProperties = { display:'grid', gap:8, padding:'12px', border:'1px solid #dbeafe', borderRadius:12, background:'#f8fbff' };
const statusPillOpen: React.CSSProperties = { display:'inline-flex', alignItems:'center', padding:'4px 9px', borderRadius:999, background:'#dbeafe', color:'#1d4ed8', fontSize:11, fontWeight:700 };
const statusPillDone: React.CSSProperties = { display:'inline-flex', alignItems:'center', padding:'4px 9px', borderRadius:999, background:'#dcfce7', color:'#166534', fontSize:11, fontWeight:700 };
const statusPillMuted: React.CSSProperties = { display:'inline-flex', alignItems:'center', padding:'4px 9px', borderRadius:999, background:'#f1f5f9', color:'#475569', fontSize:11, fontWeight:700 };
const addComposerBtn: React.CSSProperties = { display:'inline-flex', alignItems:'center', gap:10, padding:'10px 14px', background:'#0f172a', color:'#fff', borderRadius:12, fontSize:13, cursor:'pointer', border:'1px solid #0f172a', fontWeight:700, boxShadow:'0 10px 18px rgba(15, 23, 42, 0.12)' };
const addComposerIcon: React.CSSProperties = { display:'inline-flex', alignItems:'center', justifyContent:'center', width:22, height:22, borderRadius:'50%', background:'rgba(255,255,255,0.16)', fontSize:16, lineHeight:1 };
const completePillBtn: React.CSSProperties = { display:'inline-flex', alignItems:'center', gap:8, padding:'7px 10px', background:'#f8fafc', border:'1px solid #dbe4ef', borderRadius:999, cursor:'pointer', boxShadow:'inset 0 1px 0 rgba(255,255,255,0.7)', whiteSpace:'nowrap', flexShrink:0 };
const completePillBtnDone: React.CSSProperties = { ...completePillBtn, background:'#f0fdf4', border:'1px solid #bbf7d0' };

export default DashboardNotes;
