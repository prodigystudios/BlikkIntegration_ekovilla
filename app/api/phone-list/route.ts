import { NextResponse } from 'next/server';
import { getOptionalSupabaseAdmin } from '@/lib/supabase/server';
import { loadPhoneListDocument } from '@/lib/phoneListStorage';
import { requirePermission } from '@/lib/auth/guards';

// Telefonlistan, läst med service-role. Inga anropare i appen i dag (2026-09-26), men rutten står kvar
// — alltså en grind, inte ett "inloggad räcker": samma nyckel som Kontaktlistan.
export async function GET() {
  const access = await requirePermission('app.contacts.read');
  if (access.response) return access.response;
  const json = await loadPhoneListDocument(getOptionalSupabaseAdmin());
  return NextResponse.json(json, { headers: { 'Cache-Control': 'no-store' } });
}
