import { NextRequest, NextResponse } from 'next/server';
import { requireAdminUser } from '@/lib/auth/route';
import { getOptionalSupabaseAdmin } from '@/lib/supabase/server';

export async function GET() {
  const currentUser = await requireAdminUser();
  if (!currentUser) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const supabase = getOptionalSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: 'service role not configured' }, { status: 500 });

  // List auth users and join profiles
  const { data: authUsers, error: listErr } = await supabase.auth.admin.listUsers();
  if (listErr) return NextResponse.json({ error: listErr.message }, { status: 500 });

  // Fetch profiles in one query
  const ids = authUsers.users.map(u => u.id);
  let profiles: Record<string, { role: string; full_name: string | null; phone?: string | null }> = {};
  if (ids.length > 0) {
    const { data: profRows, error: profErr } = await supabase
      .from('profiles')
      .select('id, role, full_name, phone, tags')
      .in('id', ids);
    if (!profErr && profRows) {
      profRows.forEach(r => {
        profiles[r.id] = {
          role: r.role,
          full_name: (r as any).full_name ?? null,
          phone: (r as any).phone ?? null,
        } as any;
        (profiles as any)[r.id].tags = (r as any).tags || [];
      });
    }
  }

  const users = authUsers.users.map(u => ({
    id: u.id,
    email: u.email,
    created_at: u.created_at,
    role: profiles[u.id]?.role || 'member',
    full_name: profiles[u.id]?.full_name || null,
    phone: profiles[u.id]?.phone || null,
    tags: (profiles as any)[u.id]?.tags || []
  }));

  return NextResponse.json({ users });
}

export async function POST(req: NextRequest) {
  const currentUser = await requireAdminUser();
  if (!currentUser) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const supabase = getOptionalSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: 'service role not configured' }, { status: 500 });

  const body = await req.json();
  let { email, password, full_name, role } = body as { email: string; password: string; full_name?: string; role?: string };
  if (role === 'readonly') role = 'konsult';
  if (!email || !password) return NextResponse.json({ error: 'missing fields' }, { status: 400 });

  // Create auth user
  const { data: created, error: createErr } = await supabase.auth.admin.createUser({ email, password, email_confirm: true });
  if (createErr || !created?.user) return NextResponse.json({ error: createErr?.message || 'create failed' }, { status: 500 });

  const userId = created.user.id;

  // Optionally set name/role (role via SECURE function if different from default)
  if (full_name) {
    await supabase.from('profiles').update({ full_name }).eq('id', userId);
  }
  if (role && ['member','sales','admin','konsult'].includes(role) && role !== 'member') {
    // use function to ensure authorization semantics (runs SECURITY DEFINER)
    await supabase.rpc('set_user_role', { target: userId, new_role: role });
  }

  return NextResponse.json({ user: { id: userId, email, role: role || 'member', full_name: full_name || null, created_at: created.user.created_at } });
}
