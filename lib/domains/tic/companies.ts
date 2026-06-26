import { ticGet } from './client';
import { mapTicCompany } from './mappers';
import type { TicLookupResult, TicRawCompany, TicSearchResponse } from './types';

// Search companies in tic.io by free text (name) or organization number.
// NOTE: verify the exact path + query_by fields against the swagger
// (https://lens-api.tic.io/docs/v1/swagger.json) — mapping is isolated in mappers.ts
// so a field/path adjustment stays local.
export async function searchTicCompanies(q: string): Promise<TicLookupResult[]> {
  const res = await ticGet<TicSearchResponse<TicRawCompany>>('/search-public/companies', {
    q,
    query_by: 'names.nameOrIdentifier,registrationNumber',
    per_page: '10',
  });

  return (res.hits ?? [])
    .map((h) => h.document)
    .filter((d): d is TicRawCompany => !!d)
    .map(mapTicCompany);
}

// Look up a single company by org.nr and return the mapped result (or null). Prefers an
// exact registrationNumber match, falling back to the first hit. Used to enrich an existing
// customer's company data on demand (e.g. Fortnox imports that never went through lookup).
export async function getTicCompanyByOrgNumber(orgNumber: string): Promise<TicLookupResult | null> {
  const normalized = orgNumber.replace(/\D/g, '');
  if (!normalized) return null;
  const results = await searchTicCompanies(normalized);
  const exact = results.find((r) => (r.organization_number || '').replace(/\D/g, '') === normalized);
  return exact ?? results[0] ?? null;
}
