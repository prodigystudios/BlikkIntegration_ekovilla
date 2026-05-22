import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '../_util';
import { PublicationsRouteError, createPublicationWithRecipients, listPublicationsForViewer } from './_domain';
import { createPublicationInputSchema, requireAdminUser, resolvePublicationRecipients } from './_lib';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const current = await getCurrentUser();
    if (!current) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const fileId = (searchParams.get('fileId') || '').trim();
    const items = await listPublicationsForViewer(current, fileId);

    return NextResponse.json({ ok: true, items }, { status: 200, headers: new Headers({ 'Cache-Control': 'no-store' }) });
  } catch (error: any) {
    const message = error instanceof PublicationsRouteError ? error.message : error?.message || 'unexpected_error';
    const status = error instanceof PublicationsRouteError ? error.status : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}

export async function POST(req: NextRequest) {
  try {
    const current = await requireAdminUser();
    if (!current) return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });

    const body = await req.json().catch(() => null);
    const parsed = createPublicationInputSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: parsed.error.issues[0]?.message || 'invalid_body' }, { status: 400 });
    }

    const resolvedRecipients = await resolvePublicationRecipients({
      userIds: parsed.data.userIds,
      tags: parsed.data.tags,
    });
    if (!resolvedRecipients.length) return NextResponse.json({ ok: false, error: 'missing recipients' }, { status: 400 });

    const publication = await createPublicationWithRecipients({
      currentUserId: current.id,
      input: parsed.data,
      recipients: resolvedRecipients,
    });

    return NextResponse.json({ ok: true, publication }, { status: 201 });
  } catch (error: any) {
    const message = error instanceof PublicationsRouteError ? error.message : error?.message || 'unexpected_error';
    const status = error instanceof PublicationsRouteError ? error.status : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
