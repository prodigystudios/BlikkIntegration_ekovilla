import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { attachCrmTaskContacts, updateCrmTask } from '@/lib/domains/crm/tasks';
import {
  ok,
  requireCrmWriter,
  routeError,
  updateCrmTaskSchema,
  validationError,
} from '../_lib';

type RouteContext = {
  params: {
    id: string;
  };
};

export async function PATCH(req: Request, context: RouteContext) {
  try {
    const crmUser = await requireCrmWriter();
    if (crmUser.response || !crmUser.currentUser) return crmUser.response;

    const parsedBody = updateCrmTaskSchema.safeParse(await req.json().catch(() => null));
    if (!parsedBody.success) return validationError(parsedBody.error);

    const supabase = createRouteHandlerClient({ cookies });
    const payload = {
      ...parsedBody.data,
      completed_at: parsedBody.data.status === 'done' ? new Date().toISOString() : null,
    };

    const { data, error } = await updateCrmTask(supabase, context.params.id, payload);

    if (error) {
      return routeError(500, 'crm_task_update_failed', error.message);
    }

    // Kontakten följer med på ALLA svar som bär en uppgift, inte bara på listan. Klienten
    // ersätter raden med det den får tillbaka, och ett svar utan fältet hade tömt kontaktraden i
    // samma stund någon bockade av eller rättade titeln — en tyst förlust av något som stod på
    // skärmen. Samma felklass som fälten Zod strippade tyst.
    return ok({ item: data ? (await attachCrmTaskContacts(supabase, [data]))[0] : data });
  } catch (e: any) {
    return routeError(500, 'crm_task_update_unexpected', e?.message || 'Failed to update task');
  }
}