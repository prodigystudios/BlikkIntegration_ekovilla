"use client";

import { crm, quoteStatusMeta, workOrderStatusClass, workOrderStatusLabel, type QuoteStatus, type WorkOrderStatus } from '@/app/crm/lib/crmTokens';
import { cn } from '@/lib/shared/cn';
import { formatCurrency, formatDate, formatDateTime } from '@/app/crm/lib/format';
import { PhoneLink, EmailLink } from '@/app/crm/components/ContactLinks';
import { contactInitials, type CustomerContact, type RelatedCall, type RelatedQuote, type RelatedTask, type RelatedWorkOrder } from './customerCard';
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

export function QuotesTab({ quotes, total, loading }: { quotes: RelatedQuote[]; total: number | null; loading: boolean }) {
  return (
    <InfoCard title="Offerter" action={<ListLink href="/crm/offerter">Alla offerter →</ListLink>}>
      {loading ? <Loading /> : quotes.length === 0 ? (
        <EmptyState title="Inga offerter ännu">Offerter du skapar för kunden samlas här.</EmptyState>
      ) : (
        <RowList>
          {quotes.map((q) => {
            const meta = quoteStatusMeta[q.status as QuoteStatus];
            return (
              <RowLink
                key={q.id}
                href={`/crm/offerter?quote_id=${q.id}`}
                title={q.project_name || 'Offert utan namn'}
                meta={[q.quote_number, formatCurrency(q.amount, q.currency_code), formatDate(q.quote_date)].filter(Boolean).join(' · ')}
                badge={<span className={cn(crm.badge, meta?.className ?? 'border-slate-200 bg-slate-50 text-slate-700')}>{meta?.label ?? q.status}</span>}
              />
            );
          })}
        </RowList>
      )}
      {!loading ? <Truncated shown={quotes.length} total={total} href="/crm/offerter" noun="offerter" /> : null}
    </InfoCard>
  );
}

export function WorkOrdersTab({ workOrders, total, loading }: { workOrders: RelatedWorkOrder[]; total: number | null; loading: boolean }) {
  return (
    <InfoCard title="Arbetsorder" action={<ListLink href="/crm/arbetsorder">Alla arbetsorder →</ListLink>}>
      {loading ? <Loading /> : workOrders.length === 0 ? (
        <EmptyState title="Inga arbetsorder ännu">Arbetsorder skapas från en vunnen offert eller direkt i orderlistan.</EmptyState>
      ) : (
        <RowList>
          {workOrders.map((wo) => (
            <RowLink
              key={wo.id}
              href={`/crm/arbetsorder/${wo.id}`}
              title={wo.project_name || `Order ${wo.order_number}`}
              meta={[`#${wo.order_number}`, wo.desired_installation_date ? formatDate(wo.desired_installation_date) : null].filter(Boolean).join(' · ')}
              badge={
                <span className={cn(crm.badge, workOrderStatusClass[wo.status as WorkOrderStatus] ?? 'border-slate-200 bg-slate-50 text-slate-600')}>
                  {workOrderStatusLabel[wo.status as WorkOrderStatus] ?? wo.status}
                </span>
              }
            />
          ))}
        </RowList>
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
