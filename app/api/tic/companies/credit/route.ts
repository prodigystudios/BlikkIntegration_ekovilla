import { z } from 'zod';
import { ok, routeError, requireCrmWriter } from '@/app/api/crm/_shared';
import { fetchTicCreditReport, TicCompanyNotFoundError } from '@/lib/domains/tic/credit';
import { ticRouteErrorInfo } from '@/lib/domains/tic/client';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Credit report (kreditupplysning) by org.nr — used by the new-customer form to preview a
// company's credit BEFORE the customer row exists (the persisted variant lives at
// /api/crm/customers/[id]/credit). Writer-gated (sales/admin) since it bills tic.io.
const bodySchema = z.object({
  organization_number: z.string().trim().min(1).optional(),
  company_id: z.coerce.number().int().optional(),
}).refine((d) => d.organization_number || d.company_id != null, {
  message: 'Organisationsnummer eller company_id krävs',
});

export async function POST(req: Request) {
  try {
    const crmUser = await requireCrmWriter();
    if (crmUser.response) return crmUser.response;

    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return routeError(400, 'validation_error', parsed.error.issues[0]?.message || 'Ogiltig förfrågan');
    }

    try {
      const { companyId, report } = await fetchTicCreditReport({
        organizationNumber: parsed.data.organization_number,
        companyId: parsed.data.company_id,
      });
      return ok({ company_id: companyId, report });
    } catch (ticErr) {
      if (ticErr instanceof TicCompanyNotFoundError) {
        return routeError(404, 'tic_company_not_found', ticErr.message);
      }
      const info = ticRouteErrorInfo(ticErr);
      return routeError(info.status, info.code, info.message);
    }
  } catch (e: any) {
    return routeError(500, 'tic_credit_unexpected', e?.message || 'Failed to fetch credit report');
  }
}
