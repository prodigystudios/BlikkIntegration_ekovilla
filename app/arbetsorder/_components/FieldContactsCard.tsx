import Link from 'next/link';
import type { ReactNode } from 'react';
import { cn } from '@/lib/shared/cn';
import { telHref } from '@/app/crm/components/ContactLinks';
import { callablePhone } from '@/lib/domains/planning/scheduleStops';
import { FIELD_CARD, FIELD_DIVIDER, FIELD_FOCUS_RING, FIELD_SECTION_TITLE, PhoneIcon } from './fieldUi';

type Contact = {
  contactName: string | null;
  phone: string | null;
  email: string | null;
  /** Slutkunden på plats — en ANNAN person än kundens kontakt. */
  onSite: boolean;
  /** Numret är lånat av kunden för att kontakten på plats saknar eget. */
  phoneFromCustomer: boolean;
};

type Props = {
  contact: Contact;
  clientName: string;
  assignee: { name: string | null; phone: string | null } | null;
};

function ContactRow({ name, role, phone, ringLabel, children }: { name: string; role: string; phone: string | null; ringLabel: string; children?: ReactNode }) {
  const callable = callablePhone(phone);
  return (
    <div className={cn('flex items-center gap-3 px-4 py-3 first-of-type:border-t-0', FIELD_DIVIDER)}>
      <div className="grid min-w-0 flex-1 gap-0.5">
        <p className="m-0 break-words text-[15px] font-semibold text-slate-900">{name}</p>
        <p className="m-0 text-[13px] text-slate-600">
          {role}
          {phone ? <span className="tabular-nums"> · {phone}</span> : null}
        </p>
        {children}
      </div>
      {callable ? (
        <a
          href={telHref(callable)}
          aria-label={ringLabel}
          className={cn('inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--ek-accent-soft)] text-[color:var(--ek-green)]', FIELD_FOCUS_RING)}
        >
          <PhoneIcon />
        </a>
      ) : null}
    </div>
  );
}

export default function FieldContactsCard({ contact, clientName, assignee }: Props) {
  const hasContact = Boolean(contact.phone || contact.email || contact.contactName);
  if (!hasContact && !assignee) return null;

  // ⚠️ Kundnamnet får INTE fylla i för en namnlös SLUTKUND. Både offerten och ordervyn släpper igenom
  // en slutkund med bara telefon, och då skrev kortet ut byggarens bolagsnamn över fastighetsägarens
  // nummer — alltså en påhittad identitet, inte en saknad. För kundens egen kontakt är fallbacken
  // däremot rätt: där ÄR kunden den personen när ingen kontakt fångats.
  const contactName = contact.contactName || (contact.onSite ? 'Namn saknas' : clientName);

  return (
    <section className={cn(FIELD_CARD, 'overflow-hidden p-0')} aria-labelledby="field-contacts-title">
      <h2 id="field-contacts-title" className={cn(FIELD_SECTION_TITLE, 'px-4 pb-1 pt-4')}>Kontakter</h2>

      {/* ⚠️ RADENS ROLL MÅSTE FÖLJA VEM UPPGIFTERNA GÄLLER. `getWorkOrderCustomerContact` svarar med
          slutkunden när ordern har en, och hen är en ANNAN person än kundens kontakt — en byggare
          beställer, fastighetsägaren står på plats. Kortet skrev "Kundkontakt" över båda, så
          besättningen kunde ringa och presentera sig för fel person. Den stora knappen i huvudet
          heter "Ring kund" oavsett (Williams beslut 2026-11-03) — skillnaden står här. */}
      {hasContact ? (
        <ContactRow
          name={contactName}
          role={contact.onSite ? 'Kontakt på plats' : 'Kundkontakt'}
          phone={contact.phone}
          ringLabel={contact.onSite ? `Ring kontakten på plats, ${contactName}` : `Ring ${contactName}`}
        >
          {contact.email ? (
            <a
              href={`mailto:${contact.email}`}
              className="-my-2 inline-flex min-h-11 w-fit items-center break-all text-[13px] font-medium text-[color:var(--ek-accent)] underline underline-offset-2"
            >
              {contact.email}
            </a>
          ) : null}
          {/* Lånat nummer måste säga vems det är. Slutkunden fångas ofta med bara namn, och då lånar
              uppslaget kundens nummer så att besättningen kan nå NÅGON — men utan den här raden läses
              det som slutkundens, och man ringer och frågar efter fel person. */}
          {contact.onSite && contact.phoneFromCustomer && contact.phone ? (
            <p className="m-0 text-[13px] text-slate-600">Numret går till kundens kontakt – kontakten på plats har inget eget.</p>
          ) : null}
        </ContactRow>
      ) : null}

      {/* Ansvarig säljare — vem på kontoret som sålde jobbet, alltså vem man ringer när något på ordern
          inte stämmer. Utan den fick besättningen gissa, eller ringa kunden om en uppgift kunden inte
          äger.

          ⚠️ STÅR DIREKT UNDER KUNDEN OCH SER LIKADAN UT — därför måste rollen och hjälptexten göra
          skillnaden. Två ringknappar i rad är precis den yta där man trycker på fel nummer, och att
          ringa kunden med en fråga om arbetsordern är värre än att inte ringa alls.

          Renderas inte alls när ordern är otilldelad eller den ansvariges profil är tom. */}
      {assignee ? (
        <ContactRow
          name={assignee.name || 'Namn saknas'}
          role="Ansvarig säljare"
          phone={assignee.phone}
          ringLabel={`Ring säljaren${assignee.name ? `, ${assignee.name}` : ''}`}
        >
          {assignee.phone ? (
            <p className="m-0 text-[13px] text-slate-600">Ring om något inte stämmer i arbetsordern.</p>
          ) : (
            // Numret kommer ur den ansvariges egen profil och kan mycket väl saknas där. Säg det rakt
            // ut och peka på listan som har det, i stället för att låta raden se trasig ut.
            <p className="m-0 text-[13px] text-slate-600">
              Inget nummer i profilen –{' '}
              <Link href="/kontakt-lista" className="-my-2 inline-flex min-h-11 items-center font-semibold text-[color:var(--ek-accent)] underline underline-offset-2">
                sök i Kontaktlistan
              </Link>
            </p>
          )}
        </ContactRow>
      ) : null}
    </section>
  );
}
