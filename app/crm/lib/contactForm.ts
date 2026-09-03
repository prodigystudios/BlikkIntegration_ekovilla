// Ren logik bakom kontaktpersonsformuläret — typerna, utkastet och nyttolasten till API:t.
//
// Bor i en egen modul (utan "use client") därför att formuläret öppnas från TRE håll: kundkortet,
// offertpanelen och offertformuläret. Reglerna för VAD som skickas får inte finnas i tre kopior som
// kan driva isär. Samma uppdelning som app/crm/lib/taskForm.ts, och av samma skäl.
//
// Enhetstestas mot det RIKTIGA Zod-schemat i tests/crm/contactForm.test.ts.

/** En kontaktrad som API:t returnerar (crm_customer_contacts). */
export type CrmContactItem = {
  id: string;
  name: string;
  role: string | null;
  phone: string | null;
  email: string | null;
  is_primary: boolean;
};

export type ContactDraft = {
  name: string;
  role: string;
  phone: string;
  email: string;
  is_primary: boolean;
};

export const initialContactDraft: ContactDraft = {
  name: '',
  role: '',
  phone: '',
  email: '',
  is_primary: false,
};

/** Utkastet som speglar en befintlig kontaktrad. */
export function draftFromContact(contact: CrmContactItem): ContactDraft {
  return {
    name: contact.name || '',
    role: contact.role || '',
    phone: contact.phone || '',
    email: contact.email || '',
    is_primary: contact.is_primary,
  };
}

/**
 * Nyttolasten till POST /api/crm/customers/[id]/contacts och PATCH på samma rad.
 *
 * 🧨 TOMMA FÄLT MÅSTE BLI `null`, ALDRIG TOM STRÄNG. `intlEmail` i app/api/crm/customers/_lib.ts
 * prövar `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` FÖRE `.nullable()`, så en tom sträng är inte "ingen adress"
 * — den är en ogiltig adress, och hela sparningen svarar 400 med "Ogiltig e-post" på ett fält
 * säljaren medvetet lämnade tomt. Samma regel för roll och telefon, där tom sträng visserligen
 * passerar valideringen men skulle lagras som `''` och sedan läsas som ett värde av
 * `resolveCrmContact` (`contact?.email?.trim() || …` räddar den, men lita inte på det).
 *
 * 🧨 Fältnamnen måste matcha createCrmCustomerContactSchema exakt. Zod strippar okända nycklar
 * TYST — ett felstavat fältnamn försvinner utan ett ord, precis som `prospect_id` gjorde på
 * uppföljningsuppgiften i över ett år. Testet prövar därför nyttolasten mot det riktiga schemat.
 */
export function buildContactPayload(draft: ContactDraft) {
  return {
    name: draft.name.trim(),
    role: draft.role.trim() || null,
    phone: draft.phone.trim() || null,
    email: draft.email.trim() || null,
    is_primary: draft.is_primary,
  };
}

/** Namnet krävs — allt annat är frivilligt. Delad av modalen och testet. */
export function contactDraftError(draft: ContactDraft): string | null {
  return draft.name.trim() ? null : 'Namn krävs';
}
