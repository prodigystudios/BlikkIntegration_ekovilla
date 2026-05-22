import { NextRequest } from 'next/server';
import { createAdminUserSchema, ok, requireUsersAdminContext, routeError, validationError } from './_lib';

export async function GET() {
  const context = await requireUsersAdminContext();
  if ('response' in context) return context.response;

  const { supabase } = context;

  // List auth users and join profiles
  const { data: authUsers, error: listErr } = await supabase.auth.admin.listUsers();
  if (listErr) return routeError(500, 'list_users_failed', listErr.message);

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

  return ok({ users }, { users });
}

export async function POST(req: NextRequest) {
  const context = await requireUsersAdminContext();
  if ('response' in context) return context.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return routeError(400, 'invalid_json', 'Invalid JSON');
  }

  const parsed = createAdminUserSchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error);

  const { supabase } = context;
  const { email, password, full_name, role } = parsed.data;

  // Create auth user
  const { data: created, error: createErr } = await supabase.auth.admin.createUser({ email, password, email_confirm: true });
  if (createErr || !created?.user) return routeError(500, 'create_user_failed', createErr?.message || 'Create failed');

  const userId = created.user.id;

  // Apply profile changes after auth user creation. Roll back auth user if follow-up writes fail.
  if (full_name) {
    const { error: nameErr } = await supabase.from('profiles').update({ full_name }).eq('id', userId);
    if (nameErr) {
      await supabase.auth.admin.deleteUser(userId);
      return routeError(500, 'profile_update_failed', nameErr.message);
    }
  }
  if (role && role !== 'member') {
    // use function to ensure authorization semantics (runs SECURITY DEFINER)
    const { error: roleErr } = await supabase.rpc('set_user_role', { target: userId, new_role: role });
    if (roleErr) {
      await supabase.auth.admin.deleteUser(userId);
      return routeError(500, 'role_update_failed', roleErr.message);
    }
  }

  const user = { id: userId, email, role: role || 'member', full_name: full_name || null, created_at: created.user.created_at, phone: null, tags: [] };
  return ok({ user }, { user }, 201);
}
