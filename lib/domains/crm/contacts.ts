// How to reach a CRM customer: one shared resolution rule for name/e-mail/phone.
//
// A customer's contact details live in TWO places, and both are legitimate:
//
//   crm_customers.email / phone / mobile   — the customer's own channel. Mirrors the Fortnox
//                                            customer 1:1 (Email / Phone1 / Phone2).
//   crm_customer_contacts                  — named people at the customer. CRM-only; Fortnox
//                                            has no contact-person entity, it only carries the
//                                            chosen person's NAME as the YourReference string.
//
// The trouble was never the split — it was that no write path fills both halves (the customer
// form writes only the card, the prospect form writes only a contact row) and every read site
// then guessed its own precedence. Three different orders across eight call sites meant the
// same customer could get the offer, the order confirmation and the Fortnox e-mail at three
// different addresses.
//
// One rule, everywhere: a named contact person wins when one exists, otherwise the card.
// Resolved FIELD BY FIELD, so a contact with a name but no e-mail still falls back to the
// card's address instead of resolving to nothing.
//
// Deliberately pure and dependency-free so both server domain code and client components can
// import it (same as `pricing.ts`).

export type CrmContactRow = {
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  is_primary?: boolean | null;
};

export type CrmContactSource = {
  email?: string | null;
  phone?: string | null;
  mobile?: string | null;
  contacts?: CrmContactRow[] | null;
};

export type ResolvedCrmContact = {
  /** Named contact person, or '' when the customer has no contact rows. */
  name: string;
  email: string;
  phone: string;
};

/** The contact row a document defaults to: the primary one, else the first. */
export function primaryCrmContact(customer: CrmContactSource): CrmContactRow | null {
  const contacts = customer.contacts ?? [];
  return contacts.find((c) => c.is_primary) || contacts[0] || null;
}

/**
 * Resolve who to address and how to reach them. Pass any customer shape carrying the card
 * fields and (optionally) its contact rows — the select must include `email, phone, mobile`
 * for the fallback to work at all.
 *
 * Pass `preferContact` to honour a contact explicitly chosen for this document (e.g. the
 * offer's "Er referens") instead of the customer's primary contact.
 */
export function resolveCrmContact(
  customer: CrmContactSource,
  preferContact?: CrmContactRow | null,
): ResolvedCrmContact {
  const contact = preferContact ?? primaryCrmContact(customer);
  return {
    name: contact?.name?.trim() || '',
    email: contact?.email?.trim() || customer.email?.trim() || '',
    phone: contact?.phone?.trim() || customer.phone?.trim() || customer.mobile?.trim() || '',
  };
}

/**
 * Every address a document could be sent to, most likely first, de-duplicated. Backs the
 * recipient picker: named contacts (with an e-mail) first, then the customer card.
 */
export function crmContactRecipients(
  customer: CrmContactSource,
): Array<{ email: string; label: string }> {
  const seen = new Set<string>();
  const recipients: Array<{ email: string; label: string }> = [];

  const add = (email: string | null | undefined, label: string) => {
    const address = email?.trim();
    if (!address) return;
    const key = address.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    recipients.push({ email: address, label });
  };

  const contacts = customer.contacts ?? [];
  const primary = primaryCrmContact(customer);
  if (primary) add(primary.email, primary.name?.trim() || 'Kontaktperson');
  for (const contact of contacts) {
    if (contact === primary) continue;
    add(contact.email, contact.name?.trim() || 'Kontaktperson');
  }
  add(customer.email, 'Kundens adress');

  return recipients;
}
