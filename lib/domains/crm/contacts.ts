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
// The trouble was never the split — it was that no write path filled both halves (the customer
// form wrote only the card, the prospect form only a contact row) and every read site then
// guessed its own precedence. Three different orders across eight call sites meant the same
// customer could get the offer, the order confirmation and the Fortnox e-mail at three
// different addresses.
//
// One rule, everywhere: a named contact person wins when one exists, otherwise the card.
// Resolved FIELD BY FIELD, so a contact with a name but no phone still falls back to the
// card's number instead of resolving to nothing.
//
// The field-by-field part is load-bearing, not just defensive: a PRIVATE customer gets an
// automatic primary contact row carrying ONLY the person's name (createCrmCustomer), precisely
// so "Er referens" fills itself while telephone and e-mail keep coming from the card. Copying
// the channels into that row would freeze an address that is later corrected on the card.
// Anything reading a contact row directly must go through here — two pickers that read
// `contact.phone` raw would otherwise blank a number the card had already supplied.
//
// ⚠️ MED ETT UNDANTAG: E-POSTEN LÅNAS INTE UT TILL EN NAMNGIVEN PERSON PÅ ETT FÖRETAG.
//
// Kortets kanaler tillhör KUNDEN. På en privatkund ÄR kunden personen på kontaktraden — vår
// automatiska rad bär bara hens namn — så lånet är korrekt där. På ett företag är kortets adress
// bolagets växel/inkorg, och att låna ut den åt en anställd satte en persons namn bredvid en
// annans adress: ordern visade "Jonas" med Roberts e-post. En kontaktperson utan egen adress
// resolvar därför till TOM på en företagskund, inte till kortets.
//
// Telefonen lånas fortfarande ut, med flit. Ett nummer är en väg fram — växeln kopplar — medan en
// e-postadress läses som en identitet. Och `evaluateWorkOrderReadiness` SPÄRRAR på att det finns
// ett nummer: slutade telefonen lånas skulle företagsordrar vars kontaktperson saknar direktnummer
// börja fällas, alltså raka motsatsen till en städning.
//
// ⚠️ Undantaget kräver att `customer_type` finns med i selecten. Saknas det (undefined) beter sig
// funktionen som förut och lånar ut adressen — medvetet, så att en yta som inte valt ut fältet
// inte tyst tömmer e-posten för alla privatkunder. Läser du ut en FÖRETAGSKUNDS e-post här: ta med
// `customer_type`.
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
  /** Avgör om kortets e-post får lånas ut åt kontaktraden — se huvudet. Utelämnad = som förut. */
  customer_type?: 'business' | 'private' | null;
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
  // En namngiven person på ett FÖRETAG får inte ärva bolagets adress — se huvudet. Villkoret är
  // NAMNET, inte att raden finns: utan namn finns ingen att felaktigt tillskriva adressen, och
  // kortets egen är då fortfarande rätt svar.
  const namedPerson = Boolean(contact?.name?.trim());
  const borrowsCardEmail = !namedPerson || customer.customer_type !== 'business';
  return {
    name: contact?.name?.trim() || '',
    email: contact?.email?.trim() || (borrowsCardEmail ? customer.email?.trim() || '' : ''),
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

/**
 * Where a saved document (offer, order confirmation) can be e-mailed, most likely first.
 *
 * The address stored on the document's own snapshot is the point-in-time truth and leads —
 * but it is not the only option, because the snapshot freezes when the document is created:
 * a contact added afterwards, or a locked offer whose snapshot can no longer be edited, would
 * otherwise be unreachable. The customer's current addresses follow, de-duplicated.
 */
export function documentRecipients(
  snapshotEmail: string | null | undefined,
  customer: CrmContactSource | null,
  /** What to call the snapshot address, e.g. "Från offerten". */
  snapshotLabel = 'Från dokumentet',
): Array<{ email: string; label: string }> {
  const fromCustomer = customer ? crmContactRecipients(customer) : [];
  const snapshot = snapshotEmail?.trim();
  if (!snapshot) return fromCustomer;

  // Prefer the customer's own label ("Anna") over the generic one when it's the same address.
  const known = fromCustomer.find((r) => r.email.toLowerCase() === snapshot.toLowerCase());
  return known
    ? [known, ...fromCustomer.filter((r) => r !== known)]
    : [{ email: snapshot, label: snapshotLabel }, ...fromCustomer];
}
