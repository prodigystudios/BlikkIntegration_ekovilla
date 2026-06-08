import { ticGet } from './client';
import { mapTicPerson } from './mappers';
import type { TicLookupResult, TicRawPerson, TicSearchResponse } from './types';

// Search persons in tic.io by full name or personal identity number.
// tic.io caps GET person search at 2 results per page. NOTE: verify the exact path +
// query_by against the swagger (https://lens-api.tic.io/docs/v1/swagger.json).
export async function searchTicPersons(q: string): Promise<TicLookupResult[]> {
  const res = await ticGet<TicSearchResponse<TicRawPerson>>('/search-public/persons', {
    q,
    query_by: 'fullName,personalIdentityNumber',
    per_page: '2',
  });

  return (res.hits ?? [])
    .map((h) => h.document)
    .filter((d): d is TicRawPerson => !!d)
    .map(mapTicPerson);
}
