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

  const filterCounts = useMemo(() => ({
    all: tasks.length,
    open: tasks.filter((task) => task.status === 'open').length,
    overdue: tasks.filter((task) => isOverdue(task)).length,
    done: tasks.filter((task) => task.status === 'done').length,
  }), [tasks]);

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
      <SectionCard className="overflow-hidden border-emerald-300/80 bg-[radial-gradient(circle_at_top_left,_rgba(22,163,74,0.22),_transparent_30%),radial-gradient(circle_at_top_right,_rgba(101,163,13,0.16),_transparent_24%),linear-gradient(135deg,#f6fbf4_0%,#e5f4e8_56%,#f5fbf6_100%)] p-4 shadow-[0_24px_70px_rgba(15,23,42,0.08)] md:p-5 xl:p-6">
        <div className="grid gap-5">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
            <div className="grid gap-3">
              <div className="inline-flex w-fit items-center rounded-full border border-emerald-200/80 bg-white/80 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-emerald-900 shadow-[0_8px_18px_rgba(255,255,255,0.35)]">
                CRM / Uppgifter
              </div>
              <div className="grid gap-1.5">
                <div className="flex flex-wrap items-center gap-3">
                  <h1 className="m-0 text-[clamp(1.75rem,3vw,2.8rem)] font-bold tracking-[-0.05em] text-slate-950">Uppgifter</h1>
                  <div className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-900">
                    {stats.open} öppna
                  </div>
                </div>
                <p className="m-0 max-w-3xl text-sm text-slate-600">
                  Håll koll på nästa steg, det som är förfallet och vad som kan stängas direkt utan att lämna CRM-flödet.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 lg:justify-end">
              <button
                type="button"
                onClick={openCreateModal}
                className="inline-flex items-center rounded-full border border-emerald-800 bg-emerald-800 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-900"
              >
                Ny uppgift
              </button>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-4">
            <div className="rounded-[18px] border border-slate-200 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(252,253,252,0.98))] p-3 shadow-[0_16px_30px_rgba(15,23,42,0.08)] ring-1 ring-white/80">
              <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Öppna</div>
              <div className="mt-1 text-[clamp(1.35rem,2vw,1.8rem)] font-bold tracking-[-0.04em] text-slate-950">{stats.open}</div>
              <div className="mt-1 text-[13px] text-slate-500">Aktiva uppgifter att jobba med</div>
            </div>
            <div className="rounded-[18px] border border-slate-200 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(252,253,252,0.98))] p-3 shadow-[0_16px_30px_rgba(15,23,42,0.08)] ring-1 ring-white/80">
              <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Förfallna</div>
              <div className="mt-1 text-[clamp(1.35rem,2vw,1.8rem)] font-bold tracking-[-0.04em] text-slate-950">{stats.overdue}</div>
              <div className="mt-1 text-[13px] text-slate-500">Behöver åtgärdas först</div>
            </div>
            <div className="rounded-[18px] border border-slate-200 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(252,253,252,0.98))] p-3 shadow-[0_16px_30px_rgba(15,23,42,0.08)] ring-1 ring-white/80">
              <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Klara</div>
              <div className="mt-1 text-[clamp(1.35rem,2vw,1.8rem)] font-bold tracking-[-0.04em] text-slate-950">{stats.done}</div>
              <div className="mt-1 text-[13px] text-slate-500">Färdiga uppföljningar</div>
            </div>
            <div className="rounded-[18px] border border-slate-200 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(252,253,252,0.98))] p-3 shadow-[0_16px_30px_rgba(15,23,42,0.08)] ring-1 ring-white/80">
              <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">I vy</div>
              <div className="mt-1 text-[clamp(1.35rem,2vw,1.8rem)] font-bold tracking-[-0.04em] text-slate-950">{visibleTasks.length}</div>
              <div className="mt-1 text-[13px] text-slate-500">Matchar sök och filter</div>
            </div>
          </div>

          <div className="grid gap-3 rounded-[24px] border border-white/70 bg-white/75 p-3 shadow-[0_16px_36px_rgba(15,23,42,0.06)] backdrop-blur xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start">
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Sök på titel, prospekt eller källa"
              className="max-w-xl"
            />
            <div className="grid gap-2 rounded-[20px] border border-slate-200/85 bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(250,252,250,0.96))] p-2 shadow-[0_14px_30px_rgba(15,23,42,0.05)]">
              <div className="flex items-center justify-between gap-3 px-2 pt-1">
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Sales cockpit</div>
                <div className="text-xs text-slate-500">{visibleTasks.length} i vy</div>
              </div>
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
                      'grid min-w-[120px] gap-0.5 rounded-[20px] border px-3 py-2 text-left transition',
                      active ? 'border-emerald-900 bg-emerald-900 text-white shadow-[0_14px_24px_rgba(15,23,42,0.16)]' : 'border-slate-200 bg-white text-slate-700 hover:-translate-y-0.5 hover:shadow-[0_10px_20px_rgba(15,23,42,0.08)]'
                    )}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-semibold">{label}</span>
                      <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-bold', active ? 'bg-white/16 text-white' : 'bg-white/80 text-current')}>
                        {filterCounts[value]}
                      </span>
                    </div>
                    <span className={cn('text-[11px]', active ? 'text-white/80' : 'text-current/70')}>
                      {value === 'all' ? 'Hela arbetslistan' : value === 'open' ? 'Aktiva uppgifter' : value === 'overdue' ? 'Borde gjorts redan' : 'Redan avslutade'}
                    </span>
                  </button>
                );
              })}
              </div>
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
                    'relative grid gap-2.5 rounded-[22px] border px-3.5 py-3 shadow-[0_12px_24px_rgba(15,23,42,0.05)] transition-[border-color,box-shadow,transform,background-color] md:grid-cols-[minmax(0,1fr)_auto] md:items-center',
                    overdue ? 'border-amber-200 bg-[linear-gradient(180deg,#fffdf7_0%,#fffaf0_100%)] shadow-[0_16px_28px_rgba(245,158,11,0.08)]' : 'border-slate-200 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(248,250,249,0.96))] hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-[0_16px_28px_rgba(15,23,42,0.08)]'
                  )}>
                    <span className={cn('absolute inset-y-0 left-0 w-1.5 rounded-l-[22px]', task.status === 'done' ? 'bg-emerald-400' : overdue ? 'bg-amber-400' : task.priority === 'high' ? 'bg-rose-300' : task.priority === 'normal' ? 'bg-sky-400' : 'bg-slate-300')} />
                    <div className="grid gap-2 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <strong className="break-words text-[15px] font-bold tracking-[-0.03em] text-slate-950 md:text-base">{task.title}</strong>
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

                    <div className="flex flex-wrap items-center justify-end gap-1.5 md:w-[220px] md:content-start">
                      <button
                        type="button"
                        onClick={() => toggleTaskStatus(task)}
                        disabled={updating}
                        className={cn(
                          'inline-flex min-h-9 w-full items-center justify-center rounded-full border px-3 py-1.5 text-sm font-semibold transition',
                          task.status === 'done'
                            ? 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
                            : 'border-emerald-800 bg-emerald-800 text-white hover:bg-emerald-900',
                          updating ? 'cursor-wait opacity-70' : ''
                        )}
                      >
                        {updating ? 'Sparar…' : task.status === 'done' ? 'Öppna igen' : 'Markera klar'}
                      </button>
                      <button
                        type="button"
                        onClick={() => openEditModal(task)}
                        className="inline-flex min-h-9 w-full items-center justify-center rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-600 shadow-[0_8px_16px_rgba(15,23,42,0.04)] transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900"
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
            className="grid w-full max-w-[760px] gap-4 rounded-[28px] border border-white/70 bg-[linear-gradient(180deg,#ffffff_0%,#f6faf8_100%)] p-4 shadow-[0_30px_80px_rgba(15,23,42,0.28)] sm:max-h-[88vh] sm:overflow-y-auto sm:p-5"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="grid gap-1">
                <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">CRM / Uppgifter</span>
                <strong className="text-[1.5rem] font-bold tracking-[-0.05em] text-slate-950">{draft.title || 'Planera nästa steg'}</strong>
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
                className="inline-flex min-h-10 items-center justify-center rounded-full border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 shadow-[0_10px_18px_rgba(15,23,42,0.04)] hover:border-slate-300 hover:text-slate-900"
              >
                Stäng
              </button>
            </div>

            <div className="grid gap-4 rounded-[28px] border border-white/80 bg-white/92 p-4 shadow-[0_20px_44px_rgba(15,23,42,0.06)]">
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

              <div className="grid gap-3 rounded-[24px] border border-slate-200/85 bg-[linear-gradient(180deg,rgba(250,253,250,0.85),rgba(244,249,245,0.9))] p-3 shadow-[0_12px_24px_rgba(15,23,42,0.04)] sm:grid-cols-3">
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
                <label className="grid gap-1 text-sm text-slate-600 sm:col-span-3">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Källa</span>
                  <Input value={draft.source} onChange={(event) => setDraft((current) => ({ ...current, source: event.target.value }))} placeholder="Källa, t.ex. samtal eller manuell" />
                </label>
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
                  className="inline-flex min-h-11 items-center justify-center rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-slate-50"
                >
                  Avbryt
                </button>
                <button
                  type="button"
                  onClick={saveTask}
                  disabled={submitting}
                  className="inline-flex min-h-11 items-center justify-center rounded-full border border-slate-900 bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-950 disabled:cursor-not-allowed disabled:opacity-60"
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