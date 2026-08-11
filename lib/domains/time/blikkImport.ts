import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchAllFromBlikk } from '@/lib/blikkCache';
import { TIME_REFERENCE_TABLES, type TimeReferenceKind } from './reference';

// ENGÅNGSIMPORT av referensdatan från Blikk — inte en löpande synk.
//
// Tidkoder, internprojekt och frånvarotyper bodde i Blikk och hämtades live vid varje modalöppning.
// Den här filen flyttar över dagens innehåll en gång; därefter äger admin listorna. Hela filen (och
// routen som anropar den) tas bort i fas 4.7 tillsammans med resten av Blikks tidyta.
//
// Blikks fältnamn varierar mellan endpoints och tenants — samma anledning som lib/blikkCache.ts och
// lib/blikk.ts är fulla av alias. Mappningen är därför utbruten som rena funktioner och testad:
// ett tyst fel här ger en tom eller felnamngiven lönesort, vilket märks först i lönekörningen.

export type MappedReferenceRow = {
  blikk_id: string;
  code: string | null;
  name: string;
  requires_note: boolean;
  is_active: boolean;
  billable?: boolean | null;
};

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return null;
}

function firstBoolean(...values: unknown[]): boolean | null {
  for (const value of values) if (typeof value === 'boolean') return value;
  return null;
}

// Blikk kallar id:t olika saker beroende på endpoint. Saknas det helt är raden oanvändbar — den
// kan inte kopplas tillbaka, och utan en stabil nyckel blir en omkörning en dubblett.
function blikkId(raw: Record<string, any>): string | null {
  return firstString(raw?.id, raw?.Id, raw?.timecodeId, raw?.TimecodeId, raw?.projectId, raw?.ProjectId);
}

// Namnet är det enda en människa känner igen listan på. Utan namn har raden inget värde i en
// dropdown, så den hoppas över hellre än att importeras som "Tidkod 4711".
function blikkName(raw: Record<string, any>): string | null {
  return firstString(raw?.name, raw?.title, raw?.displayName, raw?.Name);
}

export function mapBlikkTimeCode(raw: Record<string, any> | null | undefined): MappedReferenceRow | null {
  if (!raw) return null;
  const id = blikkId(raw);
  const name = blikkName(raw);
  if (!id || !name) return null;
  return {
    blikk_id: id,
    code: firstString(raw.code, raw.number, raw.Code),
    name,
    requires_note: firstBoolean(raw.commentRequiredWhenTimeReporting, raw.commentRequired) ?? false,
    // Saknad aktiv-flagga tolkas som AKTIV. En importerad rad som tyst blir inaktiv försvinner ur
    // formuläret utan att någon får veta varför; en synlig rad för mycket rättas på en sekund.
    is_active: firstBoolean(raw.isActive, raw.active) ?? true,
    billable: firstBoolean(raw.billable, raw.isBillable),
  };
}

// Internprojekt och frånvaroprojekt har identisk form hos Blikk (id, name, isActive,
// commentRequiredWhenTimeReporting) — samma mappning, olika måltabell.
export function mapBlikkProject(raw: Record<string, any> | null | undefined): MappedReferenceRow | null {
  if (!raw) return null;
  const id = blikkId(raw);
  const name = blikkName(raw);
  if (!id || !name) return null;
  return {
    blikk_id: id,
    code: firstString(raw.code, raw.number, raw.Code),
    name,
    requires_note: firstBoolean(raw.commentRequiredWhenTimeReporting, raw.commentRequired) ?? false,
    is_active: firstBoolean(raw.isActive, raw.active) ?? true,
  };
}

// Delar upp mot vad som redan finns, för importen får INTE skriva över admins kurering.
// `payroll_code`, `sort_index` och `is_active` sätts av en människa efter första importen; en
// omkörning ska bara friska upp namn/kod/kommentarkrav från Blikk. Därför två satser i stället för
// en upsert — en upsert skriver alla kolumner i raden och skulle nolla lönesorten.
export function splitForImport(
  mapped: MappedReferenceRow[],
  existingBlikkIds: Set<string>,
): { toCreate: MappedReferenceRow[]; toUpdate: MappedReferenceRow[] } {
  const toCreate: MappedReferenceRow[] = [];
  const toUpdate: MappedReferenceRow[] = [];
  const seen = new Set<string>();
  for (const row of mapped) {
    // Blikk kan returnera samma rad två gånger över sidgränser; en dubblett skulle annars ge ett
    // unique-fel som stoppar hela importen.
    if (seen.has(row.blikk_id)) continue;
    seen.add(row.blikk_id);
    (existingBlikkIds.has(row.blikk_id) ? toUpdate : toCreate).push(row);
  }
  return { toCreate, toUpdate };
}

export type ImportResult = { fetched: number; created: number; updated: number; skipped: number };

const BLIKK_PATHS: Record<TimeReferenceKind, string> = {
  time_code: process.env.BLIKK_TIMECODES_PATH || '/v1/Admin/Timecodes',
  internal_project: process.env.BLIKK_INTERNAL_PROJECTS_PATH || '/v1/Admin/InternalProjects',
  absence_type: process.env.BLIKK_ABSENCE_PROJECTS_PATH || '/v1/Admin/AbsenceProjects',
};

async function importKind(admin: SupabaseClient, kind: TimeReferenceKind): Promise<ImportResult> {
  const table = TIME_REFERENCE_TABLES[kind];
  const { items } = await fetchAllFromBlikk(BLIKK_PATHS[kind]);
  const mapper = kind === 'time_code' ? mapBlikkTimeCode : mapBlikkProject;
  const mapped = items.map((item) => mapper(item)).filter(Boolean) as MappedReferenceRow[];

  const { data: existing, error: readError } = await admin.from(table).select('blikk_id').not('blikk_id', 'is', null);
  if (readError) throw new Error(`Kunde inte läsa befintlig ${table}: ${readError.message}`);
  const existingIds = new Set((existing ?? []).map((row: { blikk_id: string | null }) => String(row.blikk_id)));

  const { toCreate, toUpdate } = splitForImport(mapped, existingIds);

  if (toCreate.length) {
    const { error } = await admin.from(table).insert(toCreate);
    if (error) throw new Error(`Kunde inte skapa rader i ${table}: ${error.message}`);
  }

  // En i taget: bara Blikk-ägda kolumner, och `.eq('blikk_id', …)` som nyckel. Antalet rader är
  // tiotal, inte tusental, så en batch vore optimering utan mätning.
  for (const row of toUpdate) {
    const patch: Record<string, unknown> = { code: row.code, name: row.name, requires_note: row.requires_note };
    if (kind === 'time_code') patch.billable = row.billable ?? null;
    const { error } = await admin.from(table).update(patch).eq('blikk_id', row.blikk_id);
    if (error) throw new Error(`Kunde inte uppdatera ${table} (${row.blikk_id}): ${error.message}`);
  }

  return {
    fetched: items.length,
    created: toCreate.length,
    updated: toUpdate.length,
    skipped: items.length - mapped.length,
  };
}

// Kör alla tre i sekvens. Sekventiellt med flit: Blikks API svarar 429 vid parallella skurar (se
// backoff-hanteringen i kundimporten), och en engångsknapp behöver inte vara snabb.
export async function importTimeReferenceFromBlikk(
  admin: SupabaseClient,
): Promise<Record<TimeReferenceKind, ImportResult>> {
  const timeCode = await importKind(admin, 'time_code');
  const internalProject = await importKind(admin, 'internal_project');
  const absenceType = await importKind(admin, 'absence_type');
  return { time_code: timeCode, internal_project: internalProject, absence_type: absenceType };
}
