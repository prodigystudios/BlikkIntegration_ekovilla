import { getSupabaseAdmin } from '@/lib/supabase/server';
import { importTimeReferenceFromBlikk } from '@/lib/domains/time/blikkImport';
import { ok, requirePermission, routeError } from '@/app/api/time/_lib';

// POST /api/admin/time/import-from-blikk — engångsimport av referensdatan.
//
// Hämtar dagens tidkoder, internprojekt och frånvarotyper ur Blikk och lägger dem i våra egna
// tabeller. IDEMPOTENT: en omkörning friskar upp namn/kod/kommentarkrav men rör aldrig `payroll_code`,
// `sort_index` eller `is_active` — de sätts av en människa efter första importen, och en upsert
// skulle nolla dem (se splitForImport).
//
// Admin-klient med flit: importen skriver på hela företagets vägnar och läser Blikk med
// serverkrediter. Vakten står ändå i vägen — time.reference.manage finns bara på admin.
//
// Tillfällig: hela routen tas bort i fas 4.7 tillsammans med resten av Blikks tidyta.
export async function POST() {
  try {
    const gate = await requirePermission('time.reference.manage');
    if (gate.response || !gate.currentUser) return gate.response;

    const result = await importTimeReferenceFromBlikk(getSupabaseAdmin());
    return ok(result);
  } catch (e: any) {
    // 502, inte 500: felet kommer nästan alltid från Blikk-anropet (saknade credentials, 429, nere),
    // inte från oss. Meddelandet skickas vidare rått — det är en adminknapp, och den som trycker
    // på den ska kunna se vad Blikk faktiskt svarade i stället för "något gick fel".
    console.error('[tid] Import av referensdata från Blikk misslyckades:', e?.message);
    return routeError(502, 'time_reference_import_failed', e?.message || 'Importen från Blikk misslyckades');
  }
}
