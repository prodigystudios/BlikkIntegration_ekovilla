import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { listJobTypes, createJobType } from '@/lib/domains/planning/jobTypes';
import { ok, routeError, validationError, requirePermission, createJobTypeSchema } from '../_lib';

// All job types (incl inactive) for the card chip, the picker and the admin panel.
export async function GET() {
  try {
    const gate = await requirePermission('planning.schedule.read');
    if (gate.response) return gate.response;

    const supabase = createRouteHandlerClient({ cookies });
    const { data, error } = await listJobTypes(supabase);
    if (error) return routeError(500, 'planning_job_types_failed', error.message);

    return ok({ jobTypes: data || [] });
  } catch (e: any) {
    return routeError(500, 'planning_job_types_unexpected', e?.message || 'Failed to list job types');
  }
}

// Add a job type.
export async function POST(req: Request) {
  try {
    const gate = await requirePermission('planning.truck.manage');
    if (gate.response) return gate.response;

    const parsed = createJobTypeSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return validationError(parsed.error);

    const supabase = createRouteHandlerClient({ cookies });
    const { data, error } = await createJobType(supabase, { label: parsed.data.label, color: parsed.data.color });
    if (error) {
      if ((error as { code?: string }).code === '23505') {
        return routeError(409, 'job_type_exists', 'En jobbtyp med liknande namn finns redan.');
      }
      return routeError(500, 'planning_job_type_create_failed', error.message);
    }

    return ok({ item: data }, 201);
  } catch (e: any) {
    return routeError(500, 'planning_job_type_create_unexpected', e?.message || 'Failed to create job type');
  }
}
