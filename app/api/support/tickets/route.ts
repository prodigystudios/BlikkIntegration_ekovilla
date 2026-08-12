import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { getCurrentUser } from '@/lib/auth/route';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { ok, routeError, validationError } from '@/lib/api/responses';
import { createTicketSchema, listTicketsQuerySchema, validateScreenshot } from '@/lib/domains/support/schemas';
import { createTicket } from '@/lib/domains/support/mutations';
import { listAllTickets, listMyTickets } from '@/lib/domains/support/queries';
import { mapTicketRows } from '@/lib/domains/support/mappers';
import { removeScreenshot, uploadScreenshot } from '@/lib/domains/support/storage';
import { excludeReporter, listTicketNotifyRecipients } from '@/lib/domains/support/recipients';
import type { AppTicketRow, AppTicketView } from '@/lib/domains/support/types';
import { buildAppTicketCreatedNotification } from '@/lib/domains/notifications/payload';
import { expandNotificationToRecipients } from '@/lib/domains/notifications/mutations';
import { deliverNotifications } from '@/lib/domains/notifications/delivery';

// nodejs: skärmbilden läses som Buffer och laddas upp med service-role-nyckeln.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) return routeError(401, 'unauthorized', 'Unauthorized');

    const url = new URL(req.url);
    const parsed = listTicketsQuerySchema.safeParse({
      scope: url.searchParams.get('scope') ?? undefined,
      status: url.searchParams.get('status') ?? undefined,
      kind: url.searchParams.get('kind') ?? undefined,
      state: url.searchParams.get('state') ?? undefined,
    });
    if (!parsed.success) return validationError(parsed.error);

    const { scope, ...filters } = parsed.data;
    const supabase = createRouteHandlerClient({ cookies });

    // Backloggen är adminytan. Grinden sitter både här och i RLS (app_tickets_select) — routen
    // svarar 403 med ett begripligt fel i stället för att låta RLS returnera en tom lista, vilket
    // hade sett ut som "inga ärenden" i stället för "du får inte se det här".
    if (scope === 'all') {
      if (currentUser.role !== 'admin') return routeError(403, 'forbidden', 'Forbidden');
      const { data, error } = await listAllTickets(supabase, filters);
      if (error) return routeError(500, 'app_tickets_list_failed', error.message);
      return ok({ items: mapTicketRows(data as AppTicketRow[] | null) });
    }

    const { data, error } = await listMyTickets(supabase, currentUser.id, filters);
    if (error) return routeError(500, 'app_tickets_list_failed', error.message);
    return ok({ items: mapTicketRows(data as AppTicketRow[] | null) });
  } catch (e: any) {
    return routeError(500, 'app_tickets_unexpected', e?.message || 'Failed to list tickets');
  }
}

type ParsedTicketBody = {
  fields: Record<string, unknown>;
  screenshot: { name: string; type: string; size: number; bytes: Buffer } | null;
};

// Klienten skickar multipart när en skärmbild följer med. JSON accepteras också, så routen går att
// anropa utan filhantering (och så ett felaktigt content-type ger ett tydligt fel i stället för ett
// kryptiskt formData()-undantag).
async function parseTicketBody(req: Request): Promise<ParsedTicketBody | null> {
  const contentType = (req.headers.get('content-type') || '').toLowerCase();

  if (contentType.includes('application/json')) {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') return null;
    return { fields: body as Record<string, unknown>, screenshot: null };
  }

  const form = await req.formData().catch(() => null);
  if (!form) return null;

  const fields: Record<string, unknown> = {
    kind: form.get('kind'),
    area: form.get('area'),
    title: String(form.get('title') ?? ''),
    description: String(form.get('description') ?? ''),
    page_path: form.get('page_path'),
  };

  const candidate = form.get('screenshot');
  // Duck-typing i stället för `instanceof File`: File finns i Node 20+ men en tom filinput skickar
  // en sträng, och den ska behandlas som "ingen bild" — inte som ett fel.
  const isFile = !!candidate && typeof candidate === 'object' && typeof (candidate as any).arrayBuffer === 'function';
  if (!isFile) return { fields, screenshot: null };

  const file = candidate as unknown as { name: string; type: string; size: number; arrayBuffer: () => Promise<ArrayBuffer> };
  return {
    fields,
    screenshot: {
      name: file.name || 'skarmbild',
      type: file.type || '',
      size: file.size,
      bytes: Buffer.from(await file.arrayBuffer()),
    },
  };
}

export async function POST(req: Request) {
  // Deklarerad utanför try:n så catch-grenen kan städa bort en redan uppladdad skärmbild. Kastar
  // insert:en (i stället för att returnera ett fel) hade bilden annars blivit kvarglömt skräp i
  // bucketen, utan någon rad som pekar på den.
  let uploaded: { bucket: string; path: string } | null = null;

  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) return routeError(401, 'unauthorized', 'Unauthorized');

    const body = await parseTicketBody(req);
    if (!body) return routeError(400, 'invalid_body', 'Kunde inte läsa formuläret.');

    const parsed = createTicketSchema.safeParse(body.fields);
    if (!parsed.success) return validationError(parsed.error);

    // Bilden valideras FÖRE uppladdningen: en för stor eller fel filtyp ska aldrig hinna kosta en
    // storage-runda.
    if (body.screenshot) {
      const screenshotError = validateScreenshot(body.screenshot);
      if (screenshotError) return routeError(400, 'invalid_screenshot', screenshotError);
    }

    // Uppladdning före insert, så ett ärende aldrig kan skapas med en trasig bildreferens. Blir
    // insert:en fel städas objektet bort nedan.
    if (body.screenshot) {
      const admin = getSupabaseAdmin();
      const result = await uploadScreenshot(admin, body.screenshot);
      if (result.error) return routeError(500, 'screenshot_upload_failed', 'Kunde inte ladda upp skärmbilden.');
      uploaded = { bucket: result.bucket, path: result.path };
    }

    const supabase = createRouteHandlerClient({ cookies });
    const { data, error } = await createTicket(supabase, {
      ...parsed.data,
      reporter_id: currentUser.id,
      reporter_name: currentUser.name || 'Okänd användare',
      screenshot_bucket: uploaded?.bucket ?? null,
      screenshot_path: uploaded?.path ?? null,
    });

    if (error || !data) {
      if (uploaded) await removeScreenshot(getSupabaseAdmin(), uploaded.bucket, uploaded.path);
      return routeError(500, 'app_ticket_create_failed', error?.message || 'Kunde inte spara ärendet.');
    }

    // Best-effort: en notisfel får aldrig fälla en inlämning användaren just gjort.
    await notifyNewTicket(data).catch((e) => console.error('[support] notis-fan-out misslyckades', e));

    return ok({ item: data }, 201);
  } catch (e: any) {
    if (uploaded) await removeScreenshot(getSupabaseAdmin(), uploaded.bucket, uploaded.path);
    return routeError(500, 'app_tickets_unexpected', e?.message || 'Failed to create ticket');
  }
}

async function notifyNewTicket(ticket: AppTicketView) {
  const admin = getSupabaseAdmin();
  const recipientIds = excludeReporter(await listTicketNotifyRecipients(admin), ticket.reporter_id);
  if (recipientIds.length === 0) return;

  const content = buildAppTicketCreatedNotification({
    ticketId: ticket.id,
    kindLabel: ticket.kind_label,
    areaLabel: ticket.area_label,
    title: ticket.title,
    reporterName: ticket.reporter_name,
  });

  // deliverNotifications skriver klockraden OCH skickar push — pushen kommer gratis för varje
  // notistyp som går genom den.
  await deliverNotifications(admin, expandNotificationToRecipients(content, recipientIds));
}
