"use client";

import { useEffect, useMemo, useState } from 'react';
import SectionCard from '../../../components/ui/SectionCard';
import Input from '../../../components/ui/Input';
import Textarea from '../../../components/ui/Textarea';
import { useToast } from '@/lib/Toast';
import { cn } from '@/lib/shared/cn';

type ProspectItem = {
  id: string;
  company_name: string;
  contact_name: string | null;
  city: string | null;
  status: 'new' | 'contacted' | 'qualified' | 'quoted' | 'won' | 'lost';
};

type TaskItem = {
  id: string;
  prospect_id: string | null;
  user_id: string;
  title: string;
  details: string | null;
  status: 'open' | 'done';
  priority: 'low' | 'normal' | 'high';
  due_date: string | null;
  remind_at: string | null;
  source: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

type TaskDraft = {
  prospect_id: string;
  title: string;
  details: string;
  priority: TaskItem['priority'];
  due_date: string;
  remind_at: string;
  source: string;
  status: TaskItem['status'];
};

type TaskFilter = 'all' | 'open' | 'overdue' | 'done';

const priorityMeta: Record<TaskItem['priority'], { label: string; className: string }> = {
  low: { label: 'Låg', className: 'border-slate-200 bg-slate-100 text-slate-700' },
  normal: { label: 'Normal', className: 'border-sky-200 bg-sky-50 text-sky-700' },
  high: { label: 'Hög', className: 'border-rose-200 bg-rose-50 text-rose-700' },
};

const initialDraft: TaskDraft = {
  prospect_id: '',
  title: '',
  details: '',
  priority: 'normal',
  due_date: '',
  remind_at: '',
  source: '',
  status: 'open',
};

function formatDate(value: string | null | undefined) {
  if (!value) return 'Ingen deadline';
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return 'Ingen deadline';
  return new Intl.DateTimeFormat('sv-SE', { dateStyle: 'medium' }).format(date);
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return '–';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '–';
  return new Intl.DateTimeFormat('sv-SE', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function toDateTimeLocalValue(value: string | null | undefined) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function toIsoDateTime(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function isOverdue(task: TaskItem) {
  if (task.status === 'done' || !task.due_date) return false;
  const today = new Date();
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  return task.due_date < todayIso;
}

export default function TasksClient() {
  const toast = useToast();
  const [prospects, setProspects] = useState<ProspectItem[]>([]);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [updatingTaskIds, setUpdatingTaskIds] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<TaskFilter>('all');
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [draft, setDraft] = useState<TaskDraft>(initialDraft);

  const prospectsById = useMemo(() => new Map(prospects.map((item) => [item.id, item])), [prospects]);

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const query = new URLSearchParams();
        if (search.trim()) query.set('q', search.trim());

        const [prospectsRes, tasksRes] = await Promise.all([
          fetch('/api/crm/prospects', { cache: 'no-store' }),
          fetch(`/api/crm/tasks${query.size > 0 ? `?${query.toString()}` : ''}`, { cache: 'no-store' }),
        ]);

        const [prospectsJson, tasksJson] = await Promise.all([
          prospectsRes.json().catch(() => ({})),
          tasksRes.json().catch(() => ({})),
        ]);

        if (!active) return;

        if (!prospectsRes.ok || !prospectsJson.ok) {
          setError(prospectsJson?.error || 'Kunde inte ladda prospekt för uppgifter.');
          setProspects([]);
          setTasks([]);
          return;
        }

        if (!tasksRes.ok || !tasksJson.ok) {
          setError(tasksJson?.error || 'Kunde inte ladda uppgifter.');
          setProspects(Array.isArray(prospectsJson?.data?.items) ? prospectsJson.data.items : []);
          setTasks([]);
          return;
        }

        setProspects(Array.isArray(prospectsJson?.data?.items) ? prospectsJson.data.items : []);
        setTasks(Array.isArray(tasksJson?.data?.items) ? tasksJson.data.items : []);
      } catch {
        if (!active) return;
        setError('Kunde inte ladda uppgiftsytan.');
        setProspects([]);
        setTasks([]);
      } finally {
        if (active) setLoading(false);
      }
    }

    load();

    return () => {
      active = false;
    };
  }, [search]);

  useEffect(() => {
    if (!modalOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [modalOpen]);

  const visibleTasks = useMemo(() => {
    if (filter === 'all') return tasks;
    if (filter === 'done') return tasks.filter((task) => task.status === 'done');
    if (filter === 'overdue') return tasks.filter((task) => isOverdue(task));
    return tasks.filter((task) => task.status === 'open');
  }, [filter, tasks]);

  const stats = useMemo(() => {
    return {
      open: tasks.filter((task) => task.status === 'open').length,
      overdue: tasks.filter((task) => isOverdue(task)).length,
      done: tasks.filter((task) => task.status === 'done').length,
    };
  }, [tasks]);

  function openCreateModal() {
    setEditingTaskId(null);
    setDraft(initialDraft);
    setModalOpen(true);
  }

  function openEditModal(task: TaskItem) {
    setEditingTaskId(task.id);
    setDraft({
      prospect_id: task.prospect_id || '',
      title: task.title,
      details: task.details || '',
      priority: task.priority,
      due_date: task.due_date || '',
      remind_at: toDateTimeLocalValue(task.remind_at),
      source: task.source || '',
      status: task.status,
    });
    setModalOpen(true);
  }

  async function saveTask() {
    if (!draft.title.trim()) {
      toast.error('Uppgiftstitel krävs');
      return;
    }

    setSubmitting(true);
    try {
      const isEditing = Boolean(editingTaskId);
      const res = await fetch(isEditing ? `/api/crm/tasks/${editingTaskId}` : '/api/crm/tasks', {
        method: isEditing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...draft,
          remind_at: toIsoDateTime(draft.remind_at),
        }),
      });
      const json = await res.json().catch(() => ({}));

      if (!res.ok || !json.ok) {
        toast.error(json?.error || 'Kunde inte spara uppgift');
        return;
      }

      const item = json?.data?.item as TaskItem | undefined;
      if (item) {
        setTasks((current) => {
          if (isEditing) {
            return current.map((entry) => (entry.id === item.id ? item : entry));
          }

          return [item, ...current];
        });
      }

      setModalOpen(false);
      setEditingTaskId(null);
      setDraft(initialDraft);
      toast.success(isEditing ? 'Uppgift uppdaterad' : 'Uppgift skapad');
    } catch {
      toast.error('Fel vid sparande av uppgift');
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleTaskStatus(task: TaskItem) {
    const nextStatus = task.status === 'done' ? 'open' : 'done';
    setUpdatingTaskIds((current) => [...current, task.id]);

    try {
      const res = await fetch(`/api/crm/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prospect_id: task.prospect_id,
          title: task.title,
          details: task.details,
          priority: task.priority,
          due_date: task.due_date,
          remind_at: task.remind_at,
          source: task.source,
          status: nextStatus,
        }),
      });
      const json = await res.json().catch(() => ({}));

      if (!res.ok || !json.ok) {
        toast.error(json?.error || 'Kunde inte uppdatera uppgiften');
        return;
      }

      const item = json?.data?.item as TaskItem | undefined;
      if (item) {
        setTasks((current) => current.map((entry) => (entry.id === item.id ? item : entry)));
      }

      toast.success(nextStatus === 'done' ? 'Uppgift klar' : 'Uppgift återöppnad');
    } catch {
      toast.error('Fel vid uppdatering av uppgift');
    } finally {
      setUpdatingTaskIds((current) => current.filter((id) => id !== task.id));
    }
  }

  return (
    <div className="grid gap-4">
      <SectionCard className="overflow-hidden border-slate-200 bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.12),_transparent_28%),radial-gradient(circle_at_top_right,_rgba(245,158,11,0.10),_transparent_24%),linear-gradient(180deg,#fbfeff_0%,#f7fafc_100%)] p-5 shadow-[0_24px_70px_rgba(15,23,42,0.08)] md:p-6">
        <div className="grid gap-5">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
            <div className="grid gap-3">
              <div className="inline-flex w-fit items-center rounded-full border border-sky-200/80 bg-white/80 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-sky-900 shadow-[0_8px_18px_rgba(255,255,255,0.35)]">
                CRM / Uppgifter
              </div>
              <div className="grid gap-2">
                <div className="flex flex-wrap items-center gap-3">
                  <h1 className="m-0 text-[clamp(2rem,4vw,3.2rem)] font-bold tracking-[-0.06em] text-slate-950">Uppgifter</h1>
                  <div className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-900">
                    {stats.open} öppna
                  </div>
                  <button
                    type="button"
                    onClick={openCreateModal}
                    className="inline-flex min-h-10 items-center justify-center rounded-2xl border border-sky-600 bg-[linear-gradient(180deg,#0ea5e9_0%,#0284c7_100%)] px-4 py-2 text-sm font-semibold text-white shadow-[0_16px_26px_rgba(2,132,199,0.22)] transition hover:brightness-[0.97]"
                  >
                    Ny uppgift
                  </button>
                </div>
                <p className="m-0 max-w-3xl text-sm leading-6 text-slate-600 md:text-[15px]">
                  Första versionen fokuserar på enkel uppföljning: vad som är öppet, vad som är förfallet och vad som redan är avklarat. Allt ska gå att avpricka eller justera direkt.
                </p>
              </div>
            </div>

            <div className="grid gap-2 rounded-[28px] border border-slate-200/80 bg-[linear-gradient(180deg,rgba(15,23,42,0.94)_0%,rgba(30,41,59,0.92)_100%)] p-4 text-white shadow-[0_22px_44px_rgba(15,23,42,0.22)]">
              <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-sky-100/80">Snapshot</span>
              <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
                <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-3 backdrop-blur-sm">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-300">Öppna</div>
                  <div className="mt-1 text-xl font-bold tracking-[-0.04em] text-white">{stats.open}</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-3 backdrop-blur-sm">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-300">Förfallna</div>
                  <div className="mt-1 text-xl font-bold tracking-[-0.04em] text-white">{stats.overdue}</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-3 backdrop-blur-sm">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-300">Klara</div>
                  <div className="mt-1 text-xl font-bold tracking-[-0.04em] text-white">{stats.done}</div>
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-3 rounded-[28px] border border-white/70 bg-white/75 p-4 shadow-[0_16px_36px_rgba(15,23,42,0.06)] backdrop-blur lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Sök på titel, prospekt eller källa"
              className="rounded-2xl border-slate-200 bg-white shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]"
            />
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
              {([
                ['all', 'Alla'],
                ['open', 'Öppna'],
                ['overdue', 'Förfallna'],
                ['done', 'Klara'],
              ] as Array<[TaskFilter, string]>).map(([value, label]) => {
                const active = filter === value;
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setFilter(value)}
                    className={cn(
                      'rounded-full border px-3 py-2 font-semibold transition',
                      active ? 'border-sky-200 bg-sky-50 text-sky-700' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                    )}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {error ? <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

          <div className="grid gap-3">
            {loading ? (
              Array.from({ length: 3 }).map((_, index) => (
                <div key={index} className="grid gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                  <div className="h-3 w-40 rounded-full bg-slate-200" />
                  <div className="h-3 w-24 rounded-full bg-slate-200" />
                </div>
              ))
            ) : visibleTasks.length === 0 ? (
              <div className="grid gap-2 rounded-[24px] border border-dashed border-slate-300 bg-slate-50 px-5 py-8 text-center">
                <strong className="text-base font-bold text-slate-900">Inga uppgifter i den här vyn</strong>
                <p className="m-0 text-sm leading-6 text-slate-600">Skapa första uppgiften eller byt filter.</p>
              </div>
            ) : (
              visibleTasks.map((task) => {
                const prospect = task.prospect_id ? prospectsById.get(task.prospect_id) || null : null;
                const overdue = isOverdue(task);
                const updating = updatingTaskIds.includes(task.id);

                return (
                  <div key={task.id} className={cn(
                    'grid gap-3 rounded-[24px] border px-4 py-4 shadow-[0_12px_26px_rgba(15,23,42,0.05)] md:grid-cols-[minmax(0,1fr)_auto]',
                    overdue ? 'border-amber-200 bg-[linear-gradient(180deg,#fffdf7_0%,#fffaf0_100%)]' : 'border-slate-200 bg-white'
                  )}>
                    <div className="grid gap-2 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <strong className="break-words text-base font-bold tracking-[-0.03em] text-slate-950">{task.title}</strong>
                        <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-semibold md:px-2.5 md:py-1 md:text-[11px]', priorityMeta[task.priority].className)}>
                          {priorityMeta[task.priority].label}
                        </span>
                        {overdue ? <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-700">Förfallen</span> : null}
                        {task.status === 'done' ? <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">Klar</span> : null}
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                        <span>Deadline: {formatDate(task.due_date)}</span>
                        {task.remind_at ? <span>Påminnelse: {formatDateTime(task.remind_at)}</span> : null}
                        {prospect?.company_name ? <span>Prospekt: {prospect.company_name}</span> : null}
                        {task.source ? <span>Källa: {task.source}</span> : null}
                      </div>
                      <p className="m-0 whitespace-pre-wrap break-words text-sm leading-6 text-slate-600">{task.details || 'Ingen extra beskrivning än.'}</p>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                        <span>Skapad {formatDateTime(task.created_at)}</span>
                        {task.completed_at ? <span>Klar {formatDateTime(task.completed_at)}</span> : null}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-end gap-2 md:w-[220px] md:content-start">
                      <button
                        type="button"
                        onClick={() => toggleTaskStatus(task)}
                        disabled={updating}
                        className={cn(
                          'inline-flex min-h-10 w-full items-center justify-center rounded-2xl border px-3 py-2 text-sm font-semibold transition',
                          task.status === 'done'
                            ? 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                            : 'border-emerald-600 bg-[linear-gradient(180deg,#14b87a_0%,#0f9f6c_100%)] text-white shadow-[0_16px_26px_rgba(16,185,129,0.18)] hover:brightness-[0.97]',
                          updating ? 'cursor-wait opacity-70' : ''
                        )}
                      >
                        {updating ? 'Sparar…' : task.status === 'done' ? 'Öppna igen' : 'Markera klar'}
                      </button>
                      <button
                        type="button"
                        onClick={() => openEditModal(task)}
                        className="inline-flex min-h-10 w-full items-center justify-center rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 shadow-[0_10px_18px_rgba(15,23,42,0.04)] hover:border-slate-300 hover:text-slate-900"
                      >
                        Redigera
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </SectionCard>

      {modalOpen ? (
        <div className="fixed inset-0 z-[2800] flex items-end justify-center bg-slate-950/45 p-3 [backdrop-filter:blur(4px)] sm:items-center sm:p-4" onClick={() => setModalOpen(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label={editingTaskId ? 'Redigera uppgift' : 'Ny uppgift'}
            onClick={(event) => event.stopPropagation()}
            className="grid w-full max-w-[760px] gap-4 rounded-[28px] border border-white/70 bg-[linear-gradient(180deg,#ffffff_0%,#f5f9fc_100%)] p-4 shadow-[0_30px_80px_rgba(15,23,42,0.28)] sm:max-h-[88vh] sm:overflow-y-auto sm:p-5"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="grid gap-1">
                <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">{editingTaskId ? 'Redigera uppgift' : 'Ny uppgift'}</span>
                <strong className="text-[1.6rem] font-bold tracking-[-0.05em] text-slate-950">{draft.title || 'Planera nästa steg'}</strong>
                <p className="m-0 max-w-2xl text-sm leading-6 text-slate-600">
                  Fånga uppföljningar utan att lämna CRM-flödet. Första versionen fokuserar på tydliga deadlines och snabb avprickning.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setModalOpen(false);
                  setEditingTaskId(null);
                  setDraft(initialDraft);
                }}
                className="inline-flex min-h-10 items-center justify-center rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 shadow-[0_10px_18px_rgba(15,23,42,0.04)] hover:border-slate-300 hover:text-slate-900"
              >
                Stäng
              </button>
            </div>

            <div className="grid gap-3 rounded-[28px] border border-white/80 bg-white/92 p-4 shadow-[0_20px_44px_rgba(15,23,42,0.06)]">
              <Input value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} placeholder="Titel på uppgiften" />

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="grid gap-1 text-sm text-slate-600">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Prospekt</span>
                  <select
                    value={draft.prospect_id}
                    onChange={(event) => setDraft((current) => ({ ...current, prospect_id: event.target.value }))}
                    className="min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/20"
                  >
                    <option value="">Inget prospekt valt</option>
                    {prospects.map((prospect) => (
                      <option key={prospect.id} value={prospect.id}>{prospect.company_name}</option>
                    ))}
                  </select>
                </label>

                <label className="grid gap-1 text-sm text-slate-600">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Status</span>
                  <select
                    value={draft.status}
                    onChange={(event) => setDraft((current) => ({ ...current, status: event.target.value as TaskItem['status'] }))}
                    className="min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/20"
                  >
                    <option value="open">Öppen</option>
                    <option value="done">Klar</option>
                  </select>
                </label>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <label className="grid gap-1 text-sm text-slate-600">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Prioritet</span>
                  <select
                    value={draft.priority}
                    onChange={(event) => setDraft((current) => ({ ...current, priority: event.target.value as TaskItem['priority'] }))}
                    className="min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/20"
                  >
                    <option value="low">Låg</option>
                    <option value="normal">Normal</option>
                    <option value="high">Hög</option>
                  </select>
                </label>
                <label className="grid gap-1 text-sm text-slate-600">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Deadline</span>
                  <Input value={draft.due_date} onChange={(event) => setDraft((current) => ({ ...current, due_date: event.target.value }))} type="date" />
                </label>
                <label className="grid gap-1 text-sm text-slate-600">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Påminnelse</span>
                  <Input value={draft.remind_at} onChange={(event) => setDraft((current) => ({ ...current, remind_at: event.target.value }))} type="datetime-local" />
                </label>
                <Input value={draft.source} onChange={(event) => setDraft((current) => ({ ...current, source: event.target.value }))} placeholder="Källa, t.ex. samtal eller manuell" />
              </div>

              <Textarea
                value={draft.details}
                onChange={(event) => setDraft((current) => ({ ...current, details: event.target.value }))}
                placeholder="Vad ska följas upp och varför?"
                className="min-h-[132px]"
              />

              <div className="flex flex-wrap items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setModalOpen(false);
                    setEditingTaskId(null);
                    setDraft(initialDraft);
                  }}
                  className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-600 shadow-[0_10px_18px_rgba(15,23,42,0.04)] hover:border-slate-300 hover:text-slate-900"
                >
                  Avbryt
                </button>
                <button
                  type="button"
                  onClick={saveTask}
                  disabled={submitting}
                  className="inline-flex min-h-12 items-center justify-center rounded-2xl border border-sky-600 bg-[linear-gradient(180deg,#0ea5e9_0%,#0284c7_100%)] px-4 py-3 text-sm font-semibold text-white shadow-[0_20px_34px_rgba(2,132,199,0.22)] transition hover:brightness-[0.97] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {submitting ? 'Sparar…' : editingTaskId ? 'Spara ändringar' : 'Skapa uppgift'}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}