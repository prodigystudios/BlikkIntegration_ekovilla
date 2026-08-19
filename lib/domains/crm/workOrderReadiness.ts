/**
 * Fullständighetskontrollen mellan offert och arbetsorder.
 *
 * Orderskapandet är den sista punkten där en människa fortfarande är kvar i loopen: routen
 * auto-pushar till Fortnox i samma andetag som ordern finns, och därefter är felet ett
 * bokföringsärende i stället för ett formulärfel. Personnumret och ROT-fastighetsbeteckningen
 * spärrade redan här av precis det skälet — den här modulen samlar dem med resten av de uppgifter
 * som visade sig kunna saknas rakt igenom kedjan.
 *
 * ⚠️ VARFÖR KUNDKORTET LÄSES OM, INTE BARA OFFERTENS SNAPSHOT: adress, telefon och org.nr går inte
 * att redigera i offertformuläret — de är en ögonblicksbild av kundkortet, satt när kunden väljs.
 * Utan omläsningen hade en säljare som gör precis det spärren ber om (fyller i adressen på
 * kundkortet) blockerats ändå, av en snapshot som skrevs innan. Kundkortet vinner därför när
 * snapshoten är tom — aldrig tvärtom, en ifylld snapshot är ett medvetet val för just den offerten.
 *
 * Funktionen är ren och returnerar BÅDE fynden och de värden som lösts upp, så att
 * `createCrmWorkOrderFromQuote` bakar in exakt det som kontrollerades i ordersnapshoten. Räknade
 * anroparen ut adressen själv skulle de två kunna glida isär, och spärren hade godkänt en adress
 * som ordern sedan inte bar.
 */

import { resolveCrmContact, type CrmContactSource } from './contacts';
import { isValidPersonalNumber, PERSONAL_NUMBER_ERROR } from './personalNumber';

export type WorkOrderReadinessField =
  | 'customer_link'
  | 'personal_number'
  | 'organization_number'
  | 'work_address'
  | 'contact_phone'
  | 'rot_property'
  | 'line_items'
  | 'installation_date'
  | 'handoff_notes';

export type WorkOrderReadinessIssue = {
  field: WorkOrderReadinessField;
  /** Kort rubrik i checklistan. */
  label: string;
  /** Vad som saknas och varför det spelar roll. */
  message: string;
  /** Var uppgiften rättas — styr vilken länk checklistan visar. */
  fixAt: 'customer_card' | 'quote';
};

type AddressParts = {
  street_address: string | null;
  postal_code: string | null;
  city: string | null;
};

export type WorkOrderReadinessResolved = {
  personalNumber: string | null;
  organizationNumber: string | null;
  phone: string | null;
  /** Adressen installatörerna navigerar till, med kundkortet som sista utväg. */
  workAddress: AddressParts & { delivery_address: null; invoice_address: string | null };
};

export type WorkOrderReadiness = {
  ready: boolean;
  blockers: WorkOrderReadinessIssue[];
  warnings: WorkOrderReadinessIssue[];
  resolved: WorkOrderReadinessResolved;
};

export type ReadinessQuoteSource = {
  quote_type?: 'private' | 'business' | null;
  customer_id?: string | null;
  customer_snapshot?: Record<string, unknown> | null;
  rot_details?: { enabled?: boolean | null; property_designation?: string | null; brf_org_number?: string | null } | null;
  line_items?: Array<Record<string, unknown>> | null;
  internal_handoff?: { desired_installation_date?: string | null; handoff_notes?: string | null } | null;
};

export type ReadinessCustomerSource =
  | (CrmContactSource & {
      organization_number?: string | null;
      personal_number?: string | null;
      visit_address?: Record<string, string | null> | null;
    })
  | null;

function text(value: unknown): string | null {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Adressen som ordern ska bära.
 *
 * Gatan är ankaret, precis som i `buildCustomerSnapshot`: en separat arbetsadress lagras bara när
 * gatan är ifylld och skiljer sig från kundadressen, och då gäller dess postnummer/ort SOM IFYLLDA
 * (de lånas aldrig från kundadressen — det skulle ge fel ort). Saknas allt på offerten faller vi
 * tillbaka på kundkortets besöksadress, vilket räddar gamla offerter vars snapshot skrevs innan
 * adressen fanns på kortet.
 */
function resolveWorkAddress(
  snapshot: Record<string, unknown>,
  customer: ReadinessCustomerSource,
): AddressParts {
  const hasWorkAddress = Boolean(text(snapshot.delivery_address));
  if (hasWorkAddress) {
    return {
      street_address: text(snapshot.delivery_address),
      postal_code: text(snapshot.delivery_postal_code),
      city: text(snapshot.delivery_city),
    };
  }

  const snapshotStreet = text(snapshot.visit_address) || text(snapshot.street_address);
  if (snapshotStreet) {
    return {
      street_address: snapshotStreet,
      postal_code: text(snapshot.postal_code),
      city: text(snapshot.city),
    };
  }

  const visit = (customer?.visit_address || {}) as Record<string, string | null>;
  return {
    street_address: text(visit.street) || text(visit.street_address),
    postal_code: text(visit.postal_code),
    city: text(visit.city),
  };
}

const ADDRESS_PART_LABELS: Array<[keyof AddressParts, string]> = [
  ['street_address', 'gatuadress'],
  ['postal_code', 'postnummer'],
  ['city', 'ort'],
];

function joinSwedish(parts: string[]): string {
  if (parts.length <= 1) return parts.join('');
  return parts.slice(0, -1).join(', ') + ' och ' + parts[parts.length - 1];
}

/**
 * Har offerten en rad som faktiskt bär något? Samma villkor som offertvalideringen använder för
 * att skilja en påbörjad rad från en tom platshållare (`app/api/crm/quotes/_lib.ts`).
 */
function hasPopulatedLineItem(lineItems: Array<Record<string, unknown>>): boolean {
  return lineItems.some((item) => text(item.article_name) || text(item.m2) || text(item.quantity) || text(item.unit_price));
}

export function evaluateWorkOrderReadiness(
  quote: ReadinessQuoteSource,
  customer: ReadinessCustomerSource,
): WorkOrderReadiness {
  const snapshot = (quote.customer_snapshot || {}) as Record<string, unknown>;
  const isPrivate = quote.quote_type === 'private';
  const blockers: WorkOrderReadinessIssue[] = [];
  const warnings: WorkOrderReadinessIssue[] = [];

  const personalNumber = text(snapshot.personal_number) || text(customer?.personal_number);
  const organizationNumber = text(snapshot.organization_number) || text(customer?.organization_number);
  const contact = customer ? resolveCrmContact(customer) : { name: '', email: '', phone: '' };
  const phone = text(snapshot.phone) || text(snapshot.end_contact_phone) || text(contact.phone);
  const workAddress = resolveWorkAddress(snapshot, customer);

  // 1. Kundkopplingen först: den är förutsättningen för att de andra ens går att slå upp, och
  //    utan den kan ordern aldrig nå Fortnox (pushen resolvar kundnumret via customer_id).
  if (!text(quote.customer_id)) {
    blockers.push({
      field: 'customer_link',
      label: 'Kund i kundregistret',
      message: 'Offerten är inte kopplad till en kund i kundregistret. Utan kopplingen får arbetsordern ingen kund och kan inte synkas till Fortnox.',
      fixAt: 'quote',
    });
  }

  // 2. Personnummer på privatkund — Fortnox OrganisationNumber. Tio siffror dödar ROT- och
  //    husarbetesuppgifterna TYST (FORTNOX_INTEGRATION.md 4e), så formatet prövas här också.
  if (isPrivate && !personalNumber) {
    blockers.push({
      field: 'personal_number',
      label: 'Personnummer',
      message: 'Personnummer krävs för privatkund innan order kan skapas',
      fixAt: 'customer_card',
    });
  } else if (isPrivate && !isValidPersonalNumber(personalNumber as string)) {
    blockers.push({
      field: 'personal_number',
      label: 'Personnummer',
      message: PERSONAL_NUMBER_ERROR,
      fixAt: 'customer_card',
    });
  }

  // 3. Org.nr på företagskund — motsvarigheten på andra sidan: fakturan hittar inte rätt hos
  //    kunden utan det, och offertvalideringen kräver bara företagsnamnet.
  if (!isPrivate && !organizationNumber) {
    blockers.push({
      field: 'organization_number',
      label: 'Organisationsnummer',
      message: 'Organisationsnummer saknas på företagskunden. Det behövs för att fakturan ska hitta rätt.',
      fixAt: 'customer_card',
    });
  }

  // 4. Arbetsadressen är det installatörerna navigerar efter i fältvyn. Alla tre delarna behövs —
  //    en gata utan ort duger inte i en kartapp.
  const missingAddressParts = ADDRESS_PART_LABELS.filter(([key]) => !workAddress[key]).map(([, label]) => label);
  if (missingAddressParts.length > 0) {
    blockers.push({
      field: 'work_address',
      label: 'Arbetsadress',
      message: `Arbetsadressen saknar ${joinSwedish(missingAddressParts)}. Installatörerna navigerar till den ur arbetsordern.`,
      fixAt: text(snapshot.delivery_address) ? 'quote' : 'customer_card',
    });
  }

  // 5. Ett nummer någon svarar i. "Er referens" kräver bara ett NAMN, så en order kunde nå fältet
  //    utan att besättningen hade något sätt att höra av sig när de står på plats.
  if (!phone) {
    blockers.push({
      field: 'contact_phone',
      label: 'Telefonnummer',
      message: 'Telefonnummer saknas. Besättningen måste kunna nå kunden när de är på plats.',
      fixAt: 'customer_card',
    });
  }

  // 6. ROT utan identifierad fastighet går inte att deklarera, och Fortnox har inget API-fält för
  //    beteckningen — den som slutför fakturan läser den ur textraden vi skickar.
  const rot = quote.rot_details || {};
  if (rot.enabled === true && !text(rot.property_designation) && !text(rot.brf_org_number)) {
    blockers.push({
      field: 'rot_property',
      label: 'Fastighetsbeteckning',
      message: 'Fastighetsbeteckning (eller BRF org.nr för bostadsrätt) krävs för ROT innan order kan skapas. Öppna offerten och fyll i den.',
      fixAt: 'quote',
    });
  }

  // ── Varningar: syns i checklistan, spärrar inte. Williams val 2026-08-19. ──
  const lineItems = quote.line_items || [];
  if (lineItems.length === 0 || !hasPopulatedLineItem(lineItems)) {
    warnings.push({
      field: 'line_items',
      label: 'Artikelrader',
      message: 'Offerten har inga ifyllda artikelrader — arbetsordern skapas tom.',
      fixAt: 'quote',
    });
  }

  const handoff = quote.internal_handoff || {};
  if (!text(handoff.desired_installation_date)) {
    warnings.push({
      field: 'installation_date',
      label: 'Önskat installationsdatum',
      message: 'Önskat installationsdatum saknas — planeringen har inget att utgå från.',
      fixAt: 'quote',
    });
  }

  if (!text(handoff.handoff_notes)) {
    warnings.push({
      field: 'handoff_notes',
      label: 'Arbetsbeskrivning',
      message: 'Arbetsbeskrivning saknas — installatörerna får ingen instruktion med sig.',
      fixAt: 'quote',
    });
  }

  return {
    ready: blockers.length === 0,
    blockers,
    warnings,
    resolved: {
      personalNumber,
      organizationNumber,
      phone,
      workAddress: {
        ...workAddress,
        // Primäradressen bär redan arbetsplatsen när en sådan finns — dubblera den inte som en
        // egen "Leverans:"-rad. Ordervyn kan fortfarande sätta en.
        delivery_address: null,
        invoice_address: text(snapshot.invoice_address),
      },
    },
  };
}

/**
 * Den felkod routen ska svara med.
 *
 * Personnummer och fastighetsbeteckning har egna koder eftersom offertformuläret öppnar en prompt
 * på dem och rättar dem på plats. Den prompten ska bara fyra när fyndet är ENSAMT — annars fixar
 * säljaren en sak, trycker igen, och möts av nästa. Är det fler visas hela listan på en gång.
 */
export function workOrderReadinessErrorCode(blockers: WorkOrderReadinessIssue[]): string {
  if (blockers.length === 1) {
    const only = blockers[0];
    if (only.field === 'personal_number') return 'crm_work_order_missing_personal_number';
    if (only.field === 'rot_property') return 'crm_work_order_missing_rot_property';
  }
  return 'crm_work_order_incomplete';
}
