import type { SupabaseClient } from '@supabase/supabase-js';
import { minutesToHours } from './hours';

// Revisionsloggen för tidrader — läsningen.
//
// Skrivningen sköts av en databastrigger (20260814_time_admin_corrections.sql) och kan inte
// kringgås. Det här är den andra halvan: en logg ingen läser är inte en logg, den är en förklaring
// man tänkte ge.
//
// ⚠️ BARA ÄNDRINGAR AV NÅGON ANNANS TID FINNS HÄR. Triggern hoppar över egna ändringar med flit —
// varje sparning i /tid hade annars dränkt de rader man faktiskt vill hitta. En tom logg betyder
// alltså "ingen annan har rört din tid", inte "ingenting har hänt".
//
// Vem som får läsa avgörs av RLS: den vars tid det gäller, och den som har time.entry.read.all.

export type TimeEntryAuditRow = {
  id: string;
  entry_id: string;
  user_id: string;
  /** Null = okänd aktör (servicenyckel eller SQL-editor). */
  changed_by: string | null;
  action: 'insert' | 'update' | 'delete';
  before_data: Record<string, unknown> | null;
  after_data: Record<string, unknown> | null;
  created_at: string;
  changed_by_profile?: { full_name: string | null } | null;
};

export const timeEntryAuditSelect =
  'id, entry_id, user_id, changed_by, action, before_data, after_data, created_at, changed_by_profile:profiles!changed_by(full_name)';

/**
 * Loggrader för ett datumintervall.
 *
 * Intervallet gäller RADENS arbetsdatum, inte när ändringen gjordes: frågan man ställer är "har
 * någon rört augusti?", inte "vad hände i augusti". En rättelse i september av en augustidag hör
 * till augusti.
 *
 * Datumet läses ur `before_data` för en radering och ur `after_data` annars — en raderad rad har
 * inget efteråt, och en ny inget innan. Filtreringen sker i JS eftersom värdet bor i jsonb och ett
 * uttrycksfilter mot PostgREST hade varit svårare att läsa än den här kommentaren.
 */
export async function listTimeEntryAudit(
  supabase: SupabaseClient,
  opts: { userId?: string; limit?: number } = {},
) {
  let query = supabase
    .from('crm_time_entry_audit')
    .select(timeEntryAuditSelect)
    .order('created_at', { ascending: false })
    // Rundligt tilltaget: loggen innehåller bara ANDRAS ändringar, som per konstruktion är
    // undantag. Filtreringen på arbetsdatum sker i JS (värdet bor i jsonb), så en för snäv gräns
    // hade tyst svarat "ingen har rört månaden" om en äldre månad — därför hellre en gräns ingen
    // realistisk mängd rättelser når.
    .limit(opts.limit ?? 1000);

  // Utan userId begränsar RLS till den egna tiden, om man inte har time.entry.read.all.
  if (opts.userId) query = query.eq('user_id', opts.userId);

  return query;
}

/** Radens arbetsdatum, oavsett om den skapades, ändrades eller togs bort. */
export function auditWorkDate(row: Pick<TimeEntryAuditRow, 'before_data' | 'after_data'>): string | null {
  const source = row.after_data ?? row.before_data;
  const value = source?.work_date;
  return typeof value === 'string' ? value : null;
}

export function auditInRange(row: TimeEntryAuditRow, range: { from: string; to: string }): boolean {
  const date = auditWorkDate(row);
  return !!date && date >= range.from && date <= range.to;
}

// ── Vad som faktiskt ändrades ────────────────────────────────────────────────

/**
 * En ändrad uppgift. `null` betyder ALLTID "tomt" — aldrig "vet ej".
 *
 * ⚠️ Överlasta inte `to` med en sentinel. En tidigare version skrev jobbytet som `to: null` och
 * lät vyn hoppa över pilen, vilket gjorde att en TÖMD anteckning ritades som bara sitt gamla värde
 * — "Anteckning: Fel" läste som det som står där nu, tvärtom mot vad som hänt.
 */
export type AuditChange = { label: string; from: string | null; to: string | null };

const CLOCK_FIELDS = ['start_time', 'end_time'] as const;

function clock(value: unknown): string | null {
  return typeof value === 'string' ? value.slice(0, 5) : null;
}

function hours(value: unknown): string | null {
  const minutes = typeof value === 'number' ? value : null;
  return minutes == null ? null : `${minutesToHours(minutes).toFixed(2).replace('.', ',')} h`;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

const KIND_LABELS: Record<string, string> = {
  work_order: 'Arbetsorder',
  internal: 'Intern tid',
  absence: 'Frånvaro',
};

/**
 * Skillnaden mellan före och efter, i klartext.
 *
 * ⚠️ MÅL-ID:N ÖVERSÄTTS INTE TILL NAMN. Loggen sparar radens uuid:n, och att slå upp dem här hade
 * krävt en join per rad mot fyra tabeller — varav några kan ha hunnit ändras sedan dess, vilket
 * gjort loggen till en beskrivning av NUET i stället för av vad som hände. Ett byte redovisas
 * därför som ett byte, utan att låtsas namnge det. Klockslag, minuter, datum och anteckning är
 * däremot självförklarande och visas som de är.
 */
export function describeAuditChange(row: Pick<TimeEntryAuditRow, 'action' | 'before_data' | 'after_data'>): AuditChange[] {
  if (row.action !== 'update') return [];
  const before = row.before_data ?? {};
  const after = row.after_data ?? {};
  const changes: AuditChange[] = [];

  const push = (label: string, from: string | null, to: string | null) => {
    if (from !== to) changes.push({ label, from, to });
  };

  for (const field of CLOCK_FIELDS) {
    push(field === 'start_time' ? 'Starttid' : 'Sluttid', clock(before[field]), clock(after[field]));
  }
  push('Rast', text(String(before.break_minutes ?? '')), text(String(after.break_minutes ?? '')));
  push('Arbetad tid', hours(before.minutes_worked), hours(after.minutes_worked));
  push('Datum', text(before.work_date), text(after.work_date));
  push('Sort', KIND_LABELS[String(before.kind)] ?? null, KIND_LABELS[String(after.kind)] ?? null);
  push('Anteckning', text(before.note), text(after.note));

  // Målbytet redovisas som ett faktum, inte som två uuid:n.
  const targets = ['work_order_id', 'internal_project_id', 'absence_type_id'] as const;
  if (targets.some((field) => before[field] !== after[field])) {
    changes.push({ label: 'Jobb eller orsak', from: null, to: 'ändrat' });
  }

  return changes;
}

export function auditActionLabel(action: TimeEntryAuditRow['action']): string {
  if (action === 'delete') return 'Raden togs bort';
  if (action === 'insert') return 'Raden lades till';
  return 'Raden ändrades';
}
