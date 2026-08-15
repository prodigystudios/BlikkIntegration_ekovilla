import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { deleteCrmWorkOrderFile, getCrmWorkOrderFile } from '@/lib/domains/crm/work-orders';
import { removeWorkOrderFileObject, signWorkOrderFileUrl } from '@/lib/domains/crm/workOrderFiles/storage';
import type { WorkOrderFileRow } from '@/lib/domains/crm/workOrderFiles/types';
import { can, getEffectivePermissions } from '@/lib/auth/permissions';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { invalidUuidParam, ok, requireSignedInUser, routeError } from '../../../_lib';

// nodejs: signering och städning sker med service-role-nyckeln.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = {
  params: {
    id: string;
    fileId: string;
  };
};

// Öppna eller ladda ner en enskild fil.
//
// `?redirect=1` ger en 302 till den signerade URL:en i stället för JSON. Det är formen som duger
// som href — länken går aldrig ut, för den gatas om vid varje klick — och den som PDF-iframen och
// "Öppna i ny flik" använder. Listan använder den INTE för miniatyrer: det hade blivit ett
// funktionsanrop per bild och rendering.
//
// `?download=1` sätter Content-Disposition: attachment via den signerade URL:en.
export async function GET(req: Request, context: RouteContext) {
  try {
    const currentUser = await requireSignedInUser();
    if (currentUser.response) return currentUser.response;

    // Utan detta blir en trasig id ett 500 med ett rått Postgres-meddelande i svaret.
    const badId = invalidUuidParam(context.params.id) || invalidUuidParam(context.params.fileId);
    if (badId) return badId;

    const { searchParams } = new URL(req.url);
    const wantsRedirect = searchParams.get('redirect') === '1';
    const wantsDownload = searchParams.get('download') === '1';

    // Läses med SESSIONSKLIENTEN: RLS avgör om den här användaren över huvud taget får se raden.
    // Först därefter signerar vi med service-role.
    const supabase = createRouteHandlerClient({ cookies });
    const { data, error } = await getCrmWorkOrderFile(supabase, context.params.fileId, context.params.id);

    if (error) return routeError(500, 'crm_work_order_file_read_failed', error.message);
    if (!data) return routeError(404, 'crm_work_order_file_not_found', 'Filen hittades inte.');

    const row = data as unknown as WorkOrderFileRow;
    const url = await signWorkOrderFileUrl(
      getSupabaseAdmin(),
      row.storage_bucket,
      row.storage_path,
      wantsDownload ? row.file_name : undefined,
    );
    if (!url) return routeError(500, 'crm_work_order_file_sign_failed', 'Kunde inte skapa en länk till filen.');

    if (wantsRedirect) return NextResponse.redirect(url, { status: 302 });

    return ok({ url });
  } catch (e: any) {
    return routeError(500, 'crm_work_order_file_unexpected', e?.message || 'Failed to read work order file');
  }
}

// Kontoret raderar allt på ordern; alla andra bara sina egna uppladdningar.
//
// Kontorets undantag uttrycks som att ägarfiltret UTELÄMNAS, inte som en assert — 0 rader blir 404,
// precis som på kommentarerna. En installatör som försöker radera kontorets ritning får alltså
// samma svar som om filen inte fanns, vilket är rätt: hen har inget med den att göra.
export async function DELETE(_req: Request, context: RouteContext) {
  try {
    const currentUser = await requireSignedInUser();
    if (currentUser.response || !currentUser.currentUser) return currentUser.response;

    const badId = invalidUuidParam(context.params.id) || invalidUuidParam(context.params.fileId);
    if (badId) return badId;

    const perms = await getEffectivePermissions();
    const ownerId = can(perms, 'crm.workorder.write') ? null : currentUser.currentUser.id;

    const supabase = createRouteHandlerClient({ cookies });
    const { data, error } = await deleteCrmWorkOrderFile(
      supabase,
      context.params.fileId,
      context.params.id,
      ownerId,
    );

    if (error) return routeError(500, 'crm_work_order_file_delete_failed', error.message);
    if (!data) return routeError(404, 'crm_work_order_file_not_found', 'Filen hittades inte.');

    // Raden är borta. Objektet städas best-effort — misslyckas det ligger byte kvar utan rad, och
    // det är osynligt skräp snarare än ett trasigt kort i listan.
    const row = data as unknown as { id: string; storage_bucket: string; storage_path: string };
    await removeWorkOrderFileObject(getSupabaseAdmin(), row.storage_bucket, row.storage_path);

    return ok({ id: row.id });
  } catch (e: any) {
    return routeError(500, 'crm_work_order_file_unexpected', e?.message || 'Failed to delete work order file');
  }
}
