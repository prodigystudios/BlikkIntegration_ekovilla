import { NextRequest } from 'next/server';
import { ok, PERMISSION_ROLES, requirePermsAdmin, routeError, setPermissionSchema, validationError } from './_lib';

// GET: the permission catalog + each role's bundle. Admin only.
export async function GET() {
  const ctx = await requirePermsAdmin();
  if ('response' in ctx) return ctx.response;
  const { admin } = ctx;

  const [{ data: catalog, error: catErr }, { data: rows, error: rpErr }] = await Promise.all([
    admin.from('permissions').select('key, description').order('key'),
    admin.from('role_permissions').select('role, permission_key'),
  ]);
  if (catErr) return routeError(500, 'permissions_read_failed', catErr.message);
  if (rpErr) return routeError(500, 'role_permissions_read_failed', rpErr.message);

  const roleBundles: Record<string, string[]> = {};
  for (const r of PERMISSION_ROLES) roleBundles[r] = [];
  (rows ?? []).forEach((row: any) => {
    (roleBundles[row.role] ??= []).push(row.permission_key);
  });

  return ok({ catalog: catalog ?? [], roles: PERMISSION_ROLES, roleBundles });
}

// POST: toggle a role-bundle entry, or set/clear a per-user override. The SECURITY DEFINER
// setters run via the session client so they see the calling admin's auth.uid().
export async function POST(req: NextRequest) {
  const ctx = await requirePermsAdmin();
  if ('response' in ctx) return ctx.response;

  const parsed = setPermissionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return validationError(parsed.error);
  const { session } = ctx;
  const input = parsed.data;

  if (input.scope === 'role') {
    const { error } = await session.rpc('set_role_permission', {
      p_role: input.role, p_key: input.key, p_present: input.present,
    });
    if (error) return routeError(400, 'set_role_permission_failed', error.message);
  } else {
    const { error } = await session.rpc('set_user_permission', {
      p_user: input.userId, p_key: input.key, p_effect: input.effect,
    });
    if (error) return routeError(400, 'set_user_permission_failed', error.message);
  }

  return ok({ updated: true });
}
