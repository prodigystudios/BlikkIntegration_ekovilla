"use client";
import { useEffect, useState } from 'react';
import Input from '@/components/ui/Input';
import { cn } from '@/lib/shared/cn';
import { useToast } from '@/lib/Toast';

// Uppgiftsflödet på en offert — läsning av ALLA uppgifter som hör till offerten, plus ett
// snabbformulär som lägger en ny på en själv.
//
// Egen fil och inte inline i QuoteDetailPanel: panelen är redan 600+ rader och handlar om
// offertens status och dokument. Det här är en självständig yta med egen hämtning, egen
// felhantering och egen optimistiska uppdatering.
//
// ⚠️ Skrivningen går genom de BEFINTLIGA uppgiftsrutterna (POST /api/crm/tasks,
// PATCH /api/crm/tasks/[id]). Ingen ny skrivväg, ingen ny behörighetslogik. Läsningen har en egen
// route eftersom den betyder något annat än "mina uppgifter" — se
// app/api/crm/quotes/[id]/tasks/route.ts.

export type QuoteTask = {
  id: string;
  user_id: string;
  created_by: string | null;
  delegated: boolean;
  assignee_name: string | null;
  creator_name: string | null;
  related_type: 'crm_prospect' | 'crm_customer' | 'crm_quote' | null;
  related_id: string | null;
  related_label: string | null;
  title: string;
  details: string | null;
  status: 'open' | 'done' | 'cancelled';
  priority: 'low' | 'normal' | 'high';
  due_date: string | null;
  remind_at: string | null;
  source: string | null;
  created_at: string;
};

const priorityMeta: Record<QuoteTask['priority'], { label: string; className: string }> = {
  low: { label: 'Låg', className: 'border-slate-200 bg-slate-100 text-slate-600' },
  normal: { label: 'Normal', className: 'border-sky-200 bg-sky-50 text-sky-700' },
  high: { label: 'Hög', className: 'border-rose-200 bg-rose-50 text-rose-700' },
};

function todayIso() {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
}

function formatDueDate(value: string) {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('sv-SE', { dateStyle: 'medium' }).format(date);
}

function isOverdue(task: QuoteTask) {
  if (task.status !== 'open' || !task.due_date) return false;
  return task.due_date < todayIso();
}

/**
 * Samma ordning som servern ger: öppna före avslutade, sedan närmast förfallodatum, sedan nyast.
 *
 * Används vid inläsning och när en uppgift SKAPAS — den nya raden måste hamna på sin rätta plats
 * och inte sist bara för att den var sist att komma.
 *
 * ⚠️ Körs medvetet INTE när man bockar av. Raden man just klickade på skulle då hoppa iväg under
 * fingret, och listan är kort nog att ordningen inte hinner bli fel innan panelen stängs. Samma
 * val som uppgiftssidan gör.
 */
function sortTasks(tasks: QuoteTask[]): QuoteTask[] {
  const rank = (t: QuoteTask) => (t.status === 'done' ? 2 : t.status === 'cancelled' ? 1 : 0);
  return [...tasks].sort((a, b) => {
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    if (a.due_date !== b.due_date) {
      if (!a.due_date) return 1;
      if (!b.due_date) return -1;
      return a.due_date < b.due_date ? -1 : 1;
    }
    return a.created_at < b.created_at ? 1 : -1;
  });
}

export default function QuoteTasksCard({
  quoteId,
  quoteLabel,
  currentUserId,
  canWrite,
}: {
  quoteId: string;
  /** Etiketten som fryses på uppgiften. Byggs av den delade quoteLabel() i quoteDisplay.ts. */
  quoteLabel: string;
  /** Avgör vad som är MIN uppgift. Utan den blir varje rad läsvy — inte fel, bara sämre. */
  currentUserId: string | null;
  /** crm.write. konsult ser flödet men får inget formulär. */
  canWrite: boolean;
}) {
  const toast = useToast();

  const [tasks, setTasks] = useState<QuoteTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [updatingIds, setUpdatingIds] = useState<string[]>([]);

  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadFailed(false);

    fetch(`/api/crm/quotes/${quoteId}/tasks`, { cache: 'no-store' })
      .then((r) => r.json().catch(() => ({})))
      .then((json) => {
        if (cancelled) return;
        if (!json?.ok) { setLoadFailed(true); setTasks([]); return; }
        setTasks(sortTasks(Array.isArray(json.data?.items) ? json.data.items : []));
      })
      .catch(() => { if (!cancelled) { setLoadFailed(true); setTasks([]); } })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [quoteId]);

  /**
   * Bockar av / återöppnar.
   *
   * 🧨 Bara på EGNA rader. PATCH-rutten kör på sessionsklienten, och dashboard_work_items har
   * egen-bara RLS — en PATCH mot en kollegas uppgift träffar noll rader, `.single()` ger PGRST116
   * och rutten svarar 500 med ett obegripligt meddelande. Lös det aldrig genom att elevera PATCH:
   * det vore skrivrätt i någon annans personliga dashboard, medvetet inte byggt.
   *
   * PATCH-schemat är samma som vid skapandet, alltså hela uppgiften — därför skickas fälten
   * tillbaka oförändrade. Utelämnat fält = överskrivet med schemats default.
   */
  async function toggleStatus(task: QuoteTask) {
    const nextStatus = task.status === 'done' ? 'open' : 'done';
    setUpdatingIds((current) => [...current, task.id]);
    setTasks((current) => current.map((t) => (t.id === task.id ? { ...t, status: nextStatus } : t)));

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
      if (!res.ok || !json.ok) throw new Error(json?.error || 'Kunde inte uppdatera uppgiften');
    } catch (e) {
      // Tillbaka till det som faktiskt står i databasen — en kvarlämnad optimistisk bock är
      // värre än inget, för då tror man att uppgiften är avklarad.
      setTasks((current) => current.map((t) => (t.id === task.id ? { ...t, status: task.status } : t)));
      toast.error((e as Error)?.message || 'Kunde inte uppdatera uppgiften');
    } finally {
      setUpdatingIds((current) => current.filter((id) => id !== task.id));
    }
  }

  async function createTask(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed || creating) return;

    setCreating(true);
    try {
      const res = await fetch('/api/crm/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          related_type: 'crm_quote',
          related_id: quoteId,
          related_label: quoteLabel,
          title: trimmed,
          due_date: dueDate || null,
          priority: 'normal',
          status: 'open',
          source: 'crm_quote',
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) throw new Error(json?.error || 'Kunde inte skapa uppgiften');

      // Rutten svarar med den mappade uppgiften, men utan namnen (de sätts bara i läsrutten).
      // Den här är per definition min egen, så namnen behövs inte för att rendera raden rätt.
      const created = json.data?.item as QuoteTask | undefined;
      if (created) {
        setTasks((current) => sortTasks([...current, { ...created, assignee_name: null, creator_name: null }]));
      }
      setTitle('');
      setDueDate('');
    } catch (e) {
      toast.error((e as Error)?.message || 'Kunde inte skapa uppgiften');
    } finally {
      setCreating(false);
    }
  }

  const openCount = tasks.filter((task) => task.status === 'open').length;

  return (
    <div className="rounded-xl border border-[#e3e9df] bg-[#f9fbf7] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-700">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M9 11l2 2 4-4" /><rect x="4" y="4" width="16" height="16" rx="2" />
            </svg>
          </span>
          <div className="grid min-w-0 gap-0.5">
            <span className="text-sm font-semibold text-slate-800">Uppgifter</span>
            <span className="text-xs leading-5 text-slate-500">
              {loading
                ? 'Hämtar…'
                : tasks.length === 0
                  ? loadFailed ? 'Listan kunde inte hämtas.' : 'Inga uppgifter kopplade till offerten.'
                  : `${openCount} öppna av ${tasks.length}.`}
            </span>
            {/* Hämtningen misslyckades MEN det står rader i listan — alltså en uppgift som just
                skapades ovanpå en trasig läsning. Felet får inte ligga kvar som rubrik då: det
                läses som "din uppgift sparades inte", vilket är precis tvärtom. */}
            {loadFailed && tasks.length > 0 ? (
              <span className="text-xs leading-5 text-amber-700">Befintliga uppgifter kunde inte hämtas — listan kan vara ofullständig.</span>
            ) : null}
          </div>
        </div>
        <a
          href="/crm/uppgifter"
          className="shrink-0 text-xs font-semibold text-slate-400 no-underline transition hover:text-slate-600"
        >
          Alla uppgifter →
        </a>
      </div>

      {loading ? (
        <div className="mt-3 grid gap-1.5">
          <div className="h-9 animate-pulse rounded-lg bg-[#dfe6da]" />
          <div className="h-9 animate-pulse rounded-lg bg-[#dfe6da]" />
        </div>
      ) : tasks.length > 0 ? (
        <div className="mt-3 grid gap-1.5">
          {tasks.map((task) => {
            const isMine = Boolean(currentUserId) && task.user_id === currentUserId;
            // Kryssrutan är en SKRIVNING och kräver därför BÅDE äganderätt och crm.write.
            // `isMine` ensamt räcker inte: PATCH-rutten gatar på requireCrmWriter(), så en läsroll
            // som råkar äga en gammal uppgift (en säljare som blivit konsult) hade fått en ruta
            // som bockar av sig optimistiskt, 403:ar och rullar tillbaka igen.
            const canToggle = isMine && canWrite;
            const busy = updatingIds.includes(task.id);
            const done = task.status === 'done';
            // Avbruten är inte klar, men den är avslutad. Att rita den som en öppen punkt hade
            // lagt en uppgift ingen tänker göra överst i listan som något att göra.
            const closed = task.status !== 'open';
            const overdue = isOverdue(task);

            return (
              <div key={task.id} className="flex items-start gap-2.5 rounded-xl border border-slate-100 bg-white px-3 py-2">
                {/* Klickbar bara när man både äger raden och får skriva — se canToggle ovan. Allt
                    annat får en statisk markör, så att listan ändå läses som en checklista. */}
                {canToggle ? (
                  <button
                    type="button"
                    onClick={() => void toggleStatus(task)}
                    disabled={busy}
                    aria-label={done ? `Återöppna ${task.title}` : `Markera ${task.title} som klar`}
                    className={cn(
                      'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border p-0 transition disabled:opacity-50',
                      closed ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-slate-300 bg-white hover:border-emerald-500',
                    )}
                  >
                    {closed ? (
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M20 6L9 17l-5-5" />
                      </svg>
                    ) : null}
                  </button>
                ) : (
                  <span
                    aria-hidden="true"
                    className={cn(
                      'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                      closed ? 'border-emerald-200 bg-emerald-100 text-emerald-700' : 'border-slate-200 bg-slate-50',
                    )}
                  >
                    {closed ? (
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M20 6L9 17l-5-5" />
                      </svg>
                    ) : null}
                  </span>
                )}

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    {/* Djuplänken slår upp uppgiften i uppgiftssidans egen lista, som är egen-bara.
                        På en kollegas rad hade klicket lett till en sida där ingenting händer. */}
                    {isMine ? (
                      <a
                        href={`/crm/uppgifter?task_id=${task.id}`}
                        className={cn(
                          'min-w-0 break-words text-sm no-underline transition hover:underline',
                          closed ? 'text-slate-400 line-through' : 'text-slate-800',
                        )}
                      >
                        {task.title}
                      </a>
                    ) : (
                      <span className={cn('min-w-0 break-words text-sm', closed ? 'text-slate-400 line-through' : 'text-slate-800')}>
                        {task.title}
                      </span>
                    )}
                    {task.priority !== 'normal' ? (
                      <span className={cn('shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold', priorityMeta[task.priority].className)}>
                        {priorityMeta[task.priority].label}
                      </span>
                    ) : null}
                  </div>

                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-400">
                    {task.due_date ? (
                      <span className={cn(overdue && 'font-semibold text-amber-700')}>
                        {overdue ? '⚠ ' : ''}Förfaller {formatDueDate(task.due_date)}
                      </span>
                    ) : null}
                    {!isMine ? (
                      <span>Ligger på {task.assignee_name || 'en kollega'}</span>
                    ) : null}
                    {task.delegated && isMine ? (
                      <span>Från {task.creator_name || 'en kollega'}</span>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      {canWrite ? (
        <form onSubmit={createTask} className="mt-3 flex flex-wrap items-center gap-2 border-t border-[#e3e9df] pt-3">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Ny uppgift på offerten…"
            aria-label="Ny uppgift"
            className="min-w-0 flex-1 basis-48"
          />
          <Input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            aria-label="Förfallodatum"
            className="w-auto shrink-0"
          />
          <button
            type="submit"
            disabled={creating || title.trim().length === 0}
            className="shrink-0 rounded-lg px-3 py-2 text-sm font-semibold text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"
            // --crm-primary bor på .crm-shell, inte :root. Panelen renderas bara innanför skalet
            // (offertlistan och Säljtavlan), samma som panelens egen "Redigera offert"-knapp.
            style={{ backgroundColor: 'var(--crm-primary)' }}
          >
            {creating ? 'Lägger till…' : 'Lägg till'}
          </button>
        </form>
      ) : null}
    </div>
  );
}
