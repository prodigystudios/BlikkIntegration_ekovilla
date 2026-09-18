// Pure serializers that turn the quote form draft into the API payload shapes.
// Kept in a standalone (non-"use client") module so the mapping — historically the
// most regression-prone part of the quote form — is unit-testable in isolation.
//
// Inputs are narrow structural types: the form's full QuoteDraft satisfies them, so
// callers pass `draft` directly, and tests build small plain objects.

import { parseDecimal } from '@/lib/shared/number';
import { stockholmTodayISO } from '@/lib/domains/planning/timezone';
import type { ConstructionSlug } from '@/lib/domains/crm/constructions';

// ── Giltighetstid ────────────────────────────────────────────────────────────
//
// "Giltig till" härleds ur offertdatumet plus ett antal dagar. Säljaren väljer antalet i en
// rullgardin i stället för att behöva plocka ett datum i kalendern — det vanliga fallet är ett
// jämnt antal dagar, inte ett specifikt datum. Kalendern finns kvar för de gånger det ÄR ett
// specifikt datum som gäller.

/** Standard: en månad. Det är den giltighetstid offerterna har haft sedan formuläret byggdes. */
export const OFFER_VALIDITY_DAYS = 30;

/** Valen i rullgardinen. 30 ligger med som standardvalet. */
export const OFFER_VALIDITY_PRESETS = [10, 15, 20, 30, 45, 60] as const;

/**
 * Datumet `days` dagar efter `iso` (YYYY-MM-DD).
 *
 * Klockan tolvs på dagen med flit: en date-only-sträng tolkad som midnatt kan tippa över till fel
 * dygn när sommartid slår om, och då blir giltighetstiden en dag kort eller lång.
 */
export function addDaysIso(iso: string, days: number): string {
  const date = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(date.getTime())) return iso;
  // Vakta ÄVEN dagantalet: setDate(NaN) gör datumet ogiltigt och toISOString KASTAR då
  // (RangeError), vilket hade tagit ner hela formulärets rendering i stället för att degradera.
  if (!Number.isFinite(days)) return iso;
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * Datumen en ny offert föds med: dagens SVENSKA dag, och giltighetstiden räknad från just den.
 *
 * 🧨 Två fällor bakar ihop sig här, därför bor paret i EN funktion:
 *   • `new Date().toISOString().slice(0, 10)` ger UTC-dygnet. Mellan midnatt och kl. 02 svensk
 *     sommartid är det gårdagen — och offertdatumet går vidare till Fortnox som OfferDate och
 *     trycks som "Offertdatum" på kundens PDF.
 *   • Räknas `valid_until` ur en ANNAN klockavläsning än `quote_date` kan de hamna på var sin sida
 *     om midnatt, och offerten går ut med en giltighetstid som är en dag kort.
 */
export function initialQuoteDates(now: Date = new Date()): { quote_date: string; valid_until: string } {
  const quoteDate = stockholmTodayISO(now);
  return { quote_date: quoteDate, valid_until: addDaysIso(quoteDate, OFFER_VALIDITY_DAYS) };
}

/** Antal dagar mellan två datum (YYYY-MM-DD), eller null om något av dem inte är ett datum. */
export function daysBetweenIso(from: string, to: string): number | null {
  if (!from || !to) return null;
  const start = new Date(`${from}T12:00:00`);
  const end = new Date(`${to}T12:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  return Math.round((end.getTime() - start.getTime()) / 86_400_000);
}

/**
 * Vilket rullgardinsval giltighetstiden motsvarar, eller null för ett datum som inte är någon av
 * dem ("Eget datum").
 *
 * Härleds ur datumen i stället för att lagras separat. Ett eget fält för "valt antal dagar" hade
 * blivit en andra sanning som kan glida isär från `valid_until` — och det är `valid_until` som går
 * till Fortnox. Följden blir också att en offert som redigeras visar rätt val i rullgardinen utan
 * att något behöver ha sparats.
 */
export function matchedValidityPreset(quoteDate: string, validUntil: string): number | null {
  const days = daysBetweenIso(quoteDate, validUntil);
  if (days === null) return null;
  return (OFFER_VALIDITY_PRESETS as readonly number[]).includes(days) ? days : null;
}

// ── Offertens draft ──────────────────────────────────────────────────────────
//
// Formulärets draft-form och de två mappningarna in i den (en sparad offert → ifyllt formulär, och
// samma sak igen fast som KOPIA) bor här i stället för i QuoteFormClient.tsx av samma skäl som
// resten av modulen: mappningen är den mest regressionsbenägna delen av offertformuläret, och i en
// "use client"-komponent på 3 800 rader gick den inte att pröva i ett test.
//
// Sidoeffekterna stannar kvar i komponenten (setCustomWorkAddress, måttblocket, kundchippet) —
// funktionerna här är rena och tar bara en rad in och ger en draft ut.

export type QuoteCustomerSourceKind = 'prospect' | 'local' | 'fortnox';
export type QuoteCustomerSyncIntent = 'local_only' | 'on_work_order' | 'linked';

export type QuoteCustomerSource = {
  kind?: QuoteCustomerSourceKind | null;
  sync_intent?: QuoteCustomerSyncIntent | null;
  fortnox_customer_id?: string | null;
  fortnox_customer_name?: string | null;
};

export type QuoteLineItem = {
  id: string;
  construction: ConstructionSlug | '';
  m2: string;
  thickness_mm: string;
  /**
   * ⚠️ LÄSES INTE LÄNGRE FÖR PRISSÄTTNING. Flaggan styrde förr om raden fick sitt pris ur
   * `computeUnitPrice()` — en stub som svarade 900 kr/m³ oavsett konstruktion och tjocklek, medan
   * alla andra ytor räknade samma rad som 0 kr. Stubben är borta; priset kommer nu alltid ur
   * `lineItemUnitPrice`.
   *
   * Fältet står kvar i typen, Zod-schemat och databasen så att befintliga rader parsar oförändrat
   * (samma fälla som `is_rot_work` och `written_off` gick i när de föll ur schemat och strippades
   * tyst vid varje sparning). Ta inte bort det utan en migrering.
   */
  auto_price: boolean;
  unit_price: string;
  pricing_mode: 'm3' | 'item';
  quantity: string;
  article_id: string | null;
  article_name: string | null;
  article_number: string | null;
  // Artikelns beskrivning från registret, kopierad till raden när artikeln väljs — samma
  // denormalisering som article_price/article_unit_name. INTERN: visas som grå hjälptext under
  // vald artikel och läses aldrig av Fortnox-pushen (buildOfferRows rör den inte).
  article_note: string | null;
  article_price: number | null;
  article_unit_name: string | null;
  discount_percent: string;
  line_note: string;
  is_rot_work: boolean;
  house_work_type: string;
  // Labour carved out of a material row for ROT, as kr PER UNIT ex VAT — ett à-pris precis som
  // `unit_price`, som räknas mot antalet. Summeras till en enda "Arbetskostnad ROT"-rad på
  // Fortnox-dokumentet; materialraden sänks med lika mycket, så totalen är oförändrad.
  //
  // ⚠️ Det är en UTBRYTNING ur A-priset, inte ett tillägg: A-priset är HELA priset och det här
  // beloppet den del av det som är arbete. Äter beloppet hela A-priset bryts ingenting ut och
  // sparningen spärras — se splitRowLabor i lib/domains/crm/pricing.ts, som äger tolkningen.
  labor_cost: string;
  density: string;
  /**
   * Ska raden stå i arbetsbeskrivningen installatören läser? Gäller BARA antals-/meterrader
   * (`pricing_mode: 'item'`) — ytorna är själva jobbet och följer alltid med. Vindduk är skälet
   * valet finns: den lämnas ofta till kunden i förväg och är inget arbetsmoment.
   *
   * Standarden kommer ur artikelregistret när artikeln väljs och FRYSES sedan här på raden.
   * ⚠️ Den läses aldrig retroaktivt: en rad sparad före flaggan fanns saknar den och behandlas som
   * nej, så måttblocket blir byte-identiskt och offerten öppnas inte låst.
   */
  include_in_description: boolean;
};

/** En offert som servern skickar den (GET /api/crm/quotes/:id). */
export type QuoteItem = {
  id: string;
  quote_number: string | null;
  prospect_id: string | null;
  customer_id: string | null;
  customer_name: string | null;
  quote_type: 'private' | 'business';
  customer_source: QuoteCustomerSource | null;
  customer_snapshot: {
    customer_name?: string | null;
    company_name?: string | null;
    organization_number?: string | null;
    personal_number?: string | null;
    contact_name?: string | null;
    email?: string | null;
    phone?: string | null;
    street_address?: string | null;
    postal_code?: string | null;
    city?: string | null;
    visit_address?: string | null;
    delivery_address?: string | null;
    delivery_postal_code?: string | null;
    delivery_city?: string | null;
    invoice_address?: string | null;
    end_contact_name?: string | null;
    end_contact_phone?: string | null;
    end_contact_email?: string | null;
    label?: string | null;
  } | null;
  pricing_summary: { subtotal?: number; vat?: number; total?: number } | null;
  line_items: QuoteLineItem[] | null;
  rot_details: {
    enabled?: boolean;
    applicant_name?: string | null;
    personal_number?: string | null;
    property_designation?: string | null;
    rot_percent?: number;
    max_deduction?: number | null;
    brf_org_number?: string | null;
  } | null;
  internal_handoff: {
    desired_installation_date?: string | null;
    handoff_notes?: string | null;
    work_scope?: string | null;
  } | null;
  project_name: string;
  description: string | null;
  amount: number | string;
  currency_code: string;
  vat_percent: number | string | null;
  valid_until: string | null;
  work_order_id: string | null;
  work_order_number: string | null;
  converted_to_work_order_at: string | null;
  status: 'draft' | 'sent' | 'follow_up' | 'won' | 'lost';
  quote_date: string;
  follow_up_date: string | null;
  notes: string | null;
  assigned_to: string | null;
};

export type QuoteDraft = {
  customer_id: string | null;
  prospect_id: string;
  quote_type: 'private' | 'business';
  customer_source: {
    kind: QuoteCustomerSourceKind;
    sync_intent: QuoteCustomerSyncIntent;
    fortnox_customer_id: string;
    fortnox_customer_name: string;
  };
  customer_name: string;
  company_name: string;
  organization_number: string;
  personal_number: string;
  contact_name: string;
  email: string;
  phone: string;
  street_address: string;
  postal_code: string;
  city: string;
  visit_address: string;
  delivery_address: string;
  delivery_postal_code: string;
  delivery_city: string;
  invoice_address: string;
  // Separate on-site contact (slutkund) outside the customer card — see buildCustomerSnapshot.
  end_contact_name: string;
  end_contact_phone: string;
  end_contact_email: string;
  // Free-text märkning (företag) → Fortnox "Ert referensnummer".
  label: string;
  items: QuoteLineItem[];
  project_name: string;
  description: string;
  vat_percent: string;
  valid_until: string;
  rot_enabled: boolean;
  rot_property_designation: string;
  rot_percent: string;
  rot_max_deduction: string;
  rot_brf_org_number: string;
  desired_installation_date: string;
  handoff_notes: string;
  work_scope: string;
  status: QuoteItem['status'];
  quote_date: string;
  follow_up_date: string;
  notes: string;
  create_follow_up_task: boolean;
  // Ansvarig säljare. Tom sträng = "den som skapar offerten" (servern fyller i vid POST).
  // Bara en administratör kan ändra fältet; för alla andra visas det som text.
  assigned_to: string;
};

export function createEmptyLineItem(): QuoteLineItem {
  return {
    id: crypto.randomUUID(),
    construction: '',
    m2: '',
    thickness_mm: '',
    auto_price: true,
    unit_price: '',
    pricing_mode: 'm3',
    quantity: '',
    article_id: null,
    article_name: null,
    article_number: null,
    article_note: null,
    article_price: null,
    article_unit_name: null,
    discount_percent: '',
    line_note: '',
    is_rot_work: false,
    house_work_type: 'CONSTRUCTION',
    labor_cost: '',
    density: '',
    include_in_description: false,
  };
}

export function getDefaultDraftCustomerSource(prospectId?: string | null): QuoteDraft['customer_source'] {
  return {
    kind: prospectId ? 'prospect' : 'local',
    sync_intent: 'local_only',
    fortnox_customer_id: '',
    fortnox_customer_name: '',
  };
}

export function getDraftCustomerSource(source: QuoteCustomerSource | null | undefined, prospectId?: string | null): QuoteDraft['customer_source'] {
  const kind = source?.kind === 'prospect' || source?.kind === 'local' || source?.kind === 'fortnox'
    ? source.kind
    : (prospectId ? 'prospect' : 'local');
  const syncIntent = source?.sync_intent === 'on_work_order' || source?.sync_intent === 'linked'
    ? source.sync_intent
    : 'local_only';
  return {
    kind,
    sync_intent: kind === 'fortnox' ? 'linked' : syncIntent,
    fortnox_customer_id: source?.fortnox_customer_id || '',
    fortnox_customer_name: source?.fortnox_customer_name || '',
  };
}

// 🧨 ALDRIG `new Date().toISOString().slice(0, 10)` för ett kalenderdatum. Det ger UTC-dygnet, och
// mellan midnatt och kl. 02 svensk sommartid är det GÅRDAGEN. Offertdatumet går vidare till Fortnox
// som OfferDate och trycks som "Offertdatum" på kundens PDF — en offert skriven natten till den 16:e
// daterades den 15:e, alltså möjligen före förfrågan kom in.
//
// ⚠️ Och inte som modulkonstant: den beräknas när modulen laddas, så en flik som stått öppen över
// midnatt hade gett gårdagens datum oavsett zon. Därför är datumparet TOMT här och sätts först i
// createInitialDraft / copyDraftFromQuote.
export const BLANK_DRAFT: QuoteDraft = {
  customer_id: null,
  prospect_id: '',
  quote_type: 'business',
  customer_source: { kind: 'local', sync_intent: 'local_only', fortnox_customer_id: '', fortnox_customer_name: '' },
  customer_name: '',
  company_name: '',
  organization_number: '',
  personal_number: '',
  contact_name: '',
  email: '',
  phone: '',
  street_address: '',
  postal_code: '',
  city: '',
  visit_address: '',
  delivery_address: '',
  delivery_postal_code: '',
  delivery_city: '',
  invoice_address: '',
  end_contact_name: '',
  end_contact_phone: '',
  end_contact_email: '',
  label: '',
  // Tom med flit: startraden skapas per draft i createInitialDraft. En delad rad här hade gett två
  // drafter i samma flik SAMMA rad-id, och en redigering i den ena hade synts i den andra.
  items: [],
  project_name: '',
  description: '',
  vat_percent: '25',
  valid_until: '',
  rot_enabled: false,
  rot_property_designation: '',
  rot_percent: '30',
  rot_max_deduction: '50000',
  rot_brf_org_number: '',
  desired_installation_date: '',
  handoff_notes: '',
  work_scope: '',
  status: 'draft',
  quote_date: '',
  follow_up_date: '',
  notes: '',
  create_follow_up_task: true,
  assigned_to: '',
};

/** En tom offert med dagens SVENSKA datum och en egen tom artikelrad. Ett anrop per mount. */
export function createInitialDraft(): QuoteDraft {
  // Datumparet kommer ur initialQuoteDates — se den för varför de två måste födas ihop.
  return { ...BLANK_DRAFT, ...initialQuoteDates(), items: [createEmptyLineItem()] };
}

/**
 * En sparad offert → ett ifyllt formulär.
 *
 * ⚠️ Kunduppgifterna kommer ur offertens SNAPSHOT, aldrig ur kundkortet. Snapshoten är vad offerten
 * skickades med, och det är den som ska stå kvar när den öppnas igen — se
 * project_crm_snapshot_vs_card. Kortet läses separat och bara för kundchippet (hydrateSelectedCustomer).
 */
export function draftFromQuote(item: QuoteItem): QuoteDraft {
  return {
    customer_id: item.customer_id || null,
    prospect_id: item.prospect_id || '',
    quote_type: item.quote_type || 'business',
    customer_source: getDraftCustomerSource(item.customer_source, item.prospect_id),
    customer_name: item.customer_name || '',
    company_name: item.customer_snapshot?.company_name || '',
    organization_number: item.customer_snapshot?.organization_number || '',
    personal_number: item.customer_snapshot?.personal_number || '',
    contact_name: item.customer_snapshot?.contact_name || '',
    email: item.customer_snapshot?.email || '',
    phone: item.customer_snapshot?.phone || '',
    street_address: item.customer_snapshot?.street_address || '',
    postal_code: item.customer_snapshot?.postal_code || '',
    city: item.customer_snapshot?.city || '',
    visit_address: item.customer_snapshot?.visit_address || '',
    // A separate work address is stored only when it differs from the customer address,
    // so its presence directly drives the toggle (set by the caller).
    delivery_address: item.customer_snapshot?.delivery_address || '',
    delivery_postal_code: item.customer_snapshot?.delivery_postal_code || '',
    delivery_city: item.customer_snapshot?.delivery_city || '',
    invoice_address: item.customer_snapshot?.invoice_address || '',
    end_contact_name: item.customer_snapshot?.end_contact_name || '',
    end_contact_phone: item.customer_snapshot?.end_contact_phone || '',
    end_contact_email: item.customer_snapshot?.end_contact_email || '',
    label: item.customer_snapshot?.label || '',
    items: item.line_items?.length
      // A-priset normaliseras EN gång här: en sparad rad kan bära `article_price` utan
      // `unit_price`, och då prissätter `lineItemUnitPrice` den korrekt medan A-prisrutan hade
      // stått tom. Normaliseringen måste ske vid inläsningen, inte i renderingen — ett fält
      // som fyller i sig självt så fort det töms går inte att skriva om.
      ? item.line_items.map((line) => ({ ...line, line_note: line.line_note || '', is_rot_work: line.is_rot_work ?? false, house_work_type: line.house_work_type || 'CONSTRUCTION', labor_cost: line.labor_cost || '', density: line.density || '', article_note: line.article_note ?? null, include_in_description: line.include_in_description ?? false, unit_price: line.unit_price || (line.article_price != null ? String(line.article_price) : '') }))
      : [createEmptyLineItem()],
    project_name: item.project_name,
    description: item.description || '',
    vat_percent: String(item.vat_percent ?? 25),
    valid_until: item.valid_until || '',
    rot_enabled: Boolean(item.rot_details?.enabled),
    rot_property_designation: item.rot_details?.property_designation || '',
    rot_percent: String(item.rot_details?.rot_percent ?? 30),
    rot_max_deduction: String(item.rot_details?.max_deduction ?? 50000),
    rot_brf_org_number: item.rot_details?.brf_org_number || '',
    desired_installation_date: item.internal_handoff?.desired_installation_date || '',
    handoff_notes: item.internal_handoff?.handoff_notes || '',
    work_scope: item.internal_handoff?.work_scope || '',
    status: item.status,
    quote_date: item.quote_date,
    follow_up_date: item.follow_up_date || '',
    notes: item.notes || '',
    create_follow_up_task: false,
    // Ligger med i draften och därmed i baslinjen. Sätts den i stället av en effekt efteråt blir
    // en nyss öppnad offert omedelbart "ändrad", och det river sönder utkastskyddet — samma fälla
    // som måttblocket gick i.
    assigned_to: item.assigned_to || '',
  };
}

/** Förifyllt namn på en kopia. Prefixet läggs på varje gång — se copyDraftFromQuote. */
export const COPY_NAME_PREFIX = 'Kopia av ';

/**
 * Samma offert igen, som en NY offert — t.ex. samma jobb räknat på ett annat material.
 *
 * Ärvs rakt av (poängen är att slippa fylla i allt en gång till):
 *   • kunduppgifterna som ORIGINALET bar dem, alltså snapshoten — inte en omläsning av kundkortet.
 *     ⚠️ Avviker medvetet från husregeln i project_crm_snapshot_vs_card: en kopia ska vara
 *     identisk. Har kunden flyttat sedan dess bär kopian den gamla adressen tills säljaren rättar
 *     den i formuläret, precis som en redigering av originalet hade gjort.
 *   • artikelraderna med mått, priser, rabatter och ROT-utbrytning — måttblocket i
 *     `handoff_notes` är byte-exakt mot raderna, så de MÅSTE följas åt eller låses blocket på fel
 *     mått (se adoptExistingMeasurementBlock).
 *   • kundens Fortnox-koppling (`customer_source`). Nollställs den tror kopian att kunden är
 *     lokal och lägger upp en dubblett i Fortnox när ordern skapas.
 *
 * Nollställs:
 *   • datumen — kopian är skriven IDAG, med husets vanliga giltighetstid räknad därifrån.
 *   • statusen — en kopia är alltid ett utkast, aldrig ärvd "Vunnen"/"Skickad".
 *   • uppföljningsdatumet — originalets uppföljning gäller originalet.
 *   • ansvarig säljare — det blir hens offert (den som kopierar). Tom sträng = servern fyller i.
 *
 * Följer aldrig med, för att de inte finns i draften över huvud taget: offertnumret (en GENERERAD
 * kolumn ur radens id), Fortnox-offertnumret och arbetsorderkopplingen. Se kopieringstesterna.
 */
export function copyDraftFromQuote(item: QuoteItem, now: Date = new Date()): QuoteDraft {
  const source = draftFromQuote(item);
  return {
    ...source,
    ...initialQuoteDates(now),
    // Prefixet läggs på varje gång, även på en kopia av en kopia: två rader i listan ska inte
    // kunna se likadana ut. Det är ett förifyllt värde i ett öppet fält — säljaren döper om.
    project_name: `${COPY_NAME_PREFIX}${item.project_name}`,
    status: 'draft',
    follow_up_date: '',
    // Som en ny offert: anges ett uppföljningsdatum skapas uppgiften automatiskt.
    create_follow_up_task: true,
    assigned_to: '',
  };
}

export type QuoteCustomerFields = {
  quote_type: 'private' | 'business';
  customer_name: string;
  company_name: string;
  organization_number: string;
  personal_number: string;
  contact_name: string;
  email: string;
  phone: string;
  street_address: string;
  postal_code: string;
  city: string;
  visit_address: string;
  // Arbetsadress (where the job is performed). `delivery_address` is its STREET line;
  // postal/city are structured so it works for company jobs whose card address (street_address)
  // is the office. Kept under the `delivery_*` name = Fortnox "delivery address".
  delivery_address: string;
  delivery_postal_code: string;
  delivery_city: string;
  invoice_address: string;
  // Separate on-site contact (slutkund) OUTSIDE the customer card: e.g. a builder orders the
  // job but the work is done for a different end customer. Independent of "Er referens"
  // (contact_name), which stays the order-giver. Stored only when explicitly entered.
  end_contact_name: string;
  end_contact_phone: string;
  end_contact_email: string;
  // Free-text marking/reference (företag) → Fortnox "Ert referensnummer" (YourReferenceNumber on
  // the offer, YourOrderNumber on order/invoice). The business counterpart of a private ROT
  // customer's fastighetsbeteckning, which uses the same Fortnox field.
  label: string;
};

// Two address strings are "the same place" if their trimmed, case-folded forms match.
// Used to drop a work address that equals the customer/invoice address so the common
// (private) case stores no separate delivery address and stays exactly as before.
function sameAddressPart(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

// The customer name used on the quote: company name for business (falling back to
// the contact name), otherwise the person's name.
export function getEffectiveCustomerName(
  d: Pick<QuoteCustomerFields, 'quote_type' | 'company_name' | 'customer_name'>,
): string {
  return d.quote_type === 'business'
    ? (d.company_name.trim() || d.customer_name.trim())
    : d.customer_name.trim();
}

// Point-in-time snapshot of the customer details, stored on every quote regardless
// of whether the customer is a saved record. Empty strings become null.
export function buildCustomerSnapshot(d: QuoteCustomerFields, opts?: { reverseVat?: boolean | null }) {
  const effectiveCustomerName = getEffectiveCustomerName(d);

  // Work address: anchored on the STREET line — only stored when a street is entered AND
  // the address differs from the customer address. Identical (or no street) → null
  // everywhere, so downstream (work order, Fortnox) falls back to the customer address and
  // the private case behaves exactly as before. The street anchor keeps the snapshot, the
  // toggle (keyed on delivery_address), the work order, and Fortnox all in agreement —
  // never a half-populated city-only work address.
  const workMatchesCustomer =
    sameAddressPart(d.delivery_address, d.street_address) &&
    sameAddressPart(d.delivery_postal_code, d.postal_code) &&
    sameAddressPart(d.delivery_city, d.city);
  const hasWorkAddress = !workMatchesCustomer && Boolean(d.delivery_address.trim());

  // Separate on-site contact: stored only when at least a name/phone/email was entered.
  const hasEndContact = Boolean(
    d.end_contact_name?.trim() || d.end_contact_phone?.trim() || d.end_contact_email?.trim(),
  );

  return {
    customer_name: d.quote_type === 'private' ? d.customer_name || null : effectiveCustomerName || null,
    company_name: d.quote_type === 'business' ? d.company_name || null : null,
    organization_number: d.quote_type === 'business' ? d.organization_number || null : null,
    personal_number: d.quote_type === 'private' ? d.personal_number || null : null,
    contact_name: d.contact_name || null,
    email: d.email || null,
    phone: d.phone || null,
    street_address: d.street_address || null,
    postal_code: d.postal_code || null,
    city: d.city || null,
    visit_address: d.visit_address || null,
    delivery_address: hasWorkAddress ? d.delivery_address || null : null,
    delivery_postal_code: hasWorkAddress ? d.delivery_postal_code || null : null,
    delivery_city: hasWorkAddress ? d.delivery_city || null : null,
    invoice_address: d.invoice_address || null,
    // Separate on-site contact (slutkund) — null unless explicitly entered.
    end_contact_name: hasEndContact ? d.end_contact_name || null : null,
    end_contact_phone: hasEndContact ? d.end_contact_phone || null : null,
    end_contact_email: hasEndContact ? d.end_contact_email || null : null,
    // Märkning (företag) → Fortnox "Ert referensnummer". null unless entered.
    label: d.label?.trim() || null,
    // Point-in-time byggmoms (omvänd skattskyldighet). Stored on the snapshot so the Fortnox
    // push (resolveReverseVat) can decide the 0 %-row VAT regime without depending on the live
    // customer record — essential for snapshot-only quotes with no linked customer_id. `null`
    // = unknown (legacy rows / callers that don't supply it) → resolver falls back to the
    // customer. A boolean is authoritative.
    reverse_vat: opts?.reverseVat ?? null,
  };
}

export type QuoteRotFields = {
  quote_type: 'private' | 'business';
  rot_enabled: boolean;
  rot_property_designation: string;
  rot_percent: string;
  rot_max_deduction: string;
  rot_brf_org_number: string;
  // The ROT applicant is always the customer – derived from the customer fields,
  // never entered separately, so the personal number Fortnox uses for the deduction
  // is the same one stored on the customer.
  customer_name: string;
  personal_number: string;
};

// ROT is only valid for private customers; everything is nulled out when disabled.
export function buildRotDetails(d: QuoteRotFields) {
  const enabled = d.quote_type === 'private' ? d.rot_enabled : false;
  return {
    enabled,
    applicant_name: enabled ? d.customer_name || null : null,
    personal_number: enabled ? d.personal_number || null : null,
    property_designation: enabled ? d.rot_property_designation || null : null,
    // parseDecimal handles Swedish comma/space input ("33,5", "50 000"); raw Number() would
    // turn those into NaN and the server schema would reject the whole quote save.
    rot_percent: enabled ? parseDecimal(d.rot_percent, 30) : 30,
    max_deduction: enabled ? parseDecimal(d.rot_max_deduction, 50000) : 50000,
    brf_org_number: enabled ? d.rot_brf_org_number || null : null,
  };
}

export type QuoteHandoffFields = {
  desired_installation_date: string;
  handoff_notes: string;
  work_scope: string;
};

export function buildInternalHandoff(d: QuoteHandoffFields) {
  return {
    desired_installation_date: d.desired_installation_date || null,
    handoff_notes: d.handoff_notes || null,
    work_scope: d.work_scope || null,
  };
}

// ── Uppdatera offerten från kundkortet utan att äta säljarens egna ändringar ──
//
// Att gå in på kundkortet mitt i en offert och komma tillbaka finns till för att kunna ÅTGÄRDA
// något på kunden — slå på omvänd skattskyldighet, rätta en adress. Samtidigt fyller säljaren i
// egna värden på offerten som inte ska bli överskrivna av kortet.
//
// Tidigare gjordes valet ovillkorligt, och båda svaren var fel på var sitt sätt: förifyllde man
// alltid försvann det säljaren skrivit, förifyllde man aldrig blev en påslagen omvänd moms kvar
// på 25 % — och gula notisen intygade ändå motsatsen, eftersom den läser kundkortet direkt.
//
// Regeln nedan skiljer dem åt: ett fält som fortfarande bär exakt det värde kortet gav när kunden
// valdes är oberört och får det färska värdet; har säljaren ändrat det står deras värde kvar.

export const CUSTOMER_DERIVED_KEYS = [
  'quote_type', 'vat_percent', 'company_name', 'customer_name', 'organization_number',
  'personal_number', 'contact_name', 'phone', 'email', 'street_address', 'postal_code', 'city',
  'delivery_address', 'delivery_postal_code', 'delivery_city',
] as const;

export type CustomerDerivedKey = (typeof CUSTOMER_DERIVED_KEYS)[number];

/** The subset of draft fields that `applySelectedCustomer` derives from the customer card. */
export type CustomerDerivedValues = Record<CustomerDerivedKey, string>;

/** Pick the customer-derived subset out of anything draft-shaped. */
export function pickCustomerDerived(source: Partial<Record<CustomerDerivedKey, unknown>>): CustomerDerivedValues {
  const out = {} as CustomerDerivedValues;
  for (const key of CUSTOMER_DERIVED_KEYS) out[key] = String(source[key] ?? '');
  return out;
}

/**
 * Field-by-field merge on return from the customer card.
 *
 * @param current  what the draft holds now
 * @param applied  what the card gave when the customer was picked (the "untouched" reference)
 * @param next     what the card gives now
 *
 * Untouched (current === applied) → take `next`. Edited → keep `current`.
 *
 * ⚠️ Without `applied` this is undecidable — that is the whole reason it is stored alongside the
 * draft. A caller with no reference must leave the draft alone rather than guess, because guessing
 * wrong in the "overwrite" direction is the one that silently destroys a seller's work.
 */
export function mergeUntouchedCustomerFields(
  current: CustomerDerivedValues,
  applied: CustomerDerivedValues,
  next: CustomerDerivedValues,
): CustomerDerivedValues {
  const out = {} as CustomerDerivedValues;
  for (const key of CUSTOMER_DERIVED_KEYS) {
    out[key] = current[key] === applied[key] ? next[key] : current[key];
  }
  return out;
}

// ── Uppföljningsuppgiften ────────────────────────────────────────────────────

export type FollowUpQuoteFields = {
  id: string;
  project_name: string;
  quote_number: string | null;
  notes: string | null;
  description: string | null;
};

/**
 * Nyttolasten till POST /api/crm/tasks för uppgiften "Följ upp offert: …" som skapas när en NY
 * offert sparas med uppföljningsdatum och kryssrutan i.
 *
 * 🧨 Den här funktionen finns därför att den tidigare varianten var trasig i över ett år utan att
 * någon märkte det. Den skickade `prospect_id`, en nyckel som inte finns i `createCrmTaskSchema` —
 * och Zod strippar okända nycklar TYST. Uppgiften skapades utan koppling: `related_type` blev null,
 * och det enda spåret av offerten var titeln. Den gick alltså inte att hitta från offerten, vilket
 * är precis vad offertens uppgiftsflöde behöver.
 *
 * Nu bryts nyttolasten ut som en ren funktion just för att kunna prövas mot schemat i ett test, så
 * att ett framtida felstavat fältnamn faller på ett rött test i stället för att försvinna i det
 * tysta. Se tests/crm/quoteTasks.test.ts.
 *
 * ⚠️ Etiketten fryses i `metadata.related_label` och uppdateras inte om offerten byter namn — det
 * är en avsiktlig ögonblicksbild, samma som uppgiftssidans kopplingsväljare gör.
 */
export function buildFollowUpTaskPayload(quote: FollowUpQuoteFields, followUpDate: string, label: string) {
  return {
    related_type: 'crm_quote' as const,
    related_id: quote.id,
    related_label: label,
    title: `Följ upp offert: ${quote.project_name}`,
    details: quote.notes || quote.description || `Uppföljning för offert ${quote.project_name}`,
    priority: 'high' as const,
    due_date: followUpDate,
    source: 'crm_quote',
    status: 'open' as const,
  };
}
