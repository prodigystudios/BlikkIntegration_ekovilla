import { createSessionClient } from '@/lib/supabase/session';
import { NextResponse } from 'next/server';
import { getEffectivePermissions } from './permissions';
import type { UserRole } from '@/lib/roles';

export type { UserRole } from '@/lib/roles';

export type CurrentUser = {
  id: string;
  role: UserRole;
  name?: string | null;
};


export async function getCurrentUser(): Promise<CurrentUser | null> {
  const supabase = createSessionClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, full_name')
    .eq('id', user.id)
    .maybeSingle();

  const role = (profile as any)?.role as UserRole | undefined;

  return {
    id: user.id,
    role: role || 'member',
    name: (profile as any)?.full_name ?? null,
  };
}

export async function requireAdminUser() {
  const currentUser = await getCurrentUser();
  if (!currentUser || currentUser.role !== 'admin') return null;
  return currentUser;
}

// Fault-report supervisor guard. Reads the SAME source as the fault_reports RLS
// (is_fault_report_recipient) via the session client, so the route check and RLS agree. Returns
// the { currentUser, response } shape the CRM guards use.
export async function requireFaultReportRecipient() {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return { currentUser: null, response: NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 }) };
  }

  const supabase = createSessionClient();
  const { data, error } = await supabase
    .from('fault_report_recipients')
    .select('user_id')
    .eq('user_id', currentUser.id)
    .eq('active', true)
    .maybeSingle();

  if (error || !data) {
    return { currentUser: null, response: NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 }) };
  }

  return { currentUser, response: null as null };
}

// Skrivspärren för externa parter. ⚠️ Enda vakten på sex routes som sedan kör getSupabaseAdmin() —
// service-role, helt förbi RLS: planeringens truck-assignments create/update/delete, day-notes,
// consume-bags, samt work-orders/lookup.
//
// Kräver app.staff (intern personal: member, sales, admin). konsult och lönebyrån (ekonomi) saknar
// den. Förr en rollista (isReadonlyRole) — och den failade ÖPPET: getCurrentUser() svarar
// `role || 'member'` när profilläsningen fallerar, så en konsult blev 'member' och släpptes igenom.
// Nyckeln failar STÄNGT: ett fel i effective_permissions ger en tom mängd och 403.
//
// Tvillingen i databasen, public.is_konsult_user() (NOT … i write-policyerna på planning_*), är
// fortfarande en rollista. Den skyddar bara gamla planeringens tabeller och tas bort med dem.
export async function forbidIfReadonly() {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const permissions = await getEffectivePermissions();
  if (!permissions.has('app.staff')) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  return null;
}