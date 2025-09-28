import { NextRequest, NextResponse } from 'next/server';
import { getUserProfile } from '../../../../lib/getUserProfile';
import { adminSupabase } from '../../../../lib/adminSupabase';

// Helper: ensure admin + service role client present
async function requireAdmin() {
  const profile = await getUserProfile();
  if (!profile || profile.role !== 'admin') return null;
  return profile;
}

export async function GET() {
  const profile = await requireAdmin();
  if (!profile) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  if (!adminSupabase) return NextResponse.json({ error: 'service role not configured' }, { status: 500 });

  // List auth users and join profiles
  const { data: authUsers, error: listErr } = await adminSupabase.auth.admin.listUsers();
  if (listErr) return NextResponse.json({ error: listErr.message }, { status: 500 });

  // Fetch profiles in one query
  const ids = authUsers.users.map(u => u.id);
  let profiles: Record<string, { role: string; full_name: string | null }> = {};
  if (ids.length > 0) {
    const { data: profRows, error: profErr } = await adminSupabase
      .from('profiles')
      .select('id, role, full_name')
      .in('id', ids);
    if (!profErr && profRows) {
      profRows.forEach(r => { profiles[r.id] = { role: r.role, full_name: (r as any).full_name ?? null }; });
    }
  }

  const users = authUsers.users.map(u => ({
    id: u.id,
    email: u.email,
    created_at: u.created_at,
    role: profiles[u.id]?.role || 'member',
    full_name: profiles[u.id]?.full_name || null
  }));

  return NextResponse.json({ users });
}

export async function POST(req: NextRequest) {
  const profile = await requireAdmin();
  if (!profile) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  if (!adminSupabase) return NextResponse.json({ error: 'service role not configured' }, { status: 500 });

  const body = await req.json();
  const { email, password, full_name, role } = body as { email: string; password: string; full_name?: string; role?: string };
  if (!email || !password) return NextResponse.json({ error: 'missing fields' }, { status: 400 });

  // Create auth user
  const { data: created, error: createErr } = await adminSupabase.auth.admin.createUser({ email, password, email_confirm: true });
  if (createErr || !created?.user) return NextResponse.json({ error: createErr?.message || 'create failed' }, { status: 500 });

  const userId = created.user.id;

  // Optionally set name/role (role via SECURE function if different from default)
  if (full_name) {
    await adminSupabase.from('profiles').update({ full_name }).eq('id', userId);
  }
  if (role && ['member','sales','admin'].includes(role) && role !== 'member') {
    // use function to ensure authorization semantics (runs SECURITY DEFINER)
    await adminSupabase.rpc('set_user_role', { target: userId, new_role: role });
  }

  return NextResponse.json({ user: { id: userId, email, role: role || 'member', full_name: full_name || null, created_at: created.user.created_at } });
}
