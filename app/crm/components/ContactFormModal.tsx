"use client";

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import Input from '@/components/ui/Input';
import CrmModal from '@/app/crm/components/CrmModal';
import { useToast } from '@/lib/Toast';
import { cn } from '@/lib/shared/cn';
import { crm } from '@/app/crm/lib/crmTokens';
import {
  buildContactPayload,
  contactDraftError,
  draftFromContact,
  initialContactDraft,
  type ContactDraft,
  type CrmContactItem,
} from '@/app/crm/lib/contactForm';

// Kontaktpersonsformuläret — ETT formulär, TRE ingångar: kundkortet, offertpanelen och
// offertformuläret.
//
// Skrivningen går genom de BEFINTLIGA rutterna (POST /api/crm/customers/[id]/contacts,
// PATCH på samma rad). Ingen ny skrivväg och ingen ny behörighetslogik: båda gatar på
// crm.customer.write, och RLS på crm_customer_contacts ärver kundens synlighet.
//
// ⚠️ INGEN BORTTAGNING här, med flit. Att radera en kunds kontaktperson är ett registervårdsbeslut
// och hör hemma på kundkortet, där knappen redan finns och listan visar alla rader. Från en offert
// ska man kunna lägga till och rätta — inte städa i kundregistret av misstag.
//
// 📐 PORTALERAS TILL `body`, precis som TaskFormModal och av exakt samma skäl: offertpanelen har
// `backdrop-filter: blur(4px)`, och en förfader med filter gör `position: fixed` relativ mot
// FÖRFADERN i stället för fönstret — dialogen hade klippts av panelens scrollande kropp.
//
// 🧨 `crm-shell`-svepet är INTE dekoration. `--crm-primary` är scopad till DEN klassen
// (app/globals.css), inte till :root — en portal till `body` hamnar utanför skalet, variabeln blir
// odefinierad och sparaknappen blir vit text på ingen bakgrund. Osynlig knapp, inget felmeddelande,
// inget i konsolen.

export default function ContactFormModal({
  customerId,
  contact,
  onClose,
  onSaved,
}: {
  /** Kunden kontakten hör till. Rutten är kundscopad — utan id finns ingenstans att spara. */
  customerId: string;
  /** Kontakten som redigeras, eller null för en ny. */
  contact: CrmContactItem | null;
  onClose: () => void;
  /** Den sparade raden. `isEditing` avgör om konsumenten ska ersätta eller lägga till. */
  onSaved: (item: CrmContactItem, meta: { isEditing: boolean }) => void;
}) {
  const toast = useToast();
  const isEditing = Boolean(contact);

  // Portalen får inte finnas vid serverrenderingen — `document` saknas då. Samma vakt som
  // TaskFormModal använder.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const [draft, setDraft] = useState<ContactDraft>(() =>
    contact ? draftFromContact(contact) : initialContactDraft);
  const [submitting, setSubmitting] = useState(false);

  // Sidan bakom får inte gå att skrolla medan formuläret står öppet. Det tidigare värdet
  // återställs i stället för att nollas — offertpanelen kan ha satt sitt eget.
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; };
  }, []);

  async function saveContact() {
    const error = contactDraftError(draft);
    if (error) { toast.error(error); return; }

    setSubmitting(true);
    try {
      const res = await fetch(
        isEditing
          ? `/api/crm/customers/${customerId}/contacts/${contact!.id}`
          : `/api/crm/customers/${customerId}/contacts`,
        {
          method: isEditing ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(buildContactPayload(draft)),
        },
      );
      const json = await res.json().catch(() => ({}));

      if (!res.ok || !json.ok) {
        toast.error(json?.error || 'Kunde inte spara kontaktpersonen');
        return;
      }

      const item = json?.data?.item as CrmContactItem | undefined;
      if (item) onSaved(item, { isEditing });
      toast.success(isEditing ? 'Kontaktperson uppdaterad' : 'Kontaktperson tillagd');
      onClose();
    } catch {
      toast.error('Fel vid sparande av kontaktperson');
    } finally {
      setSubmitting(false);
    }
  }

  // Efter alla hookar — rules-of-hooks.
  if (!mounted) return null;

  return createPortal(
    <div className="crm-shell">
      <CrmModal
        onClose={onClose}
        ariaLabel={isEditing ? 'Redigera kontaktperson' : 'Ny kontaktperson'}
        maxWidth="sm:max-w-[520px]"
        header={
          <>
            <h2 className="text-lg font-bold text-slate-900">
              {isEditing ? 'Redigera kontaktperson' : 'Ny kontaktperson'}
            </h2>
            <p className={cn('mt-0.5', crm.pageSubtitle)}>
              Sparas på kunden och blir tillgänglig på alla offerter och ordrar.
            </p>
          </>
        }
        footer={
          <>
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-xl border border-slate-200 bg-white py-2.5 text-sm font-semibold text-slate-600 transition hover:border-slate-300 sm:flex-none sm:px-5"
            >
              Avbryt
            </button>
            <button
              type="button"
              onClick={saveContact}
              disabled={submitting}
              className="flex-1 rounded-xl py-2.5 text-sm font-semibold text-white shadow-sm transition hover:brightness-95 disabled:opacity-60 sm:ml-auto sm:flex-none sm:px-5"
              style={{ backgroundColor: 'var(--crm-primary)' }}
            >
              {submitting ? 'Sparar…' : isEditing ? 'Spara ändringar' : 'Lägg till'}
            </button>
          </>
        }
      >
        <div className="grid gap-4">
          <div>
            <label htmlFor="contact-name" className={cn('mb-1.5 block', crm.sectionTitle)}>Namn *</label>
            <Input
              id="contact-name"
              value={draft.name}
              onChange={(e) => setDraft((c) => ({ ...c, name: e.target.value }))}
              placeholder="Anna Svensson"
              autoFocus
            />
          </div>

          <div>
            <label htmlFor="contact-role" className={cn('mb-1.5 block', crm.sectionTitle)}>Roll</label>
            <Input
              id="contact-role"
              value={draft.role}
              onChange={(e) => setDraft((c) => ({ ...c, role: e.target.value }))}
              placeholder="t.ex. Platschef eller Inköpare"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="contact-phone" className={cn('mb-1.5 block', crm.sectionTitle)}>Telefon</label>
              <Input
                id="contact-phone"
                value={draft.phone}
                onChange={(e) => setDraft((c) => ({ ...c, phone: e.target.value }))}
                placeholder="070-123 45 67"
                inputMode="tel"
              />
            </div>
            <div>
              <label htmlFor="contact-email" className={cn('mb-1.5 block', crm.sectionTitle)}>E-post</label>
              <Input
                id="contact-email"
                value={draft.email}
                onChange={(e) => setDraft((c) => ({ ...c, email: e.target.value }))}
                placeholder="anna@foretaget.se"
                type="email"
              />
            </div>
          </div>

          {/* 🧨 `w-auto` — `:where(label){display:block;width:100%}` i globals.css gör annars
              etiketten 100 % bred, och då knuffar den sig själv till en egen rad. `flex` slår
              display, men bredden står kvar tills en klass tar över den. */}
          <label className="flex w-auto cursor-pointer select-none items-center gap-2.5 rounded-xl border border-[#e3e9df] bg-[#f6f9f3] px-4 py-3 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={draft.is_primary}
              onChange={(e) => setDraft((c) => ({ ...c, is_primary: e.target.checked }))}
              className="h-4 w-4 shrink-0 rounded border-slate-300 accent-[color:var(--ek-accent)]"
            />
            <span className="grid gap-0.5">
              <span className="font-medium">Primär kontakt</span>
              {/* Servern degraderar syskonen (demoteOtherPrimaryContacts) — bara EN primär per
                  kund. Att säga det här hindrar frågan "varför tappade den andra sin bricka?". */}
              <span className="text-[11px] leading-snug text-slate-500">
                Blir kundens förvalda kontakt på nya offerter. Den som är primär idag blir vanlig kontakt.
              </span>
            </span>
          </label>
        </div>
      </CrmModal>
    </div>,
    document.body,
  );
}
