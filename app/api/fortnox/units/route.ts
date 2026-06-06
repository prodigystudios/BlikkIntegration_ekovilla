import { requireCrmUser, requireCrmAdmin, ok, routeError, validationError, fortnoxWriteError } from '../_shared';
import { listFortnoxUnits, createFortnoxUnit } from '@/lib/domains/fortnox/units';
import { unitCreateSchema } from './_lib';

export async function GET() {
  try {
    const crmUser = await requireCrmUser();
    if (crmUser.response) return crmUser.response;

    const items = await listFortnoxUnits();
    return ok({ items, count: items.length });
  } catch (e: any) {
    return routeError(500, 'fortnox_units_list_failed', e?.message || 'Kunde inte hämta enheter');
  }
}

export async function POST(req: Request) {
  try {
    const admin = await requireCrmAdmin();
    if (admin.response) return admin.response;

    const parsed = unitCreateSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return validationError(parsed.error);

    const unit = await createFortnoxUnit(parsed.data.code, parsed.data.description ?? null);
    return ok({ unit }, 201);
  } catch (e: any) {
    return fortnoxWriteError(e, 'fortnox_unit_create_failed', 'Kunde inte skapa enhet');
  }
}
