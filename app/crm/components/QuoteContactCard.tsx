"use client";

import { useEffect, useState } from 'react';
import { cn } from '@/lib/shared/cn';
import { PhoneLink, EmailLink } from '@/app/crm/components/ContactLinks';
import ContactFormModal from '@/app/crm/components/ContactFormModal';
import type { CrmContactItem } from '@/app/crm/lib/contactForm';
import {
  contactRowByName,
  resolveDocumentReferenceContact,
  type DocumentContactSnapshot,
} from '@/lib/domains/crm/contacts';

// Vem man ringer om offerten — direkt i offertpanelen.
//
// Utan det här kortet fanns numret ingenstans på offerten: säljaren fick gå in i "Redigera offert"
// eller ända in på kundkortet mitt i en uppföljning. Kortet visar tre saker, i den ordning man
// behöver dem:
//
//   1. ER REFERENS — personen offerten står på. Löses med den DELADE regeln
//      (resolveDocumentReferenceContact): offertens snapshot vinner, luckorna fylls ur den kortrad
//      namnet syftar på. Samma svar som arbetsordern och fältvyn ger om samma person.
//   2. KONTAKT PÅ ARBETSPLATSEN — slutkunden, när jobbet utförs åt någon annan än ordergivaren.
//   3. KUNDENS ÖVRIGA KONTAKTPERSONER — här bor platschefen och inköparen.
//
// ⚠️ Kortet SKRIVER ALDRIG i offerten. Att lägga till en kontaktperson sparar på KUNDEN; offertens
// "Er referens" är en ögonblicksbild som ändras i offertformuläret. Annars hade en uppföljning
// tyst skrivit om ett dokument kunden redan fått — och synkat om det till Fortnox.
//
// ⚠️ Arbetsplatskontakten visas med sina EGNA fält, utan lån. Fältvyn lånar kundens nummer när
// slutkunden saknar eget (någon måste gå att nå på plats), men där visas bara EN kontakt. Här står
// ordergivarens nummer redan ovanför, så ett lån hade bara sett ut som att slutkunden har numret.

type QuoteContactCardProps = {
  /** Kunden offerten är kopplad till. null för en prospekt-/snapshotoffert — då finns inget kort. */
  customerId: string | null;
  /** Offertens frysta kunduppgifter. */
  snapshot: DocumentContactSnapshot | null;
  /** crm.customer.write. Utan den visas kortet som läsvy. */
  canEditContacts: boolean;
};

/**
 * Kundkortet som det här kortet läser det.
 *
 * ⚠️ Skrivs ut i sin helhet i stället för `CrmContactSource & { contacts: CrmContactItem[] }`.
 * Intersektionen ger `contacts` typen `(CrmContactRow[] | null) & CrmContactItem[]`, och då tappar
 * `contactRowByName` sin inferens och svarar `CrmContactRow` — utan `id` och `role`, alltså precis
 * de två fält kortet behöver. Formen uppfyller `CrmContactSource` strukturellt ändå.
 */
type CustomerCard = {
  customer_type: 'business' | 'private' | null;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  contacts: CrmContactItem[];
};

function ContactLines({ phone, email }: { phone: string | null; email: string | null }) {
  if (!phone && !email) {
    return <p className="m-0 text-[11px] text-slate-400">Inga kontaktuppgifter registrerade.</p>;
  }
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-0.5 text-xs">
      {phone ? <PhoneLink value={phone} /> : null}
      {email ? <EmailLink value={email} /> : null}
    </div>
  );
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return <p className="m-0 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">{children}</p>;
}

export default function QuoteContactCard({ customerId, snapshot, canEditContacts }: QuoteContactCardProps) {
  const [card, setCard] = useState<CustomerCard | null>(null);
  const [loading, setLoading] = useState(Boolean(customerId));
  // null = stängd. `{ contact: null }` = ny, `{ contact }` = redigera.
  const [formTarget, setFormTarget] = useState<{ contact: CrmContactItem | null } | null>(null);
  // Bumpas efter en sparning. En omhämtning i stället för att peta i listan för hand: sätter man
  // en kontakt till primär degraderar SERVERN syskonen (demoteOtherPrimaryContacts), och en lokal
  // lista hade då visat två primärbrickor tills panelen öppnades om.
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!customerId) { setCard(null); setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    fetch(`/api/crm/customers/${customerId}`, { cache: 'no-store' })
      .then((r) => r.json().catch(() => ({})))
      .then((json) => {
        if (cancelled) return;
        const c = json?.ok ? json.data?.item : null;
        setCard(c ? {
          // ⚠️ customer_type MÅSTE med: det avgör om kortets e-post får lånas ut åt kontaktraden.
          // Utan fältet står bolagets adress under en anställds namn (se contacts.ts).
          customer_type: c.customer_type ?? null,
          email: c.email ?? null,
          phone: c.phone ?? null,
          mobile: c.mobile ?? null,
          contacts: (c.contacts ?? []) as CrmContactItem[],
        } : null);
      })
      .catch(() => { if (!cancelled) setCard(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [customerId, reloadKey]);

  // Er referens — den delade regeln, samma svar som arbetsordern ger.
  const reference = resolveDocumentReferenceContact(snapshot, card);
  // Kontaktraden namnet syftar på, när det finns en. Ger oss `id` och `role`, alltså både
  // redigeraknappen och titeln.
  const referenceRow = card ? contactRowByName(card, reference.name) : null;

  const onSiteName = snapshot?.end_contact_name?.trim() || '';
  const onSitePhone = snapshot?.end_contact_phone?.trim() || '';
  const onSiteEmail = snapshot?.end_contact_email?.trim() || '';
  const hasOnSite = Boolean(onSiteName || onSitePhone || onSiteEmail);

  const others = (card?.contacts ?? []).filter((c) => c.id !== referenceRow?.id);
  const hasReference = Boolean(reference.name || reference.phone || reference.email);

  function applySavedContact() {
    // Läs om kundkortet så primär-degraderingen syns och den nya raden hamnar i rätt grupp.
    setReloadKey((key) => key + 1);
  }

  return (
    <div className="rounded-xl border border-[#e3e9df] bg-[#f9fbf7] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sky-100 text-sky-700">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
            </svg>
          </span>
          <div className="grid min-w-0 gap-0.5">
            <span className="text-sm font-semibold text-slate-800">Kontakt</span>
            <span className="text-xs leading-5 text-slate-500">
              {loading
                ? 'Hämtar…'
                : hasReference
                  ? 'Personen offerten står på. Ring eller mejla direkt härifrån.'
                  : 'Ingen kontaktperson på offerten.'}
            </span>
          </div>
        </div>
        {canEditContacts && customerId ? (
          <button
            type="button"
            onClick={() => setFormTarget({ contact: null })}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[13px] font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
            Ny kontaktperson
          </button>
        ) : null}
      </div>

      {loading ? (
        <div className="mt-3 grid gap-1.5">
          <div className="h-12 animate-pulse rounded-lg bg-[#dfe6da]" />
        </div>
      ) : (
        <div className="mt-3 grid gap-3">

          {/* ── Er referens ── */}
          {hasReference ? (
            <div className="grid gap-1.5 rounded-xl border border-slate-100 bg-white px-3 py-2.5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <GroupLabel>Er referens</GroupLabel>
                  <p className="m-0 mt-0.5 text-sm font-semibold text-slate-900">
                    {reference.name || <span className="font-normal text-slate-400">Namn saknas</span>}
                    {referenceRow?.role ? (
                      <span className="ml-1.5 text-xs font-normal text-slate-500">{referenceRow.role}</span>
                    ) : null}
                  </p>
                </div>
                {/* Redigera bara när referensen FAKTISKT är en rad på kundkortet. En snapshot vars
                    namn skrivits fritt (eller vars kontakt döpts om sedan dess) har ingen rad att
                    öppna — en knapp där hade lett till en dialog som sparar på fel person. */}
                {canEditContacts && customerId && referenceRow ? (
                  <button
                    type="button"
                    onClick={() => setFormTarget({ contact: referenceRow })}
                    className="shrink-0 border-0 bg-transparent p-0 text-[11px] font-semibold text-slate-400 transition hover:text-slate-700 hover:underline"
                  >
                    Redigera
                  </button>
                ) : null}
              </div>
              <ContactLines phone={reference.phone || null} email={reference.email || null} />
            </div>
          ) : null}

          {/* ── Kontakt på arbetsplatsen (slutkund) ── */}
          {hasOnSite ? (
            <div className="grid gap-1.5 rounded-xl border border-amber-100 bg-amber-50/50 px-3 py-2.5">
              <GroupLabel>Kontakt på arbetsplatsen</GroupLabel>
              <p className="m-0 text-sm font-semibold text-slate-900">
                {onSiteName || <span className="font-normal text-slate-400">Namn saknas</span>}
              </p>
              <ContactLines phone={onSitePhone || null} email={onSiteEmail || null} />
              {/* Slutkunden ligger utanför kundregistret — den redigeras på offerten, inte här.
                  Utan den upplysningen läses den saknade redigeraknappen som en bugg. */}
              <p className="m-0 text-[11px] leading-snug text-slate-400">
                Slutkund utanför kundkortet — ändras i offerten.
              </p>
            </div>
          ) : null}

          {/* ── Kundens övriga kontaktpersoner ── */}
          {others.length > 0 ? (
            <div className="grid gap-1.5">
              <GroupLabel>Övriga kontaktpersoner hos kunden</GroupLabel>
              {others.map((contact) => (
                <div key={contact.id} className="flex items-start justify-between gap-2 rounded-xl border border-slate-100 bg-white px-3 py-2">
                  <div className="min-w-0">
                    <p className="m-0 flex flex-wrap items-center gap-x-1.5 text-sm text-slate-800">
                      <span className="font-medium">{contact.name}</span>
                      {contact.role ? <span className="text-xs text-slate-500">{contact.role}</span> : null}
                      {contact.is_primary ? (
                        <span className="rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">
                          Primär
                        </span>
                      ) : null}
                    </p>
                    <div className="mt-0.5">
                      <ContactLines phone={contact.phone} email={contact.email} />
                    </div>
                  </div>
                  {canEditContacts && customerId ? (
                    <button
                      type="button"
                      onClick={() => setFormTarget({ contact })}
                      className="shrink-0 border-0 bg-transparent p-0 text-[11px] font-semibold text-slate-400 transition hover:text-slate-700 hover:underline"
                    >
                      Redigera
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}

          {/* Varken referens eller kontakter. Säg VARFÖR knappen saknas när offerten inte har någon
              kund — annars läses tomheten som ett fel. */}
          {!hasReference && !hasOnSite && others.length === 0 ? (
            <p className={cn('m-0 text-xs', customerId ? 'text-slate-400' : 'text-slate-500')}>
              {customerId
                ? 'Inga kontaktpersoner registrerade på kunden ännu.'
                : 'Offerten är inte kopplad till någon kund, så det finns ingenstans att spara en kontaktperson.'}
            </p>
          ) : null}
        </div>
      )}

      {formTarget && customerId ? (
        <ContactFormModal
          customerId={customerId}
          contact={formTarget.contact}
          onClose={() => setFormTarget(null)}
          onSaved={applySavedContact}
        />
      ) : null}
    </div>
  );
}
