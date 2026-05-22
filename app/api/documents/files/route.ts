import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { getCurrentUser } from '../_util';
import { deleteFile, DocumentsFilesRouteError, uploadFile } from './_domain';
import { deleteFileQuerySchema, uploadFileInputSchema } from './_lib';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const current = await getCurrentUser();
    if (!current) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
    if (current.role !== 'admin') return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });

    const form = await req.formData();
    const parsed = uploadFileInputSchema.safeParse({
      file: form.get('file'),
      folderId: form.get('folderId'),
    });
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: parsed.error.issues[0]?.message || 'invalid_form_data' }, { status: 400 });
    }

    const supabase = createRouteHandlerClient({ cookies });
    const file = await uploadFile(supabase, {
      ...parsed.data,
      currentUserId: current.id,
    });

    return NextResponse.json({ ok: true, file }, { status: 201 });
  } catch (error: any) {
    const message = error instanceof DocumentsFilesRouteError ? error.message : error?.message || 'unexpected_error';
    const status = error instanceof DocumentsFilesRouteError ? error.status : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const current = await getCurrentUser();
    if (!current) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
    if (current.role !== 'admin') return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });

    const { searchParams } = new URL(req.url);
    const parsed = deleteFileQuerySchema.safeParse({ id: searchParams.get('id') });
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: parsed.error.issues[0]?.message || 'invalid_query' }, { status: 400 });
    }

    const supabase = createRouteHandlerClient({ cookies });
    await deleteFile(supabase, parsed.data.id);
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (error: any) {
    const message = error instanceof DocumentsFilesRouteError ? error.message : error?.message || 'unexpected_error';
    const status = error instanceof DocumentsFilesRouteError ? error.status : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
