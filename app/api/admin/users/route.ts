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
  //
  // Rollen skrivs direkt mot profiles, samma väg som PATCH-routen. set_user_role() auktoriserar på
  // auth.uid(), och den här klienten är service-role utan sub-claim — funktionen svarade därför
  // alltid "not authorized" och rullade tillbaka hela skapandet. Anroparen är redan grindad av
  // requireUsersAdminContext().
  //
  // upsert i stället för update: profilraden läggs på plats av triggern on_auth_user_created, och
  // en update som inte träffar någon rad svarar error: null — rollen hade tappats tyst.
  const profileFields: Record<string, unknown> = {};
  if (full_name) profileFields.full_name = full_name;
  if (role) profileFields.role = role;

  if (Object.keys(profileFields).length > 0) {
    const { error: profileErr } = await supabase
      .from('profiles')
      .upsert({ id: userId, ...profileFields }, { onConflict: 'id' });
    if (profileErr) {
      await supabase.auth.admin.deleteUser(userId);
      // Läsbar text i `message`, databasens egen i `details` — samma uppdelning som PATCH på
      // [id]/route.ts. Ytan visar båda, så orsaken går fortfarande att se utan att gräva i loggen.
      return routeError(500, 'profile_update_failed', 'Kunde inte spara profiluppgifterna', profileErr.message);
    }
  }

  const user = { id: userId, email, role: role || 'member', full_name: full_name || null, created_at: created.user.created_at, phone: null, tags: [] };
  return ok({ user }, { user }, 201);
}
