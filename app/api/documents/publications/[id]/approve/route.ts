import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { getCurrentUser } from '../../../_util';
import { approvePublicationInputSchema } from '../../_lib';
import { approvePublicationForUser, PublicationsRouteError } from '../../_domain';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const current = await getCurrentUser();
    if (!current) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });

    const publicationId = String(params.id || '').trim();
    const body = await req.json().catch(() => null);
    const parsed = approvePublicationInputSchema.safeParse(body || {});
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: parsed.error.issues[0]?.message || 'invalid_body' }, { status: 400 });
    }

    const supabase = createRouteHandlerClient({ cookies });
    await approvePublicationForUser(supabase, {
      publicationId,
      userId: current.id,
      input: parsed.data,
    });

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (error: any) {
    const message = error instanceof PublicationsRouteError ? error.message : error?.message || 'unexpected_error';
    const status = error instanceof PublicationsRouteError ? error.status : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}