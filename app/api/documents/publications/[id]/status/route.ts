import { NextResponse } from 'next/server';
import { requireAdminUser } from '../../_lib';
import { getPublicationStatus, PublicationsRouteError } from '../../_domain';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const current = await requireAdminUser();
    if (!current) return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });

    const publicationId = String(params.id || '').trim();
    const { publication, summary, items } = await getPublicationStatus(publicationId);

    return NextResponse.json({ ok: true, publication, summary, items }, { status: 200, headers: new Headers({ 'Cache-Control': 'no-store' }) });
  } catch (error: any) {
    const message = error instanceof PublicationsRouteError ? error.message : error?.message || 'unexpected_error';
    const status = error instanceof PublicationsRouteError ? error.status : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}