import { requireCrmAdmin, ok, validationError, fortnoxWriteError } from '../../_shared';
import { updateFortnoxUnit, deleteFortnoxUnit } from '@/lib/domains/fortnox/units';
import { unitUpdateSchema } from '../_lib';

type RouteContext = { params: { code: string } };

export async function PUT(req: Request, { params }: RouteContext) {
  try {
    const admin = await requireCrmAdmin();
    if (admin.response) return admin.response;

    const parsed = unitUpdateSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return validationError(parsed.error);

    const unit = await updateFortnoxUnit(decodeURIComponent(params.code), parsed.data.description ?? null);
    return ok({ unit });
  } catch (e: any) {
    return fortnoxWriteError(e, 'fortnox_unit_update_failed', 'Kunde inte uppdatera enhet');
  }
}

export async function DELETE(_req: Request, { params }: RouteContext) {
  try {
    const admin = await requireCrmAdmin();
    if (admin.response) return admin.response;

    await deleteFortnoxUnit(decodeURIComponent(params.code));
    return ok({ deleted: true });
  } catch (e: any) {
    return fortnoxWriteError(e, 'fortnox_unit_delete_failed', 'Kunde inte ta bort enhet');
  }
}
