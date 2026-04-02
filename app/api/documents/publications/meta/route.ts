import { NextResponse } from 'next/server';
import { getRecipientMeta, requireAdminUser } from '../_lib';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const current = await requireAdminUser();
    if (!current) return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });
    const meta = await getRecipientMeta();
    return NextResponse.json({ ok: true, ...meta }, { status: 200 });
  } catch (error: any) {
    const message = error?.message === 'service_role_missing' ? 'service role not configured' : (error?.message || 'unexpected_error');
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
