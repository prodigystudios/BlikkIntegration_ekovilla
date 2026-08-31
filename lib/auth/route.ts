import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

export type UserRole = 'member' | 'sales' | 'admin' | 'konsult' | 'ekonomi';

export type CurrentUser = {
  id: string;
  role: UserRole;
  name?: string | null;
};

// ⚠️ Den här listan är enda vakten på sex routes som sedan kör getSupabaseAdmin() — service-role,
// alltså helt förbi RLS: planeringens truck-assignments create/update/delete, day-notes,
// consume-bags, samt work-orders/lookup. Det som INTE står här får skriva.
//
// `ekonomi` (lönebyrån) står därför här: hon är extern och ska inte skriva någonting i appen. Den
// enda skrivning hon gör alls är attesten, och den går genom set_time_period_status() som prövar
// time.approve internt — aldrig genom den här helpern.
//
// ⚠️ LISTAN HAR EN TVILLING I DATABASEN: `public.is_konsult_user()`, som bär `NOT ...` i
// write-policyerna på planning_segments och grannarna. De vaktar OLIKA vägar till samma tabeller —
// den här servervägen, tvillingen den direkta klientvägen — så en roll som bara läggs till på ett
// ställe är fortfarande skrivbehörig via det andra. Ändra alltid båda.
// Tvillingen ägs numera av supabase/sql/20260831_ekonomi_role_seed.sql.
function isReadonlyRole(role: unknown) {
  return role === 'konsult' || role === 'readonly' || role === 'ekonomi';
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const supabase = createRouteHandlerClient({ cookies });
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

  const supabase = createRouteHandlerClient({ cookies });
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

export async function forbidIfReadonly() {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  if (isReadonlyRole(currentUser.role)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  return null;
}