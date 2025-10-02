import { NextRequest, NextResponse } from 'next/server';
import { adminSupabase } from '@/lib/adminSupabase';

// Returns all users (profiles) with role = sales or admin so the planning UI can build a complete filter list.
// Uses service role (adminSupabase) to bypass RLS limitations for read-only directory purposes.
// IMPORTANT: Only exposes minimal safe fields.
export async function GET(_req: NextRequest) {
  if (!adminSupabase) {
    return NextResponse.json({ error: 'Service role not configured' }, { status: 500 });
  }
  try {
    // Fetch profiles with desired roles
    const { data: profiles, error: profErr } = await adminSupabase
      .from('profiles')
      .select('id, full_name, role')
      .in('role', ['sales','admin']);
    if (profErr) throw profErr;

    // Optionally fetch auth emails for fallback names (only if needed)
    const missingNameIds = (profiles || []).filter(p => !p.full_name).map(p => p.id);
    let emailMap: Record<string,string> = {};
    if (missingNameIds.length) {
      // auth.users table is only accessible with service key (we have it)
      const { data: users, error: usersErr } = await adminSupabase
        .from('auth.users' as any)
        .select('id,email')
        .in('id', missingNameIds);
      if (!usersErr && Array.isArray(users)) {
        users.forEach(u => { if (u.email) emailMap[u.id] = u.email.split('@')[0]; });
      }
    }

    const directory = (profiles || []).map(p => ({
      id: p.id,
      role: p.role,
      name: p.full_name || emailMap[p.id] || null,
    })).filter(d => d.name);

    // Deduplicate by name (keep first occurrence)
    const seen = new Set<string>();
    const unique = directory.filter(d => { if (seen.has(d.name!)) return false; seen.add(d.name!); return true; });

    return NextResponse.json({ users: unique });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
