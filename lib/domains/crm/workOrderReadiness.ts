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
 * snapshoten är tom — en ifylld snapshot är i övrigt ett medvetet val för just den offerten.
 *
 * ⚠️ MED ETT UNDANTAG: PERSONNUMRET. Där vinner kundkortet ALLTID, eftersom numret inte går att
 * redigera per offert och det är kortet — inte snapshoten — som Fortnox läser. Se resonemanget vid
 * `personalNumber` nedan; en snapshot som vann över ett rättat kort gjorde spärren omöjlig att ta
 * sig förbi.
 *
 * Funktionen är ren och returnerar BÅDE fynden och de värden som lösts upp, så att
 * `createCrmWorkOrderFromQuote` bakar in exakt det som kontrollerades i ordersnapshoten. Räknade
 * anroparen ut adressen själv skulle de två kunna glida isär, och spärren hade godkänt en adress
 * som ordern sedan inte bar.
 */

import { contactRowByName, resolveCrmContact, type CrmContactRow, type CrmContactSource } from './contacts';
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
  /** Kontaktens e-post ur kundkortet — se resonemanget vid uträkningen. Spärrar inte. */
  email: string | null;
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

// ── Varningar: syns i checklistan, spärrar inte. Williams val 2026-08-19. ──
//
// Rör bara offerten själv, aldrig kundkortet — därför kan de räknas ut även när kundkopplingen
// saknas och resten av kontrollen kortsluter.
function collectWarnings(quote: ReadinessQuoteSource): WorkOrderReadinessIssue[] {
  const warnings: WorkOrderReadinessIssue[] = [];
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

  return warnings;
}

export function evaluateWorkOrderReadiness(
  quote: ReadinessQuoteSource,
  customer: ReadinessCustomerSource,
): WorkOrderReadiness {
  const snapshot = (quote.customer_snapshot || {}) as Record<string, unknown>;
  const isPrivate = quote.quote_type === 'private';
  const blockers: WorkOrderReadinessIssue[] = [];
  const warnings: WorkOrderReadinessIssue[] = [];

  // ⚠️ HÄR VINNER KUNDKORTET — tvärtom mot adressen nedan, och med flit.
  //
  // Personnumret går inte att redigera i offertformuläret (ROT-sektionen VISAR det, den ändrar det
  // inte), så snapshotens värde är aldrig ett medvetet val för just den offerten — det är en
  // kopia av kortet som det såg ut när kunden valdes. Och det är kortet Fortnox faktiskt läser:
  // numret går dit som kundens `OrganisationNumber` via `buildFortnoxCustomerPayload`, aldrig ur
  // offertens snapshot. Att spärra på snapshoten var alltså att pröva ett värde som ändå inte är
  // det som skickas.
  //
  // Med snapshoten först fastnade en säljare som gjort precis det spärren bad om: kunden fick sitt
  // fulla nummer på kundkortet, men offerten bar kvar det gamla tiosiffriga och spärren fällde om
  // och om igen. Prompten i offertformuläret sparar också på KORTET, så återförsöket mötte samma
  // gamla snapshot — en rundgång utan utväg.
  const personalNumber = text(customer?.personal_number) || text(snapshot.personal_number);
  const organizationNumber = text(snapshot.organization_number) || text(customer?.organization_number);
  // Basen för TELEFONEN, medvetet oförändrad: kortets primärkontakt och därefter kortet.
  // Numret SPÄRRAR (se punkt 5), och en smalare uppslagning här hade kunnat börja fälla ordrar
  // som i dag går igenom. E-posten löses upp för sig strax nedan.
  const contact = customer ? resolveCrmContact(customer) : { name: '', email: '', phone: '' };

  // Offertens VALDA kontaktperson. Offertformuläret låter säljaren välja vem offerten gäller
  // (`resolveCrmContact(selectedCustomer, c)` i QuoteFormClient), och av det valet är NAMNET det
  // enda snapshoten bär — adressen bredvid är en kopia av kortet som det såg ut den dagen. Slår vi
  // inte upp personen igen får ordern den PRIMÄRA kontaktens adress under den valdas namn: exakt
  // "Jonas med Roberts e-post", fast på skrivvägen.
  //
  // Står namnet inte på kortet (fritext, eller en kontakt som tagits bort) blir raden namn-bara.
  // Då lånas ingen adress ut på en företagskund — det är hela regeln — medan privatkundens kort
  // fortfarande gäller, eftersom kunden ÄR personen.
  const snapshotContactName = text(snapshot.contact_name);
  const chosenContact: CrmContactRow | null = snapshotContactName
    ? ((customer ? contactRowByName(customer, snapshotContactName) : null)
        ?? { name: snapshotContactName, email: null, phone: null })
    : null;
  // KUNDENS nummer — det som skrivs till ordern. Slutkundens nummer (end_contact_phone) är en
  // ANNAN person, en kontakt på plats vid sidan av kundkortet, och får aldrig hamna här: ordervyn
  // visar fältet som kundens telefon bredvid kundens kontaktnamn, seedar redigeringsfältet ur det
  // och skickar det vidare till installatörerna. En felmärkning som nästa sparning gör permanent.
  const phone = text(snapshot.phone) || text(contact.phone);
  // Kravet är att NÅGON går att nå på plats, och där duger slutkundens nummer — det är ofta det
  // enda som finns när beställaren är en förvaltare. Prövas alltså bredare än det som lagras.
  const reachablePhone = phone || text(snapshot.end_contact_phone);
  // E-POSTEN löses om mot kundkortet i stället för att ärvas ur snapshoten.
  //
  // Adressen går inte att redigera på offerten — `draft.email` renderas aldrig i formuläret. Den
  // sätts av kontaktväljaren, via samma `resolveCrmContact`, och snapshoten bär alltså den
  // upplösning som gällde DEN DAGEN. Där ingick det gamla lånet: en kontakt utan egen adress fick
  // kortets. Vi slår därför upp den valda personen igen i stället för att lita på kopian.
  //
  // ⚠️ Och den TOMMA upplösningen måste få vinna. `resolveCrmContact` lånar inte längre ut ett
  // företags adress åt en namngiven kontakt utan egen — det var så en order kunde visa Roberts
  // e-post under Jonas namn. Fyllde vi luckan ur snapshoten här hade exakt det gamla lånet
  // kommit tillbaka, fruset från den dag offerten skrevs. Snapshoten används därför bara när det
  // inte finns någon kundrad att läsa alls.
  //
  // Spärrar inte: e-post är inget krav för att skapa order, och mejldialogen listar kundens
  // aktuella adresser separat (`documentRecipients`).
  const email = customer ? text(resolveCrmContact(customer, chosenContact).email) : text(snapshot.email);
  const workAddress = resolveWorkAddress(snapshot, customer);

  // 1. Kundkopplingen först: den är förutsättningen för att de andra ens går att slå upp, och
  //    utan den kan ordern aldrig nå Fortnox (pushen resolvar kundnumret via customer_id).
  if (!text(quote.customer_id)) {
    // KORTSLUTER med flit. Adress, telefon, org.nr och personnummer hämtas från kundkortet, och
    // utan koppling finns inget kort att hämta dem ur — listar vi dem också får säljaren fyra
    // fynd hen inte kan göra något åt, varav tre pekar på en sida som inte existerar. Ett fynd
    // med en åtgärd är hela skillnaden mellan en spärr som vägleder och en som bara stoppar.
    //
    // Åtgärden är att välja kunden i offertens Kund-sektion; offerten sparas i dag utan koppling
    // när kunden bara skrevs som fritext, och gamla offerter bär bara sin Fortnox-referens.
    return {
      ready: false,
      blockers: [{
        field: 'customer_link',
        label: 'Kund i kundregistret',
        message: 'Offerten är inte kopplad till en kund i kundregistret. Välj kunden i offertens Kund-sektion — annars får arbetsordern ingen kund, syns inte på kundkortet och räknas inte i rapporteringen.',
        fixAt: 'quote',
      }],
      warnings: collectWarnings(quote),
      resolved: {
        personalNumber,
        organizationNumber,
        phone,
        email,
        workAddress: { ...workAddress, delivery_address: null, invoice_address: text(snapshot.invoice_address) },
      },
    };
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
  if (!reachablePhone) {
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

  warnings.push(...collectWarnings(quote));

  return {
    ready: blockers.length === 0,
    blockers,
    warnings,
    resolved: {
      personalNumber,
      organizationNumber,
      phone,
      email,
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
