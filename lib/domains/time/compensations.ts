import type { SupabaseClient } from '@supabase/supabase-js';

// Traktamenten, utlägg och milersättning — egna poster, inte fält på tidraden.
//
// Lönebyrån bad om "traktamenten, utlägg, milersättning med belopp och datum" (2026-08-11). De har
// egna datum och hör inte till ett visst arbetspass: ett utlägg kan finnas en dag man inte jobbat.
//
// `quantity` (mil eller dagar) och `amount` (kronor) lagras BÅDA. Vem som fyller i beloppet är en
// fråga om formuläret; i dag skriver den anställde det själv och ingen sats finns i koden. Skulle
// systemet en dag räkna ut milersättningen ur en sats ska beloppet ändå lagras — annars ändras
// gamla månaders underlag retroaktivt när satsen justeras.

export const COMPENSATION_KINDS = ['travel', 'per_diem', 'expense'] as const;
export type CompensationKind = (typeof COMPENSATION_KINDS)[number];

export const COMPENSATION_LABELS: Record<CompensationKind, string> = {
  travel: 'Milersättning',
  per_diem: 'Traktamente',
  expense: 'Utlägg',
};

// Enheten `quantity` mäts i, per sort. Utlägg har ingen — där är beloppet hela sanningen.
export const COMPENSATION_UNITS: Record<CompensationKind, string | null> = {
  travel: 'mil',
  per_diem: 'dagar',
  expense: null,
};

export const compensationSelect = 'id, user_id, entry_date, kind, quantity, amount, note, created_at, updated_at';

export type CompensationItem = {
  id: string;
  user_id: string;
  entry_date: string;
  kind: CompensationKind;
  quantity: number | null;
  amount: number;
  note: string | null;
  created_at?: string;
  updated_at?: string;
};

export type CompensationInput = {
  entry_date: string;
  kind: CompensationKind;
  quantity?: number | null;
  amount: number;
  note?: string | null;
};

export async function listCompensations(
  supabase: SupabaseClient,
  range: { from: string; to: string },
  opts?: { userId?: string },
) {
  let query = supabase
    .from('crm_time_compensations')
    .select(compensationSelect)
    .gte('entry_date', range.from)
    .lte('entry_date', range.to)
    .order('entry_date', { ascending: true });

  // Utan userId begränsar RLS ändå till den egna raden, om man inte har time.entry.read.all.
  if (opts?.userId) query = query.eq('user_id', opts.userId);

  return query;
}

export async function createCompensation(supabase: SupabaseClient, userId: string, input: CompensationInput) {
  return supabase
    .from('crm_time_compensations')
    .insert({ ...input, user_id: userId })
    .select(compensationSelect)
    .single();
}

// Ägarskopad, som tidraderna: en icke-ägares id matchar helt enkelt ingen rad.
export async function updateCompensation(
  supabase: SupabaseClient,
  id: string,
  userId: string,
  input: Partial<CompensationInput>,
) {
  return supabase
    .from('crm_time_compensations')
    .update(input)
    .eq('id', id)
    .eq('user_id', userId)
    .select(compensationSelect)
    .maybeSingle();
}

export async function deleteCompensation(supabase: SupabaseClient, id: string, userId: string) {
  return supabase
    .from('crm_time_compensations')
    .delete()
    .eq('id', id)
    .eq('user_id', userId)
    .select('id')
    .maybeSingle();
}

export type CompensationTotals = { kind: CompensationKind; quantity: number; amount: number; count: number };

// Summering per sort för underlagets ersättningsdel. Ren funktion — testbar utan databas.
export function summarizeCompensations(items: CompensationItem[]): CompensationTotals[] {
  const totals = new Map<CompensationKind, CompensationTotals>();
  for (const item of items) {
    const current = totals.get(item.kind) ?? { kind: item.kind, quantity: 0, amount: 0, count: 0 };
    current.quantity += Number(item.quantity ?? 0);
    // Number() och inte + : Postgres numeric kommer tillbaka som sträng via PostgREST, och
    // '120.50' + '80.25' hade blivit '120.5080.25'.
    current.amount += Number(item.amount ?? 0);
    current.count += 1;
    totals.set(item.kind, current);
  }
  return COMPENSATION_KINDS.map((kind) => totals.get(kind)).filter(Boolean) as CompensationTotals[];
}
