import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import {
  approveCrmAiProspectSuggestion,
  getCrmAiProspectSuggestion,
  mapCrmAiProspectSuggestionRow,
  reviewCrmAiProspectSuggestion,
} from '@/lib/crm/aiProspects';
import { ok, requireCrmUser, reviewCrmAiProspectSuggestionSchema, routeError, validationError } from '../../_lib';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const crmUser = await requireCrmUser();
    if (crmUser.response || !crmUser.currentUser) return crmUser.response;

    const parsedBody = reviewCrmAiProspectSuggestionSchema.safeParse(await req.json().catch(() => null));
    if (!parsedBody.success) return validationError(parsedBody.error);

    const supabase = createRouteHandlerClient({ cookies });
    const suggestionResult = await getCrmAiProspectSuggestion(supabase, params.id);

    if (suggestionResult.error) {
      return routeError(500, 'crm_ai_prospekt_get_failed', suggestionResult.error.message);
    }

    if (!suggestionResult.data) {
      return routeError(404, 'crm_ai_prospekt_not_found', 'Förslaget hittades inte');
    }

    const suggestion = mapCrmAiProspectSuggestionRow(suggestionResult.data as any);

    if (suggestion.status !== 'pending') {
      return routeError(409, 'crm_ai_prospekt_already_reviewed', 'Förslaget är redan granskat');
    }

    let approvedProspect = null;
    if (parsedBody.data.action === 'approve') {
      const prospectResult = await approveCrmAiProspectSuggestion(
        supabase,
        suggestion,
        crmUser.currentUser.id,
      );

      if (prospectResult.error) {
        return routeError(500, 'crm_ai_prospekt_approve_failed', prospectResult.error.message);
      }

      approvedProspect = prospectResult.data;
    }

    const reviewResult = await reviewCrmAiProspectSuggestion(supabase, suggestion.id, {
      status: parsedBody.data.action === 'approve' ? 'approved' : 'rejected',
      reviewed_by: crmUser.currentUser.id,
      review_note: parsedBody.data.review_note,
      reviewed_at: new Date().toISOString(),
      approved_prospect_id: approvedProspect?.id || null,
    });

    if (reviewResult.error) {
      return routeError(500, 'crm_ai_prospekt_review_failed', reviewResult.error.message);
    }

    return ok({
      item: mapCrmAiProspectSuggestionRow(reviewResult.data as any),
      approved_prospect: approvedProspect,
    });
  } catch (e: any) {
    return routeError(500, 'crm_ai_prospekt_unexpected', e?.message || 'Failed to review AI prospect suggestion');
  }
}