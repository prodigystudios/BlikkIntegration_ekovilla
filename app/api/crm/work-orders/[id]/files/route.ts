import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import {
  createCrmWorkOrderFile,
  findCrmWorkOrderFileByPath,
  isUserOnWorkOrder,
  listCrmWorkOrderFiles,
} from '@/lib/domains/crm/work-orders';
import {
  getWorkOrderFileBucket,
  isWorkOrderFilePath,
  readWorkOrderFileInfo,
  removeWorkOrderFileObject,
  signWorkOrderFileUrls,
} from '@/lib/domains/crm/workOrderFiles/storage';
import { isPreviewableImage, validateWorkOrderFile } from '@/lib/domains/crm/workOrderFiles/validation';
import { mapWorkOrderFileRow } from '@/lib/domains/crm/workOrderFiles/mappers';
import type { WorkOrderFileRow } from '@/lib/domains/crm/workOrderFiles/types';
import { can, getEffectivePermissions } from '@/lib/auth/permissions';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import {
  createWorkOrderFileSchema,
  invalidUuidParam,
  ok,
  requireSignedInUser,
  routeError,
  validationError,
} from '../../_lib';

// nodejs: signering och städning sker med service-role-nyckeln.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = {
  params: {
    id: string;
  };
};

export async function GET(_req: Request, context: RouteContext) {
  try {
    const currentUser = await requireSignedInUser();
    if (currentUser.response || !currentUser.currentUser) return currentUser.response;

    const badId = invalidUuidParam(context.params.id);
    if (badId) return badId;

    const supabase = createRouteHandlerClient({ cookies });
    const { data, error } = await listCrmWorkOrderFiles(supabase, context.params.id);

    if (error) {
      return routeError(500, 'crm_work_order_files_list_failed', error.message);
    }

    const rows = (data || []) as unknown as WorkOrderFileRow[];

    // Bara bilder signeras — de är de enda som renderas som miniatyr. PDF:er får null och öppnas
    // via /files/<id>?redirect=1 vid klick, så vi inte signerar det som ändå inte visas.
    //
    // EN batch-signering (createSignedUrls) i stället för N enskilda: en telefon i fält ska inte
    // betala tio rundturer för att rita en lista. Support-modulens has_screenshot-lösning duger
    // inte här — där finns högst en bild i en detaljvy, här är miniatyrerna hela poängen.
    // Grupperat PER BUCKET, inte "ta bucketen från första raden": bucketnamnet sparas per rad
    // just för att en framtida bucketflytt inte ska göra gamla rader olästbara, och en signering
    // som antar en enda bucket hade tyst tappat miniatyren på allt som låg kvar i den gamla.
    // I normalfallet är det en bucket och därmed ett anrop.
    const previewable = rows.filter((row) => isPreviewableImage(row.content_type));
    const admin = getSupabaseAdmin();
    const byBucket = new Map<string, string[]>();
    for (const row of previewable) {
      const bucket = row.storage_bucket || getWorkOrderFileBucket();
      byBucket.set(bucket, [...(byBucket.get(bucket) || []), row.storage_path]);
    }
    if (byBucket.size === 0) byBucket.set(getWorkOrderFileBucket(), []);

    const urls = new Map<string, string>();
    for (const [bucket, paths] of byBucket) {
      const signed = await signWorkOrderFileUrls(admin, bucket, paths);
      for (const [path, url] of signed) urls.set(path, url);
    }

    const perms = await getEffectivePermissions();
    const isOfficeWriter = can(perms, 'crm.workorder.write');

    // Kan den här användaren ladda upp? Kontoret alltid; besättningen på sitt eget jobb. Frågan
    // ställs till samma funktion som RLS-policyn kallar, så knappen och databasen är överens.
    // Klienten kan inte svara på det själv — därför följer flaggorna med listan.
    let canUpload = isOfficeWriter;
    if (!canUpload) {
      const { data: onJob } = await isUserOnWorkOrder(supabase, currentUser.currentUser.id, context.params.id);
      canUpload = onJob === true;
    }

    return ok({
      items: rows.map((row) => mapWorkOrderFileRow(row, urls.get(row.storage_path) ?? null)),
      can_upload: canUpload,
      // Bara kontoret får dölja en fil för besättningen.
      can_mark_internal: isOfficeWriter,
      can_delete_any: isOfficeWriter,
    });
  } catch (e: any) {
    return routeError(500, 'crm_work_order_files_unexpected', e?.message || 'Failed to list work order files');
  }
}

// Steg 3 av tre: klienten har laddat upp och rapporterar var filen hamnade.
//
// ALLT I KROPPEN ÄR ETT PÅSTÅENDE. Upload-token binder bara sökvägen — inte storlek, inte
// mimetype — så den här routen är den enda försvarslinjen mot en klient som påstod 2 MB och
// laddade upp 40. Tre kontroller bär det:
//   1. sökvägen måste ligga under Arbetsorder/<denna order>/<den här användaren>/ — annars kan en
//      klient koppla ett Support/-objekt ELLER en kollegas fil till sin egen order,
//   2. sökvägen får inte redan vara registrerad (409) — se nedan om varför det är en säkerhets-
//      kontroll och inte en dubblettstädning,
//   3. storlek och mimetype läses ur LAGRINGEN, inte ur kroppen.
//
// ⚠️ UPPSTÄDNINGEN ÄR DESTRUKTIV och får bara röra ett objekt som den här användaren själv just
// laddat upp. Sökvägen till en bild går att läsa ut ur den signerade URL:en listan skickar
// (`/object/sign/<bucket>/<path>?token=…`), så vad som helst i listan kan spelas tillbaka hit.
// Kontroll 1 och 2 är det som gör städningen ofarlig — ta inte bort någon av dem.
export async function POST(req: Request, context: RouteContext) {
  const bucket = getWorkOrderFileBucket();
  let uploadedPath: string | null = null;

  try {
    const currentUser = await requireSignedInUser();
    if (currentUser.response || !currentUser.currentUser) return currentUser.response;

    const badId = invalidUuidParam(context.params.id);
    if (badId) return badId;

    const parsedBody = createWorkOrderFileSchema.safeParse(await req.json().catch(() => null));
    if (!parsedBody.success) return validationError(parsedBody.error);

    const { storage_path: storagePath, file_name: fileName, category } = parsedBody.data;

    if (!isWorkOrderFilePath(storagePath, context.params.id, currentUser.currentUser.id)) {
      return routeError(400, 'crm_work_order_file_path_invalid', 'Filen hör inte till den här arbetsordern.');
    }

    const supabase = createRouteHandlerClient({ cookies });

    // Redan registrerad? Då är objektet någon annans (eller vårt eget, redan sparat) och får inte
    // röras. Svara innan `uploadedPath` sätts, så ingen felgren kan städa bort det.
    const { data: existing } = await findCrmWorkOrderFileByPath(supabase, storagePath);
    if (existing) {
      return routeError(409, 'crm_work_order_file_already_registered', 'Filen är redan sparad på arbetsordern.');
    }

    uploadedPath = storagePath;

    const admin = getSupabaseAdmin();
    const info = await readWorkOrderFileInfo(admin, bucket, storagePath);
    if (!info) {
      return routeError(400, 'crm_work_order_file_missing_object', 'Uppladdningen kom aldrig fram. Försök igen.');
    }

    const fileError = validateWorkOrderFile({ size: info.size, type: info.contentType || '', name: fileName });
    if (fileError) {
      // Filen ligger redan i lagringen och är inte tillåten — städa bort den direkt.
      await removeWorkOrderFileObject(admin, bucket, storagePath);
      uploadedPath = null;
      return routeError(400, 'crm_work_order_file_invalid', fileError);
    }

    // Interna filer är ett kontorsbegrepp. En installatör ska inte kunna lägga upp något
    // besättningen inte ser — RLS gör om samma kontroll, det här är bara det snälla svaret.
    const perms = await getEffectivePermissions();
    const isInternal = can(perms, 'crm.workorder.write') ? parsedBody.data.is_internal : false;

    const { data, error } = await createCrmWorkOrderFile(supabase, {
      work_order_id: context.params.id,
      category,
      is_internal: isInternal,
      file_name: fileName,
      storage_bucket: bucket,
      storage_path: storagePath,
      content_type: info.contentType,
      size_bytes: info.size,
      created_by: currentUser.currentUser.id,
      // profiles är self-read-only, så namnet snapshottas här och läses aldrig via en join.
      created_by_name: currentUser.currentUser.name || 'Okänd',
    });

    if (error || !data) {
      // 23505 = unikt index på storage_path. Då vann någon annan kapplöpningen om samma sökväg och
      // objektet tillhör DERAS rad — städa inte, det vore att radera en fil som just sparats.
      // Förkontrollen ovan fångar normalfallet; det här är racet mellan den och insert:en.
      const isDuplicate = (error as { code?: string } | null)?.code === '23505';
      if (!isDuplicate) await removeWorkOrderFileObject(admin, bucket, storagePath);
      uploadedPath = null;
      if (isDuplicate) {
        return routeError(409, 'crm_work_order_file_already_registered', 'Filen är redan sparad på arbetsordern.');
      }
      return routeError(500, 'crm_work_order_file_create_failed', error?.message || 'Kunde inte spara filen.');
    }

    uploadedPath = null;
    const row = data as unknown as WorkOrderFileRow;
    const url = isPreviewableImage(row.content_type)
      ? (await signWorkOrderFileUrls(admin, bucket, [row.storage_path])).get(row.storage_path) ?? null
      : null;

    return ok({ item: mapWorkOrderFileRow(row, url) }, 201);
  } catch (e: any) {
    // Samma städning som ovan — ett kvarglömt objekt utan rad är skräp ingen kan nå, men det ska
    // inte bli kvar bara för att felet kom från oväntat håll.
    if (uploadedPath) await removeWorkOrderFileObject(getSupabaseAdmin(), bucket, uploadedPath);
    return routeError(500, 'crm_work_order_file_unexpected', e?.message || 'Failed to create work order file');
  }
}
