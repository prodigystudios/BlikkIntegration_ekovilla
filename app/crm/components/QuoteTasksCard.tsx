"use client";
import { useEffect, useState } from 'react';
import { cn } from '@/lib/shared/cn';
import { useToast } from '@/lib/Toast';
import TaskFormModal from '@/app/crm/components/TaskFormModal';
import { buildTaskStatusTogglePayload, type TaskItem } from '@/app/crm/lib/taskForm';

// Uppgiftsflödet på en offert — läsning av ALLA uppgifter som hör till offerten, plus knappen som
// öppnar uppgiftsformuläret med offerten som given koppling.
//
// Egen fil och inte inline i QuoteDetailPanel: panelen är redan 600+ rader och handlar om
// offertens status och dokument. Det här är en självständig yta med egen hämtning, egen
// felhantering och egen optimistisk uppdatering.
//
// ⚠️ Skrivningen går genom de BEFINTLIGA uppgiftsrutterna (POST /api/crm/tasks,
// PATCH /api/crm/tasks/[id]) och genom SAMMA formulär som uppgiftssidan — mottagarväljaren,
// notisen, påminnelsen och beskrivningen följer med gratis. Ingen ny skrivväg, ingen ny
// behörighetslogik. Läsningen har en egen route eftersom den betyder något annat än "mina
// uppgifter" — se app/api/crm/quotes/[id]/tasks/route.ts.

// Uppgiften som uppgiftsrutterna returnerar, plus de två namnen som BARA offertens läsrutt
// lägger på (profiles-RLS är self-only, så klienten kan inte slå upp dem själv).
export type QuoteTask = TaskItem & {
  assignee_name: string | null;
  creator_name: string | null;
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
  canDelegate,
}: {
  quoteId: string;
  /** Etiketten som fryses på uppgiften. Byggs av den delade quoteLabel() i quoteDisplay.ts. */
  quoteLabel: string;
  /** Avgör vad som är MIN uppgift. Utan den blir varje rad läsvy — inte fel, bara sämre. */
  currentUserId: string | null;
  /** crm.write. konsult ser flödet men får ingen knapp. */
  canWrite: boolean;
  /** crm.admin. Skickas vidare till formuläret, som äger mottagarväljaren. */
  canDelegate: boolean;
}) {
  const toast = useToast();

  const [tasks, setTasks] = useState<QuoteTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [updatingIds, setUpdatingIds] = useState<string[]>([]);
  // Bumpas när listan måste hämtas om — se applySavedTask.
  const [reloadKey, setReloadKey] = useState(0);

  // Formuläret är SAMMA modal som uppgiftssidan öppnar. Ett eget litet snabbformulär här hade
  // saknat mottagarväljaren (och därmed notisen), påminnelsen och beskrivningen.
  // null = stängd. `{ task: null }` = ny uppgift, `{ task }` = redigera den befintliga.
  const [formTarget, setFormTarget] = useState<{ task: TaskItem | null } | null>(null);

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
  }, [quoteId, reloadKey]);

  /**
   * Bockar av / återöppnar.
   *
   * 🧨 Bara på EGNA rader. PATCH-rutten kör på sessionsklienten, och dashboard_work_items har
   * egen-bara RLS — en PATCH mot en kollegas uppgift träffar noll rader, `.single()` ger PGRST116
   * och rutten svarar 500 med ett obegripligt meddelande. Lös det aldrig genom att elevera PATCH:
   * det vore skrivrätt i någon annans personliga dashboard, medvetet inte byggt.
   *
   * Nyttolasten byggs av buildTaskStatusTogglePayload — delad med uppgiftssidan, och den bär
   * normaliseringen av `remind_at` som gör att en uppgift med påminnelse går att bocka av alls.
   */
  async function toggleStatus(task: QuoteTask) {
    const nextStatus = task.status === 'done' ? 'open' : 'done';
    setUpdatingIds((current) => [...current, task.id]);
    setTasks((current) => current.map((t) => (t.id === task.id ? { ...t, status: nextStatus } : t)));

    try {
      const res = await fetch(`/api/crm/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildTaskStatusTogglePayload(task, nextStatus)),
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

  /**
   * Den sparade uppgiften tillbaka från formuläret.
   *
   * ⚠️ En uppgift man lagt på NÅGON ANNAN kommer tillbaka utan namn — modalen anropar den vanliga
   * skrivrutten, och namnen sätts bara av offertens läsrutt. Raden skulle alltså stå som "Ligger på
   * en kollega" tills panelen öppnas om. Därför läses listan om i stället för att raden läggs till
   * för hand: en extra hämtning är billigare än en rad som ljuger om vem som ska göra jobbet.
   */
  function applySavedTask(item: TaskItem, { isEditing }: { isEditing: boolean }) {
    const isMine = Boolean(currentUserId) && item.user_id === currentUserId;
    if (isMine) {
      setTasks((current) => {
        const withNames: QuoteTask = { ...item, assignee_name: null, creator_name: null };
        return sortTasks(isEditing
          ? current.map((t) => (t.id === item.id ? { ...t, ...withNames } : t))
          : [...current, withNames]);
      });
    } else {
      setReloadKey((key) => key + 1);
    }
    toast.success(item.delegated ? 'Uppgift skapad och notis skickad' : isEditing ? 'Uppgift uppdaterad' : 'Uppgift skapad');
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
                  : `${openCount} ${openCount === 1 ? 'öppen' : 'öppna'} av ${tasks.length}.`}
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
            // `cancelled` utesluts: toggeln skriver 'done', så ett klick hade gjort en AVBRUTEN
            // uppgift till en klar — och rutan står redan ibockad, så etiketten "Markera som klar"
            // hade ljugit också. Avbrutna uppgifter är läsvy.
            const canToggle = isMine && canWrite && task.status !== 'cancelled';
            // Redigering kräver samma sak minus undantaget för avbrutna: draftFromTask klämmer
            // status till öppen, så en avbruten uppgift går utmärkt att öppna och rätta.
            const canEdit = isMine && canWrite;
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
                    {/* Redigering sker HÄR, inte på uppgiftssidan. En djuplänk till /crm/uppgifter
                        kastade ut en ur offerten man höll på med — och tillbaka fanns ingen väg
                        utom bakåtknappen. Samma modal, samma offert, panelen kvar bakom.

                        Bara egna rader: PATCH kör på sessionsklienten mot en tabell med egen-bara
                        RLS, så ett formulär över en kollegas uppgift hade gått att fylla i och
                        sedan fallit på 500 vid spara. Kollegans text går ändå att LÄSA nedan. */}
                    {canEdit ? (
                      <button
                        type="button"
                        onClick={() => setFormTarget({ task })}
                        // ⚠️ `inline` är inte kosmetik. globals.css ger VARJE <button>
                        // `display:inline-flex; justify-content:center; padding:10px 14px;
                        // border:1px solid transparent` på elementspecificitet — utan de här
                        // klasserna centreras titeln, får knappstoppning och bryter inte som
                        // grannraden. Klasser vinner över elementregeln, men bara de som faktiskt
                        // skrivs ut. Samma familj som knapp-padding-fällan i FRONTEND_SYSTEM.md.
                        className={cn(
                          'inline min-w-0 break-words border-0 bg-transparent p-0 text-left text-sm transition hover:underline',
                          closed ? 'text-slate-400 line-through' : 'text-slate-800',
                        )}
                      >
                        {task.title}
                      </button>
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

                  {/* Beskrivningen i KLARTEXT, inte bara i redigeringsläget. Den bär oftast själva
                      poängen med uppgiften ("ring om taket innan vi prisar"), och att behöva öppna
                      ett formulär för att läsa den gjorde flödet till en innehållsförteckning.
                      Ingen radbegränsning: texten är det man kom hit för, och panelen skrollar. */}
                  {task.details ? (
                    <p className={cn(
                      'm-0 mt-1 whitespace-pre-wrap break-words text-[13px] leading-5',
                      closed ? 'text-slate-400' : 'text-slate-600',
                    )}>
                      {task.details}
                    </p>
                  ) : null}

                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-400">
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
        <div className="mt-3 border-t border-[#e3e9df] pt-3">
          <button
            type="button"
            onClick={() => setFormTarget({ task: null })}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold text-white transition hover:brightness-95"
            // --crm-primary bor på .crm-shell, inte :root. Panelen renderas bara innanför skalet
            // (offertlistan och Säljtavlan), samma som panelens egen "Redigera offert"-knapp.
            style={{ backgroundColor: 'var(--crm-primary)' }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
            Lägg till uppgift
          </button>
        </div>
      ) : null}

      {/* Samma formulär som uppgiftssidan, med offerten som LÅST koppling: man står redan på
          offerten, och att kunna peka om uppgiften härifrån vore ett sätt att tappa bort den.
          Modalen ligger inuti offertpanelen i DOM:en och målas därför ovanpå den. */}
      {formTarget ? (
        <TaskFormModal
          task={formTarget.task}
          lockedRelation={{ type: 'crm_quote', id: quoteId, label: quoteLabel }}
          canDelegate={canDelegate}
          onClose={() => setFormTarget(null)}
          onSaved={applySavedTask}
        />
      ) : null}
    </div>
  );
}
