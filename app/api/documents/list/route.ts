import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { getCurrentUser } from '../_util';
import { DocumentsListRouteError, getDocumentsListData } from './_domain';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const current = await getCurrentUser();
    if (!current) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });

    const supabase = createRouteHandlerClient({ cookies });
    const { searchParams } = new URL(req.url);
    const folderId = (searchParams.get('folderId') || '').trim() || null;
    const result = await getDocumentsListData(supabase, {
      folderId,
      canEdit: current.role === 'admin',
    });

    return NextResponse.json({ ok: true, ...result }, { status: 200, headers: new Headers({ 'Cache-Control': 'no-store' }) });
  } catch (error: any) {
    const message = error instanceof DocumentsListRouteError ? error.message : error?.message || 'unexpected_error';
    const status = error instanceof DocumentsListRouteError ? error.status : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
