import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { getCurrentUser } from '../../_util';
import { createFileDownloadUrl, DocumentsFilesRouteError } from '../_domain';
import { downloadFileQuerySchema } from '../_lib';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const current = await getCurrentUser();
    if (!current) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const parsed = downloadFileQuerySchema.safeParse({
      id: searchParams.get('id'),
      download: searchParams.get('download'),
      redirect: searchParams.get('redirect'),
    });
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: parsed.error.issues[0]?.message || 'invalid_query' }, { status: 400 });
    }

    const supabase = createRouteHandlerClient({ cookies });
    const url = await createFileDownloadUrl(supabase, {
      id: parsed.data.id,
      download: parsed.data.download,
    });

    if (parsed.data.redirect) {
      return NextResponse.redirect(url, { status: 302 });
    }

    return NextResponse.json({ ok: true, url }, { status: 200, headers: new Headers({ 'Cache-Control': 'no-store' }) });
  } catch (error: any) {
    const message = error instanceof DocumentsFilesRouteError ? error.message : error?.message || 'unexpected_error';
    const status = error instanceof DocumentsFilesRouteError ? error.status : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
