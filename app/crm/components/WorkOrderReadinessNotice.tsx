"use client";
import Link from 'next/link';
import { cn } from '@/lib/shared/cn';
import type { WorkOrderReadinessIssue } from '@/lib/domains/crm/workOrderReadiness';

// Checklistan mellan offert och arbetsorder.
//
// Poängen med att visa den FÖRE klicket: spärren sitter på servern och svarar med ett fel, men ett
// fel som dyker upp efter att man tryckt lär bara ut att knappen är trasig. Listan säger i stället
// vad som fattas och var det rättas — och eftersom både den och spärren läser
// `evaluateWorkOrderReadiness` kan de inte säga emot varandra.
//
// Delad av offertformuläret och den delade offertpanelen (offertlistan + säljtavlan).

type Props = {
  blockers: WorkOrderReadinessIssue[];
  warnings: WorkOrderReadinessIssue[];
  /** Kundkortet — där adress, telefon, org.nr och personnummer faktiskt går att rätta. */
  customerHref?: string | null;
  /**
   * Alternativ till `customerHref` för ytor som måste göra något innan de lämnar sidan.
   * Offertformuläret lägger undan säljarens osparade utkast först — en rak länk därifrån hade
   * ätit upp arbetet på vägen till kundkortet. Vinner över `customerHref` när båda är satta.
   */
  onOpenCustomerCard?: (() => void) | null;
  /** Offertens redigeringsvy. Utelämnas när man redan står i den. */
  quoteHref?: string | null;
  /**
   * Hämtar kontrollen på nytt. Knappen till arbetsordern är avstängd så länge något saknas, och
   * uppgifterna rättas på en ANNAN sida — utan en väg att kontrollera om blir en rättning som
   * gjorts i en annan flik osynlig här, och knappen sitter kvar avstängd utan förklaring.
   */
  onRecheck?: (() => void) | null;
  /** Sant medan omkontrollen pågår. */
  rechecking?: boolean;
  className?: string;
};

const actionClass = 'rounded-lg border border-rose-300 bg-white px-2.5 py-1 text-[11px] font-medium text-rose-700 transition hover:border-rose-400';

function IssueList({ issues, tone }: { issues: WorkOrderReadinessIssue[]; tone: 'blocker' | 'warning' }) {
  return (
    <ul className="m-0 grid list-none gap-1 p-0">
      {issues.map((issue) => (
        <li key={issue.field} className="flex gap-2 text-[11px] leading-snug">
          <span aria-hidden className={cn('mt-[3px] h-1.5 w-1.5 shrink-0 rounded-full', tone === 'blocker' ? 'bg-rose-400' : 'bg-amber-400')} />
          <span>
            <span className="font-semibold">{issue.label}.</span>{' '}
            <span className="font-normal">{issue.message}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

export default function WorkOrderReadinessNotice({ blockers, warnings, customerHref, onOpenCustomerCard, quoteHref, onRecheck, rechecking = false, className }: Props) {
  if (blockers.length === 0 && warnings.length === 0) return null;

  // Bara de länkar som någon av fynden faktiskt pekar på — en "Öppna kundkortet" bredvid ett fynd
  // som rättas i offerten skickar säljaren åt fel håll.
  const needsCustomerCard = blockers.some((b) => b.fixAt === 'customer_card');
  const needsQuote = blockers.some((b) => b.fixAt === 'quote');

  return (
    <div className={cn('grid gap-2.5', className)}>
      {blockers.length > 0 ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-3 text-rose-800">
          <p className="m-0 mb-1.5 text-xs font-semibold">
            {blockers.length === 1 ? 'En uppgift saknas' : `${blockers.length} uppgifter saknas`} innan arbetsordern kan skapas
          </p>
          <IssueList issues={blockers} tone="blocker" />
          {(needsCustomerCard && (onOpenCustomerCard || customerHref)) || (needsQuote && quoteHref) || onRecheck ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {needsCustomerCard && onOpenCustomerCard ? (
                <button type="button" onClick={onOpenCustomerCard} className={actionClass}>
                  Öppna kundkortet
                </button>
              ) : needsCustomerCard && customerHref ? (
                <Link href={customerHref} className={actionClass}>
                  Öppna kundkortet
                </Link>
              ) : null}
              {needsQuote && quoteHref ? (
                <Link href={quoteHref} className={actionClass}>
                  Öppna offerten
                </Link>
              ) : null}
              {onRecheck ? (
                <button type="button" onClick={onRecheck} disabled={rechecking} className={cn(actionClass, 'disabled:opacity-60')}>
                  {rechecking ? 'Kontrollerar…' : 'Kontrollera igen'}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {warnings.length > 0 ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3 text-amber-800">
          <p className="m-0 mb-1.5 text-xs font-semibold">Värt att fylla i först</p>
          <IssueList issues={warnings} tone="warning" />
        </div>
      ) : null}
    </div>
  );
}
