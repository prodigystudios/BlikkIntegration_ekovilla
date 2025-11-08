import { NextRequest, NextResponse } from 'next/server';
import { getUserProfile } from '../../../../../lib/getUserProfile';
import { adminSupabase } from '../../../../../lib/adminSupabase';
import { getBlikk } from '../../../../../lib/blikk';

type BlikkUser = { id: number; email?: string | null; name?: string | null; fullName?: string | null; firstName?: string | null; lastName?: string | null };

async function requireAdmin() {
  const profile = await getUserProfile();
  if (!profile || profile.role !== 'admin') return null;
  return profile;
}

function normEmail(e?: string | null) {
  return (e || '').trim().toLowerCase();
}

function blikkUserSummary(u: any): BlikkUser {
  const name = u.name || u.fullName || [u.firstName, u.lastName].filter(Boolean).join(' ').trim();
  const email = u.email || u.Email || null;
  return { id: Number(u.id ?? u.userId ?? u.Id ?? u.UserId), email, name, fullName: u.fullName, firstName: u.firstName, lastName: u.lastName } as any;
}

export async function GET() {
  const current = await requireAdmin();
  if (!current) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  if (!adminSupabase) return NextResponse.json({ error: 'service role not configured' }, { status: 500 });

  // 1) List auth users to get emails
  const { data: authUsers, error: listErr } = await adminSupabase.auth.admin.listUsers();
  if (listErr) return NextResponse.json({ error: listErr.message }, { status: 500 });
  const auth = authUsers.users.map((u) => ({ id: u.id, email: u.email || '' }));
  const ids = auth.map((u) => u.id);

  // 2) Fetch profiles to read full_name, role, blikk_id
  const { data: profRows, error: profErr } = await adminSupabase
    .from('profiles')
    .select('id, role, full_name, blikk_id')
    .in('id', ids);
  if (profErr) return NextResponse.json({ error: profErr.message }, { status: 500 });
  const profById = new Map(profRows?.map((r) => [r.id, r]) || []);

  // 3) Fetch Blikk users (page through a bit to be safe)
  const blikk = getBlikk();
  const allBlikk: any[] = [];
  let page = 1;
  const pageSize = 100;
  for (let i = 0; i < 5; i++) {
    try {
      const res: any = await blikk.listUsers({ page, pageSize });
      const items = Array.isArray(res) ? res : res.items || res.data || [];
      if (!items.length) break;
      allBlikk.push(...items);
      if (items.length < pageSize) break;
      page += 1;
    } catch (e: any) {
      // Stop paging on error but keep what we have
      break;
    }
  }
  const blikkUsers: BlikkUser[] = allBlikk
    .map(blikkUserSummary)
    .filter((u) => Number.isFinite(u.id)) as any;

  const byEmail = new Map<string, BlikkUser>();
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

  return NextResponse.json({
    profiles,
    blikkUsers: blikkUsers.map((u) => ({ id: u.id, email: u.email || null, name: u.name || null })),
  });
}

export async function POST(req: NextRequest) {
  const current = await requireAdmin();
  if (!current) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  if (!adminSupabase) return NextResponse.json({ error: 'service role not configured' }, { status: 500 });

  const body = await req.json();
  const { userId, blikkId } = body as { userId: string; blikkId: number | null };
  if (!userId) return NextResponse.json({ error: 'missing userId' }, { status: 400 });
  // Allow clearing mapping by sending null
  const { error } = await adminSupabase.from('profiles').update({ blikk_id: blikkId }).eq('id', userId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
