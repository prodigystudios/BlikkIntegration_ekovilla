import type { SupabaseClient } from '@supabase/supabase-js';
import { mapTicketRow } from './mappers';
import { ticketSelect } from './queries';
import type { CreateTicketInput, UpdateTicketInput } from './schemas';
import type { AppTicketRow, AppTicketView } from './types';

type MutationResult = { data: AppTicketView | null; error: { message: string; code?: string } | null };

// Skapar ärendet som den inloggade användaren (sessionsklient — RLS kräver reporter_id = auth.uid()).
// Skärmbilden är redan uppladdad när vi kommer hit; bucket/path följer med som en färdig referens.
export async function createTicket(
  supabase: SupabaseClient,
  input: CreateTicketInput & {
    reporter_id: string;
    reporter_name: string;
    screenshot_bucket?: string | null;
    screenshot_path?: string | null;
  },
): Promise<MutationResult> {
  const result = await supabase
    .from('app_tickets')
    .insert({
      reporter_id: input.reporter_id,
      reporter_name: input.reporter_name,
      kind: input.kind,
      area: input.area,
      title: input.title,
      description: input.description,
      page_path: input.page_path,
      screenshot_bucket: input.screenshot_bucket ?? null,
      screenshot_path: input.screenshot_path ?? null,
    })
    .select(ticketSelect)
    .single();

  return { data: result.data ? mapTicketRow(result.data as AppTicketRow) : null, error: result.error };
}

// Bygger den faktiska kolumnuppdateringen ur admins indata. Ren funktion (inget I/O) så reglerna
// nedan är enhetstestade i stället för att bara existera i en route.
//
// `sentKeys` är nycklarna klienten faktiskt skickade. Zod fyller i defaults för utelämnade fält, och
// att skriva dem hade nollat kolumner ingen rört — samma fälla som pickProvidedFields löser på
// CRM-sidan (se app/api/crm/_shared.ts).
export function buildTicketUpdatePatch(
  input: UpdateTicketInput,
  sentKeys: string[],
  actor: { id: string; name: string },
  now: string,
): Record<string, unknown> {
  const patch: Record<string, unknown> = { updated_at: now };
  const sent = new Set(sentKeys);

  if (sent.has('status') && input.status) {
    patch.status = input.status;
    // Vem som senast tog i ärendet, och när. Stämplas vid varje statusändring — inte bara den
    // första — så "handled_at" svarar på "när rörde vi det här sist", vilket är frågan man
    // faktiskt ställer om en backlog. Namnet lagras som kopia eftersom `profiles` är
    // self-read-only och alltså inte går att läsa upp i efterhand.
    patch.handled_by = actor.id;
    patch.handled_by_name = actor.name;
    patch.handled_at = now;
  }

  if (sent.has('resolution')) patch.resolution = input.resolution ?? null;
  if (sent.has('changelog_note')) patch.changelog_note = input.changelog_note ?? null;

  if (sent.has('publish_to_changelog')) {
    patch.changelog_published_at = input.publish_to_changelog ? now : null;
  }

  return patch;
}

// Avgör om patchen får publicera i changeloggen. Två villkor, båda för att skydda läsaren av
// changeloggen: ärendet måste vara KLART (en publik rad om något ofixat är ett löfte, inte en
// changelog), och det måste finnas en text att visa (annars blir raden tom).
//
// Tar emot både patchen och nuläget, eftersom admin kan publicera i samma sparning som hen sätter
// status till 'done' och skriver texten — då finns inget av det i DB ännu.
export function checkChangelogPublishable(args: {
  patch: Record<string, unknown>;
  current: { status: string; changelog_note: string | null };
}): string | null {
  const { patch, current } = args;
  if (patch.changelog_published_at == null) return null; // publiceras inte i den här sparningen

  const resultingStatus = (patch.status as string | undefined) ?? current.status;
  if (resultingStatus !== 'done') {
    return 'Bara ett klarmarkerat ärende kan publiceras i changeloggen.';
  }

  const resultingNote =
    'changelog_note' in patch ? (patch.changelog_note as string | null) : current.changelog_note;
  if (!resultingNote) {
    return 'Skriv en changelog-text innan du publicerar ärendet.';
  }

  return null;
}

// Admin-uppdatering. RLS (app_tickets_update) släpper bara igenom admin; för alla andra matchar
// UPDATE:n noll rader och `data` blir null — routen svarar 404/403 deliberat i stället för 500.
export async function updateTicket(
  supabase: SupabaseClient,
  id: string,
  patch: Record<string, unknown>,
): Promise<MutationResult> {
  const result = await supabase.from('app_tickets').update(patch).eq('id', id).select(ticketSelect).maybeSingle();

  return { data: result.data ? mapTicketRow(result.data as AppTicketRow) : null, error: result.error };
}

// Raderar ärendet (admin, RLS app_tickets_delete). Returnerar den RÅA raden — inte vyn — eftersom
// anroparen behöver bucket och path för att städa bort skärmbilden ur storage. Utan `.select()` vet
// vi inte vilken fil som just blev föräldralös. Noll rader tillbaka = RLS nekade, eller raden fanns
// inte.
export async function deleteTicket(
  supabase: SupabaseClient,
  id: string,
): Promise<{ data: AppTicketRow | null; error: { message: string; code?: string } | null }> {
  const result = await supabase.from('app_tickets').delete().eq('id', id).select(ticketSelect).maybeSingle();

  return { data: (result.data as AppTicketRow | null) ?? null, error: result.error };
}
