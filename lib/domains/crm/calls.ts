import type { SupabaseClient } from '@supabase/supabase-js';

export const crmCallSelect = `
  id,
  prospect_id,
  customer_id,
  company_name,
  organization_number,
  contact_name,
  phone,
  email,
  city,
  source,
  user_id,
  outcome,
  summary,
  next_step,
  call_at,
  quote_id,
  created_at,
  prospect:crm_customers!prospect_id(
    id,
    company_name,
    customer_stage,
    source
  ),
  customer:crm_customers!customer_id(
    id,
    customer_stage,
    customer_type,
    company_name,
    first_name,
    last_name,
    organization_number,
    email,
    phone,
    mobile,
    contacts:crm_customer_contacts(name, phone, email, is_primary)
  )
`;

type CreateCrmCallInput = {
  prospect_id?: string | null;
  customer_id?: string | null;
  /** Offerten samtalet loggades från. Null för samtal loggade utanför en offert. */
  quote_id?: string | null;
  company_name: string | null;
  organization_number: string | null;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  source: string | null;
  user_id: string;
  outcome: 'no_answer' | 'follow_up' | 'positive' | 'negative';
  summary: string;
  next_step: string | null;
  call_at?: string;
};

type UpdateCrmCallInput = {
  prospect_id?: string | null;
  customer_id?: string | null;
  company_name: string | null;
  organization_number: string | null;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  source: string | null;
  outcome: 'no_answer' | 'follow_up' | 'positive' | 'negative';
  summary: string;
  next_step: string | null;
  call_at?: string;
};

type ListCrmCallsOptions = {
  search?: string;
  prospectId?: string;
  customerId?: string;
  limit?: number;
};

// Taket när anroparen inte ber om något. Har alltid funnits här, men var hårdkodat: CRM-översikten
// hämtade alla 50 för att rendera fem rader.
const CRM_CALLS_DEFAULT_LIMIT = 50;

/**
 * Identitetsfälten på ett samtal som loggas från en offert, härledda ur offertens egen rad.
 *
 * 🧨 prospect_id sätts MED FLIT INTE. crm_calls_insert_visible kräver att en satt prospect_id pekar
 * på en kund som är tilldelad den som skriver — en säljare som loggar ett samtal på en KOLLEGAS
 * offert hade alltså blivit nekad av RLS, mitt i det som ska vara en snabb anteckning. customer_id
 * har inget sådant villkor, och det är ändå den kopplingen kundkortets samtalshistorik läser.
 * Följden att leva med: samtalet syns inte i prospekt-filtrerade vyer i /crm/samtal.
 *
 * Kontaktfälten är visningsdata på raden (samtalslistan visar företag och kontakt). De kommer ur
 * offertens snapshot, inte från webbläsaren, så de alltid beskriver vem offerten faktiskt gäller.
 */
export function quoteCallIdentity(quote: {
  customer_id?: string | null;
  /** Finns i typen för att visa att den LÄSES OCH IGNORERAS med flit — se ovan. */
  prospect_id?: string | null;
  customer_name?: string | null;
  customer_snapshot?: Record<string, unknown> | null;
}) {
  const snapshot = (quote.customer_snapshot ?? {}) as Record<string, unknown>;
  const text = (value: unknown): string | null => {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    return trimmed === '' ? null : trimmed;
  };

  return {
    prospect_id: null,
    customer_id: quote.customer_id ?? null,
    company_name: text(snapshot.company_name) ?? text(snapshot.customer_name) ?? text(quote.customer_name),
    organization_number: text(snapshot.organization_number),
    contact_name: text(snapshot.contact_name),
    phone: text(snapshot.phone),
    email: text(snapshot.email),
    city: text(snapshot.city),
    source: null,
  };
}

/**
 * Namnet på den som loggade samtalet.
 *
 * Kräver eleverad klient: profiles-RLS är self-only, så varken klienten eller en sessionsrutt kan
 * slå upp en kollegas namn. Samma skäl som uppgiftsflödets attachCrmTaskParticipantNames.
 * Ett misslyckat uppslag är inte fatalt — raden kommer tillbaka med null och UI:t visar en reserv.
 */
export async function attachCrmCallUserNames<T extends { user_id: string }>(
  admin: SupabaseClient,
  calls: T[],
): Promise<Array<T & { user_name: string | null }>> {
  const ids = Array.from(new Set(calls.map((call) => call.user_id).filter(Boolean)));

  const names = new Map<string, string>();
  if (ids.length > 0) {
    const { data } = await admin.from('profiles').select('id, full_name').in('id', ids);
    for (const row of (data || []) as Array<{ id: string; full_name: string | null }>) {
      if (row.full_name) names.set(row.id, row.full_name);
    }
  }

  return calls.map((call) => ({ ...call, user_name: names.get(call.user_id) ?? null }));
}

export async function listCrmCalls(supabase: SupabaseClient, search?: string) {
  let query = supabase.from('crm_calls').select(crmCallSelect).order('call_at', { ascending: false }).limit(50);

  if (search) {
    query = query.or(
      `summary.ilike.%${search}%,next_step.ilike.%${search}%,company_name.ilike.%${search}%,contact_name.ilike.%${search}%,phone.ilike.%${search}%,email.ilike.%${search}%,city.ilike.%${search}%`
    );
  }

  return query;
}

export async function createCrmCall(supabase: SupabaseClient, input: CreateCrmCallInput) {
  return supabase.from('crm_calls').insert(input).select(crmCallSelect).single();
}

export async function listCrmCallsWithFilters(supabase: SupabaseClient, options: ListCrmCallsOptions) {
  let query = supabase.from('crm_calls').select(crmCallSelect).order('call_at', { ascending: false }).limit(options.limit ?? CRM_CALLS_DEFAULT_LIMIT);

  if (options.search) {
    query = query.or(
      `summary.ilike.%${options.search}%,next_step.ilike.%${options.search}%,company_name.ilike.%${options.search}%,contact_name.ilike.%${options.search}%,phone.ilike.%${options.search}%,email.ilike.%${options.search}%,city.ilike.%${options.search}%`
    );
  }

  if (options.prospectId) {
    query = query.eq('prospect_id', options.prospectId);
  }

  if (options.customerId) {
    query = query.eq('customer_id', options.customerId);
  }

  return query;
}

/**
 * Alla samtal som loggats på offerten — även kollegornas.
 *
 * ⚠️ KRÄVER ELEVERAD KLIENT, och det är inte en genväg: crm_calls_select_visible är "eget samtal,
 * egen tilldelad kund, eller admin", så en säljare som öppnar en kollegas offert hade fått ett tomt
 * kort trots att offerten är hens att se. Policyn lämnas medvetet orörd — att vidga den hade gett
 * kollegors samtal i VARJE vy, inte bara i offertkortet.
 *
 * Grinden ligger därför i routen och gäller OFFERTEN: syns den inte för sessionen svarar den 404
 * och den här frågan körs aldrig. Samma konstruktion som listCrmQuoteTasks — läs
 * app/api/crm/quotes/[id]/calls/route.ts innan ordningen ändras.
 */
export async function listCrmQuoteCalls(admin: SupabaseClient, quoteId: string) {
  return admin
    .from('crm_calls')
    .select(crmCallSelect)
    .eq('quote_id', quoteId)
    .order('call_at', { ascending: false })
    .limit(CRM_CALLS_DEFAULT_LIMIT);
}

export async function updateCrmCall(supabase: SupabaseClient, id: string, input: UpdateCrmCallInput) {
  return supabase.from('crm_calls').update(input).eq('id', id).select(crmCallSelect).single();
}
