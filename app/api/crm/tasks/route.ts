import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { attachCrmTaskContacts, createCrmTask, listCrmTasks, listCrmTasksDelegatedBy, mapCrmTaskRows } from '@/lib/domains/crm/tasks';
import { buildCrmTaskAssignedNotification } from '@/lib/domains/notifications/payload';
import { expandNotificationToRecipients } from '@/lib/domains/notifications/mutations';
import { deliverNotifications } from '@/lib/domains/notifications/delivery';
import {
  authorizeTaskOwner,
  createCrmTaskSchema,
  listCrmTasksQuerySchema,
  ok,
  requireCrmUser,
  requireCrmWriter,
  routeError,
  validationError,
} from './_lib';

export async function GET(req: Request) {
  try {
    const crmUser = await requireCrmUser();
    if (crmUser.response || !crmUser.currentUser) return crmUser.response;

    const url = new URL(req.url);
    const parsedQuery = listCrmTasksQuerySchema.safeParse({
      q: url.searchParams.get('q') || undefined,
      status: url.searchParams.get('status') || undefined,
      prospect_id: url.searchParams.get('prospect_id') || undefined,
      customer_id: url.searchParams.get('customer_id') || undefined,
      scope: url.searchParams.get('scope') || undefined,
      limit: url.searchParams.get('limit') || undefined,
    });

    if (!parsedQuery.success) return validationError(parsedQuery.error);

    const supabase = createRouteHandlerClient({ cookies });

    // Uppgifter man delegerat tillhör mottagaren och ligger utanför den egna RLS-vyn. Skaparen
    // kommer alltid från sessionen, aldrig från frågesträngen — filtret är slutet om anroparen.
    if (parsedQuery.data.scope === 'delegated') {
      const { data, error } = await listCrmTasksDelegatedBy(getSupabaseAdmin(), crmUser.currentUser.id, {
        search: parsedQuery.data.q,
      });
      if (error) return routeError(500, 'crm_tasks_delegated_failed', error.message);
      // ⚠️ Kontakterna slås upp med SESSIONSKLIENTEN även här, inte med den elevated klienten som
      // hämtade raderna. Elevationen ovan är motiverad av att uppgifterna tillhör mottagaren; den
      // säger ingenting om vilka KUNDER anroparen får läsa. Ser hen inte offerten blir kontakten
      // null, precis som avsett.
      return ok({ items: await attachCrmTaskContacts(supabase, mapCrmTaskRows(data as any[] | null | undefined)) });
    }

    const query = await listCrmTasks(supabase, {
      search: parsedQuery.data.q,
      status: parsedQuery.data.status,
      prospectId: parsedQuery.data.prospect_id,
      customerId: parsedQuery.data.customer_id,
      limit: parsedQuery.data.limit,
    });
    const { data, error } = await query;

    if (error) {
      return routeError(500, 'crm_tasks_list_failed', error.message);
    }

    return ok({ items: await attachCrmTaskContacts(supabase, mapCrmTaskRows(data as any[] | null | undefined)) });
  } catch (e: any) {
    return routeError(500, 'crm_tasks_unexpected', e?.message || 'Failed to list tasks');
  }
}

/**
 * Notis till den som fått en uppgift på sig.
 *
 * Avsändarens namn slås upp med elevated klient — profiles-RLS är self-only, så en säljare kan
 * inte läsa chefens namn med sin egen session. Utan namnet vore notisen "du har fått en uppgift"
 * utan avsändare, vilket är hälften av det man behöver veta.
 *
 * deliverNotifications skriver klockraden OCH skickar push till mottagarens opt-in-enheter.
 */
async function notifyTaskAssignee(input: {
  taskId: string;
  title: string;
  dueDate: string | null;
  assigneeId: string;
  assignerId: string;
}) {
  const admin = getSupabaseAdmin();
  const { data: assigner } = await admin
    .from('profiles')
    .select('full_name')
    .eq('id', input.assignerId)
    .maybeSingle();

  const content = buildCrmTaskAssignedNotification({
    taskId: input.taskId,
    title: input.title,
    assignerName: assigner?.full_name || 'En kollega',
    dueDate: input.dueDate,
  });

  await deliverNotifications(admin, expandNotificationToRecipients(content, [input.assigneeId]));
}

export async function POST(req: Request) {
  try {
    const crmUser = await requireCrmWriter();
    if (crmUser.response || !crmUser.currentUser) return crmUser.response;

    const parsedBody = createCrmTaskSchema.safeParse(await req.json().catch(() => null));
    if (!parsedBody.success) return validationError(parsedBody.error);

    const owner = await authorizeTaskOwner(parsedBody.data.user_id, crmUser.currentUser.id);
    if (owner.response) return owner.response;

    const payload = {
      ...parsedBody.data,
      user_id: owner.ownerId ?? crmUser.currentUser.id,
      // Fylls i på ALLA uppgifter, inte bara delegerade — en halvfylld kolumn är svårare att
      // lita på än en tom, och "vem skapade den här" är samma fråga oavsett mottagare.
      created_by: crmUser.currentUser.id,
      completed_at: parsedBody.data.status === 'done' ? new Date().toISOString() : null,
    };

    // Egen uppgift går den vanliga sessionsvägen. En uppgift åt någon ANNAN måste skrivas med
    // elevated klient: dashboard_work_items WITH CHECK är egen-bara, och policyn lämnas
    // medvetet orörd (se 20260817_dashboard_work_items_created_by.sql). Behörighetsbeslutet är
    // redan fattat ovan — crm.admin plus en mottagare verifierad mot säljarkatalogen.
    const sessionClient = createRouteHandlerClient({ cookies });
    const supabase = owner.ownerId ? getSupabaseAdmin() : sessionClient;
    const { data, error } = await createCrmTask(supabase, payload);

    if (error) {
      return routeError(500, 'crm_task_create_failed', error.message);
    }

    // Notis till mottagaren. Best-effort: uppgiften är redan sparad, och en utebliven notis får
    // aldrig fälla den. Bara vid delegering — ingen behöver en notis om sin egen uppgift.
    if (data && owner.ownerId) {
      await notifyTaskAssignee({
        taskId: data.id,
        title: data.title,
        dueDate: data.due_date,
        assigneeId: owner.ownerId,
        assignerId: crmUser.currentUser.id,
      }).catch((e) => console.error('[crm_task] notis-fan-out misslyckades', e));
    }

    // ⚠️ SESSIONSKLIENTEN, även när uppgiften skrevs elevated åt någon annan: elevationen ovan
    // gäller uppgiftstabellen, inte vilka kunder anroparen får läsa. Utan raden saknar en nyss
    // skapad uppgift sin kontaktrad tills listan hämtas om.
    return ok({ item: data ? (await attachCrmTaskContacts(sessionClient, [data]))[0] : data }, 201);
  } catch (e: any) {
    return routeError(500, 'crm_task_unexpected', e?.message || 'Failed to create task');
  }
}