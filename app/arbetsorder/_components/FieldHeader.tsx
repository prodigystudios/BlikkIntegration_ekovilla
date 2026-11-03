"use client";

import type { MouseEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/shared/cn';
import { crm } from '@/app/crm/lib/crmTokens';
import { telHref } from '@/app/crm/components/ContactLinks';
import { mapsSearchHref } from '@/lib/domains/planning/scheduleStops';
import type { FieldViewHeading } from '../fieldView';
import { ChevronLeftIcon, FIELD_FOCUS_RING as FOCUS_RING, PhoneIcon, PinIcon } from './fieldUi';

/**
 * "‹ Mitt schema" — tillbaka dit man kom ifrån, eller till startsidan.
 *
 * ⚠️ EN LÄNK, INTE EN KNAPP. Ett vanligt klick med historik i appen går BAKÅT (schemat eller Mina jobb,
 * med scrollen kvar) — precis som den gamla "← Tillbaka". Utan historik — en ny flik, appen öppnad
 * från en notis — finns inget bakåt, och då är länkens eget mål startsidan, där schemat står. En
 * <button onClick={router.back}> hade gjort ingenting i det läget, och tappat mittenklick.
 */
export function BackToSchedule() {
  const router = useRouter();
  function onClick(event: MouseEvent<HTMLAnchorElement>) {
    // Mittenklick, ⌘/Ctrl-klick och shift: låt webbläsaren öppna länken som vanligt.
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (window.history.length <= 1) return;
    event.preventDefault();
    router.back();
  }
  return (
    <Link
      href="/"
      onClick={onClick}
      className={cn('-ml-1.5 inline-flex h-11 items-center gap-1.5 rounded-xl pl-1.5 pr-3 text-[15px] font-semibold text-[color:var(--ek-green)] no-underline', FOCUS_RING)}
    >
      <ChevronLeftIcon />
      Mitt schema
    </Link>
  );
}

type Props = {
  orderRef: string;
  statusLabel: string;
  statusClass: string;
  heading: FieldViewHeading;
  clientName: string;
  plannedDate: string;
  /** Redan prövat med callablePhone. null = ingen Ring-knapp. */
  phone: string | null;
};

export default function FieldHeader({ orderRef, statusLabel, statusClass, heading, clientName, plannedDate, phone }: Props) {
  const action = 'inline-flex h-[52px] min-w-0 items-center justify-center gap-2 rounded-[14px] px-3 text-[15px] font-semibold no-underline';
  return (
    <header className="grid gap-4">
      <div className="flex items-center justify-between gap-3">
        <BackToSchedule />
        <span className="text-[13px] font-semibold tabular-nums text-slate-600">{orderRef}</span>
      </div>

      <div className="grid gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn(crm.badge, statusClass, 'text-xs')}>{statusLabel}</span>
        </div>
        <h1 className="m-0 mt-1 break-words text-[26px] font-bold leading-tight tracking-[-0.02em] text-slate-900">{heading.title}</h1>
        {heading.place ? <p className="m-0 text-base text-slate-700">{heading.place}</p> : null}
        {heading.project ? <p className="m-0 text-sm font-medium text-slate-700">{heading.project}</p> : null}
        <p className="m-0 text-sm text-slate-600">{clientName} · Planerad {plannedDate}</p>
        {heading.delivery ? <p className="m-0 text-[13px] text-slate-600">Leverans: {heading.delivery}</p> : null}
      </div>

      {/* Vägbeskrivning och Ring kund — de två saker man gör med jobbet i handen innan man kliver
          in. Saknas det ena tar det andra hela bredden.

          ⚠️ "Ring kund" även när numret går till slutkunden på plats (William 2026-11-03: mot de
          anställda är det kunden oavsett). Vem det faktiskt är står på kontaktkortet längre ner. */}
      {heading.mapsQuery || phone ? (
        <div className={cn('grid gap-2', heading.mapsQuery && phone ? 'grid-cols-2' : 'grid-cols-1')}>
          {heading.mapsQuery ? (
            <a
              href={mapsSearchHref(heading.mapsQuery)}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(action, 'bg-[var(--ek-green)] text-white', FOCUS_RING, 'focus-visible:ring-offset-2')}
            >
              <PinIcon />
              Vägbeskrivning
              <span className="sr-only"> (öppnas i ny flik)</span>
            </a>
          ) : null}
          {phone ? (
            <a
              href={telHref(phone)}
              className={cn(action, 'border border-solid border-[color:var(--ek-accent-soft-border)] bg-white text-[color:var(--ek-green)]', FOCUS_RING)}
            >
              <PhoneIcon />
              Ring kund
            </a>
          ) : null}
        </div>
      ) : null}
    </header>
  );
}
