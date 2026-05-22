import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { getCurrentUser } from '../_util';
import { createFolderInputSchema, deleteFolderQuerySchema, renameFolderInputSchema } from './_lib';
import { createFolder, deleteFolder, DocumentsFoldersRouteError, renameFolder } from './_domain';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const current = await getCurrentUser();
    if (!current) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
    if (current.role !== 'admin') return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });

    const body = await req.json();
    const parsed = createFolderInputSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: parsed.error.issues[0]?.message || 'invalid_body' }, { status: 400 });
    }

    const supabase = createRouteHandlerClient({ cookies });
    const folder = await createFolder(supabase, { ...parsed.data, createdBy: current.id });
    return NextResponse.json({ ok: true, folder }, { status: 201 });
  } catch (error: any) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
    }

    const message = error instanceof DocumentsFoldersRouteError ? error.message : error?.message || 'unexpected_error';
    const status = error instanceof DocumentsFoldersRouteError ? error.status : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const current = await getCurrentUser();
    if (!current) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
    if (current.role !== 'admin') return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });

    const { searchParams } = new URL(req.url);
    const parsed = deleteFolderQuerySchema.safeParse({ id: (searchParams.get('id') || '').trim() });
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: parsed.error.issues[0]?.message || 'invalid_query' }, { status: 400 });
    }

    const supabase = createRouteHandlerClient({ cookies });
    await deleteFolder(supabase, parsed.data.id);
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (error: any) {
    const message = error instanceof DocumentsFoldersRouteError ? error.message : error?.message || 'unexpected_error';
    const status = error instanceof DocumentsFoldersRouteError ? error.status : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const current = await getCurrentUser();
    if (!current) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
    if (current.role !== 'admin') return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });

    const body = await req.json();
    const parsed = renameFolderInputSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: parsed.error.issues[0]?.message || 'invalid_body' }, { status: 400 });
    }

    const supabase = createRouteHandlerClient({ cookies });
    const folder = await renameFolder(supabase, parsed.data);
    return NextResponse.json({ ok: true, folder }, { status: 200 });
  } catch (error: any) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
    }

    const message = error instanceof DocumentsFoldersRouteError ? error.message : error?.message || 'unexpected_error';
    const status = error instanceof DocumentsFoldersRouteError ? error.status : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
