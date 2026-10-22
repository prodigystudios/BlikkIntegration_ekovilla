"use client";

import { useState } from 'react';
import Input from '../../../components/ui/Input';
import { CrmTable, CustomerCell, type CrmTableColumn } from '@/app/crm/components/CrmTable';
import { netAmount } from '@/lib/domains/crm/pricing';
import { CALL_OUTCOME_META } from '@/app/crm/lib/callDisplay';
import { crm, quoteStatusMeta, workOrderStatusClass, workOrderStatusLabel, type QuoteStatus, type WorkOrderStatus } from '@/app/crm/lib/crmTokens';
import { cn } from '@/lib/shared/cn';
import { documentRef, formatCurrency, formatDate, formatDateTime, formatDayRange, isWorkOrderOverdue } from '@/app/crm/lib/format';
import { PhoneLink, EmailLink } from '@/app/crm/components/ContactLinks';
import {
  contactInitials,
  filterQuotes,
  filterWorkOrders,
  isTaskOverdue,
  QUOTE_STATUS_FILTERS,
  quotePlace,
  quoteSums,
  splitTasks,
  workOrderPlace,
  type CustomerContact,
  type QuoteStatusFilter,
  type RelatedCall,
  type RelatedQuote,
  type RelatedTask,
  type RelatedWorkOrder,
} from './customerCard';
import { cardLinkButton, EmptyState, InfoCard } from './CustomerCardUi';

// Kundkortets flikar utöver Översikt. Ren visning — hämtning, sparning och modaler bor i
// CustomerDetailClient.


// Länken till hela listan, som kortets gamla sidokolumn hade ("Offerter →" …). Det är där man skapar
// och filtrerar tills flikarna får egna verktyg.
function ListLink({ href, children }: { href: string; children: React.ReactNode }) {
  return <a href={href} className={cn(cardLinkButton, 'inline-flex items-center no-underline')}>{children}</a>;
}

/** Listan är serverns första sida. Står det fler i räkningen än i listan ska kortet säga det. */
function Truncated({ shown, total, href, noun }: { shown: number; total: number | null; href: string; noun: string }) {
  if (total == null || total <= shown) return null;
  return (
    <p className="m-0 mt-3 text-xs text-slate-600">
      Visar de {shown} senaste av {total} {noun}. <a href={href} className={crm.link}>Se alla</a>
    </p>
  );
}

function Loading() {
  return <div className="h-24 animate-pulse rounded-xl bg-[#e6ede3]" />;
}

/** En rad i en flikslista: länk till posten, titel + meta till vänster, märke till höger. */
function RowLink({ href, title, meta, badge, muted = false }: {
  href: string; title: string; meta?: string | null; badge?: React.ReactNode; muted?: boolean;
}) {
  return (
    <li className="border-t border-[#edf1ec] first:border-t-0">
      <a href={href} className="flex min-h-14 items-center justify-between gap-3 px-4 py-3 no-underline transition hover:bg-[#f1f5ee]">
        <span className="min-w-0">
          <span className={cn('block truncate text-sm font-medium', muted ? 'text-slate-500 line-through' : 'text-slate-900')}>{title}</span>
          {meta ? <span className="block text-xs text-slate-600">{meta}</span> : null}
        </span>
        {badge}
      </a>
    </li>
  );
}

function RowList({ children }: { children: React.ReactNode }) {
  return <ul className="m-0 list-none overflow-hidden rounded-xl border border-[#e0e8dc] p-0">{children}</ul>;
}

const quoteWidth = {
  number: 'hidden w-[7rem] break-words tabular-nums text-slate-500 sm:table-cell',
  name: '',
  date: 'hidden w-[6.5rem] whitespace-nowrap tabular-nums text-slate-500 xl:table-cell',
  seller: 'hidden w-[8rem] truncate xl:table-cell',
  amount: 'hidden w-[7.5rem] text-right tabular-nums sm:table-cell',
  status: 'w-[6.75rem] pr-0 text-right sm:w-[7.5rem] sm:pr-4 sm:text-left',
} as const;

// Kolumnerna döljs efter kortets SMALA huvudkolumn (sidokolumnen tar 300 px), inte listsidans.
const orderWidth = {
  number: 'hidden w-[6.5rem] break-words tabular-nums text-slate-500 sm:table-cell',
  name: '',
  planned: 'hidden w-[8.5rem] text-slate-600 lg:table-cell',
  assignee: 'hidden w-[8rem] truncate xl:table-cell',
  status: 'w-[7.5rem] pr-0 sm:pr-4',
  quote: 'hidden w-[7rem] xl:table-cell',
} as const;

// Flikarnas gröna "Ny …"-knapp — samma utseende som länk (till ett annat formulär) och som knapp
// (öppnar en modal här). `py-0` mot den globala knapp-paddingen, `no-underline` för länken.
const newActionClass = 'inline-flex h-10 items-center gap-2 rounded-xl bg-[color:var(--ek-green)] px-4 py-0 text-sm font-semibold text-white no-underline transition hover:bg-[color:var(--ek-green-strong)]';

function PlusIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden><path d="M12 5v14M5 12h14" /></svg>;
}

function NewActionButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return <button type="button" onClick={onClick} className={newActionClass}><PlusIcon />{children}</button>;
}

function NewButton({ href, children }: { href: string; children: React.ReactNode }) {
  return <a href={href} className={newActionClass}><PlusIcon />{children}</a>;
}

function SearchField({ value, onChange, label, placeholder }: { value: string; onChange: (v: string) => void; label: string; placeholder: string }) {
  return (
    <Input
      type="search"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={label}
      placeholder={placeholder}
      className="min-h-10 w-full sm:max-w-xs"
    />
  );
}

export function QuotesTab({ quotes, total, loading, sellerName, newQuoteHref }: {
  quotes: RelatedQuote[];
  total: number | null;
  loading: boolean;
  /** Ansvarig säljare per id, ur säljarkatalogen. */
  sellerName: (id: string | null) => string | null;
  /** null = ingen rätt att skapa offerter (crm.offer.write). */
  newQuoteHref: string | null;
}) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<QuoteStatusFilter>('alla');
  const shown = filterQuotes(quotes, search, filter);
  const sums = quoteSums(quotes);
  const quoteHref = (q: RelatedQuote) => `/crm/offerter?quote_id=${q.id}`;

  const columns: Array<CrmTableColumn<RelatedQuote>> = [
    { header: 'Nr', className: quoteWidth.number, cell: (q) => documentRef(q.fortnox_offer_number, q.quote_number) },
    {
      header: 'Benämning',
      className: quoteWidth.name,
      cell: (q) => <CustomerCell href={quoteHref(q)} customer={q.project_name || 'Offert utan namn'} project={quotePlace(q)} />,
    },
    {
      header: 'Status',
      className: quoteWidth.status,
      cell: (q) => {
        const meta = quoteStatusMeta[q.status as QuoteStatus];
        return <span className={cn(crm.badge, meta?.className ?? 'border-slate-200 bg-slate-50 text-slate-700')}>{meta?.label ?? q.status}</span>;
      },
    },
    { header: 'Datum', className: quoteWidth.date, cell: (q) => formatDate(q.quote_date) },
    { header: 'Ansvarig', className: quoteWidth.seller, cell: (q) => sellerName(q.assigned_to) ?? '–' },
    { header: 'Ex moms', className: quoteWidth.amount, cell: (q) => formatCurrency(netAmount(q), q.currency_code) },
  ];

  return (
    <InfoCard title="Offerter" action={<ListLink href="/crm/offerter">Alla offerter →</ListLink>}>
      {loading ? <Loading /> : quotes.length === 0 ? (
        <EmptyState
          title="Inga offerter ännu"
          action={newQuoteHref ? <NewButton href={newQuoteHref}>Skapa första offerten</NewButton> : null}
        >
          Offerter du skapar för kunden samlas här.
        </EmptyState>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 flex-[1_1_320px] flex-wrap items-center gap-2.5">
              <SearchField value={search} onChange={setSearch} label="Sök offerter" placeholder="Sök offert…" />
              <div role="group" aria-label="Filtrera på status" className="flex flex-wrap gap-1.5">
                {QUOTE_STATUS_FILTERS.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    aria-pressed={filter === f.id}
                    onClick={() => setFilter(f.id)}
                    className={cn(
                      'h-8 rounded-full border px-3 py-0 text-[13px] font-medium transition',
                      filter === f.id
                        ? 'border-[color:var(--ek-green)] bg-[color:var(--ek-green)] text-white'
                        : 'border-[#dce4d8] bg-white text-slate-700 hover:border-[#c8d4c3]',
                    )}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
            {newQuoteHref ? <NewButton href={newQuoteHref}>Ny offert</NewButton> : null}
          </div>
          {shown.length === 0 ? (
            <EmptyState title={search.trim() ? 'Inga offerter matchar sökningen' : 'Inga offerter med den statusen'} />
          ) : (
            <CrmTable label="Kundens offerter" size="regular" columns={columns} rows={shown} rowHref={quoteHref} />
          )}
          <div className="mt-3.5 flex flex-wrap justify-end gap-x-6 gap-y-1.5 text-[13px] text-slate-600">
            <span>Vunnet totalt: <strong className="font-semibold tabular-nums text-slate-900">{formatCurrency(sums.won, 'SEK')}</strong></span>
            <span>Öppna offerter: <strong className="font-semibold tabular-nums text-slate-900">{formatCurrency(sums.open, 'SEK')}</strong></span>
            {/* Summorna räknas på det som hämtats. Är listan kapad säger de det, i stället för att se
                ut som kundens hela historik. */}
            <span className="text-xs text-slate-500">
              ex moms
              {total != null && total > quotes.length ? ` · de ${quotes.length} senaste` : ''}
              {sums.otherCurrency ? ' · utan offerter i annan valuta' : ''}
            </span>
          </div>
        </>
      )}
      {!loading ? <Truncated shown={quotes.length} total={total} href="/crm/offerter" noun="offerter" /> : null}
    </InfoCard>
  );
}

export function WorkOrdersTab({ workOrders, quotes, total, loading, newWorkOrderHref }: {
  workOrders: RelatedWorkOrder[];
  /** Kundens offerter — "Från offert" visar offertens nummer när den finns bland dem. */
  quotes: RelatedQuote[];
  total: number | null;
  loading: boolean;
  /** null = ingen rätt att skapa arbetsorder (crm.workorder.write). */
  newWorkOrderHref: string | null;
}) {
  const [search, setSearch] = useState('');
  const shown = filterWorkOrders(workOrders, search);
  const quoteById = new Map(quotes.map((q) => [q.id, q]));
  const orderHref = (wo: RelatedWorkOrder) => `/crm/arbetsorder/${wo.id}`;

  const columns: Array<CrmTableColumn<RelatedWorkOrder>> = [
    { header: 'Nr', className: orderWidth.number, cell: (wo) => documentRef(wo.fortnox_order_number, wo.order_number) },
    {
      header: 'Arbete & adress',
      className: orderWidth.name,
      cell: (wo) => <CustomerCell href={orderHref(wo)} customer={wo.project_name || `Order ${wo.order_number}`} project={workOrderPlace(wo)} />,
    },
    {
      // "Planerad", som orderlistan (Williams ord, 2026-08-23): schemats första och sista dag, inte
      // önskat installationsdatum.
      header: 'Planerad',
      className: orderWidth.planned,
      cell: (wo) => formatDayRange(wo.planned_start_day, wo.planned_end_day) ?? '–',
    },
    { header: 'Ansvarig', className: orderWidth.assignee, cell: (wo) => wo.assignee?.full_name ?? '–' },
    {
      header: 'Status',
      className: orderWidth.status,
      cell: (wo) => (
        <>
          <span className={cn(crm.badge, workOrderStatusClass[wo.status as WorkOrderStatus] ?? 'border-slate-200 bg-slate-50 text-slate-600')}>
            {workOrderStatusLabel[wo.status as WorkOrderStatus] ?? wo.status}
          </span>
          {/* Samma två tillägg som orderlistan: faktureringsläget och förseningen mot önskat datum. */}
          {wo.partial_invoicing_started_at && wo.status !== 'invoiced' && wo.status !== 'partially_invoiced' ? (
            <span className="mt-1 block text-[11px] font-semibold text-amber-700">Delfakturerad</span>
          ) : null}
          {isWorkOrderOverdue(wo.desired_installation_date, wo.status) ? (
            <span className="mt-1 block text-[11px] font-semibold text-rose-700" title="Önskat installationsdatum har passerat">Försenad</span>
          ) : null}
        </>
      ),
    },
    {
      header: 'Från offert',
      className: orderWidth.quote,
      cell: (wo) => {
        if (!wo.quote_id) return '–';
        const q = quoteById.get(wo.quote_id);
        return (
          <a href={`/crm/offerter?quote_id=${wo.quote_id}`} className={crm.link}>
            {q ? documentRef(q.fortnox_offer_number, q.quote_number) : 'Offert'}
          </a>
        );
      },
    },
  ];

  return (
    <InfoCard title="Arbetsorder" action={<ListLink href="/crm/arbetsorder">Alla arbetsorder →</ListLink>}>
      {loading ? <Loading /> : workOrders.length === 0 ? (
        <EmptyState
          title="Inga arbetsorder ännu"
          action={newWorkOrderHref ? <NewButton href={newWorkOrderHref}>Ny arbetsorder</NewButton> : null}
        >
          Skapa en arbetsorder direkt eller från en vunnen offert.
        </EmptyState>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <SearchField value={search} onChange={setSearch} label="Sök arbetsorder" placeholder="Sök arbetsorder eller adress…" />
            {newWorkOrderHref ? <NewButton href={newWorkOrderHref}>Ny arbetsorder</NewButton> : null}
          </div>
          {shown.length === 0 ? (
            <EmptyState title="Inga arbetsorder matchar sökningen" />
          ) : (
            <CrmTable label="Kundens arbetsorder" size="regular" columns={columns} rows={shown} rowHref={orderHref} />
          )}
        </>
      )}
      {!loading ? <Truncated shown={workOrders.length} total={total} href="/crm/arbetsorder" noun="arbetsorder" /> : null}
    </InfoCard>
  );
}

export function CallsTab({ calls, loading, sellerName, onLogCall, seesAllCalls }: {
  calls: RelatedCall[];
  loading: boolean;
  sellerName: (id: string | null) => string | null;
  /** null = ingen rätt att logga samtal (crm.call.write), eller listan laddar. */
  onLogCall: (() => void) | null;
  /** crm.admin. Läspolicyn visar annars bara egna samtal — det ska stå, inte gissas. */
  seesAllCalls: boolean;
}) {
  const logButton = onLogCall ? <NewActionButton onClick={onLogCall}>Logga samtal</NewActionButton> : null;
  return (
    <InfoCard title="Samtalslogg" action={<ListLink href="/crm/samtal">Alla samtal →</ListLink>}>
      {loading ? <Loading /> : calls.length === 0 ? (
        <EmptyState title="Inga samtal loggade" action={logButton}>Logga samtal för att hålla ordning på vad som sagts med kunden.</EmptyState>
      ) : (
        <>
          {logButton ? <div className="mb-2 flex justify-end">{logButton}</div> : null}
          <ol className="m-0 list-none p-0">
            {calls.map((call) => {
              const meta = CALL_OUTCOME_META[call.outcome];
              const who = [call.contact_name, sellerName(call.user_id)].filter(Boolean).join(' · ');
              return (
                <li key={call.id} className="flex gap-3.5 border-t border-[#e3e9e1] py-4 first:border-t-0">
                  {/* Riktning och längd finns inte i samtalsloggen — ikonen bär utfallets färg i stället. */}
                  <span className={cn('inline-flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full border', meta?.className ?? 'border-slate-200 bg-slate-100 text-slate-700')} aria-hidden>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2" />
                    </svg>
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                      <span className={cn(crm.badge, meta?.className)}>{meta?.label ?? call.outcome}</span>
                      {who ? <span className="text-xs text-slate-600">{who}</span> : null}
                    </div>
                    <p className="m-0 mt-1.5 text-sm leading-relaxed text-slate-800">
                      <a href={`/crm/samtal?call_id=${call.id}`} className="text-inherit no-underline hover:underline">{call.summary}</a>
                    </p>
                    {call.next_step ? <p className="m-0 mt-1 text-[13px] text-slate-600">Nästa steg: {call.next_step}</p> : null}
                  </div>
                  <span className="shrink-0 whitespace-nowrap text-xs text-slate-600">{formatDateTime(call.call_at)}</span>
                </li>
              );
            })}
          </ol>
        </>
      )}
      {/* crm_calls_select_visible släpper bara fram egna samtal (och prospekt man äger) för den som inte
          är admin. Utan raden hade en tom logg sett ut som att ingen pratat med kunden. */}
      {!loading && !seesAllCalls ? <p className="m-0 mt-3 text-xs text-slate-500">Visar samtal du har loggat själv.</p> : null}
    </InfoCard>
  );
}

function TaskRow({ task, currentUserId, canWrite, busy, todayIso, onToggle, onEdit }: {
  task: RelatedTask;
  currentUserId: string | null;
  canWrite: boolean;
  busy: boolean;
  todayIso: string;
  onToggle: (task: RelatedTask) => void;
  onEdit: (task: RelatedTask) => void;
}) {
  // Samma regler som offertpanelens uppgiftskort (QuoteTasksCard):
  // 🧨 bara EGNA rader går att skriva — PATCH kör på sessionsklienten mot en tabell med egen-bara
  // RLS — och det kräver crm.write. En avbruten uppgift bockas inte: toggeln skriver 'done', och
  // en avbruten hade då blivit klar. Redigering går däremot, draftFromTask öppnar den igen.
  const isMine = Boolean(currentUserId) && task.user_id === currentUserId;
  const canToggle = isMine && canWrite && task.status !== 'cancelled';
  const canEdit = isMine && canWrite;
  const closedRow = task.status !== 'open';
  const overdue = isTaskOverdue(task, todayIso);
  return (
    <li className="flex min-h-14 items-center gap-3 border-t border-[#edf1ec] px-4 py-2.5 first:border-t-0">
      {canToggle ? (
        <input
          type="checkbox"
          checked={closedRow}
          disabled={busy}
          onChange={() => onToggle(task)}
          aria-label={closedRow ? `Återöppna ${task.title}` : `Markera ${task.title} som klar`}
          className="h-[18px] w-[18px] shrink-0 accent-[color:var(--ek-green)]"
        />
      ) : (
        <span
          className={cn('h-[18px] w-[18px] shrink-0 rounded border', closedRow ? 'border-slate-400 bg-slate-300' : 'border-slate-300')}
          aria-hidden
        />
      )}
      <span className="min-w-0 flex-1">
        {canEdit ? (
          <button
            type="button"
            onClick={() => onEdit(task)}
            className={cn('min-h-0 w-full justify-start px-0 py-0 text-left text-sm font-medium hover:underline', closedRow ? 'text-slate-500 line-through' : 'text-slate-900')}
          >
            {task.title}
          </button>
        ) : (
          // Rader man inte får skriva i öppnas på uppgiftssidan, som innan kortet fick egna formulär.
          <a
            href={`/crm/uppgifter?task_id=${task.id}`}
            className={cn('text-sm font-medium no-underline hover:underline', closedRow ? 'text-slate-500 line-through' : 'text-slate-900')}
          >
            {task.title}
          </a>
        )}
        {task.status === 'cancelled' ? <span className="ml-2 text-xs text-slate-500">Avbruten</span> : null}
        {/* Listan har inga namn (bara offertens läsrutt sätter dem) — samma ord som offertpanelen när namnet saknas. */}
        {task.delegated ? <span className="block text-xs text-slate-500">Från en kollega</span> : null}
      </span>
      {task.due_date ? (
        <span className={cn('shrink-0 whitespace-nowrap text-xs font-semibold', overdue ? 'text-[#a3212b]' : 'text-slate-600')}>
          {overdue ? 'Försenad · ' : ''}{formatDate(task.due_date)}
        </span>
      ) : null}
    </li>
  );
}

export function TasksTab({ tasks, loading, currentUserId, canWrite, updatingIds, todayIso, onCreate, onToggle, onEdit }: {
  tasks: RelatedTask[];
  loading: boolean;
  currentUserId: string | null;
  /** crm.write — PATCH- och POST-rutten gatar på den. */
  canWrite: boolean;
  updatingIds: string[];
  /** Svensk dag (stockholmTodayISO) — förseningen räknas mot den, inte mot UTC. */
  todayIso: string;
  onCreate: (() => void) | null;
  onToggle: (task: RelatedTask) => void;
  onEdit: (task: RelatedTask) => void;
}) {
  const { open, closed } = splitTasks(tasks);
  const createButton = onCreate ? <NewActionButton onClick={onCreate}>Ny uppgift</NewActionButton> : null;

  return (
    <InfoCard title="Uppgifter" action={<ListLink href="/crm/uppgifter">Alla uppgifter →</ListLink>}>
      {loading ? <Loading /> : tasks.length === 0 ? (
        <EmptyState title="Inga uppgifter" action={createButton}>Skapa en uppgift, till exempel att följa upp en offert.</EmptyState>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h3 className="m-0 flex items-center gap-2 text-sm font-semibold text-slate-900">
              Att göra <span className="text-slate-500">({open.length})</span>
            </h3>
            {createButton}
          </div>
          {open.length === 0 ? (
            <p className="m-0 text-sm text-slate-600">Inget att göra just nu.</p>
          ) : (
            <ul className="m-0 list-none overflow-hidden rounded-xl border border-[#e0e8dc] p-0">
              {open.map((task) => <TaskRow key={task.id} task={task} currentUserId={currentUserId} canWrite={canWrite} busy={updatingIds.includes(task.id)} todayIso={todayIso} onToggle={onToggle} onEdit={onEdit} />)}
            </ul>
          )}
          {closed.length > 0 ? (
            <>
              <h3 className="m-0 mb-2.5 mt-6 text-[13px] font-semibold text-slate-600">Klara</h3>
              <ul className={cn(crm.sunken, 'm-0 list-none overflow-hidden rounded-xl p-0')}>
                {closed.map((task) => <TaskRow key={task.id} task={task} currentUserId={currentUserId} canWrite={canWrite} busy={updatingIds.includes(task.id)} todayIso={todayIso} onToggle={onToggle} onEdit={onEdit} />)}
              </ul>
            </>
          ) : null}
        </>
      )}
      {/* Uppgifterna har egen-bara RLS — en kollegas uppgift på kunden syns inte här. */}
      {!loading ? <p className="m-0 mt-3 text-xs text-slate-500">Visar dina egna uppgifter för kunden.</p> : null}
    </InfoCard>
  );
}

export function ContactsTab({ contacts, onAdd, onEdit, onDelete }: {
  contacts: CustomerContact[];
  onAdd: () => void;
  onEdit: (contact: CustomerContact) => void;
  onDelete: (contact: CustomerContact) => void;
}) {
  return (
    <InfoCard
      title="Kontaktpersoner"
      action={
        <button
          type="button"
          onClick={onAdd}
          className="inline-flex h-10 items-center gap-2 rounded-xl bg-[color:var(--ek-green)] px-4 py-0 text-sm font-semibold text-white transition hover:bg-[color:var(--ek-green-strong)]"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden><path d="M12 5v14M5 12h14" /></svg>
          Lägg till
        </button>
      }
    >
      {contacts.length === 0 ? (
        <EmptyState title="Inga kontaktpersoner ännu">Lägg till den du pratar med, till exempel platschef eller inköpare.</EmptyState>
      ) : (
        <ul className="m-0 grid list-none gap-3.5 p-0 grid-cols-[repeat(auto-fill,minmax(min(260px,100%),1fr))]">
          {contacts.map((contact) => (
            <li key={contact.id} className={cn(crm.sunken, 'flex flex-col gap-3 rounded-xl p-4')}>
              <div className="flex items-center gap-3">
                <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#dfe6dd] text-sm font-semibold text-[color:var(--ek-green)]" aria-hidden>
                  {contactInitials(contact.name)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="m-0 truncate text-[15px] font-semibold text-slate-900">{contact.name}</p>
                  {contact.role ? <p className="m-0 truncate text-[13px] text-slate-600">{contact.role}</p> : null}
                </div>
                {contact.is_primary ? (
                  <span className="rounded-full bg-[color:var(--ek-accent-soft)] px-2 py-0.5 text-[11px] font-semibold text-[color:var(--ek-accent)]">Primär</span>
                ) : null}
              </div>
              {contact.email || contact.phone ? (
                <div className="flex flex-col gap-1.5 text-[13px]">
                  {contact.email ? <EmailLink value={contact.email} /> : null}
                  {contact.phone ? <PhoneLink value={contact.phone} /> : null}
                </div>
              ) : null}
              {/* Redigera fanns inte förr trots att PATCH-rutten alltid gjort det: en felstavad
                  mejladress måste tas bort och skrivas in på nytt. */}
              <div className="flex gap-4 border-t border-[#dde6d9] pt-2.5">
                <button type="button" onClick={() => onEdit(contact)} className="min-h-8 px-0 py-0 text-xs font-semibold text-slate-600 hover:text-slate-900">
                  Redigera
                </button>
                <button type="button" onClick={() => onDelete(contact)} className="min-h-8 px-0 py-0 text-xs font-semibold text-slate-600 hover:text-rose-700">
                  Ta bort
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </InfoCard>
  );
}
