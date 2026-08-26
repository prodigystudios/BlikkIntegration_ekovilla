import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { crmQuoteSelect } from './quotes';
import { contactRowByName, resolveCrmContact, type CrmContactRow, type CrmContactSource } from './contacts';
import { computePricing, type PricingLineItem } from './pricing';
import { activeLineItems, computeInvoiceState, validateLineItemEdit, type InvoiceRound } from '@/lib/domains/fortnox/partialInvoices';
import { isValidPersonalNumber, PERSONAL_NUMBER_ERROR } from './personalNumber';
import { reportedSacksByWorkOrder } from '@/lib/domains/planning/reports';
import {
  evaluateWorkOrderReadiness,
  type ReadinessCustomerSource,
  type WorkOrderReadiness,
} from './workOrderReadiness';
import type { CreateWorkOrderFileInput } from './workOrderFiles/types';

export const crmWorkOrderSelect = `
  id,
  quote_id,
  prospect_id,
  customer_id,
  order_number,
  project_name,
  client_name,
  quote_type,
  customer_snapshot,
  work_address,
  pricing_summary,
  line_items,
  rot_details,
  internal_handoff,
  currency_code,
  amount,
  vat_percent,
  desired_installation_date,
  source_status,
  status,
  notes,
  fortnox_order_number,
  fortnox_order_sync_status,
  fortnox_order_synced_at,
  fortnox_invoice_number,
  fortnox_invoice_sync_status,
  fortnox_invoiced_at,
  partial_invoicing_started_at,
  created_by,
  assigned_to,
  created_at,
  updated_at,
  assignee:profiles!assigned_to(id, full_name)
`;

export const crmWorkOrderTimeEntrySelect = `
  id,
  work_order_id,
  user_id,
  work_date,
  start_time,
  end_time,
  break_minutes,
  hours,
  note,
  created_at,
  updated_at,
  user:profiles(
    id,
    full_name
  )
`;

export const crmWorkOrderCommentSelect = `
  id,
  work_order_id,
  created_by,
  body,
  created_at,
  author:profiles(
    id,
    full_name
  )
`;

export type CrmWorkOrderStatus = 'draft' | 'scheduled' | 'ready' | 'in_progress' | 'completed' | 'partially_invoiced' | 'invoiced' | 'cancelled';

/**
 * Statusar som betyder att ordern aldrig blev av. En avbruten order är inte omsättning — den ska
 * inte räknas som ordervärde, som ett antal order eller som ett steg i konverteringen.
 *
 * Bor här hos vokabulären i stället för hos rapporten, så att en framtida status i samma anda
 * (avbeställd, makulerad) har ett självklart ställe att läggas till på och slår igenom överallt.
 *
 * Läses AVSIKTLIGT inte som "det som saknas i BOARD_FILTER_STATUSES". `cancelled` ligger utanför
 * brädans grupper idag, men den dagen någon lägger till en Avbrutna-flik hade en sådan härledning
 * tyst börjat räkna avbrutna order som omsättning igen.
 */
export const DEAD_WORK_ORDER_STATUSES: CrmWorkOrderStatus[] = ['cancelled'];

/** Blev ordern aldrig av? */
export function isDeadWorkOrder(status: string | null | undefined): boolean {
  return DEAD_WORK_ORDER_STATUSES.includes(status as CrmWorkOrderStatus);
}

type WorkOrderAddress = {
  street_address?: string | null;
  postal_code?: string | null;
  city?: string | null;
  delivery_address?: string | null;
  invoice_address?: string | null;
};

type WorkOrderUpdateInput = {
  status: CrmWorkOrderStatus;
  desired_installation_date: string | null;
  notes: string | null;
  internal_handoff: Record<string, any>;
  work_address: WorkOrderAddress;
  assigned_to?: string | null;
};

type CreateWorkOrderCommentInput = {
  work_order_id: string;
  created_by: string;
  body: string;
};

type QuoteSource = {
  id: string;
  prospect_id: string | null;
  customer_id: string | null;
  customer_name: string | null;
  quote_type: 'private' | 'business';
  customer_snapshot: Record<string, any> | null;
  pricing_summary: Record<string, any> | null;
  line_items: Array<Record<string, any>> | null;
  rot_details: Record<string, any> | null;
  internal_handoff: Record<string, any> | null;
  project_name: string;
  description: string | null;
  amount: number;
  currency_code: string;
  vat_percent: number;
  status: 'draft' | 'sent' | 'follow_up' | 'won' | 'lost';
  notes: string | null;
  created_by: string;
  assigned_to: string;
  work_order_id: string | null;
  work_order_number: string | null;
};

function buildWorkOrderNumber(seed: string) {
  const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `AO-${datePart}-${seed.replace(/-/g, '').slice(0, 6).toUpperCase()}`;
}

type StandaloneWorkOrderInput = {
  customerId: string;
  projectName: string;
  desiredInstallationDate: string | null;
  actorUserId: string;
};

// Create a work order WITHOUT an originating quote (standalone order). Pulls identity
// (name, snapshot, address) from the linked customer card; articles/notes are added
// afterwards on the work order detail page. quote_id is left null.
export async function createStandaloneCrmWorkOrder(supabase: SupabaseClient, input: StandaloneWorkOrderInput) {
  const { data: customer, error: custErr } = await supabase
    .from('crm_customers')
    .select('id, customer_type, company_name, organization_number, first_name, last_name, personal_number, email, phone, mobile, visit_address, delivery_address, invoice_address, reverse_vat, contacts:crm_customer_contacts(name, phone, email, is_primary)')
    .eq('id', input.customerId)
    .maybeSingle();

  if (custErr) return { data: null, error: custErr, reason: 'customer_fetch_failed' as const };
  if (!customer) return { data: null, error: { message: 'Kunden hittades inte' }, reason: 'customer_not_found' as const };

  // Fortnox needs a private customer's personnummer (its OrganisationNumber) to invoice the
  // order. It is optional at customer-create, so enforce it here: the caller collects it and
  // saves it on the customer card before the order is created.
  if (customer.customer_type === 'private' && !customer.personal_number) {
    return { data: null, error: { message: 'Personnummer krävs för privatkund innan order kan skapas' }, reason: 'missing_personal_number' as const };
  }

  // Och det ska vara ETT FULLT nummer. Kundkortet låser formatet numera, men rader som skapades
  // innan dess bär tio siffror — och de tar sig hela vägen till Fortnox, där ROT- och
  // husarbetesuppgifterna faller tyst och måste läggas in för hand. Här är sista stället felet går
  // att fånga innan det blir ett bokföringsärende.
  if (customer.customer_type === 'private' && !isValidPersonalNumber(customer.personal_number as string)) {
    return { data: null, error: { message: PERSONAL_NUMBER_ERROR }, reason: 'invalid_personal_number' as const };
  }

  const isBusiness = customer.customer_type === 'business';
  const clientName = isBusiness
    ? (customer.company_name || 'Okänd kund')
    : ([customer.first_name, customer.last_name].filter(Boolean).join(' ') || 'Okänd kund');
  // Shared rule (resolveCrmContact) so a standalone order lands on the same address as an
  // order created from a quote — the card alone used to decide here.
  const contact = resolveCrmContact(customer as CrmContactSource);
  const visit = (customer.visit_address || {}) as Record<string, string | null>;

  const customerSnapshot = {
    customer_name: clientName,
    company_name: isBusiness ? (customer.company_name || null) : null,
    organization_number: isBusiness ? (customer.organization_number || null) : null,
    personal_number: !isBusiness ? (customer.personal_number || null) : null,
    contact_name: contact.name || null,
    email: contact.email || null,
    phone: contact.phone || null,
    // "Er referens" — kundens formella referens, den som hamnar på Fortnox-dokumenten och styr
    // fakturan rätt hos kunden. SKILD från contact_name ovan: det fältet är kundkontakten, alltså
    // vem vi och installatörerna ringer, och den får ändras fritt utan att röra Fortnox. På en
    // standalone-order finns ingen offert att ärva referensen från, så den seedas från samma
    // kontakt och kan sedan sättas för hand i ordervyn.
    your_reference: contact.name || null,
    street_address: visit.street || visit.street_address || null,
    postal_code: visit.postal_code || null,
    city: visit.city || null,
    delivery_address: null,
    invoice_address: null,
    // Reverse charge (omvänd skattskyldighet / byggmoms) from the customer card — drives
    // vat_percent below and the Fortnox VATType on push (see lib/domains/fortnox/helpers.ts).
    reverse_vat: customer.reverse_vat === true,
  };

  const createResult = await supabase
    .from('crm_work_orders')
    .insert({
      quote_id: null,
      customer_id: customer.id,
      order_number: buildWorkOrderNumber(globalThis.crypto.randomUUID()),
      project_name: input.projectName,
      client_name: clientName,
      quote_type: customer.customer_type,
      customer_snapshot: customerSnapshot,
      work_address: {
        street_address: customerSnapshot.street_address,
        postal_code: customerSnapshot.postal_code,
        city: customerSnapshot.city,
        delivery_address: null,
        invoice_address: null,
      },
      pricing_summary: {},
      line_items: [],
      rot_details: {},
      internal_handoff: {},
      currency_code: 'SEK',
      amount: 0,
      // 0 % for reverse-charge (byggmoms) customers, else the standard 25 %. Mirrors the quote
      // form's auto-default so a standalone order's pricing/display matches the Fortnox document.
      vat_percent: customerSnapshot.reverse_vat ? 0 : 25,
      desired_installation_date: input.desiredInstallationDate,
      status: 'draft',
      notes: null,
      created_by: input.actorUserId,
      assigned_to: input.actorUserId,
    })
    .select(crmWorkOrderSelect)
    .single();

  return { data: createResult.data, error: createResult.error, reason: createResult.error ? ('create_failed' as const) : null };
}

function getClientName(source: QuoteSource) {
  return source.customer_snapshot?.customer_name
    || source.customer_snapshot?.company_name
    || source.customer_name
    || source.project_name;
}


// Kundkortets halva av fullständighetskontrollen. Fälten är exakt de `resolveCrmContact` och
// `evaluateWorkOrderReadiness` läser — inget mer, eftersom raden bara används för att fylla luckor.
const readinessCustomerSelect =
  'customer_type, organization_number, personal_number, email, phone, mobile, visit_address, contacts:crm_customer_contacts(name, phone, email, is_primary)';

// ⚠️ Felet får INTE svaljas. En tillfälligt misslyckad läsning skulle annars vara omöjlig att
// skilja från "kunden har inga uppgifter": kontrollen hade hittat på spärrar för adress, telefon
// och org.nr och bett säljaren fylla i fält som redan är ifyllda. Anroparen avbryter i stället.
async function fetchReadinessCustomer(
  supabase: SupabaseClient,
  customerId: string | null,
): Promise<{ customer: ReadinessCustomerSource; error: { message: string } | null }> {
  if (!customerId) return { customer: null, error: null };
  const { data, error } = await supabase
    .from('crm_customers')
    .select(readinessCustomerSelect)
    .eq('id', customerId)
    .maybeSingle();
  if (error) return { customer: null, error };
  return { customer: (data as ReadinessCustomerSource) ?? null, error: null };
}

/**
 * Vad som saknas innan offerten kan bli en arbetsorder — samma bedömning som skapandet gör.
 *
 * Finns för att kunna svara på frågan UTAN att försöka skapa ordern: offertformuläret och den
 * delade offertpanelen visar listan innan säljaren trycker, i stället för att ett fel dyker upp
 * efteråt. Att den delar funktion med `createCrmWorkOrderFromQuote` är hela poängen — en egen
 * kopia i klienten hade glidit isär från det servern faktiskt kräver.
 */
export async function getWorkOrderReadinessForQuote(supabase: SupabaseClient, quoteId: string) {
  const { data: quote, error } = await supabase
    .from('crm_quotes')
    .select('id, customer_id, quote_type, customer_snapshot, rot_details, line_items, internal_handoff, status, work_order_id')
    .eq('id', quoteId)
    .maybeSingle();

  if (error) return { data: null, error, reason: 'quote_fetch_failed' as const };
  if (!quote) return { data: null, error: { message: 'Offerten hittades inte' }, reason: 'not_found' as const };

  const { customer, error: customerError } = await fetchReadinessCustomer(
    supabase,
    (quote as { customer_id: string | null }).customer_id,
  );
  if (customerError) return { data: null, error: customerError, reason: 'customer_fetch_failed' as const };

  const readiness: WorkOrderReadiness = evaluateWorkOrderReadiness(quote, customer);

  return { data: readiness, error: null, reason: null };
}

export async function createCrmWorkOrderFromQuote(supabase: SupabaseClient, quoteId: string, actorUserId: string) {
  const quoteResult = await supabase
    .from('crm_quotes')
    .select('id, prospect_id, customer_id, customer_name, quote_type, customer_snapshot, pricing_summary, line_items, rot_details, internal_handoff, project_name, description, amount, currency_code, vat_percent, status, notes, created_by, assigned_to, work_order_id, work_order_number')
    .eq('id', quoteId)
    .single<QuoteSource>();

  if (quoteResult.error) {
    return { data: null, error: quoteResult.error, reason: quoteResult.error.code === 'PGRST116' ? 'not_found' : 'quote_fetch_failed' as const };
  }

  const quote = quoteResult.data;

  if (!quote) {
    return { data: null, error: { message: 'Offerten hittades inte' }, reason: 'not_found' as const };
  }

  if (quote.status !== 'won') {
    return { data: null, error: { message: 'Arbetsorder kan bara skapas från vunnen offert' }, reason: 'quote_not_won' as const };
  }

  if (quote.work_order_id || quote.work_order_number) {
    return { data: null, error: { message: 'Arbetsorder finns redan för offerten' }, reason: 'already_created' as const };
  }

  // Fullständighetskontrollen. Allt som saknas fångas HÄR, före insert:en, eftersom routen
  // auto-pushar den färdiga ordern till Fortnox — efter den punkten är en glömd uppgift ett
  // bokföringsärende i stället för ett formulärfel. Kundkortet läses om eftersom adress, telefon
  // och org.nr inte går att redigera i offertformuläret; se workOrderReadiness.ts.
  const { customer: customerRow, error: customerError } = await fetchReadinessCustomer(supabase, quote.customer_id);
  if (customerError) {
    return { data: null, error: customerError, reason: 'customer_fetch_failed' as const };
  }

  const readiness = evaluateWorkOrderReadiness(quote, customerRow);

  if (!readiness.ready) {
    // Kontrollen skickas MED, den görs inte om i routen. En andra körning kan svara annorlunda —
    // eller misslyckas — och då hade svaret burit ett felmeddelande om saknade uppgifter men en
    // tom lista, vilket i klienten läses som "inget saknas" och torkar checklistan från skärmen.
    // Meddelandet är första fyndets, så ytor som bara visar `error` säger fortfarande något
    // begripligt.
    return { data: null, error: { message: readiness.blockers[0].message }, reason: 'incomplete' as const, readiness };
  }

  // "Er referens" blir ett EGET fält på arbetsordern. På offerten är den samma sak som
  // contact_name (fältet heter "Er referens (kontaktperson)" och är obligatoriskt där), men från
  // och med ordern skiljer sig de två: contact_name blir kundkontakten — vem vi ringer — och får
  // ändras fritt, medan your_reference är det som går till Fortnox YourReference. Utan den här
  // frysningen vid orderskapandet skulle en rättad kontaktperson skriva om kundens fakturareferens.
  //
  // De upplösta värdena bakas in i snapshoten: kontrollen ovan godkände dem, och skrev vi något
  // annat till ordern hade spärren prövat en uppgift ordern sedan inte bar.
  //
  // ⚠️ Vem som vinner varierar per fält, och det är HELA poängen — se huvudet i
  // workOrderReadiness.ts. För telefon och org.nr fyller kortet bara en tom snapshot. För
  // personnummer, e-post och kundadress vinner kortet, eftersom de tre inte går att redigera i
  // offertformuläret och kopian därför aldrig är ett medvetet val.
  const orderSnapshot: Record<string, unknown> = {
    ...(quote.customer_snapshot || {}),
    your_reference: quote.customer_snapshot?.your_reference ?? quote.customer_snapshot?.contact_name ?? null,
    personal_number: quote.quote_type === 'private' ? readiness.resolved.personalNumber : (quote.customer_snapshot?.personal_number ?? null),
    organization_number: quote.quote_type === 'business' ? readiness.resolved.organizationNumber : (quote.customer_snapshot?.organization_number ?? null),
    phone: readiness.resolved.phone,
    // E-posten löses om ur kundkortet, till skillnad från telefonen ovan som bara fyller en tom
    // snapshot. Skälet är att den inte går att redigera på offerten — `draft.email` sätts från
    // kortet och renderas aldrig i formuläret — så en snapshot som vann hade burit vidare ett lån
    // som inte längre görs: bolagets adress under en anställds namn. Se `resolved.email`.
    email: readiness.resolved.email,
    // Kundadressen ur samma uppslagning som spärren använde. ⚠️ Inte kosmetik:
    // `buildOrderDeliveryFields` avgör om Fortnox ska få ett leveransadressblock genom att jämföra
    // arbetsadressens gata med DEN HÄR strängen. Lämnade vi offertens gamla kundadress kvar skulle
    // varje order som skapats efter en rättad adress få en Leveransadress på orderbekräftelsen,
    // för ett jobb som ligger på kundens egen adress.
    //
    // ⚠️ BARA när spärren faktiskt prövade den, alltså när offerten saknar egen arbetsadress. Har
    // den en egen tittar kontrollen aldrig på kundadressen, och ett halvtomt kundkort (gata utan
    // ort) hade då tyst ersatt offertens kompletta adress med nullar — utan att något fångade det,
    // eftersom adresspärren mätte arbetsadressen. Då behåller snapshoten sitt eget värde.
    // Och bara när adressen faktiskt kom från KORTET — annars vore skrivningen en nolloperation,
    // utom för den äldre fritextnyckeln `visit_address` som skulle byta ut gatan och lämna kvar
    // postnumret från den andra platsen.
    //
    // Följden är att en sådan gammal rad får ett leveransadressblock på Fortnox-orderbekräftelsen,
    // eftersom arbetsadressens gata då skiljer sig från snapshotens. Det är RÄTT och ska inte
    // "rättas": fältet hette "Om annan än kundadress", alltså en annan plats än kundens — precis
    // det ett leveransadressblock finns till för.
    ...(readiness.resolved.workAddressFromCustomer && readiness.resolved.customerAddressFromCard
      ? {
          street_address: readiness.resolved.customerAddress.street_address,
          postal_code: readiness.resolved.customerAddress.postal_code,
          city: readiness.resolved.customerAddress.city,
        }
      : {}),
  };

  const orderNumber = buildWorkOrderNumber(quote.id);

  const createResult = await supabase
    .from('crm_work_orders')
    .insert({
      quote_id: quote.id,
      prospect_id: quote.prospect_id,
      customer_id: quote.customer_id,
      order_number: orderNumber,
      project_name: quote.project_name,
      client_name: getClientName(quote),
      quote_type: quote.quote_type,
      customer_snapshot: orderSnapshot,
      work_address: readiness.resolved.workAddress,
      pricing_summary: quote.pricing_summary || {},
      line_items: quote.line_items || [],
      rot_details: quote.rot_details || {},
      internal_handoff: quote.internal_handoff || {},
      currency_code: quote.currency_code || 'SEK',
      amount: quote.amount || 0,
      // ?? not || — a reverse-charge (byggmoms) quote has vat_percent 0, and `0 || 25` would
      // wrongly store 25 on the work order (the document/pricing stay 0, only the column drifts).
      vat_percent: quote.vat_percent ?? 25,
      desired_installation_date: quote.internal_handoff?.desired_installation_date || null,
      source_status: quote.status,
      status: 'draft',
      // Orderns notes = "Interna anteckningar". Seedas från offertens egna notes (annars
      // description) — ALDRIG från handoff_notes: det blocket bor redan i internal_handoff
      // (rad ovan) och skulle annars dubbleras i både "Överlämningsnotering" och "Interna
      // anteckningar" i ordervyn.
      notes: quote.notes || quote.description || null,
      created_by: actorUserId,
      assigned_to: quote.assigned_to,
    })
    .select(crmWorkOrderSelect)
    .single();

  if (createResult.error) {
    return { data: null, error: createResult.error, reason: createResult.error.code === '23505' ? 'already_created' as const : 'work_order_create_failed' as const };
  }

  const workOrder = createResult.data;

  // Återlänkningen körs med elevated klient, INTE sessionsklienten. Sedan
  // 20260817_crm_work_orders_insert_from_won_quote.sql får vilken säljare som helst skapa
  // ordern på en vunnen offert (så att ett jobb inte står still när säljaren är borta), men
  // offertens UPDATE-policy är fortfarande ägarscopad — och den ska den vara, annars blir
  // allas offerter redigerbara för alla. Utan elevationen skulle raden ovan skapas och den här
  // skrivningen falla: föräldralös order, offert som ser okonverterad ut, och nästa försök
  // smäller på unikhetsindexet på quote_id.
  //
  // Avgränsningen är medveten: fyra kolumner som är systemets bokföring över att
  // konverteringen skett, inget av användarens innehåll. Behörighetsbeslutet är redan fattat
  // (crm.workorder.write + vunnen offert) och ordern är redan skapad när vi kommer hit.
  const quoteUpdateResult = await getSupabaseAdmin()
    .from('crm_quotes')
    .update({
      work_order_id: workOrder.id,
      work_order_number: workOrder.order_number,
      converted_to_work_order_at: new Date().toISOString(),
      converted_to_work_order_by: actorUserId,
    })
    .eq('id', quote.id)
    .select(crmQuoteSelect)
    .single();

  if (quoteUpdateResult.error) {
    return { data: null, error: quoteUpdateResult.error, reason: 'quote_update_failed' as const };
  }

  return {
    data: {
      item: quoteUpdateResult.data,
      workOrder,
    },
    error: null,
    reason: null,
  };
}

// Page size for the work-order board. The list is paginated server-side (range + exact
// count) instead of an unbounded `.limit()`, so it can never silently truncate past the
// PostgREST row cap once the company accumulates orders (see SUPABASE_CONVENTIONS.md).
export const CRM_WORK_ORDERS_PAGE_SIZE = 100;

// The board's composite status filters → the concrete statuses each one covers. Mirrors the
// client's matchesFilter so server-side filtering and the chip labels agree. `all` = no status
// filter (includes cancelled, exactly like the old client-side 'all'). Kept here so the list
// query and the per-filter counts can never diverge.
export type CrmWorkOrderBoardFilter = 'all' | 'draft' | 'scheduled' | 'active' | 'completed' | 'invoiced';
export const CRM_WORK_ORDER_BOARD_FILTERS: CrmWorkOrderBoardFilter[] = ['all', 'draft', 'scheduled', 'active', 'completed', 'invoiced'];
export const BOARD_FILTER_STATUSES: Record<CrmWorkOrderBoardFilter, CrmWorkOrderStatus[] | null> = {
  all: null,
  draft: ['draft'],
  scheduled: ['scheduled', 'ready'],
  active: ['in_progress'],
  // 'Fakturera' covers orders still in the invoicing stage — completed AND mid-delfakturering.
  completed: ['completed', 'partially_invoiced'],
  invoiced: ['invoiced'],
};

type WorkOrderListFilters = {
  search?: string;
  filter?: CrmWorkOrderBoardFilter;
  status?: CrmWorkOrderStatus;
  assignedToIn?: string[];
  workOrderId?: string;
  customerId?: string;
};

// Apply the shared WHERE clauses so the paginated list and the per-filter counts always use
// the exact same predicates (search, status group, assignee, deep-link, customer scope).
function applyWorkOrderListFilters<Q extends {
  or: (f: string) => Q; eq: (c: string, v: string) => Q; in: (c: string, v: string[]) => Q;
}>(query: Q, options: WorkOrderListFilters): Q {
  if (options.search) {
    // ⚠️ KOMMATECKEN OCH PARENTESER MÅSTE BORT. PostgREST läser `or=(...)` som en villkorslista
    // separerad med komma, så ett kundnamn som "Ekbergs Bygg, AB" delar uttrycket mitt itu och hela
    // frågan svarar 400 — vilket väljaren visar som "inga träffar" och orderlistan som ett fel. En
    // term som `x,status.eq.invoiced` hade dessutom smugit in en egen gren i filtret.
    const term = options.search.replace(/[,()]/g, ' ').trim();
    if (!term) return query;

    // ⚠️ `fortnox_order_number` är med sedan 2026-08-14. Den saknades, vilket betydde att numret
    // appen VISAR överallt (documentRef leder med Fortnox-numret) var det enda man inte kunde söka
    // på — man fick leta upp ordern på kundnamn för att hitta ett nummer man redan hade framför
    // sig.
    query = query.or(
      `order_number.ilike.%${term}%,fortnox_order_number.ilike.%${term}%,project_name.ilike.%${term}%,client_name.ilike.%${term}%,notes.ilike.%${term}%`,
    );
  }
  const statuses = options.filter ? BOARD_FILTER_STATUSES[options.filter] : null;
  if (statuses) query = query.in('status', statuses);
  if (options.status) query = query.eq('status', options.status);
  if (options.assignedToIn && options.assignedToIn.length > 0) query = query.in('assigned_to', options.assignedToIn);
  if (options.workOrderId) query = query.eq('id', options.workOrderId);
  if (options.customerId) query = query.eq('customer_id', options.customerId);
  return query;
}

// Sort orders, named after the leading key. The board is a work queue — earliest installation
// date first — but a "senaste ordrar" list needs the other end of the table, and the order MUST
// be chosen server-side: the page cap cuts the rows before the browser sees them, so sorting in
// the client only reorders whatever survived the cut. With the default sort a newly created
// order (installation date in the future) is the LAST row in the table, so once the company
// passes CRM_WORK_ORDERS_PAGE_SIZE orders a client-sorted "latest" list would quietly show the
// oldest jobs instead.
export type CrmWorkOrderSort = 'installation_asc' | 'created_desc';

export async function listCrmWorkOrdersWithFilters(
  supabase: SupabaseClient,
  options: WorkOrderListFilters & { limit?: number; offset?: number; sort?: CrmWorkOrderSort },
) {
  const limit = options.limit ?? CRM_WORK_ORDERS_PAGE_SIZE;
  const offset = options.offset ?? 0;
  const selected = supabase
    .from('crm_work_orders')
    .select(crmWorkOrderSelect, { count: 'exact' });
  const ordered = options.sort === 'created_desc'
    ? selected.order('created_at', { ascending: false })
    : selected
      .order('desired_installation_date', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: false });

  return applyWorkOrderListFilters(ordered.range(offset, offset + limit - 1), options);
}

// Per-filter counts for the board chips. One head-count query per filter (count-only, no rows
// transferred) so the chips stay accurate at any table size — same pattern as the customer
// stage counts. The assignee/search scope is applied so the counts match the visible list.
export async function getCrmWorkOrderFilterCounts(
  supabase: SupabaseClient,
  options: { search?: string; assignedToIn?: string[] },
): Promise<Record<CrmWorkOrderBoardFilter, number>> {
  const entries = await Promise.all(
    CRM_WORK_ORDER_BOARD_FILTERS.map(async (filter) => {
      const query = applyWorkOrderListFilters(
        supabase.from('crm_work_orders').select('id', { count: 'exact', head: true }),
        { search: options.search, filter, assignedToIn: options.assignedToIn },
      );
      // Throw rather than fall back to 0 — a failed count would render as a chip reading 0 next to
      // a list full of rows, with nothing saying the number is wrong. Same rule as the quote counts.
      const { count, error } = await query;
      if (error) throw new Error(`work_order_counts:${filter}: ${error.message}`);
      return [filter, count ?? 0] as const;
    }),
  );
  return Object.fromEntries(entries) as Record<CrmWorkOrderBoardFilter, number>;
}

// ── Snapshot-överlagringarna från ordervyn ───────────────────────────────────
//
// Tre olika personer/värden bor i samma jsonb-kolumn och redigeras i samma formulär:
//
//   • your_reference — kundens FORMELLA referens. Enda av de tre som når Fortnox
//     (YourReference) och som styr fakturan till rätt attestant hos kunden.
//   • contact        — kundkontakten: vem vi och installatörerna ringer.
//   • end_contact    — slutkunden på plats: en ANNAN person, utanför kundkortet.
//
// ⚠️ EN read-merge-write, inte tre. Kolumnen bär också personnummer, org.nr, adresser och
// reverse_vat — allt som INTE nämns här måste överleva — och en PATCH som bär flera av
// överlagringarna får inte låta den sista skriva bort de föregående.
//
// Ren funktion med flit: det här är den sortens sammanslagning där ett tyst fel (ett bortglömt
// fält, en överlagring som äter en annan) inte syns förrän någon läser fel telefonnummer på en
// arbetsplats. Routen resolvar auth och läser raden; regeln bor här och är testad.
export function mergeWorkOrderSnapshotOverrides(
  snapshot: Record<string, unknown> | null | undefined,
  overrides: {
    contact?: { contact_name?: string | null; email?: string | null; phone?: string | null };
    /** `undefined` = rör inte kolumnen. `null` = rensa den. */
    your_reference?: string | null;
    end_contact?: {
      end_contact_name?: string | null;
      end_contact_phone?: string | null;
      end_contact_email?: string | null;
    };
  },
): Record<string, unknown> {
  const current = (snapshot ?? {}) as Record<string, unknown>;
  const merged: Record<string, unknown> = { ...current };

  if (overrides.contact) {
    // Frys det gamla contact_name som Er referens på en order skapad INNAN de två blev skilda
    // fält. Utan det skulle en rättad kontaktperson på en sådan order fortfarande ändra vad
    // Fortnox-headern faller tillbaka på — precis den bugg uppdelningen finns för att ta bort.
    if (merged.your_reference == null) merged.your_reference = current.contact_name ?? null;
    merged.contact_name = overrides.contact.contact_name ?? null;
    merged.email = overrides.contact.email ?? null;
    merged.phone = overrides.contact.phone ?? null;
  }

  // Uttryckligen skickad (null inkluderat) → vinner över frysningen ovan.
  if (overrides.your_reference !== undefined) merged.your_reference = overrides.your_reference;

  // Alla tre nycklarna skrivs när objektet finns, null inkluderat: att skicka tomma fält är hur
  // krysset i ordervyn stängs av. Ett "skriv bara när det finns ett värde" hade gjort en slutkund
  // som lagts in fel omöjlig att rensa.
  if (overrides.end_contact) {
    merged.end_contact_name = overrides.end_contact.end_contact_name ?? null;
    merged.end_contact_phone = overrides.end_contact.end_contact_phone ?? null;
    merged.end_contact_email = overrides.end_contact.end_contact_email ?? null;
  }

  return merged;
}

export async function updateCrmWorkOrder(supabase: SupabaseClient, id: string, input: Partial<WorkOrderUpdateInput>) {
  return supabase.from('crm_work_orders').update(input).eq('id', id).select(crmWorkOrderSelect).single();
}

export async function getCrmWorkOrder(supabase: SupabaseClient, id: string) {
  return supabase.from('crm_work_orders').select(crmWorkOrderSelect).eq('id', id).single();
}

// Utblåsta säckar som rapporterats på jobbet, summerade över planeringens alla segment för ordern.
//
// Källan är ops_segment_reports — planeringens egen tabell, samma summering som tavlans kort visar
// mot det planerade antalet. Ingen ny datamodell alltså; arbetsordern läser det som redan finns.
//
// ⚠️ Returnerar `null` när ingen rapport finns, INTE 0. Skillnaden är hela poängen: noll
// rapporterade säckar är ett påstående om JOBBET ("inget material gick åt"), medan avsaknad av
// rapport är ett påstående om RAPPORTERINGEN. En nolla bredvid det beräknade talet hade lästs som
// det förra.
//
// Talet går genom supersede-regeln (lib/domains/planning/sackLedger.ts): finns en final —
// egenkontrollen — är den jobbets sanning, annars summan av delrapporterna. Aldrig bådadera.
//
// En rad som faktiskt rapporterar 0 ger 0 och inte null, vilket är rätt: någon har svarat.
//
// SELECT-policyn kräver planning.schedule.read (admin/sales/konsult har den). En roll utan den får
// inga rader och därmed null — också rätt svar: vi vet inte.
export async function getWorkOrderReportedSacks(
  supabase: SupabaseClient,
  workOrderId: string,
): Promise<number | null> {
  const map = await reportedSacksByWorkOrder(supabase, [workOrderId]);
  return map.get(workOrderId) ?? null;
}

// Offertens nummer, för arbetsorderns "Källa".
//
// Arbetsordern bär bara `quote_id`, och rutan visade ett uuid-fragment — som varken går att slå
// upp någonstans eller följer husets dokumentreferens. Med de här två fälten kan sidan rendera
// den med documentRef, alltså Fortnox-numret när det finns och vårt eget dessförinnan.
//
// Egen liten fråga i stället för en join i crmWorkOrderSelect: den selecten bär också listan, som
// hämtar hundra rader åt gången och inte har någon användning för offertens nummer.
export async function getWorkOrderSourceQuote(supabase: SupabaseClient, quoteId: string) {
  const { data } = await supabase
    .from('crm_quotes')
    .select('id, quote_number, fortnox_offer_number')
    .eq('id', quoteId)
    .maybeSingle();
  return (data ?? null) as { id: string; quote_number: string | null; fortnox_offer_number: string | null } | null;
}

// Look a work order up by the number written on the job, for the egenkontroll's order search.
//
// Accepts either reference: the Fortnox number once the order is synced (what the customer
// paperwork shows, so what gets written down) or the internal AO number before that. Fortnox first.
//
// The projection is FIXED and minimal — see the route for why this runs elevated. line_items are
// reduced to geometry: an egenkontroll needs area, thickness, density and what the row is called,
// never unit_price / discount_percent / labor_cost.
const WORK_ORDER_LOOKUP_SELECT =
  'id, order_number, fortnox_order_number, project_name, client_name, desired_installation_date, work_address, customer_snapshot, internal_handoff, line_items';

const LOOKUP_ADDRESS_KEYS = [
  'street_address', 'postal_code', 'city',
  'delivery_address', 'delivery_postal_code', 'delivery_city',
] as const;

const LOOKUP_LINE_ITEM_KEYS = [
  'construction', 'm2', 'thickness_mm', 'density', 'article_name', 'line_note', 'pricing_mode', 'quantity',
] as const;

function narrowLookupRow(row: Record<string, unknown>): Record<string, unknown> {
  const snapshot = (row.customer_snapshot ?? {}) as Record<string, unknown>;
  const items = Array.isArray(row.line_items) ? (row.line_items as Record<string, unknown>[]) : [];
  return {
    ...row,
    customer_snapshot: Object.fromEntries(LOOKUP_ADDRESS_KEYS.map((k) => [k, snapshot[k] ?? null])),
    line_items: items.map((item) => Object.fromEntries(LOOKUP_LINE_ITEM_KEYS.map((k) => [k, item[k] ?? null]))),
  };
}

export async function lookupCrmWorkOrderByNumber(supabase: SupabaseClient, orderNumber: string) {
  const byFortnox = await supabase
    .from('crm_work_orders')
    .select(WORK_ORDER_LOOKUP_SELECT)
    .eq('fortnox_order_number', orderNumber)
    .limit(1)
    .maybeSingle();
  if (byFortnox.error) return { data: null, error: byFortnox.error };

  let row = byFortnox.data as Record<string, unknown> | null;

  if (!row) {
    const byOrderNumber = await supabase
      .from('crm_work_orders')
      .select(WORK_ORDER_LOOKUP_SELECT)
      .eq('order_number', orderNumber)
      .limit(1)
      .maybeSingle();
    if (byOrderNumber.error) return { data: null, error: byOrderNumber.error };
    row = byOrderNumber.data as Record<string, unknown> | null;
  }

  if (!row) return { data: null, error: null };

  // The day the job is actually scheduled for — the egenkontroll dates itself from this rather
  // than from the order's desired date, which goes stale as soon as the planner moves the job.
  // Earliest segment that has not finished; falls back to the most recent one for past jobs.
  const { data: segment } = await supabase
    .from('ops_segments')
    .select('start_day')
    .eq('work_order_id', row.id as string)
    .order('start_day', { ascending: true })
    .limit(1)
    .maybeSingle();

  return {
    data: { ...narrowLookupRow(row), scheduled_day: (segment as { start_day?: string } | null)?.start_day ?? null },
    error: null,
  };
}

// Redact a work order down to what the field view needs.
//
// Since the crew RLS policy (20260810_crm_work_order_crew_access.sql) an installer can read their
// own work order — which is the point — but RLS is ROW level and cannot narrow columns, and
// crmWorkOrderSelect carries things a person on a roof has no business receiving. Two of them are
// personal data: customer_snapshot.personal_number and rot_details.personal_number (both written
// by quoteSerializers for ROT jobs). This is where the column-level line is drawn instead.
//
// KEPT: order refs, names, status, dates, work address, internal handoff, and line_items —
// article rows including prices, a deliberate decision (the field view's article tab shows them).
// DROPPED: personnummer, pricing_summary, amount — nothing in the field view renders them.
// rot_details is reduced to the three fields computePricing actually reads.
export function redactWorkOrderForField<T extends Record<string, unknown>>(row: T): T {
  const snapshot = (row.customer_snapshot ?? {}) as Record<string, unknown>;
  const rot = (row.rot_details ?? {}) as Record<string, unknown>;

  const {
    pricing_summary: _pricingSummary,
    amount: _amount,
    ...rest
  } = row as Record<string, unknown>;

  return {
    ...rest,
    // Contact details only — the field view reads phone/email/contact_name and nothing else.
    customer_snapshot: {
      contact_name: snapshot.contact_name ?? null,
      email: snapshot.email ?? null,
      phone: snapshot.phone ?? null,
    },
    // Enough for the ROT line in the article tab's totals; no personnummer, no property designation.
    rot_details: {
      enabled: rot.enabled ?? false,
      rot_percent: rot.rot_percent ?? null,
      max_deduction: rot.max_deduction ?? null,
    },
  } as unknown as T;
}

// Invoice rounds (delfakturering) for a work order, oldest round first. Each row records the
// Fortnox invoice number + the per-line quantities billed that round; the app owns this state
// because Fortnox can't report per-article invoiced quantity back. Returns [] when none.
export async function listWorkOrderInvoiceRounds(supabase: SupabaseClient, workOrderId: string) {
  return supabase
    .from('crm_work_order_invoices')
    .select('id, round_number, fortnox_invoice_number, fortnox_sync_status, amount, line_quantities, created_at')
    .eq('work_order_id', workOrderId)
    .order('round_number', { ascending: true });
}

// Resolve just the customer contact (name/phone/email) for a work order. Pass an ADMIN
// client: the field view (installers/member) needs to know who to call but has no CRM
// read access to the full customer record — this exposes only the three contact fields.
// Kontaktuppgifterna en arbetsorder ska VISAS med. Ordningen — slutkunden på plats, annars orderns
// egen kontakt, annars kundkortet — är densamma för fältvyn och CRM.
//
// ⚠️ `email` är kontaktpersonens EGNA adress och kan vara null medan kunden har en: regeln är att
// en namngiven person inte ärver någon annans adress (se contacts.ts). Ska något SKICKAS är det en
// annan fråga — då duger kundens egen adress, den tillskrivs ingen. Därför följer `customerEmail`
// med separat. Visa den aldrig som kontaktpersonens; prefilla ett mottagarfält med den.
//
// Returns { data: null } when there is nothing at all to show.
export async function getWorkOrderCustomerContact(supabase: SupabaseClient, workOrderId: string) {
  const { data: wo, error: woError } = await supabase
    .from('crm_work_orders').select('customer_id, customer_snapshot').eq('id', workOrderId).maybeSingle();
  if (woError) return { data: null, error: woError };

  const snap = (wo?.customer_snapshot ?? null) as {
    contact_name?: string | null;
    phone?: string | null;
    email?: string | null;
    end_contact_name?: string | null;
    end_contact_phone?: string | null;
    end_contact_email?: string | null;
  } | null;

  // ORDERNS EGEN KONTAKT (steg 2) går före kundkortet. Den redigeras i CRM-vyn ("Kundkontakt: vem
  // vi och installatörerna ringer") och skrivs till snapshoten — men den här funktionen läste
  // kundkortet direkt, så ett kontaktbyte gjort i CRM nådde aldrig dem det gjordes för.
  //
  // ⚠️ NAMNET avgör att ordern har en egen kontakt. En snapshot med bara ett telefonnummer är
  // ingen vald person — den hade annars trängt undan kortets primärkontakt och lämnat fältvyn med
  // ett naket nummer utan namn, sämre än före den här ändringen.
  const orderContactName = snap?.contact_name?.trim() || null;

  let card: CrmContactSource | null = null;
  // ⚠️ Felet sparas i stället för att returneras direkt. Slutkunden nedan besvaras utan kundkortet
  // och gjorde det förut utan att ens läsa det — en tillfälligt trasig kundläsning får inte ta med
  // sig den uppgift besättningen behöver mest när de står på plats.
  let cardError: { message: string } | null = null;
  if (wo?.customer_id) {
    const { data: c, error } = await supabase
      .from('crm_customers')
      // customer_type är inte kosmetik här: det avgör om kortets e-post får lånas ut åt
      // kontaktraden (`resolveCrmContact`). Utan fältet lånas den ut som förut, och fältvyn hade
      // visat bolagets adress under en anställds namn.
      .select('customer_type, phone, mobile, email, contacts:crm_customer_contacts(name, phone, email, is_primary)')
      .eq('id', wo.customer_id)
      .maybeSingle();
    if (error) cardError = error;
    else card = (c as CrmContactSource) ?? null;
  }

  // Orderns egna värden vinner, och luckorna fylls ur den kortrad NAMNET syftar på — samma
  // uppslagning som skrivvägen gör (`evaluateWorkOrderReadiness`). Utan den löstes en äldre order
  // vars snapshot bara bär ett namn mot kortets PRIMÄRA kontakt, och de två vägarna svarade olika
  // om samma order.
  const namedRow = card && orderContactName ? contactRowByName(card, orderContactName) : null;
  const orderContact: CrmContactRow | null = orderContactName
    ? {
        name: orderContactName,
        phone: snap?.phone?.trim() || namedRow?.phone || null,
        email: snap?.email?.trim() || namedRow?.email || null,
      }
    : null;

  // Steg 3: kundkortet fyller resten via den delade regeln. Är snapshoten namnlös (äldre order som
  // aldrig fångade någon kontakt) faller `resolveCrmContact` tillbaka på kortets primärkontakt av
  // sig själv. Regeln avgör också om kortets e-post får lånas ut: en namngiven kontakt på en
  // företagskund ärver inte bolagets adress, medan privatkundens namn-bara-rad gör det.
  const resolved = card
    ? resolveCrmContact(card, orderContact)
    : {
        name: orderContact?.name?.trim() || '',
        email: orderContact?.email?.trim() || '',
        phone: orderContact?.phone?.trim() || '',
      };
  // ⚠️ NUMRET på ordern gäller även när kontaktnamnet är tomt. Namnet avgör vem adressen tillhör,
  // men ett nummer tillskrivs ingen — och rensar någon bort namnet men behåller telefonen i CRM
  // skulle fältvyn annars kasta det enda numret ordern bär, medan CRM-kortet visade det.
  const base = { ...resolved, phone: snap?.phone?.trim() || resolved.phone };

  // Steg 1: en separat slutkund på plats (fångad utanför kundkortet) är den installatörerna ska
  // nå vid jobbet och vinner över kundens kontakt. Fungerar även för en fristående order utan
  // kundkoppling.
  //
  // ⚠️ ADRESSEN lånas inte hit: slutkunden är en ANNAN person, och kundens adress hade stått under
  // hens namn. NUMRET lånas, med flit — en besättning som står på plats måste kunna ringa NÅGON,
  // och slutkunden fångas ofta med bara namn. Samma skillnad som på kundkortet: ett nummer är en
  // väg fram, en adress läses som en identitet.
  const onSiteName = snap?.end_contact_name?.trim() || null;
  const onSitePhone = snap?.end_contact_phone?.trim() || null;
  const onSiteEmail = snap?.end_contact_email?.trim() || null;
  if (onSiteName || onSitePhone || onSiteEmail) {
    return {
      data: {
        contactName: onSiteName,
        phone: onSitePhone || base.phone || null,
        email: onSiteEmail,
        customerEmail: card?.email?.trim() || null,
        isOnSiteContact: true,
        // Numret ovan är LÅNAT av kunden — slutkunden har inget eget. Lånet är rätt (någon måste
        // gå att nå på plats), men vem numret TILLHÖR måste följa med: en vy som skriver
        // "Kontakt på plats · Ulla" över byggarens nummer får besättningen att ringa och fråga
        // efter Ulla hos fel person. Samma skillnad som adressen redan gör — ett nummer är en väg
        // fram, inte en identitet — men den skillnaden går bara att visa om den syns i svaret.
        phoneFromCustomer: !onSitePhone && Boolean(base.phone),
      },
      error: null,
    };
  }

  if (cardError) return { data: null, error: cardError };

  if (!base.name && !base.phone && !base.email && !card?.email?.trim()) return { data: null, error: null };

  return {
    data: {
      contactName: base.name || null,
      phone: base.phone || null,
      email: base.email || null,
      customerEmail: card?.email?.trim() || null,
      isOnSiteContact: false,
      // Kundens egen kontakt — numret är per definition redan kundens, så det finns inget lån att
      // upplysa om.
      phoneFromCustomer: false,
    },
    error: null,
  };
}

// Replace the work order's article rows + recomputed totals. Pricing is computed by the
// caller (shared computePricing) so DB, UI and the Fortnox order stay consistent.
export async function updateCrmWorkOrderLineItems(
  supabase: SupabaseClient,
  id: string,
  lineItems: Array<Record<string, any>>,
  pricing: { subtotal: number; vat: number; total: number },
) {
  return supabase
    .from('crm_work_orders')
    .update({
      line_items: lineItems,
      pricing_summary: { subtotal: pricing.subtotal, vat: pricing.vat, total: pricing.total },
      amount: pricing.total,
    })
    .eq('id', id)
    .select(crmWorkOrderSelect)
    .single();
}

// Spara arbetsorderns artikelrader — EN väg in, oavsett om det är en ändring, en ny artikel, en
// borttagen rad eller en avskrivning (`written_off`). Reglerna bor här i stället för i routen,
// eftersom de är affärsregler och eftersom de tidigare fanns i två kopior som kunde glida isär.
//
// Vad som skyddas när fakturor redan gått ut ligger i validateLineItemEdit: det som står på en
// utställd faktura måste finnas kvar, får inte krympa under det fakturerade, och får inte byta pris
// eller artikel. Allt annat är fritt — ett projekt ändras medan det pågår.
export async function saveWorkOrderLineItems(
  supabase: SupabaseClient,
  workOrderId: string,
  nextLineItems: Array<Record<string, any>>,
) {
  const { data, error } = await supabase
    .from('crm_work_orders')
    .select('id, status, vat_percent, quote_type, rot_details, line_items, partial_invoicing_started_at, fortnox_invoice_number')
    .eq('id', workOrderId)
    .maybeSingle();

  if (error) return { data: null, error, reason: 'fetch_failed' as const };
  if (!data) return { data: null, error: { message: 'Arbetsordern hittades inte' }, reason: 'not_found' as const };

  const wo = data as {
    status: string;
    vat_percent: number | null;
    quote_type: string | null;
    rot_details: Record<string, unknown> | null;
    line_items: Array<Record<string, any>> | null;
    partial_invoicing_started_at: string | null;
    fortnox_invoice_number: string | null;
  };

  // En färdigfakturerad order är avslutad. Att ändra summan efter sista fakturan skulle bara få CRM
  // och bokföringen att säga olika saker.
  if (wo.status === 'invoiced' || wo.fortnox_invoice_number) {
    return { data: null, error: { message: 'Arbetsordern är färdigfakturerad och kan inte ändras.' }, reason: 'order_closed' as const };
  }

  // Rundorna behövs både för redigeringsreglerna och för att avgöra om ordern stänger sig.
  const { data: roundsData, error: roundsError } = await listWorkOrderInvoiceRounds(supabase, workOrderId);
  // Fail closed: ett svalt läsfel hade sett ut som "inget är fakturerat" och släppt igenom en
  // radering av en rad som redan står på kundens faktura.
  if (roundsError) return { data: null, error: roundsError, reason: 'rounds_read_failed' as const };
  const rounds = (roundsData ?? []) as unknown as InvoiceRound[];

  if (wo.partial_invoicing_started_at) {
    const verdict = validateLineItemEdit(wo.line_items as any, nextLineItems as any, rounds);
    if (!verdict.ok) return { data: null, error: { message: verdict.message }, reason: 'line_invoiced' as const };
  }

  const pricing = computePricing(activeLineItems(nextLineItems) as PricingLineItem[], wo.vat_percent, {
    isPrivate: wo.quote_type === 'private',
    rot: (wo.rot_details ?? null) as any,
  });

  // Ordern stänger sig när inget återstår att fakturera och minst en runda gått ut — oavsett vilket
  // ARBETSläge den står i. Den är då fullt fakturerad, och det är ett faktum om faktureringen, inte
  // en åsikt om jobbet. Utan det här kunde en order som satts till Pågående aldrig nå ett avslut:
  // 'invoiced' går inte att välja för hand, och alla fakturavägar svarar "inget kvar att fakturera".
  const stateAfter = computeInvoiceState(nextLineItems as any, rounds);
  const closes = rounds.length > 0 && stateAfter.every((s) => s.remaining <= 0);

  const result = await supabase
    .from('crm_work_orders')
    .update({
      line_items: nextLineItems,
      pricing_summary: { subtotal: pricing.subtotal, vat: pricing.vat, total: pricing.total },
      amount: pricing.total,
      ...(closes ? { status: 'invoiced', fortnox_invoiced_at: new Date().toISOString() } : {}),
    })
    .eq('id', workOrderId)
    .select(crmWorkOrderSelect)
    .single();

  return { data: result.data, error: result.error, reason: result.error ? ('update_failed' as const) : null };
}

// Tabellen heter `crm_time_entries` sedan fas 4 (20260811_time_entries_reshape.sql). Namnbytet är
// inte kosmetiskt: raden bär numera även frånvaro och interntid, som per definition inte har någon
// arbetsorder, och den är löneunderlag. Funktionerna här är kontorets arbetsordervy — de filtrerar
// alltid på en order och rör aldrig de andra sorterna.
export async function listCrmWorkOrderTimeEntries(supabase: SupabaseClient, workOrderId: string) {
  return supabase
    .from('crm_time_entries')
    .select(crmWorkOrderTimeEntrySelect)
    .eq('work_order_id', workOrderId)
    .order('work_date', { ascending: false })
    .order('created_at', { ascending: false });
}

// Raden byggs av buildTimeEntryRow (lib/domains/time/entries.ts), inte här: den äger regeln att
// SERVERN räknar minuterna ur klockslagen, sätter `kind` och utelämnar `hours` så databastriggern
// får härleda den. Två vägar in i samma tabell får inte ha två uträkningar — kontorets timmar och
// löneunderlaget ÄR samma rad.
export async function createCrmWorkOrderTimeEntry(supabase: SupabaseClient, row: Record<string, unknown>) {
  return supabase
    .from('crm_time_entries')
    .insert(row)
    .select(crmWorkOrderTimeEntrySelect)
    .single();
}

export async function listCrmWorkOrderComments(supabase: SupabaseClient, workOrderId: string) {
  return supabase
    .from('crm_work_order_comments')
    .select(crmWorkOrderCommentSelect)
    .eq('work_order_id', workOrderId)
    .order('created_at', { ascending: false });
}

export async function createCrmWorkOrderComment(supabase: SupabaseClient, input: CreateWorkOrderCommentInput) {
  return supabase.from('crm_work_order_comments').insert(input).select(crmWorkOrderCommentSelect).single();
}

// Edit/delete are owner-scoped (user_id / created_by) so a person can only change their
// own time rows and comments. A non-owner's id simply matches no row.
export async function updateCrmWorkOrderTimeEntry(
  supabase: SupabaseClient,
  id: string,
  userId: string,
  row: Record<string, unknown>,
) {
  // Tre fält skalas bort ur den byggda raden.
  //
  // `user_id` — ägarbytet, självklart.
  //
  // `work_order_id` — raden byggs med ordern ur URL:en, så en PATCH mot fel orders adress hade
  // FLYTTAT tidraden dit. Fliken ändrar sin rads innehåll, aldrig vilket jobb den hör till.
  //
  // `time_code_id` — mindre uppenbart och därför farligare: buildTimeEntryRow sätter alltid fältet,
  // och kontorsfliken har ingen tidkodsväljare, så den skulle skicka null. En rad som skapats i
  // /tid MED en tidkod syns i den här fliken (listan filtrerar bara på ordern), och att rätta ett
  // stavfel i anteckningen hade då tyst raderat radens lönesort. Fältet lämnas orört i stället —
  // det som inte går att sätta här får inte heller gå att nollställa här.
  const { user_id: _ignoredUser, work_order_id: _ignoredOrder, time_code_id: _ignoredCode, ...patch } = row;
  return supabase
    .from('crm_time_entries')
    .update(patch)
    .eq('id', id)
    .eq('user_id', userId)
    .select(crmWorkOrderTimeEntrySelect)
    .maybeSingle();
}

export async function deleteCrmWorkOrderTimeEntry(supabase: SupabaseClient, id: string, userId: string) {
  return supabase
    .from('crm_time_entries')
    .delete()
    .eq('id', id)
    .eq('user_id', userId)
    .select('id')
    .maybeSingle();
}

export async function updateCrmWorkOrderComment(supabase: SupabaseClient, id: string, userId: string, body: string) {
  return supabase
    .from('crm_work_order_comments')
    .update({ body })
    .eq('id', id)
    .eq('created_by', userId)
    .select(crmWorkOrderCommentSelect)
    .maybeSingle();
}

// Profiles that can be @-mentioned in work order comments. Returns everyone with a
// name (installers included), not just CRM-assignable roles. Reads across all users,
// so it needs the admin client (session RLS limits profiles to the requester's own row).
export async function listMentionableProfiles(supabase: SupabaseClient) {
  return supabase
    .from('profiles')
    .select('id, full_name')
    .not('full_name', 'is', null)
    .order('full_name', { ascending: true });
}

export async function deleteCrmWorkOrderComment(supabase: SupabaseClient, id: string, userId: string) {
  return supabase
    .from('crm_work_order_comments')
    .delete()
    .eq('id', id)
    .eq('created_by', userId)
    .select('id')
    .maybeSingle();
}

// ── Filer på ordern (ritningar, förberedelser, foto före/efter) ──────────────
//
// INGEN profiles-join, till skillnad från crmWorkOrderCommentSelect ovan. `profiles` är
// self-read-only (profiles_select_self i auth_roles_setup.sql:71 är enda SELECT-policyn), så
// `uploader:profiles(full_name)` hade gett null för alla utom en själv — det är samma skäl som
// gör att listMentionableProfiles går via admin-klienten. Uppladdarens namn snapshottas därför i
// created_by_name när raden skapas.
export const crmWorkOrderFileSelect = `
  id,
  work_order_id,
  category,
  is_internal,
  file_name,
  storage_bucket,
  storage_path,
  content_type,
  size_bytes,
  created_by,
  created_by_name,
  created_at
`;

export async function listCrmWorkOrderFiles(supabase: SupabaseClient, workOrderId: string) {
  return supabase
    .from('crm_work_order_files')
    .select(crmWorkOrderFileSelect)
    .eq('work_order_id', workOrderId)
    .order('created_at', { ascending: false });
}

export async function createCrmWorkOrderFile(supabase: SupabaseClient, input: CreateWorkOrderFileInput) {
  return supabase.from('crm_work_order_files').insert(input).select(crmWorkOrderFileSelect).single();
}

// Finns redan en rad som pekar på det här objektet?
//
// Bekräftelsesteget städar bort objektet när raden inte kan skrivas, och den städningen får ALDRIG
// träffa en fil som redan tillhör någon. Sökvägen till en bild går att läsa ut ur den signerade
// URL:en i listan, så en klient kan spela tillbaka en sökväg som redan är registrerad — och utan
// den här kontrollen hade ett nekat insert då raderat den befintliga filens byte.
// Ett unikt index på storage_path är backstoppen; det här är det begripliga svaret (409).
export async function findCrmWorkOrderFileByPath(supabase: SupabaseClient, storagePath: string) {
  return supabase
    .from('crm_work_order_files')
    .select('id')
    .eq('storage_path', storagePath)
    .maybeSingle();
}

export async function getCrmWorkOrderFile(supabase: SupabaseClient, fileId: string, workOrderId: string) {
  return supabase
    .from('crm_work_order_files')
    .select(crmWorkOrderFileSelect)
    .eq('id', fileId)
    .eq('work_order_id', workOrderId)
    .maybeSingle();
}

// `ownerId = null` betyder kontoret (crm.workorder.write) — ingen ägarfiltrering. Annars filtreras
// raden på uppladdaren, så en installatör bara kan ta bort sitt eget.
//
// Ägarskapet uttrycks som predikat i queryn och inte som en assert, precis som
// deleteCrmWorkOrderComment: en främmande rad matchar helt enkelt ingenting och routen svarar 404.
// `.eq('work_order_id', ...)` är inte överflödigt trots att id:t är unikt — utan den kan ett
// fil-id från en ANNAN order raderas genom den här orderns adress.
//
// Raden raderas FÖRE objektet och returnerar sin adress i samma vända, till skillnad från
// dokumentbiblioteket som läser först och raderar sen. En rundtur i stället för två, och
// radraderingen blir atomär. Misslyckas storage-städningen efteråt ligger byte kvar utan rad —
// osynligt skräp, vilket är den bättre av de två felmoderna (en rad som pekar på ingenting ger
// ett trasigt kort i listan).
export async function deleteCrmWorkOrderFile(
  supabase: SupabaseClient,
  fileId: string,
  workOrderId: string,
  ownerId: string | null,
) {
  const query = supabase
    .from('crm_work_order_files')
    .delete()
    .eq('id', fileId)
    .eq('work_order_id', workOrderId);

  if (ownerId) query.eq('created_by', ownerId);

  return query.select('id, storage_bucket, storage_path').maybeSingle();
}

// Besättningsfrågan, ställd till samma SECURITY DEFINER-funktion som RLS-policyerna kallar
// (20260810_crm_work_order_crew_access.sql). Routen som gatar en skrivning måste ge SAMMA svar som
// policyn — härleder den i stället svaret ur rollen glider de två isär, och användaren får ett
// 200 på något databasen sedan tyst nekar.
export async function isUserOnWorkOrder(supabase: SupabaseClient, userId: string, workOrderId: string) {
  return supabase.rpc('is_user_on_work_order', { p_uid: userId, p_wo: workOrderId });
}