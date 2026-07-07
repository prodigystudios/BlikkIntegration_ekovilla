import { NextRequest, NextResponse } from 'next/server';
import { getBlikk } from '@/lib/blikk';
import { requireAdminUser } from '@/lib/auth/route';

// Diagnostik (Steg 0): bekräftar vilka Blikk-kontaktfält som bär kundnummer, contactType
// (företag/privat) och ansvarig säljare, samt om ansvarig finns i listan eller bara på
// detaljen. Admin-only + ej i produktion. Kör t.ex. GET /api/blikk/contacts/probe?pageSize=5
export async function GET(req: NextRequest) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 });
  }
  const admin = await requireAdminUser();
  if (!admin) {
    return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
  }
  try {
    const { searchParams } = new URL(req.url);
    const pageSize = Number(searchParams.get('pageSize') || '5');
    const sample = Number(searchParams.get('sample') || '3');
    const data = await getBlikk().probeContacts({ pageSize, sample });
    return NextResponse.json({ ok: true, data });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'probe failed' }, { status: 500 });
  }
}
