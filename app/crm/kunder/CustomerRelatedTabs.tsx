"use client";

import { useState } from 'react';
import Input from '../../../components/ui/Input';
import { CrmTable, CustomerCell, type CrmTableColumn } from '@/app/crm/components/CrmTable';
import { netAmount } from '@/lib/domains/crm/pricing';
import { crm, quoteStatusMeta, workOrderStatusClass, workOrderStatusLabel, type QuoteStatus, type WorkOrderStatus } from '@/app/crm/lib/crmTokens';
import { cn } from '@/lib/shared/cn';
import { documentRef, formatCurrency, formatDate, formatDateTime, formatDayRange, isWorkOrderOverdue } from '@/app/crm/lib/format';
import { PhoneLink, EmailLink } from '@/app/crm/components/ContactLinks';
import {
  contactInitials,
  filterQuotes,
  filterWorkOrders,
  QUOTE_STATUS_FILTERS,
  quotePlace,
  quoteSums,
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

const callOutcomeLabel: Record<string, string> = {
  no_answer: 'Inget svar', follow_up: 'Följ upp', positive: 'Positiv', negative: 'Negativ',
};

const taskStatusLabel: Record<string, string> = {
  open: 'Öppen', done: 'Klar', cancelled: 'Avbruten',
};

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

function NewButton({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      className="inline-flex h-10 items-center gap-2 rounded-xl bg-[color:var(--ek-green)] px-4 text-sm font-semibold text-white no-underline transition hover:bg-[color:var(--ek-green-strong)]"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden><path d="M12 5v14M5 12h14" /></svg>
      {children}
    </a>
  );
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

export function CallsTab({ calls, loading }: { calls: RelatedCall[]; loading: boolean }) {
  return (
    <InfoCard title="Samtalslogg" action={<ListLink href="/crm/samtal">Alla samtal →</ListLink>}>
      {loading ? <Loading /> : calls.length === 0 ? (
        <EmptyState title="Inga samtal loggade">Logga samtal så att kollegorna ser vad som sagts.</EmptyState>
      ) : (
        <RowList>
          {calls.map((call) => (
            <RowLink
              key={call.id}
              href={`/crm/samtal?call_id=${call.id}`}
              title={call.summary || call.contact_name || 'Samtal'}
              meta={[call.contact_name, formatDateTime(call.call_at)].filter(Boolean).join(' · ')}
              badge={<span className={cn(crm.badge, 'border-sky-200 bg-sky-50 text-sky-700')}>{callOutcomeLabel[call.outcome] || call.outcome}</span>}
            />
          ))}
        </RowList>
      )}
    </InfoCard>
  );
}

export function TasksTab({ tasks, loading }: { tasks: RelatedTask[]; loading: boolean }) {
  return (
    <InfoCard title="Uppgifter" action={<ListLink href="/crm/uppgifter">Alla uppgifter →</ListLink>}>
      {loading ? <Loading /> : tasks.length === 0 ? (
        <EmptyState title="Inga uppgifter">Skapa en uppgift, till exempel att följa upp en offert.</EmptyState>
      ) : (
        <RowList>
          {tasks.map((task) => (
            <RowLink
              key={task.id}
              href={`/crm/uppgifter?task_id=${task.id}`}
              title={task.title}
              muted={task.status === 'done'}
              meta={task.due_date ? `Förfaller ${formatDate(task.due_date)}` : null}
              badge={<span className={cn(crm.badge, 'border-slate-200 bg-slate-50 text-slate-600')}>{taskStatusLabel[task.status] || task.status}</span>}
            />
          ))}
        </RowList>
      )}
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
