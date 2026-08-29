import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { deleteMaterialCostArticle, upsertMaterialCostArticle } from '@/lib/domains/crm/calcSettings';
import {
  deleteMaterialCostArticleSchema,
  ok,
  requireCrmAdmin,
  routeError,
  upsertMaterialCostArticleSchema,
  validationError,
} from '../_lib';

// Material → kostnadsartikel: koppla och koppla bort.
//
// ⚠️ MATERIALET LIGGER I KROPPEN RESPEKTIVE I QUERYN, ALDRIG I SÖKVÄGEN. Kortkoderna innehåller
// snedstreck ("ISOCELL/ISECO"), och som sökvägssegment hade det blivit två segment och en 404 som
// ser ut som att materialet inte finns.
export const dynamic = 'force-dynamic';

export async function PUT(req: Request) {
  try {
    const crmAdmin = await requireCrmAdmin();
    if (crmAdmin.response || !crmAdmin.currentUser) return crmAdmin.response;

    const parsedBody = upsertMaterialCostArticleSchema.safeParse(await req.json().catch(() => null));
    if (!parsedBody.success) return validationError(parsedBody.error);

    const supabase = createRouteHandlerClient({ cookies });
    const { data, error } = await upsertMaterialCostArticle(supabase, {
      material: parsedBody.data.material,
      articleNumber: parsedBody.data.article_number,
      userId: crmAdmin.currentUser.id,
    });
    if (error || !data) {
      return routeError(
        500,
        'crm_material_cost_article_upsert_failed',
        error?.message || 'Kunde inte spara kostnadsartikeln.',
      );
    }

    return ok({ item: data }, 201);
  } catch (e: any) {
    return routeError(500, 'crm_material_cost_article_unexpected', e?.message || 'Failed to save cost article');
  }
}

export async function DELETE(req: Request) {
  try {
    const crmAdmin = await requireCrmAdmin();
    if (crmAdmin.response) return crmAdmin.response;

    const url = new URL(req.url);
    const parsedQuery = deleteMaterialCostArticleSchema.safeParse({ material: url.searchParams.get('material') });
    if (!parsedQuery.success) return validationError(parsedQuery.error);

    const supabase = createRouteHandlerClient({ cookies });
    const { data, error } = await deleteMaterialCostArticle(supabase, parsedQuery.data.material);
    if (error) {
      return routeError(500, 'crm_material_cost_article_delete_failed', error.message);
    }
    // ⚠️ En DELETE som RLS avvisar svarar `error: null` och NOLL RADER — inte ett fel. Utan
    // radräkningen hade knappen sagt "borttagen" om en rad som ligger kvar.
    if (!data || data.length === 0) {
      return routeError(
        404,
        'crm_material_cost_article_not_found',
        'Kopplingen fanns inte, eller kunde inte tas bort.',
      );
    }

    return ok({ material: parsedQuery.data.material });
  } catch (e: any) {
    return routeError(500, 'crm_material_cost_article_delete_unexpected', e?.message || 'Failed to delete cost article');
  }
}
