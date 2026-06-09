import { ok, requirePermsAdmin, routeError } from '../../_lib';

type RouteContext = { params: { id: string } };

// GET a single user's permission state: their role, the role's bundle, their per-user
// overrides, and the resulting effective set. Read via the service-role client because
// user_permissions is self-read-only under RLS. Admin only.
export async function GET(_req: Request, context: RouteContext) {
  const ctx = await requirePermsAdmin();
  if ('response' in ctx) return ctx.response;
  const { admin } = ctx;
  const id = context.params.id;

  const { data: profile, error: profErr } = await admin
    .from('profiles').select('role').eq('id', id).maybeSingle();
  if (profErr) return routeError(500, 'profile_read_failed', profErr.message);
  const role = (profile as { role?: string } | null)?.role ?? 'member';

  const [{ data: rp, error: rpErr }, { data: up, error: upErr }] = await Promise.all([
    admin.from('role_permissions').select('permission_key').eq('role', role),
    admin.from('user_permissions').select('permission_key, effect').eq('user_id', id),
  ]);
  if (rpErr) return routeError(500, 'role_permissions_read_failed', rpErr.message);
  if (upErr) return routeError(500, 'user_permissions_read_failed', upErr.message);

  const roleKeys = (rp ?? []).map((r: any) => r.permission_key as string);
  const overrides = (up ?? []).map((r: any) => ({ key: r.permission_key as string, effect: r.effect as 'grant' | 'revoke' }));

  const effective = new Set(roleKeys);
  for (const o of overrides) {
    if (o.effect === 'grant') effective.add(o.key);
    if (o.effect === 'revoke') effective.delete(o.key);
  }

  return ok({ role, roleKeys, overrides, effective: [...effective] });
}
