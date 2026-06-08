import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { generateCoachReply, loadCoachContext } from '@/lib/domains/crm/coach';
import { coachRequestSchema, ok, requireCrmWriter, routeError, validationError } from './_lib';

export async function POST(req: Request) {
  try {
    const crmUser = await requireCrmWriter();
    if (crmUser.response) return crmUser.response;

    const parsedBody = coachRequestSchema.safeParse(await req.json().catch(() => null));
    if (!parsedBody.success) return validationError(parsedBody.error);

    const supabase = createRouteHandlerClient({ cookies });
    const contextResult = parsedBody.data.context ? await loadCoachContext(supabase, parsedBody.data.context) : { data: null, error: null };

    if (contextResult.error) {
      return routeError(500, 'crm_coach_context_failed', contextResult.error.message);
    }

    // The route stays thin on purpose: context loading happens here, while provider
    // selection and mock fallback stay in the Coach domain layer.
    const reply = await generateCoachReply({
      prompt: parsedBody.data.prompt,
      quickAction: parsedBody.data.quick_action,
      context: contextResult.data,
      userName: crmUser.currentUser?.name || null,
    });

    return ok({ reply });
  } catch (e: any) {
    return routeError(500, 'crm_coach_unexpected', e?.message || 'Failed to generate coach response');
  }
}