import { ticGet } from './client';
import { mapTicCreditReport } from './mappers';
import type {
  TicCreditReport,
  TicRawCompany,
  TicRawCompanyRisk,
  TicSearchResponse,
} from './types';

// Thrown when an org.nr can't be matched to a tic.io company (so the route can return a
// friendly 404 instead of a generic tic error).
export class TicCompanyNotFoundError extends Error {
  constructor() {
    super('Företaget kunde inte hittas hos tic.io.');
    this.name = 'TicCompanyNotFoundError';
  }
}

// Strip everything but digits so "556012-5790" and "5560125790" both match.
function normalizeOrgNumber(org: string): string {
  return org.replace(/\D/g, '');
}

// Resolve tic.io's numeric internal companyId from a Swedish org.nr. Picks the hit whose
// registrationNumber matches exactly (the credit endpoints are keyed by this internal id,
// not the org.nr).
export async function resolveTicCompanyId(orgNumber: string): Promise<number> {
  const normalized = normalizeOrgNumber(orgNumber);
  if (!normalized) throw new TicCompanyNotFoundError();

  const res = await ticGet<TicSearchResponse<TicRawCompany>>('/search-public/companies', {
    q: normalized,
    query_by: 'names.nameOrIdentifier,registrationNumber',
    per_page: '5',
  });

  const docs = (res.hits ?? []).map((h) => h.document).filter((d): d is TicRawCompany => !!d);
  const exact = docs.find((d) => normalizeOrgNumber(d.registrationNumber ?? '') === normalized);
  const companyId = exact?.companyId ?? docs[0]?.companyId;
  if (typeof companyId !== 'number') throw new TicCompanyNotFoundError();
  return companyId;
}

// Fetch the cached credit-score / risk summary for a company id.
export async function getTicCompanyRisk(companyId: number): Promise<TicCreditReport> {
  const raw = await ticGet<TicRawCompanyRisk>(`/companies/${companyId}/risks`);
  return mapTicCreditReport(raw);
}

// Full flow used by the route: resolve the companyId (from a stored one or the org.nr) and
// fetch the report. Returns both so the caller can persist the id for the next refresh.
export async function fetchTicCreditReport(args: {
  organizationNumber?: string | null;
  companyId?: number | null;
}): Promise<{ companyId: number; report: TicCreditReport }> {
  const companyId = args.companyId ?? (args.organizationNumber
    ? await resolveTicCompanyId(args.organizationNumber)
    : null);
  if (typeof companyId !== 'number') throw new TicCompanyNotFoundError();
  const report = await getTicCompanyRisk(companyId);
  return { companyId, report };
}
