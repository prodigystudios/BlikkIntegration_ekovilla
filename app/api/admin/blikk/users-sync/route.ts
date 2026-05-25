import { NextRequest } from 'next/server';
import { getBlikk } from '../../../../../lib/blikk';
import { blikkUserSummary, normEmail, ok, requireBlikkUsersSyncContext, routeError, updateBlikkMappingSchema, validationError } from './_lib';

export async function GET() {
  const context = await requireBlikkUsersSyncContext();
  if ('response' in context) return context.response;

  const { supabase } = context;

  // 1) List auth users to get emails
  const { data: authUsers, error: listErr } = await supabase.auth.admin.listUsers();
  if (listErr) return routeError(500, 'list_users_failed', listErr.message);
  const auth = authUsers.users.map((u) => ({ id: u.id, email: u.email || '' }));
  const ids = auth.map((u) => u.id);

  // 2) Fetch profiles to read full_name, role, blikk_id
  const { data: profRows, error: profErr } = await supabase
    .from('profiles')
    .select('id, role, full_name, blikk_id')
    .in('id', ids);
  if (profErr) return routeError(500, 'profiles_query_failed', profErr.message);
  const profById = new Map(profRows?.map((r) => [r.id, r]) || []);

  // 3) Fetch Blikk users (page through a bit to be safe)
  const blikk = getBlikk();
  const allBlikk: any[] = [];
  let page = 1;
  const pageSize = 100;
  let blikkLoadFailed: string | null = null;
  for (let i = 0; i < 5; i++) {
    try {
      const res: any = await blikk.listUsers({ page, pageSize });
      const items = Array.isArray(res) ? res : res.items || res.data || [];
      if (!items.length) break;
      allBlikk.push(...items);
      if (items.length < pageSize) break;
      page += 1;
    } catch (error) {
      blikkLoadFailed = error instanceof Error ? error.message : 'Failed loading Blikk users';
      // Stop paging on error but keep what we have.
      break;
    }
  }
  if (blikkLoadFailed && allBlikk.length === 0) {
    return routeError(502, 'blikk_users_load_failed', 'Failed loading Blikk users', blikkLoadFailed);
  }

  const blikkUsers = allBlikk
    .map(blikkUserSummary)
    .filter((u) => Number.isFinite(u.id));

  const byEmail = new Map<string, (typeof blikkUsers)[number]>();
  for (const u of blikkUsers) {
    const e = normEmail(u.email);
    if (e && !byEmail.has(e)) byEmail.set(e, u); // prefer first occurrence
  }

  // 4) Build response list with bestMatch via email
  const profiles = auth.map((u) => {
    const prof = profById.get(u.id);
    const email = normEmail(u.email);
    const best = email ? byEmail.get(email) || null : null;
    return {
      id: u.id,
      email: u.email,
      role: prof?.role || 'member',
      full_name: prof?.full_name || null,
      blikk_id: (prof as any)?.blikk_id ?? null,
      bestMatch: best ? { id: best.id, email: best.email || null, name: best.name || null } : null,
    };
  });

  const responseData = {
    profiles,
    blikkUsers: blikkUsers.map((u) => ({ id: u.id, email: u.email || null, name: u.name || null })),
  };

  return ok(responseData, responseData);
}

export async function POST(req: NextRequest) {
  const context = await requireBlikkUsersSyncContext();
  if ('response' in context) return context.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return routeError(400, 'invalid_json', 'Invalid JSON');
  }

  const parsed = updateBlikkMappingSchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error);

  const { supabase } = context;
  const { userId, blikkId } = parsed.data;
  // Allow clearing mapping by sending null
  const { error } = await supabase.from('profiles').update({ blikk_id: blikkId }).eq('id', userId);
  if (error) return routeError(500, 'mapping_update_failed', error.message);
  return ok({ userId, blikkId }, { userId, blikkId });
}
