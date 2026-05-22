import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { getCurrentUser } from '../../_util';
import { DocumentsFilesRouteError, searchFiles } from '../_domain';
import { searchFilesQuerySchema } from '../_lib';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const current = await getCurrentUser();
    if (!current) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const parsed = searchFilesQuerySchema.safeParse({
      q: searchParams.get('q'),
      limit: searchParams.get('limit'),
    });

    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: parsed.error.issues[0]?.message || 'invalid_query' }, { status: 400 });
    }

    const supabase = createRouteHandlerClient({ cookies });
    const results = await searchFiles(supabase, parsed.data);
    return NextResponse.json({ ok: true, q: parsed.data.q, results }, { status: 200, headers: new Headers({ 'Cache-Control': 'no-store' }) });
  } catch (error: any) {
    const message = error instanceof DocumentsFilesRouteError ? error.message : error?.message || 'unexpected_error';
    const status = error instanceof DocumentsFilesRouteError ? error.status : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
