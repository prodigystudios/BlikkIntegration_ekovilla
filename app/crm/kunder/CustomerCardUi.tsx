import { crm } from '@/app/crm/lib/crmTokens';
import { cn } from '@/lib/shared/cn';
import { AddressLink } from '@/app/crm/components/ContactLinks';
import type { AddressDisplay } from './customerCard';

// Kundkortets byggstenar. Bor bredvid kortet: de är formade efter dess läsvy (rubrik + "Ändra",
// etikett/värde-listor) och har ingen annan användare än kortets flikar och sidokolumn.

/** Textlänk som är en knapp ("Ändra", "Visa alla", "Uppdatera"). `px-0 py-0` mot den globala knapp-paddingen. */
export const cardLinkButton = 'min-h-8 px-0 py-0 text-[13px] font-semibold text-[color:var(--ek-accent)] hover:text-[color:var(--ek-green)] hover:underline underline-offset-2 disabled:opacity-50';

export function InfoCard({ title, action, children, className, id }: {
  title: string; action?: React.ReactNode; children: React.ReactNode; className?: string; id?: string;
}) {
  return (
    <section id={id} className={cn(crm.cardInner, 'p-5 sm:p-6', className)}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h2 className="m-0 text-base font-semibold text-slate-900">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Sidokolumnens kort: kicker i stället för rubrik, något tätare. */
export function SideCard({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn(crm.cardInner, 'p-5', className)}>
      <h2 className={cn(crm.sectionTitle, 'm-0 mb-3.5')}>{title}</h2>
      {children}
    </section>
  );
}

/** Etikett till vänster, värde till höger. `compact` = sidokolumnens mindre variant. */
export function DefinitionList({ children, compact = false }: { children: React.ReactNode; compact?: boolean }) {
  return (
    <dl
      className={cn(
        'm-0 grid',
        compact
          ? 'grid-cols-[minmax(90px,max-content)_minmax(0,1fr)] gap-x-4 gap-y-2 text-[13px]'
          : 'grid-cols-[minmax(110px,max-content)_minmax(0,1fr)] gap-x-5 gap-y-3 text-sm',
      )}
    >
      {children}
    </dl>
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-slate-600">{label}</dt>
      <dd className="m-0 min-w-0 font-medium text-slate-900 [overflow-wrap:anywhere]">{children}</dd>
    </>
  );
}

/** Ett tomt eller härlett värde: grå text i stället för ett streck. */
export function Muted({ children }: { children: React.ReactNode }) {
  return <span className="font-normal text-slate-500">{children}</span>;
}

export function AddressValue({ display }: { display: AddressDisplay }) {
  if (display.kind === 'same-as-visit') return <Muted>Samma som besöksadress</Muted>;
  if (display.kind === 'empty') return <Muted>Ej angivet</Muted>;
  return <AddressLink value={display.lines.join(', ')} className="text-sm" />;
}

export function EmptyState({ title, children, action }: { title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-[#c4cec2] px-4 py-9 text-center">
      <p className="m-0 text-[15px] font-semibold text-slate-900">{title}</p>
      {children ? <p className="m-0 max-w-sm text-[13px] text-slate-600">{children}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function CountBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[#dfe6dd] px-1.5 text-[11px] font-semibold tabular-nums text-slate-600">
      {children}
    </span>
  );
}

export function Chip({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex h-[26px] items-center gap-1.5 whitespace-nowrap rounded-full bg-[#eef2ed] px-2.5 text-xs font-semibold text-slate-700', className)}>
      {children}
    </span>
  );
}
