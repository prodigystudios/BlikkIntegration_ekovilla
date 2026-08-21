import { randomUUID } from 'crypto';
import { invalidUuidParam, ok, routeError, validationError } from '@/lib/api/responses';
import { getOptionalSupabaseAdmin } from '@/lib/supabase/server';
import { uploadUrlSchema } from '@/lib/domains/info-page/schemas';
import { requireSection } from '@/lib/domains/info-page/mutations';
import { buildInfoImagePath, createInfoImageUploadUrl, getInfoImageBucket } from '@/lib/domains/info-page/storage';
import { requireAdmin, readJson, toRouteError } from '../../../../_guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/admin/info/sections/[id]/images/upload-url
// Steg 1 av två: servern reserverar en sökväg och signerar en uppladdning. Klienten lägger
// filen direkt i storage och anropar sedan .../images för att registrera raden. Filen går
// alltså aldrig genom den här funktionen.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;

  const badId = invalidUuidParam(params.id);
  if (badId) return badId;

  const parsed = uploadUrlSchema.safeParse(await readJson(req));
  if (!parsed.success) return validationError(parsed.error);

  try {
    // Att sektionen finns kontrolleras HÄR och inte först vid registreringen: annars kunde en
    // fil hamna i bucketen under ett id som inte finns, utan rad som pekar på den.
    await requireSection(auth.client, params.id);

    const admin = getOptionalSupabaseAdmin();
    if (!admin) return routeError(500, 'service_role_missing', 'service role not configured');

    const bucket = getInfoImageBucket();
    const path = buildInfoImagePath(params.id, parsed.data.fileName, randomUUID());
    const signed = await createInfoImageUploadUrl(admin, bucket, path);
    if (!signed) return routeError(500, 'upload_url_failed', 'Kunde inte förbereda uppladdningen.');

    return ok({ bucket, path: signed.path, token: signed.token });
  } catch (error) {
    return toRouteError(error);
  }
}
