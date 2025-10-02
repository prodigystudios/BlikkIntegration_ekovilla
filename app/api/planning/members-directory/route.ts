import { NextRequest, NextResponse } from 'next/server';
import { adminSupabase } from '@/lib/adminSupabase';

// Returns all users (profiles) with any recognized role so truck team assignment can list everyone.
// Uses service role (adminSupabase) to bypass RLS. Exposes only minimal safe fields.
export async function GET(_req: NextRequest) {
  if (!adminSupabase) {
    return NextResponse.json({ error: 'Service role not configured' }, { status: 500 });
  }
  try {
    const { data: profiles, error: profErr } = await adminSupabase
      .from('profiles')
      .select('id, full_name, role, email');
    if (profErr) throw profErr;

    const directory = (profiles || []).map(p => ({
      id: p.id,
      role: p.role,
      name: p.full_name || (p.email ? p.email.split('@')[0] : null)
    })).filter(d => d.name);

    // Deduplicate by id (should already be unique) and ensure name trimmed
    const cleaned = directory.map(d => ({ ...d, name: d.name!.trim() })).filter(d => d.name.length > 0);

    return NextResponse.json({ users: cleaned });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
