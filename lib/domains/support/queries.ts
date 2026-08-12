import type { SupabaseClient } from '@supabase/supabase-js';
import { CLOSED_TICKET_STATUSES, TICKET_STATUSES, type TicketKind, type TicketStatus } from './types';
import type { ListTicketsQuery } from './schemas';

// EN sammanhållen literal, inte ihopslagna delsträngar: supabase-js typar svaret utifrån
// select-strängens LITERALTYP, och `'a' + 'b'` degraderar den till `string` — då blir `data` en
// union med GenericStringError och varje mappning kräver en dubbelcast.
export const ticketSelect =
  'id, reporter_id, reporter_name, kind, area, title, description, page_path, status, resolution, screenshot_bucket, screenshot_path, changelog_note, changelog_published_at, handled_by, handled_by_name, handled_at, created_at, updated_at';

// Öppna statusar uttryckt som en positiv lista. Att i stället negera de stängda (`not.in`) hade
// gett samma svar men kräver PostgREST-citering i strängform — en positiv `.in()` går inte att
// stava fel, och listan härleds ur samma källa så en ny status inte kan glömmas bort här.
const OPEN_TICKET_STATUSES: TicketStatus[] = TICKET_STATUSES.filter((s) => !CLOSED_TICKET_STATUSES.includes(s));

type TicketFilters = Pick<ListTicketsQuery, 'status' | 'kind' | 'state'>;

// Gemensam filtrering för båda scoparna, så "mina" och backloggen aldrig tolkar samma
// frågeparametrar olika.
function applyFilters<T extends { eq: any; in: any }>(query: T, filters: TicketFilters): T {
  let q: any = query;
  // En explicit status vinner över state — den är mer specifik, och att lägga båda hade kunnat ge
  // en tom lista utan att användaren förstår varför (t.ex. state=open + status=done).
  if (filters.status) {
    q = q.eq('status', filters.status);
  } else if (filters.state === 'open') {
    q = q.in('status', OPEN_TICKET_STATUSES);
  } else if (filters.state === 'closed') {
    q = q.in('status', CLOSED_TICKET_STATUSES as TicketStatus[]);
  }
  if (filters.kind) q = q.eq('kind', filters.kind as TicketKind);
  return q as T;
}

// Rapportörens egna ärenden. En användares egna ärenden är få — inget behov av paginering.
export async function listMyTickets(supabase: SupabaseClient, reporterId: string, filters: TicketFilters) {
  const query = supabase
    .from('app_tickets')
    .select(ticketSelect)
    .eq('reporter_id', reporterId)
    .order('created_at', { ascending: false })
    .limit(100);

  return applyFilters(query as any, filters);
}

// Backloggen (admin). Taket ligger under PostgREST:s radgräns; växer den förbi 500 öppna ärenden
// är det ett annat problem än paginering.
export async function listAllTickets(supabase: SupabaseClient, filters: TicketFilters) {
  const query = supabase
    .from('app_tickets')
    .select(ticketSelect)
    .order('created_at', { ascending: false })
    .limit(500);

  return applyFilters(query as any, filters);
}

// RLS avgör synligheten: rapportören ser sin egen rad, admin ser alla. maybeSingle → null när
// raden inte finns ELLER är osynlig, så routen kan svara 404 i stället för att läcka ett 500.
export async function getTicket(supabase: SupabaseClient, id: string) {
  return supabase.from('app_tickets').select(ticketSelect).eq('id', id).maybeSingle();
}
