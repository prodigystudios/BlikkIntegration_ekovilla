"use client";

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Input from '../../../components/ui/Input';
import { useToast } from '@/lib/Toast';
import { cn } from '@/lib/shared/cn';
import { crm } from '@/app/crm/lib/crmTokens';
import TaskFormModal from '@/app/crm/components/TaskFormModal';
// Formuläret och dess typer är delade med offertpanelens uppgiftskort — ETT formulär, två
// ingångar. Se app/crm/lib/taskForm.ts.
import { buildTaskStatusTogglePayload, relatedTypeLabel, type TaskItem } from '@/app/crm/lib/taskForm';

// 'delegated' är inte ett filter på samma lista utan en egen hämtning: uppgifterna tillhör
// mottagaren och ligger utanför den inloggades RLS-vy.
type TaskFilter = 'all' | 'open' | 'overdue' | 'done' | 'delegated';

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

function isOverdue(task: TaskItem) {
  if (task.status === 'done' || !task.due_date) return false;
  const today = new Date();
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  return task.due_date < todayIso;
}

export default function TasksClient({ canDelegate = false }: { canDelegate?: boolean }) {
  const toast = useToast();
  const searchParams = useSearchParams();
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingTaskIds, setUpdatingTaskIds] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<TaskFilter>('all');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // null = stängd. `{ task: null }` = skapa, `{ task }` = redigera. Formuläret bor i
  // TaskFormModal och äger sitt eget utkast — den här sidan säger bara VAD som ska redigeras.
  const [formTarget, setFormTarget] = useState<{ task: TaskItem | null } | null>(null);
  // Säljarkatalogen bakom "Från: X" på en uppgift man FÅTT. Hämtas av alla: det är mottagaren
  // som mest behöver veta vem som lagt uppgiften på hen, och utan katalogen hade hen bara sett
  // ett uuid. (Modalen hämtar sin egen katalog till mottagarväljaren, och bara när den öppnas.)
  const [sellers, setSellers] = useState<{ id: string; full_name: string | null }[]>([]);
  const [sellersLoaded, setSellersLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    fetch('/api/crm/sellers', { cache: 'no-store' })
      .then((r) => r.json().catch(() => ({})))
      .then((json) => {
        if (!active) return;
        setSellers(json?.ok ? json.data?.sellers || [] : []);
        setSellersLoaded(Boolean(json?.ok));
      })
      .catch(() => { if (active) setSellers([]); });
    return () => { active = false; };
  }, []);

  const sellerNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const seller of sellers) if (seller.full_name) map.set(seller.id, seller.full_name);
    return map;
  }, [sellers]);

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const query = new URLSearchParams();
        if (search.trim()) query.set('q', search.trim());
        // Delegerade uppgifter är en EGEN hämtning, inte ett filter över den vanliga listan:
        // de tillhör mottagaren och kommer aldrig med i den inloggades egna rader.
        if (filter === 'delegated') query.set('scope', 'delegated');

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
    // filter är med som beroende BARA för att 'delegated' byter datakälla — de övriga filtren
    // är rena klientfilter över samma hämtning och ska inte kosta en ny request.
  }, [search, filter === 'delegated']); // eslint-disable-line react-hooks/exhaustive-deps

  // Deep-link: open a specific task's edit modal when arriving with ?task_id=
  // (e.g. from a customer's related list). Handled once the task is loaded.
  const presetTaskId = searchParams.get('task_id') || '';
  const [hasHandledTaskPreset, setHasHandledTaskPreset] = useState(false);
  useEffect(() => { setHasHandledTaskPreset(false); }, [presetTaskId]);
  useEffect(() => {
    if (!presetTaskId || hasHandledTaskPreset || loading) return;
    const task = tasks.find((t) => t.id === presetTaskId);
    if (!task) return;
    openEditModal(task);
    setHasHandledTaskPreset(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetTaskId, hasHandledTaskPreset, loading, tasks]);

  const visibleTasks = useMemo(() => {
    // 'delegated' har redan hämtat exakt de rader som ska visas — ett klientfilter här hade
    // filtrerat bort dem allihop, eftersom de per definition inte är den inloggades egna.
    if (filter === 'all' || filter === 'delegated') return tasks;
    if (filter === 'done') return tasks.filter((task) => task.status === 'done');
    if (filter === 'overdue') return tasks.filter((task) => isOverdue(task));
    return tasks.filter((task) => task.status === 'open');
  }, [filter, tasks]);

  // Räknarna beskriver den hämtade listan. I den delegerade vyn är det en annan lista, så de
  // nollas hellre än visar siffror som gäller något annat.
  const filterCounts = useMemo(() => (filter === 'delegated' ? { all: 0, open: 0, overdue: 0, done: 0 } : {
    all: tasks.length,
    open: tasks.filter((task) => task.status === 'open').length,
    overdue: tasks.filter((task) => isOverdue(task)).length,
    done: tasks.filter((task) => task.status === 'done').length,
  }), [tasks, filter]);

  // Active filter count — shown as a badge on the mobile filter toggle.
  const activeFilterCount = filter !== 'all' ? 1 : 0;

  function openCreateModal() {
    setFormTarget({ task: null });
  }

  function openEditModal(task: TaskItem) {
    setFormTarget({ task });
  }

  /**
   * Den sparade raden tillbaka från formuläret.
   *
   * ⚠️ Den nya raden läggs bara till om den hör hemma i den lista som visas. En uppgift man lagt
   * på någon annan tillhör MOTTAGAREN — hade den lagts först i den egna listan skulle den räknats
   * bland ens egna öppna uppgifter och märkts "Från: <sig själv>" tills nästa omladdning. Samma
   * sak omvänt: en egen uppgift hör inte hemma i "Jag har lagt ut".
   */
  function applySavedTask(item: TaskItem, { isEditing }: { isEditing: boolean }) {
    const belongsInView = filter === 'delegated' ? item.delegated : !item.delegated;
    setTasks((current) => {
      if (isEditing) return current.map((entry) => (entry.id === item.id ? item : entry));
      return belongsInView ? [item, ...current] : current;
    });
    toast.success(
      isEditing ? 'Uppgift uppdaterad'
        : item.delegated ? 'Uppgift skapad och notis skickad — finns under "Jag har lagt ut"'
        : 'Uppgift skapad',
    );
  }

  async function toggleTaskStatus(task: TaskItem) {
    const nextStatus = task.status === 'done' ? 'open' : 'done';
    setUpdatingTaskIds((current) => [...current, task.id]);

    try {
      const res = await fetch(`/api/crm/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        // Delad med offertpanelens uppgiftskort. Bär normaliseringen av `remind_at` — utan den
        // gick en uppgift med påminnelse inte att bocka av härifrån heller.
        body: JSON.stringify(buildTaskStatusTogglePayload(task, nextStatus)),
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
    <div className="grid grid-cols-1 gap-4">

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
        <div className="grid gap-3 border-b border-slate-100 px-4 py-2.5">
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
                'relative inline-flex h-[2.6rem] w-[2.6rem] shrink-0 items-center justify-center rounded-lg border p-0 transition sm:hidden',
                filtersOpen || activeFilterCount > 0 ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-[#dce4d8] bg-white text-slate-600',
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
              // Bara för den som kan delegera — för alla andra är listan alltid tom.
              ...(canDelegate ? [['delegated', 'Jag har lagt ut'] as [TaskFilter, string]] : []),
            ] as Array<[TaskFilter, string]>).map(([value, label]) => {
              const isActive = filter === value;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => setFilter(value)}
                  className={cn(
                    'inline-flex shrink-0 items-center gap-1.5 rounded-xl border px-2.5 py-1 text-[13px] font-semibold transition',
                    isActive
                      ? 'border-transparent text-white'
                      : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300',
                  )}
                  style={isActive ? { backgroundColor: 'var(--crm-primary)' } : undefined}
                >
                  {label}
                  {/* Den delegerade vyn är en egen hämtning — en siffra ur den vanliga listan
                      hade beskrivit fel uppsättning rader. Hellre ingen siffra än en som ljuger. */}
                  {value === 'delegated' ? null : (
                    <span className={cn(
                      'rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums',
                      isActive ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-600',
                    )}>
                      {filterCounts[value as keyof typeof filterCounts]}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Content */}
        <div className="p-2.5">
          {error ? (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
          ) : loading ? (
            <div className="grid gap-2">
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
            <div className="grid gap-1.5">
              {visibleTasks.map((task) => {
                const linkLabel = task.related_label;
                const overdue = isOverdue(task);
                const updating = updatingTaskIds.includes(task.id);

                return (
                  <div
                    key={task.id}
                    className={cn(
                      'relative grid gap-2 overflow-hidden rounded-lg border px-2.5 py-2 shadow-[0_1px_2px_rgba(15,23,42,0.05)] transition md:grid-cols-[1fr_auto] md:items-center',
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
                        <strong className="text-[13px] font-semibold text-slate-900">{task.title}</strong>
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
                        {/* En delegerad uppgift måste säga varifrån den kommer. Samma rad dyker
                            dessutom upp bland mottagarens egna dashboard-anteckningar (samma
                            tabell, samma kind), och utan avsändare läses den som något hen själv
                            skrivit och inte minns.

                            Vilket namn som är intressant beror på vilken sida man står på: i den
                            delegerade vyn är det MOTTAGAREN, i sin egen lista AVSÄNDAREN. */}
                        {task.delegated ? (
                          <span className={cn(crm.badge, 'border-sky-200 bg-sky-50 text-sky-700')}>
                            {filter === 'delegated'
                              ? `Åt: ${sellerNameById.get(task.user_id) ?? (sellersLoaded ? 'okänd' : '…')}`
                              : `Från: ${(task.created_by && sellerNameById.get(task.created_by)) ?? (sellersLoaded ? 'en kollega' : '…')}`}
                          </span>
                        ) : null}
                      </div>

                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-slate-500">
                        <span>Deadline: {formatDate(task.due_date)}</span>
                        {task.remind_at && <span>Påminnelse: {formatDateTime(task.remind_at)}</span>}
                        {linkLabel && task.related_type && <span>{relatedTypeLabel[task.related_type]}: {linkLabel}</span>}
                        {task.source && <span>Källa: {task.source}</span>}
                      </div>

                      {task.details && (
                        <p className="mt-1.5 line-clamp-2 text-sm text-slate-500">{task.details}</p>
                      )}
                    </div>

                    {/* Actions.
                        Den delegerade vyn är LÄSVY. Raderna tillhör mottagaren, och både PATCH
                        och DELETE kör på sessionsklienten mot en tabell vars RLS är egen-bara —
                        varje knapptryck här hade matchat noll rader och gett ett 500-fel. Att
                        visa knappar som inte kan fungera är sämre än att inte visa dem: uppgiften
                        är säljarens att göra klar, chefens att följa. */}
                    <div className="flex flex-wrap items-center gap-2 md:w-36 md:flex-col md:items-stretch">
                      {filter === 'delegated' ? (
                        <p className="text-[11px] leading-snug text-slate-400 md:text-right">
                          {task.status === 'done' ? 'Avklarad av säljaren' : 'Väntar på säljaren'}
                        </p>
                      ) : (
                      <>
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
                      </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Formulär ──
          Delas med offertpanelens uppgiftskort (app/crm/components/TaskFormModal.tsx). Den här
          sidan lägger ingen låst koppling: härifrån ska man kunna peka uppgiften vart som helst. */}
      {formTarget ? (
        <TaskFormModal
          task={formTarget.task}
          canDelegate={canDelegate}
          onClose={() => setFormTarget(null)}
          onSaved={applySavedTask}
        />
      ) : null}
    </div>
  );
}
