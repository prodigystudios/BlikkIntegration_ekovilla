import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { isUserOnWorkOrder } from '@/lib/domains/crm/work-orders';
import {
  buildWorkOrderFilePath,
  createWorkOrderFileUploadUrl,
  getWorkOrderFileBucket,
} from '@/lib/domains/crm/workOrderFiles/storage';
import { validateWorkOrderFile } from '@/lib/domains/crm/workOrderFiles/validation';
import { can, getEffectivePermissions } from '@/lib/auth/permissions';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import {
  invalidUuidParam,
  ok,
  requireSignedInUser,
  routeError,
  validationError,
  workOrderFileUploadUrlSchema,
} from '../../../_lib';

// nodejs: myntandet sker med service-role-nyckeln.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = {
  params: {
    id: string;
  };
};

// Steg 1 av tre i uppladdningen. Här skapas INGEN databasrad — bara en engångs-URL som klienten
// laddar upp till. En avbruten uppladdning lämnar därför aldrig en rad som pekar på ingenting;
// den lämnar på sin höjd ett oåtkomligt objekt (privat bucket, inga storage-policyer).
//
// Grinden är requireSignedInUser() och inte requireCrmUser(): installatören har inga CRM-nycklar
// alls, precis som på kommentarerna och tidraderna. Skrivrätten avgörs i stället av samma två
// villkor som INSERT-policyn i 20260815_crm_work_order_files.sql — ord för ord, så routens svar
// blir identiskt med databasens i stället för ungefärligt.
export async function POST(req: Request, context: RouteContext) {
  try {
    const currentUser = await requireSignedInUser();
    if (currentUser.response || !currentUser.currentUser) return currentUser.response;

    // Utan den här skulle en trasig id mynta en signerad URL under Arbetsorder/<skräp>/ — ett
    // objekt ingen arbetsorder någonsin kan nå, men som ligger kvar i bucketen.
    const badId = invalidUuidParam(context.params.id);
    if (badId) return badId;

    const parsedBody = workOrderFileUploadUrlSchema.safeParse(await req.json().catch(() => null));
    if (!parsedBody.success) return validationError(parsedBody.error);

    // Avvisa det uppenbart felaktiga innan vi kostar på oss en storage-runda. Påståendena är inte
    // att lita på — steg 2 läser filens faktiska storlek och typ ur lagringen — men en fil som
    // redan på pappret är 40 MB ska stoppas här, innan användaren laddat upp den.
    const claimError = validateWorkOrderFile({
      size: parsedBody.data.size_bytes,
      type: parsedBody.data.content_type,
      name: parsedBody.data.file_name,
    });
    if (claimError) return routeError(400, 'crm_work_order_file_invalid', claimError);

    const supabase = createRouteHandlerClient({ cookies });
    const perms = await getEffectivePermissions();

    let allowed = can(perms, 'crm.workorder.write');
    if (!allowed) {
      // Besättningsfrågan kan bara databasen svara på. Samma SECURITY DEFINER-funktion som
      // policyn kallar — inte en rollkoll, som hade gett fel svar för den som har en
      // per-användar-grant.
      const { data: onJob } = await isUserOnWorkOrder(supabase, currentUser.currentUser.id, context.params.id);
      allowed = onJob === true;
    }
    if (!allowed) {
      return routeError(403, 'crm_work_order_file_forbidden', 'Du kan inte ladda upp filer på den här arbetsordern.');
    }

    const bucket = getWorkOrderFileBucket();
    // Uppladdarens id ligger i sökvägen — se buildWorkOrderFilePath. Det är spärren som gör att en
    // läsbehörig användare inte kan spela tillbaka någon annans filsökväg till bekräftelsesteget.
    const path = buildWorkOrderFilePath(
      context.params.id,
      currentUser.currentUser.id,
      parsedBody.data.file_name,
      crypto.randomUUID(),
    );

    const { signedUrl, token, error } = await createWorkOrderFileUploadUrl(getSupabaseAdmin(), bucket, path);
    if (error || !signedUrl || !token) {
      return routeError(500, 'crm_work_order_file_upload_url_failed', error?.message || 'Kunde inte skapa uppladdningslänk.');
    }

    return ok({ bucket, path, token, signed_url: signedUrl });
  } catch (e: any) {
    return routeError(500, 'crm_work_order_file_upload_url_unexpected', e?.message || 'Failed to create upload url');
  }
}
