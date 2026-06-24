// Supabase queries + pure row-builders for korjournal_trips. The HTTP layer
// (app/api/korjournal/trips) handles auth, Zod and response shaping; this module
// owns the table access and the snake_case payload mapping. RLS scopes rows by user.

import type { SupabaseClient } from '@supabase/supabase-js';

export const korjournalTripSelect = '*';

// ── Normalization (pure) ───────────────────────────────────────────────────

export function normalizeOptionalText(value: string | null | undefined) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const text = String(value).trim();
  return text || null;
}

// Returns null for empty, a finite number, or NaN for an unparseable value.
export function normalizeOptionalKilometer(value: string | number | null | undefined) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

// ── Row builders (pure) ─────────────────────────────────────────────────────

export type CreateTripInput = {
  date?: string;
  startAddress?: string | null;
  endAddress?: string | null;
  startKm?: string | number | null;
  endKm?: string | number | null;
  note?: string | null;
  salesPerson?: string | null;
};

export type BuildResult<T> = { row: T } | { error: 'invalid_km' };

// Build the insert row, defaulting the date and validating km. Mirrors the
// legacy POST handler exactly.
export function buildCreateTripRow(
  input: CreateTripInput,
  ctx: { userId: string; defaultDate: string },
): BuildResult<Record<string, unknown>> {
  const startKm = normalizeOptionalKilometer(input.startKm);
  const endKm = normalizeOptionalKilometer(input.endKm);
  if (Number.isNaN(startKm) || Number.isNaN(endKm)) return { error: 'invalid_km' };

  return {
    row: {
      date: input.date?.trim() || ctx.defaultDate,
      start_address: input.startAddress == null ? '' : String(input.startAddress),
      end_address: input.endAddress == null ? '' : String(input.endAddress),
      start_km: startKm,
      end_km: endKm,
      note: normalizeOptionalText(input.note),
      user_id: ctx.userId,
      sales_person: normalizeOptionalText(input.salesPerson),
    },
  };
}

export type UpdateTripInput = {
  date?: string;
  startAddress?: string | null;
  endAddress?: string | null;
  startKm?: string | number | null;
  endKm?: string | number | null;
  note?: string | null;
};

// Build a partial update from only the provided fields. Mirrors the legacy PATCH
// handler exactly (undefined keys are skipped).
export function buildUpdateTripRow(body: UpdateTripInput): BuildResult<Record<string, unknown>> {
  const updates: Record<string, unknown> = {};
  if (body.date !== undefined) updates.date = body.date;
  if (body.startAddress !== undefined) updates.start_address = body.startAddress == null ? '' : String(body.startAddress);
  if (body.endAddress !== undefined) updates.end_address = body.endAddress == null ? '' : String(body.endAddress);
  if (body.startKm !== undefined) {
    const startKm = normalizeOptionalKilometer(body.startKm);
    if (Number.isNaN(startKm)) return { error: 'invalid_km' };
    updates.start_km = startKm;
  }
  if (body.endKm !== undefined) {
    const endKm = normalizeOptionalKilometer(body.endKm);
    if (Number.isNaN(endKm)) return { error: 'invalid_km' };
    updates.end_km = endKm;
  }
  if (body.note !== undefined) updates.note = normalizeOptionalText(body.note);
  return { row: updates };
}

// Resolve the [start, end) date bounds for a YYYY-MM month filter.
export function monthDateRange(ym: string): { start: string; end: string } {
  const [yStr, mStr] = ym.split('-');
  const y = Number(yStr);
  const m = Number(mStr); // 1-12
  const nextY = m === 12 ? y + 1 : y;
  const nextM = m === 12 ? 1 : m + 1;
  return {
    start: `${yStr}-${mStr.padStart(2, '0')}-01`,
    end: `${String(nextY)}-${String(nextM).padStart(2, '0')}-01`,
  };
}

// ── Queries ─────────────────────────────────────────────────────────────────

export type ListKorjournalTripsOptions = { userId: string; ym?: string };

export function listKorjournalTrips(supabase: SupabaseClient, { userId, ym }: ListKorjournalTripsOptions) {
  let query = supabase
    .from('korjournal_trips')
    .select(korjournalTripSelect)
    .eq('user_id', userId)
    .order('date', { ascending: false });
  if (ym) {
    const { start, end } = monthDateRange(ym);
    query = query.gte('date', start).lt('date', end);
  }
  return query;
}

export function createKorjournalTrip(supabase: SupabaseClient, row: Record<string, unknown>) {
  return supabase.from('korjournal_trips').insert(row).select(korjournalTripSelect).single();
}

export function updateKorjournalTrip(supabase: SupabaseClient, id: string, updates: Record<string, unknown>) {
  return supabase.from('korjournal_trips').update(updates).eq('id', id).select(korjournalTripSelect).maybeSingle();
}

export function deleteKorjournalTrip(supabase: SupabaseClient, id: string) {
  return supabase.from('korjournal_trips').delete().eq('id', id).limit(1);
}
