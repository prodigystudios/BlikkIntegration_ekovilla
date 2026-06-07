"use client";

import { useEffect, useMemo, useState } from 'react';
import Input from '../../../components/ui/Input';
import Textarea from '../../../components/ui/Textarea';
import MetricCard from '../components/MetricCard';
import { useToast } from '@/lib/Toast';
import { cn } from '@/lib/shared/cn';
import { crm } from '@/app/crm/lib/crmTokens';

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

const stripClass: Record<string, string> = {
  done: 'bg-emerald-400',
  overdue: 'bg-amber-400',
  high: 'bg-rose-400',
  normal: 'bg-sky-400',
  low: 'bg-slate-300',
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

  const stats = useMemo(() => ({
    open: tasks.filter((task) => task.status === 'open').length,
    overdue: tasks.filter((task) => isOverdue(task)).length,
    done: tasks.filter((task) => task.status === 'done').length,
  }), [tasks]);

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
          if (isEditing) return current.map((entry) => (entry.id === item.id ? item : entry));
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

  function closeModal() {
    setModalOpen(false);
    setEditingTaskId(null);
    setDraft(initialDraft);
  }

  return (
    <div className="grid grid-cols-1 gap-6">

      {/* ── Header ── */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className={crm.pageTitle}>Uppgifter</h1>
          <p className={cn('mt-0.5', crm.pageSubtitle)}>
            Håll koll på nästa steg, det som är förfallet och vad som kan stängas direkt.
          </p>
        </div>
        <button
          type="button"
          onClick={openCreateModal}
          className={crm.primaryButton}
          style={{ backgroundColor: 'var(--crm-primary)' }}
        >
          <span aria-hidden>+</span> Ny uppgift
        </button>
      </div>

      {/* ── Metrics ── */}
      <div className="hidden gap-4 sm:grid sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Öppna" value={stats.open} helper="Aktiva uppgifter att jobba med" />
        <MetricCard label="Förfallna" value={stats.overdue} helper="Behöver åtgärdas först" />
        <MetricCard label="Klara" value={stats.done} helper="Färdiga uppföljningar" />
        <MetricCard label="I vy" value={visibleTasks.length} helper="Matchar sök och filter" />
      </div>

      {/* ── List card ── */}
      <div className={crm.card}>

        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-5 py-3">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Sök på titel, prospekt eller källa…"
            className="w-full sm:w-64"
          />
          <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto [-webkit-overflow-scrolling:touch]">
            {([
              ['all', 'Alla'],
              ['open', 'Öppna'],
              ['overdue', 'Förfallna'],
              ['done', 'Klara'],
            ] as Array<[TaskFilter, string]>).map(([value, label]) => {
              const isActive = filter === value;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => setFilter(value)}
                  className={cn(
                    'inline-flex shrink-0 items-center gap-1.5 rounded-xl border px-3 py-1.5 text-sm font-semibold transition',
                    isActive
                      ? 'border-transparent text-white'
                      : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300',
                  )}
                  style={isActive ? { backgroundColor: 'var(--crm-primary)' } : undefined}
                >
                  {label}
                  <span className={cn(
                    'rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums',
                    isActive ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500',
                  )}>
                    {filterCounts[value]}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Content */}
        <div className="p-4">
          {error ? (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
          ) : loading ? (
            <div className="grid gap-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-20 animate-pulse rounded-2xl border border-slate-100 bg-[#dfe6da]" />
              ))}
            </div>
          ) : visibleTasks.length === 0 ? (
            <div className="py-10 text-center">
              <strong className="block text-sm font-bold text-slate-800">Inga uppgifter i det här filtret</strong>
              <p className="mt-1 text-sm text-slate-500">Skapa en ny uppgift med knappen ovan eller byt filter.</p>
            </div>
          ) : (
            <div className="grid gap-2.5">
              {visibleTasks.map((task) => {
                const prospect = task.prospect_id ? prospectsById.get(task.prospect_id) || null : null;
                const overdue = isOverdue(task);
                const updating = updatingTaskIds.includes(task.id);

                return (
                  <div
                    key={task.id}
                    className={cn(
                      'relative grid gap-3 overflow-hidden rounded-2xl border px-4 py-3.5 transition md:grid-cols-[1fr_auto] md:items-center',
                      overdue
                        ? 'border-amber-200 bg-amber-50/40'
                        : 'border-slate-200 bg-white hover:border-slate-300',
                      task.status === 'done' && 'opacity-60',
                    )}
                  >
                    {/* Priority / status strip */}
                    <span className={cn(
                      'absolute inset-y-0 left-0 w-1 rounded-l-2xl',
                      task.status === 'done' ? stripClass.done
                        : overdue ? stripClass.overdue
                        : stripClass[task.priority],
                    )} />

                    {/* Main content */}
                    <div className="min-w-0 pl-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <strong className="text-sm font-semibold text-slate-900">{task.title}</strong>
                        <span className={cn(crm.badge, priorityMeta[task.priority].className)}>
                          {priorityMeta[task.priority].label}
                        </span>
                        {overdue && (
                          <span className={cn(crm.badge, 'border-amber-200 bg-amber-50 text-amber-700')}>
                            Förfallen
                          </span>
                        )}
                        {task.status === 'done' && (
                          <span className={cn(crm.badge, 'border-emerald-200 bg-emerald-50 text-emerald-700')}>
                            Klar
                          </span>
                        )}
                      </div>

                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-500">
                        <span>Deadline: {formatDate(task.due_date)}</span>
                        {task.remind_at && <span>Påminnelse: {formatDateTime(task.remind_at)}</span>}
                        {prospect?.company_name && <span>Prospekt: {prospect.company_name}</span>}
                        {task.source && <span>Källa: {task.source}</span>}
                      </div>

                      {task.details && (
                        <p className="mt-1.5 line-clamp-2 text-sm text-slate-500">{task.details}</p>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex flex-wrap items-center gap-2 md:w-36 md:flex-col md:items-stretch">
                      <button
                        type="button"
                        onClick={() => toggleTaskStatus(task)}
                        disabled={updating}
                        className={cn(
                          'inline-flex h-9 items-center justify-center rounded-xl border px-3 text-sm font-semibold transition',
                          task.status === 'done'
                            ? 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                            : 'border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700',
                          updating && 'cursor-wait opacity-70',
                        )}
                      >
                        {updating ? 'Sparar…' : task.status === 'done' ? 'Öppna igen' : 'Markera klar'}
                      </button>
                      <button
                        type="button"
                        onClick={() => openEditModal(task)}
                        className={cn(crm.ghostButton, 'w-full justify-center')}
                      >
                        Redigera
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Modal ── */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-[2800] flex items-end justify-center bg-slate-950/45 p-3 [backdrop-filter:blur(4px)] sm:items-center sm:p-4"
          onClick={closeModal}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={editingTaskId ? 'Redigera uppgift' : 'Ny uppgift'}
            onClick={(e) => e.stopPropagation()}
            className="grid w-full max-w-[720px] gap-5 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_30px_80px_rgba(15,23,42,0.24)] sm:max-h-[88vh]"
          >
            {/* Modal header */}
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-bold text-slate-900">
                  {editingTaskId ? 'Redigera uppgift' : 'Ny uppgift'}
                </h2>
                <p className={cn('mt-0.5', crm.pageSubtitle)}>
                  Fånga uppföljningar utan att lämna CRM-flödet.
                </p>
              </div>
              <button type="button" onClick={closeModal} className={crm.ghostButton}>
                Stäng
              </button>
            </div>

            {/* Form fields */}
            <div className="grid gap-4">
              <div>
                <p className={cn('mb-1.5', crm.sectionTitle)}>Titel</p>
                <Input
                  value={draft.title}
                  onChange={(e) => setDraft((c) => ({ ...c, title: e.target.value }))}
                  placeholder="Titel på uppgiften"
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <p className={cn('mb-1.5', crm.sectionTitle)}>Prospekt</p>
                  <select
                    value={draft.prospect_id}
                    onChange={(e) => setDraft((c) => ({ ...c, prospect_id: e.target.value }))}
                    className="min-h-11 w-full rounded-lg border border-[#dce4d8] bg-white px-3 py-2 text-sm text-slate-900 transition-colors focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                  >
                    <option value="">Inget prospekt valt</option>
                    {prospects.map((p) => (
                      <option key={p.id} value={p.id}>{p.company_name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <p className={cn('mb-1.5', crm.sectionTitle)}>Status</p>
                  <select
                    value={draft.status}
                    onChange={(e) => setDraft((c) => ({ ...c, status: e.target.value as TaskItem['status'] }))}
                    className="min-h-11 w-full rounded-lg border border-[#dce4d8] bg-white px-3 py-2 text-sm text-slate-900 transition-colors focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                  >
                    <option value="open">Öppen</option>
                    <option value="done">Klar</option>
                  </select>
                </div>
              </div>

              <div className="grid gap-4 rounded-2xl border border-slate-100 bg-slate-50/60 p-4 sm:grid-cols-3">
                <div>
                  <p className={cn('mb-1.5', crm.sectionTitle)}>Prioritet</p>
                  <select
                    value={draft.priority}
                    onChange={(e) => setDraft((c) => ({ ...c, priority: e.target.value as TaskItem['priority'] }))}
                    className="min-h-11 w-full rounded-lg border border-[#dce4d8] bg-white px-3 py-2 text-sm text-slate-900 transition-colors focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                  >
                    <option value="low">Låg</option>
                    <option value="normal">Normal</option>
                    <option value="high">Hög</option>
                  </select>
                </div>
                <div>
                  <p className={cn('mb-1.5', crm.sectionTitle)}>Deadline</p>
                  <Input
                    value={draft.due_date}
                    onChange={(e) => setDraft((c) => ({ ...c, due_date: e.target.value }))}
                    type="date"
                  />
                </div>
                <div>
                  <p className={cn('mb-1.5', crm.sectionTitle)}>Påminnelse</p>
                  <Input
                    value={draft.remind_at}
                    onChange={(e) => setDraft((c) => ({ ...c, remind_at: e.target.value }))}
                    type="datetime-local"
                  />
                </div>
                <div className="sm:col-span-3">
                  <p className={cn('mb-1.5', crm.sectionTitle)}>Källa</p>
                  <Input
                    value={draft.source}
                    onChange={(e) => setDraft((c) => ({ ...c, source: e.target.value }))}
                    placeholder="t.ex. samtal eller manuell"
                  />
                </div>
              </div>

              <div>
                <p className={cn('mb-1.5', crm.sectionTitle)}>Beskrivning</p>
                <Textarea
                  value={draft.details}
                  onChange={(e) => setDraft((c) => ({ ...c, details: e.target.value }))}
                  placeholder="Vad ska följas upp och varför?"
                  className="min-h-[120px]"
                />
              </div>
            </div>

            {/* Modal actions */}
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 pt-4">
              <button type="button" onClick={closeModal} className={crm.ghostButton}>
                Avbryt
              </button>
              <button
                type="button"
                onClick={saveTask}
                disabled={submitting}
                className={cn(crm.saveButton, 'h-9 w-auto px-5')}
              >
                {submitting ? 'Sparar…' : editingTaskId ? 'Spara ändringar' : 'Skapa uppgift'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
