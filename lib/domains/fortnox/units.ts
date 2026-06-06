import { fortnoxGet, fortnoxPost, fortnoxPut, fortnoxDelete } from './client';
import type { FortnoxUnitListResponse } from './types';

export type FortnoxUnit = { code: string; description: string };

type FortnoxUnitWriteResponse = { Unit: { Code: string; Description: string | null } };

function toUnit(u: { Code: string; Description: string | null }): FortnoxUnit {
  return { code: u.Code, description: u.Description ?? '' };
}

// List the account's unit register from Fortnox (e.g. st, m², tim).
export async function listFortnoxUnits(): Promise<FortnoxUnit[]> {
  const response = await fortnoxGet<FortnoxUnitListResponse>('/units');
  return (response.Units ?? []).map((u) => ({ code: u.Code, description: u.Description }));
}

// Create a unit. Code is the key (required, immutable afterwards).
export async function createFortnoxUnit(code: string, description: string | null): Promise<FortnoxUnit> {
  const response = await fortnoxPost<FortnoxUnitWriteResponse>('/units', {
    Unit: { Code: code, Description: description ?? undefined },
  });
  return toUnit(response.Unit);
}

// Update a unit's description (matched on Code, which cannot change).
export async function updateFortnoxUnit(code: string, description: string | null): Promise<FortnoxUnit> {
  const response = await fortnoxPut<FortnoxUnitWriteResponse>(`/units/${encodeURIComponent(code)}`, {
    Unit: { Description: description ?? undefined },
  });
  return toUnit(response.Unit);
}

// Delete a unit. Fortnox rejects deletion if the unit is in use.
export async function deleteFortnoxUnit(code: string): Promise<void> {
  await fortnoxDelete(`/units/${encodeURIComponent(code)}`);
}
