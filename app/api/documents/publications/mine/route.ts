import { NextResponse } from 'next/server';
import { getCurrentUser } from '../../_util';
import { listMyPublicationAssignments, PublicationsRouteError } from '../_domain';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const current = await getCurrentUser();
    if (!current) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });

    const items = await listMyPublicationAssignments(current.id);
    return NextResponse.json({ ok: true, items }, { status: 200, headers: new Headers({ 'Cache-Control': 'no-store' }) });
  } catch (error: any) {
    const message = error instanceof PublicationsRouteError ? error.message : error?.message || 'unexpected_error';
    const status = error instanceof PublicationsRouteError ? error.status : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
