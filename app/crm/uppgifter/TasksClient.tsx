"use client";

import { useEffect, useMemo, useState } from 'react';
import Input from '../../../components/ui/Input';
import Select from '../../../components/ui/Select';
import Textarea from '../../../components/ui/Textarea';
import CrmModal from '../components/CrmModal';
import EntityCombobox, { type EntityResult } from '../components/EntityCombobox';
import { useToast } from '@/lib/Toast';
import { cn } from '@/lib/shared/cn';
import { crm } from '@/app/crm/lib/crmTokens';

type QuoteLite = {
  id: string;
  project_name: string;
  quote_number: string | null;
};

function quoteLabel(q: QuoteLite): string {
  return q.quote_number ? `${q.project_name} (#${q.quote_number})` : q.project_name;
}

type CrmRelatedType = 'crm_prospect' | 'crm_customer' | 'crm_quote';

const relatedTypeLabel: Record<CrmRelatedType, string> = {
  crm_prospect: 'Prospekt',
  crm_customer: 'Kund',
  crm_quote: 'Offert',
};

type TaskItem = {
  id: string;
  related_type: CrmRelatedType | null;
  related_id: string | null;
  related_label: string | null;
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
  related_type: '' | CrmRelatedType;
  related_id: string;
  related_label: string;
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
  related_type: '',
  related_id: '',
  related_label: '',
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
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [updatingTaskIds, setUpdatingTaskIds] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<TaskFilter>('all');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [draft, setDraft] = useState<TaskDraft>(initialDraft);

  // Debounced server-side search for the relation picker — scales to any table size
  // (vs. preloading every customer/quote into a <select>).
  async function searchRelated(query: string): Promise<EntityResult[]> {
    if (draft.related_type === 'crm_customer') {
      const res = await fetch(`/api/crm/customers/search?q=${encodeURIComponent(query)}`, { cache: 'no-store' });
      const json = await res.json().catch(() => ({}));
      const items = json?.ok && Array.isArray(json?.data?.items) ? json.data.items : [];
      return items.map((c: { id: string; display_name: string; organization_number: string | null; city: string | null }) => ({
        id: c.id,
        label: c.display_name || 'Okänd kund',
        sublabel: [c.organization_number, c.city].filter(Boolean).join(' · ') || undefined,
      }));
    }
    if (draft.related_type === 'crm_quote') {
      const res = await fetch(`/api/crm/quotes?q=${encodeURIComponent(query)}`, { cache: 'no-store' });
      const json = await res.json().catch(() => ({}));
      const items = json?.ok && Array.isArray(json?.data?.items) ? json.data.items : [];
      return items.map((q: QuoteLite & { customer_name: string | null }) => ({
        id: q.id,
        label: quoteLabel(q),
        sublabel: q.customer_name || undefined,
      }));
    }
    if (draft.related_type === 'crm_prospect') {
      const res = await fetch(`/api/crm/prospects?q=${encodeURIComponent(query)}`, { cache: 'no-store' });
      const json = await res.json().catch(() => ({}));
      const items = json?.ok && Array.isArray(json?.data?.items) ? json.data.items : [];
      return items.map((p: { id: string; company_name: string; contact_name: string | null; city: string | null }) => ({
        id: p.id,
        label: p.company_name,
        sublabel: [p.contact_name, p.city].filter(Boolean).join(' · ') || undefined,
      }));
    }
    return [];
  }

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const query = new URLSearchParams();
        if (search.trim()) query.set('q', search.trim());

        // Linked entities (customer/quote/prospect) are searched on demand in the
        // modal via EntityCombobox, so the list view only needs the tasks themselves.
        const tasksRes = await fetch(`/api/crm/tasks${query.size > 0 ? `?${query.toString()}` : ''}`, { cache: 'no-store' });
        const tasksJson = await tasksRes.json().catch(() => ({}));

        if (!active) return;

        if (!tasksRes.ok || !tasksJson.ok) {
          setError(tasksJson?.error || 'Kunde inte ladda uppgifter.');
          setTasks([]);
          return;
        }

        setTasks(Array.isArray(tasksJson?.data?.items) ? tasksJson.data.items : []);
      } catch {
        if (!active) return;
        setError('Kunde inte ladda uppgifter.');
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

  const filterCounts = useMemo(() => ({
    all: tasks.length,
    open: tasks.filter((task) => task.status === 'open').length,
    overdue: tasks.filter((task) => isOverdue(task)).length,
    done: tasks.filter((task) => task.status === 'done').length,
  }), [tasks]);

  // Active filter count — shown as a badge on the mobile filter toggle.
  const activeFilterCount = filter !== 'all' ? 1 : 0;

  function openCreateModal() {
    setEditingTaskId(null);
    setDraft(initialDraft);
    setModalOpen(true);
  }

  function openEditModal(task: TaskItem) {
    setEditingTaskId(task.id);
    setDraft({
      related_type: task.related_type || '',
      related_id: task.related_id || '',
      related_label: task.related_label || '',
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
          related_type: task.related_type,
          related_id: task.related_id,
          related_label: task.related_label,
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


      {/* ── List card ── */}
      <div className={crm.card}>

        {/* Toolbar */}
        <div className="grid gap-3 border-b border-slate-100 px-5 py-3">
          {/* Search + mobile filter toggle */}
          <div className="flex items-center gap-2">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Sök på titel, prospekt eller källa…"
              className="flex-1 sm:w-64 sm:flex-none"
            />
            <button
              type="button"
              onClick={() => setFiltersOpen((o) => !o)}
              aria-expanded={filtersOpen}
              aria-label="Filter"
              className={cn(
                'relative inline-flex h-[2.6rem] w-[2.6rem] shrink-0 items-center justify-center !rounded-lg !border !p-0 transition sm:hidden',
                filtersOpen || activeFilterCount > 0 ? '!border-emerald-500 !bg-emerald-50 text-emerald-700' : '!border-[#dce4d8] !bg-white text-slate-600',
              )}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M4 6h16M7 12h10M10 18h4" />
              </svg>
              {activeFilterCount > 0 ? (
                <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-emerald-600 px-1 text-[10px] font-bold text-white">{activeFilterCount}</span>
              ) : null}
            </button>
          </div>

          {/* Filter chips — collapsible on mobile, inline on desktop */}
          <div className={cn('flex-wrap gap-1.5 sm:flex', filtersOpen ? 'flex' : 'hidden')}>
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
                <div key={i} className="h-20 animate-pulse rounded-lg border border-[#e3e9df] bg-[#dfe6da]" />
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
                const linkLabel = task.related_label;
                const overdue = isOverdue(task);
                const updating = updatingTaskIds.includes(task.id);

                return (
                  <div
                    key={task.id}
                    className={cn(
                      'relative grid gap-3 overflow-hidden rounded-lg border px-4 py-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.05)] transition md:grid-cols-[1fr_auto] md:items-center',
                      overdue
                        ? 'border-amber-200 bg-amber-50/40'
                        : 'border-[#e3e9df] bg-white hover:border-[#cfdcc9]',
                      task.status === 'done' && 'opacity-60',
                    )}
                  >
                    {/* Priority / status strip */}
                    <span className={cn(
                      'absolute inset-y-0 left-0 w-1.5',
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
                        {linkLabel && task.related_type && <span>{relatedTypeLabel[task.related_type]}: {linkLabel}</span>}
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
        <CrmModal
          onClose={closeModal}
          ariaLabel={editingTaskId ? 'Redigera uppgift' : 'Ny uppgift'}
          maxWidth="sm:max-w-[720px]"
          header={
            <>
              <h2 className="text-lg font-bold text-slate-900">{editingTaskId ? 'Redigera uppgift' : 'Ny uppgift'}</h2>
              <p className={cn('mt-0.5', crm.pageSubtitle)}>Fånga uppföljningar utan att lämna CRM-flödet.</p>
            </>
          }
          footer={
            <>
              <button
                type="button"
                onClick={closeModal}
                className="flex-1 rounded-xl border border-slate-200 bg-white py-2.5 text-sm font-semibold text-slate-600 transition hover:border-slate-300 sm:flex-none sm:px-5"
              >
                Avbryt
              </button>
              <button
                type="button"
                onClick={saveTask}
                disabled={submitting}
                className="flex-1 rounded-xl py-2.5 text-sm font-semibold text-white shadow-sm transition hover:brightness-95 disabled:opacity-60 sm:ml-auto sm:flex-none sm:px-5"
                style={{ backgroundColor: 'var(--crm-primary)' }}
              >
                {submitting ? 'Sparar…' : editingTaskId ? 'Spara ändringar' : 'Skapa uppgift'}
              </button>
            </>
          }
        >
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
                  <p className={cn('mb-1.5', crm.sectionTitle)}>Koppling</p>
                  <Select
                    value={draft.related_type}
                    onChange={(e) => setDraft((c) => ({ ...c, related_type: e.target.value as TaskDraft['related_type'], related_id: '', related_label: '' }))}
                  >
                    <option value="">Ingen koppling</option>
                    <option value="crm_customer">Kund</option>
                    <option value="crm_quote">Offert</option>
                    <option value="crm_prospect">Prospekt</option>
                  </Select>
                </div>

                <div>
                  <p className={cn('mb-1.5', crm.sectionTitle)}>
                    {draft.related_type ? relatedTypeLabel[draft.related_type] : 'Post'}
                  </p>
                  <EntityCombobox
                    value={draft.related_id}
                    valueLabel={draft.related_label}
                    onChange={(id, label) => setDraft((c) => ({ ...c, related_id: id, related_label: label }))}
                    onClear={() => setDraft((c) => ({ ...c, related_id: '', related_label: '' }))}
                    search={searchRelated}
                    disabled={!draft.related_type}
                    placeholder={draft.related_type ? `Sök ${relatedTypeLabel[draft.related_type].toLowerCase()}…` : 'Välj koppling först'}
                  />
                </div>
              </div>

              <div>
                <p className={cn('mb-1.5', crm.sectionTitle)}>Status</p>
                <Select
                  value={draft.status}
                  onChange={(e) => setDraft((c) => ({ ...c, status: e.target.value as TaskItem['status'] }))}
                >
                  <option value="open">Öppen</option>
                  <option value="done">Klar</option>
                </Select>
              </div>

              <div className="grid gap-4 rounded-xl border border-[#e3e9df] bg-[#f6f9f3] p-4 sm:grid-cols-3">
                <div>
                  <p className={cn('mb-1.5', crm.sectionTitle)}>Prioritet</p>
                  <Select
                    value={draft.priority}
                    onChange={(e) => setDraft((c) => ({ ...c, priority: e.target.value as TaskItem['priority'] }))}
                  >
                    <option value="low">Låg</option>
                    <option value="normal">Normal</option>
                    <option value="high">Hög</option>
                  </Select>
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
        </CrmModal>
      )}
    </div>
  );
}
