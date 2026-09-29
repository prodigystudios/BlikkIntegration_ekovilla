import { z } from 'zod';
import { computePricing } from '@/lib/domains/crm/pricing';
import { pricingModeFromUnit } from '@/lib/domains/crm/lineItems';
import { parseDecimal } from '@/lib/shared/number';
import { resolveCrmContact, type CrmContactSource } from '@/lib/domains/crm/contacts';
import { getCrmCustomerDisplayName, type CrmCustomerType } from '@/lib/domains/crm/customers';
import type { WorkOrderReadinessIssue } from '@/lib/domains/crm/workOrderReadiness';
import { RESELLER_ID_PATTERN } from './resellers';

/**
 * Jobbet från återförsäljarportalen (RESELLER_PORTAL_CRM_PLAN.md fas 3b, kontraktets "Flöde 2"): schemat för kroppen
 * och hur den blir en arbetsorder. Rent: ingen databas, inget nätverk. Databasstegen står i ./jobIntakeStore.ts.
 *
 * Reglerna, från planen och Williams beslut 2026-09-28:
 *   - Raderna: priset är `unitCost` (article_price = unit_price), ingen rabatt, ingen ROT. Lösull (`volume`) blir
 *     m³-rader med yta och tjocklek, resten antal. `ovrigt` blir ingen konstruktion; CRM:et saknar det värdet.
 *     Namn och enhet tas ur artikelregistret när artikeln finns där: säckberäkningen känner igen materialet på
 *     registrets namn, och Fortnox vill ha registrets enhetskod (portalen får den med gemener). Densiteten lämnas tom,
 *     säljaren fyller i den.
 *   - Kunden är butiken. Med ett kundkort byggs snapshoten som på en fristående order (kortets kontakt blir Er
 *     referens, kortets moms gäller). Utan kort står butikens uppgifter där, och `reverse_vat` skrivs INTE: snapshotens
 *     värde vinner annars över kundkortet för alltid (`resolveReverseVat` i fortnox/helpers.ts).
 *   - Märkningen (`label`) är butikens offertnummer. Utan ROT blir den `YourOrderNumber` i Fortnox.
 *   - Arbetsplatsen är arbetsadressen, och står också som snapshotens separata arbetsadress (`delivery_*`), så att
 *     fullständighetskontrollen prövar arbetsplatsen och inte butikens adress, och Fortnox får den som leveransadress.
 *   - Kontaktpersonen på plats blir `end_contact_*`. Fastighetsbeteckning, vindslucka, period och meddelande blir TEXT
 *     i `handoff_notes`, aldrig egna nycklar i `internal_handoff`: arbetsorderns Spara skriver över hela kolumnen.
 *   - Titeln är arbetsplatsens adress. Den står i listorna och på Fortnox-ordern ("Projekt: …").
 */

export const PORTAL_JOB_PATH = '/api/portal/jobs';

const trimmed = (max: number) => z.string().trim().max(max, `Högst ${max} tecken.`);
const required = (max: number) => trimmed(max).min(1, 'Får inte vara tomt.');
// Portalens id:n står i sökvägar (planens punkt 16): samma tecken som butikens id.
const portalId = z.string().regex(RESELLER_ID_PATTERN, 'Ogiltigt id.');
const amount = z.number().finite('Ogiltigt tal.');
const positive = (max: number) => amount.positive('Måste vara större än noll.').max(max, `Högst ${max}.`);

const addressSchema = (street: z.ZodString) =>
  z.object({ street, postalCode: trimmed(20), city: trimmed(100) });

const quantitySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('volume'), areaM2: positive(100_000), thicknessMm: positive(2_000) }),
  z.object({ kind: z.literal('count'), value: positive(100_000) }),
]);

export const PORTAL_CONSTRUCTIONS = ['vind', 'snedtak', 'vagg', 'ovrigt'] as const;

const lineSchema = z
  .object({
    articleNumber: required(50),
    name: required(500),
    construction: z.enum(PORTAL_CONSTRUCTIONS),
    unit: trimmed(20),
    quantity: quantitySchema,
    unitCost: amount.min(0, 'Priset kan inte vara negativt.').max(10_000_000),
    // Bara information (kontraktet): CRM:et räknar själv.
    lineCost: amount,
  })
  // Kontraktet: `volume` är lösull, i m³. En volymrad i en annan enhet hade blivit en m³-rad med fel enhet på
  // Fortnox-ordern ("38 st"), så den nekas i stället för att tolkas.
  .refine((line) => line.quantity.kind !== 'volume' || pricingModeFromUnit(line.unit) === 'm3', {
    message: 'En volymrad (yta × tjocklek) ska ha enheten m3.',
    path: ['unit'],
  });

/** Butiken i portalens kropp: samma i ett jobb och i en butiksbeställning (fas 8), som delar butikens första kontakt. */
export const portalStoreSchema = z.object({
  resellerId: portalId,
  name: required(200),
  address: addressSchema(trimmed(200)),
  // null = butiken är inte kopplad i portalen. En tom sträng betyder samma sak.
  ekovillaCustomerNumber: z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), trimmed(50).nullable()),
});

export const portalJobSchema = z.object({
  quoteId: portalId,
  quoteNumber: required(50),
  store: portalStoreSchema,
  workplace: z.object({
    // Installatörerna kör dit: alla tre delarna krävs.
    address: z.object({ street: required(200), postalCode: required(20), city: required(100) }),
    propertyDesignation: trimmed(200),
    desiredPeriod: trimmed(200),
    atticHatch: z.enum(['inside', 'outside']),
    contactName: trimmed(200),
    contactPhone: trimmed(50),
    notes: trimmed(4000),
  }),
  lines: z.array(lineSchema).min(1, 'Jobbet har inga rader.').max(200, 'Högst 200 rader.'),
  costTotal: amount.min(0),
});

export type PortalJob = z.infer<typeof portalJobSchema>;
export type PortalJobLine = PortalJob['lines'][number];

// --------------------------------------------------------------------------------------------------- arbetsordern

/** Det ur artikelregistret som raden tar över (`listCachedFortnoxArticles`). */
export type RegisterArticleForJob = {
  article_number: string;
  description: string | null;
  unit: string | null;
  note?: string | null;
  include_in_work_description?: boolean;
};

/** Butikens kundkort, med det snapshoten och kontakten behöver. */
export type JobCustomerCard = CrmContactSource & {
  id: string;
  customer_type: CrmCustomerType;
  company_name: string | null;
  organization_number: string | null;
  first_name: string | null;
  last_name: string | null;
  personal_number: string | null;
  visit_address: Record<string, string | null> | null;
  reverse_vat: boolean | null;
};

export const JOB_CUSTOMER_SELECT =
  'id, customer_type, company_name, organization_number, first_name, last_name, personal_number, email, phone, mobile, visit_address, reverse_vat, contacts:crm_customer_contacts(name, phone, email, is_primary)';

const nonEmpty = (value: string | null | undefined) => {
  const t = value?.trim();
  return t ? t : null;
};

/** "Rönnvägen 18, Gävle". */
export function portalJobProjectName(job: PortalJob): string {
  const { street, city } = job.workplace.address;
  return [street, city].map((s) => s.trim()).filter(Boolean).join(', ');
}

const ATTIC_HATCH_LABEL: Record<PortalJob['workplace']['atticHatch'], string> = { inside: 'inne', outside: 'ute' };

/** Arbetsbeskrivningens text: det installatörerna behöver veta som inte har ett eget fält. */
export function portalJobHandoffNotes(job: PortalJob): string {
  const w = job.workplace;
  const rows = [
    `Jobb från återförsäljarportalen: ${job.store.name.trim()}, offert ${job.quoteNumber.trim()}.`,
    w.propertyDesignation.trim() ? `Fastighetsbeteckning: ${w.propertyDesignation.trim()}` : null,
    `Vindslucka: ${ATTIC_HATCH_LABEL[w.atticHatch]}`,
    w.desiredPeriod.trim() ? `Önskad period: ${w.desiredPeriod.trim()}` : null,
    w.notes.trim() ? `Meddelande från butiken: ${w.notes.trim()}` : null,
  ];
  return rows.filter(Boolean).join('\n');
}

/** Formatet talen har på en offertrad: text, punkt som decimaltecken (parseDecimal läser den). */
const numberText = (n: number) => String(n);

/** En rad i `line_items`, med samma fält som offertens (`quoteLineItemSchema`). */
export type PortalWorkOrderLine = {
  id: string;
  construction: string;
  m2: string;
  thickness_mm: string;
  auto_price: boolean;
  unit_price: string;
  pricing_mode: 'm3' | 'item';
  quantity: string;
  article_id: null;
  article_name: string;
  article_number: string;
  article_price: number;
  article_unit_name: string | null;
  article_note: string | null;
  discount_percent: string;
  line_note: string;
  is_rot_work: boolean;
  house_work_type: 'CONSTRUCTION';
  labor_cost: string;
  density: string;
  written_off: boolean;
  include_in_description: boolean;
};

export function mapPortalJobLines(
  lines: PortalJobLine[],
  register: ReadonlyMap<string, RegisterArticleForJob>,
  newId: () => string,
): PortalWorkOrderLine[] {
  return lines.map((line) => {
    const article = register.get(line.articleNumber);
    const volume = line.quantity.kind === 'volume' ? line.quantity : null;
    const count = line.quantity.kind === 'count' ? line.quantity : null;
    return {
      id: newId(),
      construction: line.construction === 'ovrigt' ? '' : line.construction,
      m2: volume ? numberText(volume.areaM2) : '',
      thickness_mm: volume ? numberText(volume.thicknessMm) : '',
      auto_price: false,
      unit_price: numberText(line.unitCost),
      pricing_mode: volume ? 'm3' : 'item',
      quantity: count ? numberText(count.value) : '',
      article_id: null,
      article_name: nonEmpty(article?.description) ?? line.name,
      article_number: line.articleNumber,
      article_price: line.unitCost,
      article_unit_name: nonEmpty(article?.unit) ?? nonEmpty(line.unit),
      article_note: nonEmpty(article?.note),
      discount_percent: '',
      line_note: '',
      is_rot_work: false,
      house_work_type: 'CONSTRUCTION',
      labor_cost: '',
      density: '',
      written_off: false,
      // Artikelregistrets standard, som när en rad skapas i offerten.
      include_in_description: article?.include_in_work_description === true,
    };
  });
}

export function buildPortalJobCustomerSnapshot(job: PortalJob, customer: JobCustomerCard | null): Record<string, unknown> {
  const workplace = job.workplace;
  const common = {
    delivery_address: nonEmpty(workplace.address.street),
    delivery_postal_code: nonEmpty(workplace.address.postalCode),
    delivery_city: nonEmpty(workplace.address.city),
    invoice_address: null,
    label: job.quoteNumber.trim(),
    end_contact_name: nonEmpty(workplace.contactName),
    end_contact_phone: nonEmpty(workplace.contactPhone),
  };

  if (!customer) {
    const store = job.store;
    return {
      customer_name: store.name.trim(),
      company_name: store.name.trim(),
      organization_number: null,
      personal_number: null,
      contact_name: null,
      email: null,
      phone: null,
      your_reference: null,
      street_address: nonEmpty(store.address.street),
      postal_code: nonEmpty(store.address.postalCode),
      city: nonEmpty(store.address.city),
      ...common,
    };
  }

  return { ...portalCustomerIdentity(customer), ...common };
}

/**
 * Kundkortets del av snapshoten: vem kunden är, dess kontakt (Er referens) och adress, och momsen. Det är de fälten
 * som byts när butikens kundkort kopplas i efterhand (fas 3c); märkningen, arbetsplatsen och kontakten på plats är
 * jobbets och står kvar.
 */
export function portalCustomerIdentity(customer: JobCustomerCard): Record<string, unknown> {
  const isBusiness = customer.customer_type === 'business';
  const contact = resolveCrmContact(customer);
  const visit = customer.visit_address ?? {};
  return {
    customer_name: getCrmCustomerDisplayName(customer),
    company_name: isBusiness ? nonEmpty(customer.company_name) : null,
    organization_number: isBusiness ? nonEmpty(customer.organization_number) : null,
    personal_number: isBusiness ? null : nonEmpty(customer.personal_number),
    contact_name: nonEmpty(contact.name),
    email: nonEmpty(contact.email),
    phone: nonEmpty(contact.phone),
    // Som en fristående order: ingen offert att ärva Er referens från, så kortets kontakt.
    your_reference: nonEmpty(contact.name),
    street_address: nonEmpty(visit.street) ?? nonEmpty(visit.street_address),
    postal_code: nonEmpty(visit.postal_code),
    city: nonEmpty(visit.city),
    reverse_vat: customer.reverse_vat === true,
  };
}

function mergeLinkedSnapshot(existing: Record<string, unknown>, identity: Record<string, unknown>): Record<string, unknown> {
  const merged = { ...existing, ...identity };
  for (const key of LINK_CONTACT_KEYS) {
    const kept = existing[key];
    if (typeof kept === 'string' && kept.trim()) merged[key] = kept;
  }
  return merged;
}

/** Det ur arbetsordern som kopplingen räknar om. */
export type LinkableWorkOrder = {
  customer_snapshot: Record<string, unknown> | null;
  line_items: Array<Record<string, unknown>> | null;
  rot_details: Record<string, unknown> | null;
};

/** Kontaktfälten ordern kan ha fått för hand innan kortet kopplades. Kortet fyller dem bara när de är tomma. */
const LINK_CONTACT_KEYS = ['contact_name', 'email', 'phone', 'your_reference'] as const;

/**
 * Butikens kundkort kopplas på en portalorder utan kund (fas 3c): kunden, kortets del av snapshoten och momsen, och
 * därmed beloppet. Butiken är kunden: det är butiken Ekovilla fakturerar (William 2026-09-28). Raderna och resten av
 * snapshoten (märkningen, arbetsplatsen, kontakten på plats) står kvar.
 *
 * Kortet vinner för vem kunden är (namn, org.nr, adress, moms). Kontakten och Er referens är ett val för just den här
 * ordern: har säljaren fyllt i dem innan kortet kopplades står de kvar, och kortet fyller bara det som är tomt. Samma
 * regel som telefonnumret i fullständighetskontrollen.
 */
export function buildPortalCustomerLinkUpdate(workOrder: LinkableWorkOrder, customer: JobCustomerCard): Record<string, unknown> {
  const vatPercent = customer.reverse_vat === true ? 0 : 25;
  // Avskrivna rader räknas inte: samma regel som `activeLineItems` (fortnox/partialInvoices.ts), som
  // saveWorkOrderLineItems räknar med. Den importeras inte hit, eftersom den modulen drar in service-klienten och
  // Fortnox-pushen, och den här ska vara ren. Ändras regeln där ändras den här.
  const active = (workOrder.line_items ?? []).filter((item) => !item.written_off) as PortalWorkOrderLine[];
  const pricing = computePricing(active, vatPercent, {
    isPrivate: customer.customer_type === 'private',
    rot: (workOrder.rot_details ?? null) as { enabled?: boolean | null } | null,
  });
  return {
    customer_id: customer.id,
    client_name: getCrmCustomerDisplayName(customer),
    quote_type: customer.customer_type === 'private' ? 'private' : 'business',
    customer_snapshot: mergeLinkedSnapshot(workOrder.customer_snapshot ?? {}, portalCustomerIdentity(customer)),
    vat_percent: vatPercent,
    pricing_summary: { subtotal: pricing.subtotal, vat: pricing.vat, total: pricing.total },
    amount: pricing.total,
  };
}

export type PortalWorkOrderInput = {
  job: PortalJob;
  customer: JobCustomerCard | null;
  register: ReadonlyMap<string, RegisterArticleForJob>;
  workOrderId: string;
  orderNumber: string;
  assigneeId: string;
  newId: () => string;
};

/** Raden som läggs in i `crm_work_orders`. */
export function buildPortalWorkOrderInsert(input: PortalWorkOrderInput): Record<string, unknown> {
  const { job, customer } = input;
  const snapshot = buildPortalJobCustomerSnapshot(job, customer);
  const lineItems = mapPortalJobLines(job.lines, input.register, input.newId);
  // 0 % vid omvänd skattskyldighet på kortet, annars 25 %. Samma regel som en fristående order.
  const vatPercent = customer?.reverse_vat === true ? 0 : 25;
  const pricing = computePricing(lineItems, vatPercent, { isPrivate: false });
  return {
    id: input.workOrderId,
    quote_id: null,
    prospect_id: null,
    customer_id: customer?.id ?? null,
    order_number: input.orderNumber,
    project_name: portalJobProjectName(job),
    client_name: snapshot.customer_name,
    quote_type: customer?.customer_type === 'private' ? 'private' : 'business',
    customer_snapshot: snapshot,
    work_address: {
      street_address: nonEmpty(job.workplace.address.street),
      postal_code: nonEmpty(job.workplace.address.postalCode),
      city: nonEmpty(job.workplace.address.city),
      delivery_address: null,
      invoice_address: null,
    },
    pricing_summary: { subtotal: pricing.subtotal, vat: pricing.vat, total: pricing.total },
    line_items: lineItems,
    rot_details: {},
    internal_handoff: { desired_installation_date: null, handoff_notes: portalJobHandoffNotes(job) },
    currency_code: 'SEK',
    amount: pricing.total,
    vat_percent: vatPercent,
    desired_installation_date: null,
    status: 'draft',
    notes: null,
    created_by: input.assigneeId,
    assigned_to: input.assigneeId,
  };
}

// -------------------------------------------------------------------------------------------------- Fortnox-ordern

/**
 * Varför Fortnox-ordern inte skapades, som säljaren läser det i notisen. Fynden kommer ur samma
 * fullständighetskontroll som våra egna ordrar (`evaluateWorkOrderReadiness`); de som pekar på offerten får här en
 * text om butiken i stället.
 */
export function portalFortnoxBlockerReasons(blockers: WorkOrderReadinessIssue[], customerNumber: string | null): string[] {
  return blockers.map((blocker) => {
    if (blocker.field === 'customer_link') {
      return customerNumber
        ? `Butikens kundnummer ${customerNumber} finns inte i kundregistret.`
        : 'Butiken har inget kundnummer i portalen, så jobbet är inte kopplat till någon kund.';
    }
    if (blocker.field === 'organization_number') return 'Organisationsnummer saknas på butikens kundkort.';
    return blocker.message;
  });
}

/**
 * Påminnelsen i notisen: portalen skickar ingen densitet, och säckantalet är 0 tills den finns. Läses ur
 * arbetsorderns rader: en m³-rad (lösull) utan densitet.
 */
export function workOrderLinesNeedDensity(lines: unknown): boolean {
  if (!Array.isArray(lines)) return false;
  return lines.some((line) => {
    const l = line as { pricing_mode?: string | null; density?: string | number | null; written_off?: boolean | null };
    return (l.pricing_mode ?? 'm3') !== 'item' && !l.written_off && !(parseDecimal(l.density) > 0);
  });
}
