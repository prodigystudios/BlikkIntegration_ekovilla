import { requireCrmAdmin, ok, validationError } from '../../_shared';
import {
  updateFortnoxArticle,
  deleteFortnoxArticle,
} from '@/lib/domains/fortnox/articles';
import { fortnoxArticleInputSchema, toFortnoxArticleInput, toFortnoxPrices, fortnoxWriteError } from '../_lib';

type RouteContext = { params: { articleNumber: string } };

export async function PUT(req: Request, { params }: RouteContext) {
  try {
    const admin = await requireCrmAdmin();
    if (admin.response) return admin.response;

    const parsed = fortnoxArticleInputSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return validationError(parsed.error);

    const article = await updateFortnoxArticle(
      decodeURIComponent(params.articleNumber),
      toFortnoxArticleInput(parsed.data),
      toFortnoxPrices(parsed.data),
    );
    return ok({ article });
  } catch (e: any) {
    return fortnoxWriteError(e, 'fortnox_article_update_failed', 'Kunde inte uppdatera artikel');
  }
}

export async function DELETE(_req: Request, { params }: RouteContext) {
  try {
    const admin = await requireCrmAdmin();
    if (admin.response) return admin.response;

    await deleteFortnoxArticle(decodeURIComponent(params.articleNumber));
    return ok({ deleted: true });
  } catch (e: any) {
    return fortnoxWriteError(e, 'fortnox_article_delete_failed', 'Kunde inte ta bort artikel');
  }
}
