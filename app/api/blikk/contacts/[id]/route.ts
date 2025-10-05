import { NextRequest, NextResponse } from 'next/server';
import { getBlikk } from '@/lib/blikk';

// Lean contact by id endpoint (debug stripped)
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const idNum = Number(params.id);
  if (!Number.isFinite(idNum) || idNum <= 0) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  }
  try {
    const blikk = getBlikk();
    const data = await blikk.getContactById(idNum); // no debug/attempts exposure
    return NextResponse.json({ contact: data.contact }, { status: 200 });
  } catch (e: any) {
    const msg = String(e?.message || e);
    if (/404:/.test(msg) || /Contact not found/i.test(msg)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
