import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

export type UserRole = 'member' | 'sales' | 'admin' | 'konsult';

export type CurrentUser = {
  id: string;
  role: UserRole;
  name?: string | null;
};

function isReadonlyRole(role: unknown) {
  return role === 'konsult' || role === 'readonly';
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