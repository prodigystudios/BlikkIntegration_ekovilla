import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { getCurrentUser } from '../../../_util';
import { createPublicationOpenRedirectUrl, markPublicationOpenedForUser, PublicationsRouteError } from '../../_domain';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const current = await getCurrentUser();
    if (!current) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });

    const publicationId = String(params.id || '').trim();
    const supabase = createRouteHandlerClient({ cookies });
    await markPublicationOpenedForUser(supabase, publicationId, current.id);

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (error: any) {
    const message = error instanceof PublicationsRouteError ? error.message : error?.message || 'unexpected_error';
    const status = error instanceof PublicationsRouteError ? error.status : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const current = await getCurrentUser();
    if (!current) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });

    const publicationId = String(params.id || '').trim();
    const supabase = createRouteHandlerClient({ cookies });
    await markPublicationOpenedForUser(supabase, publicationId, current.id);
    const signedUrl = await createPublicationOpenRedirectUrl(supabase, publicationId);

    return NextResponse.redirect(signedUrl, { status: 302 });
  } catch (error: any) {
    const message = error instanceof PublicationsRouteError ? error.message : error?.message || 'unexpected_error';
    const status = error instanceof PublicationsRouteError ? error.status : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
