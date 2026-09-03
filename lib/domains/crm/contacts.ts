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
// Villkoret är NAMNET, inte kontaktraden. Finns ingen namngiven person finns ingen att felaktigt
// tillskriva adressen, och kortets egen är fortfarande rätt svar. ⚠️ Följden är att en
// företagskund UTAN kontaktrader ändå tappar adressen på sin arbetsorder, eftersom offerten alltid
// bär ett namn ("Er referens" är obligatoriskt där) och `evaluateWorkOrderReadiness` slår upp det
// namnet som en namn-bara-rad. Det är regeln, inte ett förbiseende: adressen hade annars stått
// under referenspersonens namn. Mejlutskicket når den ändå — `crmContactRecipients` listar den
// separat som "Kundens adress".
//
// Telefonen lånas fortfarande ut, med flit. Ett nummer är en väg fram — växeln kopplar — medan en
// e-postadress läses som en identitet. Och `evaluateWorkOrderReadiness` SPÄRRAR på att det finns
// ett nummer: slutade telefonen lånas skulle företagsordrar vars kontaktperson saknar direktnummer
// börja fällas, alltså raka motsatsen till en städning.
//
// ⚠️ KÄND LUCKA: villkoret är kundtypen, inte "är raden kunden själv". En PRIVATkund som fått en
// EXTRA kontaktrad (en maka, en förvaltare) ärver därför fortfarande kortets adress under den
// personens namn. Att stänga den kräver kundens namn hit, till varje anropare — en större plumbing
// än luckan är värd i dag. Privatkundens automatiska rad är fortfarande huvudfallet och rätt.
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
 * Kontaktraden ett SPARAT namn syftar på, eller null.
 *
 * Ett dokument (offert, order) bär bara kontaktpersonens NAMN — inte vilken rad valet gällde. Utan
 * den här uppslagningen löses adressen mot kortets PRIMÄRA kontakt i stället, och då står den
 * valda personens namn bredvid primärkontaktens adress: precis felet regeln finns för.
 *
 * Delad av `evaluateWorkOrderReadiness` (skrivvägen) och `getWorkOrderCustomerContact` (fältvyn),
 * så samma order svarar likadant på båda hållen.
 */
export function contactRowByName(
  customer: CrmContactSource,
  name: string | null | undefined,
): CrmContactRow | null {
  // Skiftlägesokänslig: namnet skrevs in för hand på ett ställe och valdes ur en lista på ett
  // annat. En bomma här tömmer adressen enligt regeln nedan, så matchningen ska inte vara
  // strängare än nödvändigt. Ett omdöpt eller borttaget namn missar fortfarande — med flit, då
  // VET vi inte vem personen är.
  const wanted = name?.trim().toLocaleLowerCase('sv');
  if (!wanted) return null;
  return (customer.contacts ?? []).find((c) => c.name?.trim().toLocaleLowerCase('sv') === wanted) ?? null;
}

// ─── Dokumentets kontaktperson ────────────────────────────────────────────────

/** Kontaktfälten ett CRM-dokument (offert, arbetsorder) fryser i sin `customer_snapshot`. */
export type DocumentContactSnapshot = {
  contact_name?: string | null;
  phone?: string | null;
  email?: string | null;
  end_contact_name?: string | null;
  end_contact_phone?: string | null;
  end_contact_email?: string | null;
};

export type ResolvedDocumentContact = {
  contactName: string | null;
  phone: string | null;
  email: string | null;
  /** Kundens EGEN adress. Bara för utskick — visa den aldrig som kontaktpersonens. */
  customerEmail: string | null;
  /** Sant när uppgifterna är slutkundens på plats, alltså en ANNAN person än kundens kontakt. */
  isOnSiteContact: boolean;
  /**
   * Sant när `phone` är LÅNAT av kunden för att slutkunden saknar eget nummer. Numret går att
   * ringa — det är hela poängen med lånet — men det tillhör någon annan än `contactName`, och en
   * vy som skriver namnet över numret skickar folk till fel person.
   */
  phoneFromCustomer: boolean;
};

/**
 * Vem man ringer om ett CRM-dokument, i EN källa i taget — aldrig fält för fält mellan två
 * personer:
 *
 *   1. slutkunden på plats (`end_contact_*`) — lånar numret, aldrig adressen
 *   2. dokumentets egen kontakt (snapshoten) — den säljaren redigerar i offert/order
 *   3. kundkortet — sista utvägen för äldre dokument som aldrig fångade någon kontakt
 *
 * ⚠️ REN funktion, utan databasläsning. Anroparen läser snapshoten och kundkortet och skickar in
 * dem; det är därför både servern (arbetsordern, uppgiftslistan) och klienten (offertpanelen) kan
 * dela EN regel. Låg tidigare bara inne i `getWorkOrderCustomerContact`, och tre ytor som var för
 * sig gissar sin egen ordning är precis hur samma dokument börjar svara olika på olika ställen —
 * felet steg 2 ovan en gång var.
 *
 * `card` måste bära `customer_type`: det avgör om kortets e-post får lånas ut åt kontaktraden
 * (se huvudkommentaren). Utan fältet lånas den ut som förut, och då står bolagets adress under
 * en anställds namn.
 *
 * Returnerar null när det inte finns någonting att visa.
 */
export function resolveDocumentContact(
  snapshot: DocumentContactSnapshot | null | undefined,
  card: CrmContactSource | null | undefined,
): ResolvedDocumentContact | null {
  const snap = snapshot ?? null;
  const source = card ?? null;

  // ⚠️ NAMNET avgör att dokumentet har en egen kontakt. En snapshot med bara ett telefonnummer är
  // ingen vald person — den hade annars trängt undan kortets primärkontakt och lämnat vyn med ett
  // naket nummer utan namn, sämre än ingen upplösning alls.
  const documentContactName = snap?.contact_name?.trim() || null;

  // Dokumentets egna värden vinner, och luckorna fylls ur den kortrad NAMNET syftar på — samma
  // uppslagning som skrivvägen gör (`evaluateWorkOrderReadiness`). Utan den löstes ett äldre
  // dokument vars snapshot bara bär ett namn mot kortets PRIMÄRA kontakt, och de två vägarna
  // svarade olika om samma dokument.
  const namedRow = source && documentContactName ? contactRowByName(source, documentContactName) : null;
  const documentContact: CrmContactRow | null = documentContactName
    ? {
        name: documentContactName,
        phone: snap?.phone?.trim() || namedRow?.phone || null,
        email: snap?.email?.trim() || namedRow?.email || null,
      }
    : null;

  // Kundkortet fyller resten via den delade regeln. Är snapshoten namnlös (äldre dokument som
  // aldrig fångade någon kontakt) faller `resolveCrmContact` tillbaka på kortets primärkontakt av
  // sig själv. Regeln avgör också om kortets e-post får lånas ut.
  const resolved = source
    ? resolveCrmContact(source, documentContact)
    : {
        name: documentContact?.name?.trim() || '',
        email: documentContact?.email?.trim() || '',
        phone: documentContact?.phone?.trim() || '',
      };
  // ⚠️ NUMRET på dokumentet gäller även när kontaktnamnet är tomt. Namnet avgör vem adressen
  // tillhör, men ett nummer tillskrivs ingen — och rensar någon bort namnet men behåller telefonen
  // skulle vyn annars kasta det enda numret dokumentet bär.
  const base = { ...resolved, phone: snap?.phone?.trim() || resolved.phone };

  // Steg 1: en separat slutkund på plats (fångad utanför kundkortet) är den som ska nås vid jobbet
  // och vinner över kundens kontakt. Fungerar även utan kundkoppling.
  //
  // ⚠️ ADRESSEN lånas inte hit: slutkunden är en ANNAN person, och kundens adress hade stått under
  // hens namn. NUMRET lånas, med flit — någon måste gå att nå på plats, och slutkunden fångas ofta
  // med bara namn. Samma skillnad som på kundkortet: ett nummer är en väg fram, en adress läses
  // som en identitet.
  const onSiteName = snap?.end_contact_name?.trim() || null;
  const onSitePhone = snap?.end_contact_phone?.trim() || null;
  const onSiteEmail = snap?.end_contact_email?.trim() || null;
  if (onSiteName || onSitePhone || onSiteEmail) {
    return {
      contactName: onSiteName,
      phone: onSitePhone || base.phone || null,
      email: onSiteEmail,
      customerEmail: source?.email?.trim() || null,
      isOnSiteContact: true,
      phoneFromCustomer: !onSitePhone && Boolean(base.phone),
    };
  }

  if (!base.name && !base.phone && !base.email && !source?.email?.trim()) return null;

  return {
    contactName: base.name || null,
    phone: base.phone || null,
    email: base.email || null,
    customerEmail: source?.email?.trim() || null,
    isOnSiteContact: false,
    // Kundens egen kontakt — numret är per definition redan kundens, så det finns inget lån att
    // upplysa om.
    phoneFromCustomer: false,
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
